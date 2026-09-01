import { describe, expect, it, vi, type Mock } from 'vitest'
import { DEFAULT_APP_SETTINGS, type AppSettings, type Commitment } from '@nexa/shared-types'
import { Logger, MemorySink } from '@nexa/observability'
import type { CommitmentRepository } from '@nexa/local-store'
import type { AtlassianMcpManager } from '@nexa/atlassian-mcp-manager'
import type { ChatRequest, ChatResult, RequestContext } from '@nexa/llm-client'
import { DailyBriefingService, type DailyBriefingDeps } from './briefing-service.js'
import type { BriefingSummaryLlm } from './briefing-summary.js'

type CompleteMock = Mock<(request: ChatRequest, ctx: RequestContext) => Promise<ChatResult>>

const PROFILE = 'profile-1'
const NOW = new Date('2026-09-01T03:00:00.000Z') // 10:00 giờ Việt Nam

function commitment(over: Partial<Commitment> = {}): Commitment {
  return {
    id: 'c1',
    profileId: PROFILE,
    title: 'Chốt hợp đồng ABBANK',
    nextAction: 'Gửi bản cuối',
    status: 'active',
    dueAt: '2026-08-31T03:00:00.000Z',
    checkInAt: null,
    completedAt: null,
    sourceConversationId: null,
    createdBy: 'user',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-30T00:00:00.000Z',
    ...over,
  }
}

function jiraPayload(issues: unknown[]): string {
  return JSON.stringify({ total: issues.length, issues })
}

interface Harness {
  readonly service: DailyBriefingService
  readonly sink: MemorySink
  readonly listSpy: ReturnType<typeof vi.fn>
  readonly callTool: ReturnType<typeof vi.fn>
  readonly complete: CompleteMock
}

function harness(over: {
  readonly commitments?: readonly Commitment[]
  readonly settings?: Partial<AppSettings>
  readonly mcp?: AtlassianMcpManager | null
  readonly callTool?: ReturnType<typeof vi.fn>
  readonly complete?: CompleteMock
  readonly now?: () => Date
} = {}): Harness {
  const sink = new MemorySink()
  const listSpy = vi.fn().mockReturnValue([...(over.commitments ?? [])])
  const callTool = over.callTool ?? vi.fn().mockResolvedValue({ rawText: jiraPayload([]) })
  const complete: CompleteMock =
    over.complete ??
    (vi.fn().mockResolvedValue({
      text: 'Hôm nay có việc quá hạn.',
      toolCalls: [],
      finishReason: 'stop',
    }) as CompleteMock)

  const deps: DailyBriefingDeps = {
    profileId: PROFILE,
    commitments: { list: listSpy } as unknown as CommitmentRepository,
    settings: () => ({ ...DEFAULT_APP_SETTINGS, ...over.settings }),
    mcp:
      over.mcp === null
        ? () => null
        : () => ({ callTool } as unknown as AtlassianMcpManager),
    jiraBaseUrl: () => 'https://jira.corp.local/',
    summary: {
      resolveModel: () => ({ modelId: 'gpt-4o-mini', provider: 'litellm' }),
      buildLlmClient: (): BriefingSummaryLlm => ({ complete }),
      timeoutMs: () => 30_000,
    },
    logger: new Logger({ sink, minLevel: 'debug' }),
    now: over.now ?? (() => NOW),
    timeZoneOffsetMinutes: () => 420,
  }

  return { service: new DailyBriefingService(deps), sink, listSpy, callTool, complete }
}

describe('DailyBriefingService — ghép hai nguồn', () => {
  it('ghép cam kết và issue vào cùng bản tin', async () => {
    const { service } = harness({
      commitments: [commitment()],
      callTool: vi.fn().mockResolvedValue({
        rawText: jiraPayload([
          { key: 'DT-1', summary: 'Sửa lỗi đăng nhập', duedate: '2026-09-01' },
        ]),
      }),
    })

    const view = await service.get()

    expect(view.enabled).toBe(true)
    expect(view.localDate).toBe('2026-09-01')
    expect(view.totalItems).toBe(2)
    expect(view.groups.find((g) => g.group === 'overdue')?.items[0]?.id).toBe('commitment:c1')
    expect(view.groups.find((g) => g.group === 'due_today')?.items[0]?.id).toBe('jira:DT-1')
  })

  it('dựng link issue từ base URL đã cấu hình', async () => {
    const { service } = harness({
      callTool: vi
        .fn()
        .mockResolvedValue({ rawText: jiraPayload([{ key: 'DT-9', summary: 'A' }]) }),
    })
    const view = await service.get()
    const item = view.groups.flatMap((g) => g.items).find((i) => i.id === 'jira:DT-9')
    expect(item?.url).toBe('https://jira.corp.local/browse/DT-9')
  })

  it('chỉ lấy cam kết đang chạy, bỏ cam kết đã tạm gác', async () => {
    const { service } = harness({
      commitments: [
        commitment({ id: 'active-1', status: 'active' }),
        commitment({ id: 'blocked-1', status: 'blocked' }),
        commitment({ id: 'paused-1', status: 'paused' }),
      ],
    })
    const ids = (await service.get()).groups.flatMap((g) => g.items).map((i) => i.id)
    expect(ids).toContain('commitment:active-1')
    expect(ids).toContain('commitment:blocked-1')
    expect(ids).not.toContain('commitment:paused-1')
  })

  it('bind vào profile hiện tại', async () => {
    const { service, listSpy } = harness({ commitments: [commitment()] })
    await service.get()
    expect(listSpy).toHaveBeenCalledWith(PROFILE, { includeCompleted: false })
  })
})

describe('DailyBriefingService — hỏng một nguồn', () => {
  it('vẫn trả phần cam kết khi Jira lỗi', async () => {
    const { service } = harness({
      commitments: [commitment()],
      callTool: vi.fn().mockRejectedValue(new Error('gateway down')),
    })

    const view = await service.get()

    expect(view.totalItems).toBe(1)
    expect(view.sources.find((s) => s.source === 'jira')?.status).toBe('error')
    expect(view.sources.find((s) => s.source === 'commitment')?.status).toBe('ok')
  })

  it('phân biệt "chưa kết nối Jira" với "không có việc nào"', async () => {
    const { service } = harness({ mcp: null, commitments: [commitment()] })
    const view = await service.get()
    const jira = view.sources.find((s) => s.source === 'jira')
    expect(jira?.status).toBe('not_configured')
    expect(jira?.itemCount).toBe(0)
  })

  it('cờ jiraSearch tắt thành trạng thái chính sách, không phải lỗi', async () => {
    const { service, callTool } = harness({
      settings: { features: { ...DEFAULT_APP_SETTINGS.features, jiraSearch: false } },
    })
    const view = await service.get()
    expect(view.sources.find((s) => s.source === 'jira')?.status).toBe('disabled_by_policy')
    expect(callTool).not.toHaveBeenCalled()
  })

  it('báo phần Jira còn sót lại thay vì im lặng cắt', async () => {
    const { service } = harness({
      callTool: vi.fn().mockResolvedValue({
        rawText: JSON.stringify({ total: 90, issues: [{ key: 'DT-1', summary: 'A' }] }),
      }),
    })
    const view = await service.get()
    expect(view.sources.find((s) => s.source === 'jira')?.truncatedCount).toBe(89)
  })
})

describe('DailyBriefingService — cache', () => {
  it('mở lại trong cùng ngày dùng cache, không gọi lại Jira', async () => {
    const { service, callTool } = harness()
    await service.get()
    await service.get()
    expect(callTool).toHaveBeenCalledTimes(1)
  })

  it('làm mới tường minh thì gọi lại nguồn', async () => {
    const { service, callTool } = harness()
    await service.get()
    await service.refresh()
    expect(callTool).toHaveBeenCalledTimes(2)
  })

  it('không cache một lần Jira hỏng tạm thời — mở lại Today là thử lại', async () => {
    const callTool = vi.fn().mockRejectedValue(new Error('gateway down'))
    const { service } = harness({ callTool })
    await service.get()
    await service.get()
    expect(callTool).toHaveBeenCalledTimes(2)
  })

  it('vẫn cache khi Jira chỉ là chưa cấu hình', async () => {
    const { service, listSpy } = harness({ mcp: null })
    await service.get()
    await service.get()
    expect(listSpy).toHaveBeenCalledTimes(1)
  })

  it('sang ngày địa phương mới thì dựng lại', async () => {
    let clock = NOW
    const { service, callTool } = harness({ now: () => clock })
    await service.get()
    clock = new Date('2026-09-02T03:00:00.000Z')
    const view = await service.get()
    expect(callTool).toHaveBeenCalledTimes(2)
    expect(view.localDate).toBe('2026-09-02')
  })
})

describe('DailyBriefingService — cờ tắt', () => {
  it('trả bản tin rỗng đã tắt và không chạm nguồn nào', async () => {
    const { service, callTool, listSpy } = harness({ settings: { dailyBriefingEnabled: false } })
    const view = await service.get()
    expect(view.enabled).toBe(false)
    expect(view.groups).toEqual([])
    expect(callTool).not.toHaveBeenCalled()
    expect(listSpy).not.toHaveBeenCalled()
  })
})

describe('DailyBriefingService — chỉ đọc và kín tiếng', () => {
  it('không gọi tool nào ngoài jira_search', async () => {
    const { service, callTool } = harness({ commitments: [commitment()] })
    await service.get()
    for (const [name] of callTool.mock.calls) expect(name).toBe('jira_search')
  })

  it('không ghi nội dung cam kết hay tiêu đề issue vào log', async () => {
    const { service, sink } = harness({
      commitments: [commitment({ title: 'Chốt hợp đồng ABBANK', nextAction: 'Gửi pháp chế' })],
      callTool: vi.fn().mockResolvedValue({
        rawText: jiraPayload([{ key: 'DT-1', summary: 'Bí mật thương vụ' }]),
      }),
    })
    await service.get()
    const text = sink.asText()
    expect(text).not.toContain('ABBANK')
    expect(text).not.toContain('Gửi pháp chế')
    expect(text).not.toContain('Bí mật thương vụ')
    expect(text).toContain('briefing-built')
  })
})
