import { isExternalProvider, type LlmProvider } from '@nexa/shared-types'
import { newRequestId, type Logger } from '@nexa/observability'
import type { ChatRequest, ChatResult, RequestContext } from '@nexa/llm-client'
import type { Briefing, BriefingItem } from '@nexa/daily-briefing'
import type { BriefingSummaryView } from '@nexa/shared-types'

/**
 * Đoạn dẫn đầu bản tin (openspec `add-daily-briefing`).
 *
 * Đây là chỗ DUY NHẤT model tham gia vào bản tin, và nó không cầm quyết định nào: danh sách mục
 * đã được `buildBriefing` chốt xong trước khi file này chạy. Model nhận danh sách đó và trả về
 * đúng một chuỗi. Không có schema nào cho phép nó thêm mục, bớt mục, đổi thứ tự hay đổi hạn — thứ
 * duy nhất được đọc lại là `result.text`.
 *
 * Cùng khuôn với bước gợi ý câu chữ của BA review: "a model is used at exactly one point, and it
 * never rules".
 */

const MAX_SUMMARY_CHARS = 600
const MAX_ITEMS_IN_PROMPT = 15

const SYSTEM_PROMPT = `Bạn viết một đoạn dẫn ngắn cho bản tin công việc buổi sáng của người dùng.

Quy tắc bắt buộc:
- Tối đa 3 câu, tiếng Việt tự nhiên, bình tĩnh, không hô hào.
- CHỈ nói về những việc đã liệt kê. Không thêm việc, không đoán deadline, không bịa số liệu.
- Không liệt kê lại toàn bộ danh sách — người dùng đã nhìn thấy nó ngay bên dưới.
- Nêu điều đáng chú ý nhất trước, thường là việc quá hạn.
- Không chào hỏi, không mở đầu bằng "Chào buổi sáng", không kết bằng lời chúc.
- Trả về văn bản thuần, không markdown, không bullet.`

export interface BriefingSummaryLlm {
  complete(request: ChatRequest, ctx: RequestContext): Promise<ChatResult>
}

export interface BriefingSummaryDeps {
  readonly enabled: () => boolean
  readonly resolveModel: () => { readonly modelId: string; readonly provider: LlmProvider }
  readonly buildLlmClient: (provider: LlmProvider, timeoutMs: number) => BriefingSummaryLlm
  readonly timeoutMs: () => number
  readonly logger: Logger
}

const GROUP_LABELS = {
  overdue: 'Quá hạn',
  due_today: 'Đến hạn hôm nay',
  due_this_week: 'Trong 7 ngày tới',
  in_progress: 'Đang làm',
} as const

function describeItem(item: BriefingItem): string {
  const where = item.source === 'jira' ? `${item.reference ?? 'Jira'}: ` : ''
  const when =
    item.reason.days === null
      ? ''
      : item.reason.days < 0
        ? ` (quá hạn ${String(-item.reason.days)} ngày)`
        : item.reason.days === 0
          ? ' (hôm nay)'
          : ` (còn ${String(item.reason.days)} ngày)`
  return `- ${where}${item.title}${when}`
}

/** Prompt chỉ chứa mục ĐÃ chốt; không có dữ liệu thô nào khác đi kèm. */
export function buildSummaryPrompt(briefing: Briefing): string {
  const lines: string[] = []
  let budget = MAX_ITEMS_IN_PROMPT
  for (const group of briefing.groups) {
    if (group.items.length === 0 || budget <= 0) continue
    lines.push(`${GROUP_LABELS[group.group]}:`)
    for (const item of group.items.slice(0, budget)) lines.push(describeItem(item))
    budget -= Math.min(group.items.length, budget)
  }
  return lines.join('\n')
}

/**
 * Làm sạch chuỗi model trả về.
 *
 * Trả `null` khi rỗng hoặc dài bất thường — bản tin thà không có đoạn dẫn còn hơn có một đoạn
 * model đang lan man.
 */
export function normalizeSummary(text: string): string | null {
  const cleaned = text.replace(/```[a-z]*\n?|```/gi, '').trim()
  if (cleaned.length === 0) return null
  if (cleaned.length > MAX_SUMMARY_CHARS) return null
  return cleaned
}

/**
 * Sinh đoạn dẫn.
 *
 * Không bao giờ ném: mọi thất bại thành `status: 'unavailable'`, vì bản tin phải hiện đủ mục kể
 * cả khi model chết.
 */
export async function summarizeBriefing(
  briefing: Briefing,
  deps: BriefingSummaryDeps,
): Promise<BriefingSummaryView> {
  if (!deps.enabled()) return { status: 'disabled', text: null }
  if (briefing.totalItems === 0) return { status: 'disabled', text: null }

  const started = Date.now()
  try {
    const config = deps.resolveModel()

    // Cùng cổng chia sẻ với `commitmentContextEnabled`: nội dung cam kết là kế hoạch nội bộ, nó
    // không mặc nhiên rời tổ chức chỉ vì người dùng bật đoạn dẫn. Lọc ở đây, ngay trước lời gọi.
    if (isExternalProvider(config.provider)) {
      deps.logger.info('briefing-summary-withheld', { reason: 'external_provider' })
      return { status: 'unavailable', text: null }
    }

    const llm = deps.buildLlmClient(config.provider, deps.timeoutMs())
    const result = await llm.complete(
      {
        model: config.modelId,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildSummaryPrompt(briefing) },
        ],
        temperature: 0,
      },
      { requestId: newRequestId() },
    )

    const text = normalizeSummary(result.text)
    deps.logger.info('briefing-summary-done', {
      ok: text !== null,
      chars: text?.length ?? 0,
      durationMs: Date.now() - started,
    })
    return text === null ? { status: 'unavailable', text: null } : { status: 'ok', text }
  } catch {
    // Không ghi câu lỗi từ provider: nó có thể vọng lại prompt, mà prompt là nội dung công việc.
    deps.logger.warn('briefing-summary-failed', { durationMs: Date.now() - started })
    return { status: 'unavailable', text: null }
  }
}
