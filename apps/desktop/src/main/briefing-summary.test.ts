import { describe, expect, it, vi, type Mock } from 'vitest'
import { Logger, MemorySink } from '@nexa/observability'
import { buildBriefing, type Briefing } from '@nexa/daily-briefing'
import type { ChatRequest, ChatResult, RequestContext } from '@nexa/llm-client'
import {
  buildSummaryPrompt,
  normalizeSummary,
  summarizeBriefing,
  type BriefingSummaryLlm,
} from './briefing-summary.js'

type CompleteMock = Mock<(request: ChatRequest, ctx: RequestContext) => Promise<ChatResult>>

function reply(text: string): ChatResult {
  return { text, toolCalls: [], finishReason: 'stop' }
}

const NOW = new Date('2026-09-01T03:00:00.000Z')

function briefingWith(count = 2): Briefing {
  return buildBriefing({
    now: NOW,
    timeZoneOffsetMinutes: 420,
    commitments: Array.from({ length: count }, (_, index) => ({
      id: `c${String(index)}`,
      title: `Việc số ${String(index)}`,
      nextAction: null,
      status: 'active',
      dueAt: '2026-08-30T03:00:00.000Z',
      checkInAt: null,
      sourceConversationId: null,
      updatedAt: '2026-08-29T03:00:00.000Z',
    })),
    issues: [],
  })
}

function deps(over: {
  readonly enabled?: boolean
  readonly complete?: CompleteMock
  readonly provider?: 'litellm' | 'openai'
} = {}) {
  const sink = new MemorySink()
  const complete: CompleteMock =
    over.complete ?? (vi.fn().mockResolvedValue(reply('Có hai việc quá hạn.')) as CompleteMock)
  return {
    sink,
    complete,
    deps: {
      enabled: () => over.enabled ?? true,
      resolveModel: () => ({ modelId: 'm1', provider: over.provider ?? ('litellm' as const) }),
      buildLlmClient: (): BriefingSummaryLlm => ({ complete }),
      timeoutMs: () => 30_000,
      logger: new Logger({ sink, minLevel: 'debug' }),
    },
  }
}

describe('normalizeSummary', () => {
  it('gỡ hàng rào markdown model hay thêm', () => {
    expect(normalizeSummary('```\nHai việc quá hạn.\n```')).toBe('Hai việc quá hạn.')
  })

  it('từ chối chuỗi rỗng', () => {
    expect(normalizeSummary('   ')).toBeNull()
  })

  it('từ chối đoạn dài bất thường', () => {
    expect(normalizeSummary('a'.repeat(5_000))).toBeNull()
  })
})

describe('buildSummaryPrompt', () => {
  it('chỉ chứa mục đã chốt, kèm mức khẩn', () => {
    const prompt = buildSummaryPrompt(briefingWith(1))
    expect(prompt).toContain('Quá hạn:')
    expect(prompt).toContain('Việc số 0')
    expect(prompt).toContain('quá hạn 2 ngày')
  })

  it('giới hạn số mục đưa vào prompt', () => {
    const prompt = buildSummaryPrompt(briefingWith(40))
    const bullets = prompt.split('\n').filter((line) => line.startsWith('- '))
    expect(bullets.length).toBeLessThanOrEqual(15)
  })
})

describe('summarizeBriefing', () => {
  it('cờ tắt thì không gọi model lần nào', async () => {
    const { deps: d, complete } = deps({ enabled: false })
    const summary = await summarizeBriefing(briefingWith(), d)
    expect(summary).toEqual({ status: 'disabled', text: null })
    expect(complete).not.toHaveBeenCalled()
  })

  it('bản tin rỗng thì không gọi model', async () => {
    const { deps: d, complete } = deps()
    const summary = await summarizeBriefing(briefingWith(0), d)
    expect(summary.status).toBe('disabled')
    expect(complete).not.toHaveBeenCalled()
  })

  it('trả đoạn dẫn khi model trả lời hợp lệ', async () => {
    const { deps: d } = deps()
    const summary = await summarizeBriefing(briefingWith(), d)
    expect(summary).toEqual({ status: 'ok', text: 'Có hai việc quá hạn.' })
  })

  it('model lỗi thì bản tin mất đoạn dẫn chứ không hỏng', async () => {
    const { deps: d } = deps({
      complete: vi.fn().mockRejectedValue(new Error('502')) as CompleteMock,
    })
    const summary = await summarizeBriefing(briefingWith(), d)
    expect(summary).toEqual({ status: 'unavailable', text: null })
  })

  it('giữ lại nội dung công việc với provider ngoài tổ chức', async () => {
    const { deps: d, complete } = deps({ provider: 'openai' })
    const summary = await summarizeBriefing(briefingWith(), d)
    expect(summary).toEqual({ status: 'unavailable', text: null })
    expect(complete).not.toHaveBeenCalled()
  })

  it('model nói thêm việc không có thật cũng không đổi được danh sách mục', async () => {
    const briefing = briefingWith(1)
    const { deps: d } = deps({
      complete: vi
        .fn()
        .mockResolvedValue(
          reply('Bạn còn phải nộp báo cáo thuế và họp với giám đốc lúc 15h.'),
        ) as CompleteMock,
    })

    const summary = await summarizeBriefing(briefing, d)

    // Đoạn văn được nhận nguyên vẹn — nhưng nó KHÔNG phải nguồn dữ liệu: bản tin vẫn đúng một mục.
    expect(summary.status).toBe('ok')
    expect(briefing.totalItems).toBe(1)
    expect(briefing.groups.flatMap((g) => g.items).map((i) => i.title)).toEqual(['Việc số 0'])
  })

  it('không ghi câu lỗi của provider vào log', async () => {
    const { deps: d, sink } = deps({
      complete: vi
        .fn()
        .mockRejectedValue(new Error('prompt echoed: Chốt hợp đồng ABBANK')) as CompleteMock,
    })
    await summarizeBriefing(briefingWith(), d)
    expect(sink.asText()).not.toContain('ABBANK')
  })
})
