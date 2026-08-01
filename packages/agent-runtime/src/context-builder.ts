import type { ChatMessage } from '@nexa/llm-client'
import { estimateTokens, type ProcessedDocument } from '@nexa/document-processor'
import type { MessageRole } from '@nexa/shared-types'

/**
 * Dựng context gửi cho model (§7.1 bước 4, §7.2 bước 5).
 *
 * Chiến lược: cửa sổ trượt — giữ system prompt + tài liệu đính kèm của lượt hiện tại + N
 * message gần nhất vừa trong ngân sách. Message cũ bị BỎ, không tóm tắt.
 *
 * Vì sao không tóm tắt (OPEN-QUESTIONS B2): tóm tắt là thêm một lần gọi LLM ⇒ thêm chi phí,
 * thêm độ trễ, và thêm một lần nội dung nhạy cảm rời khỏi máy. Nếu tổ chức muốn có tóm tắt
 * thì đó là scope bổ sung, cần quyết định riêng.
 */

export const DEFAULT_SYSTEM_PROMPT = `Bạn là Nexa, trợ lý AI chạy trên máy tính của nhân viên.

Nguyên tắc bắt buộc:
- Trả lời bằng tiếng Việt, ngắn gọn và chính xác.
- Chỉ dùng thông tin có trong hội thoại, trong tài liệu người dùng đính kèm, hoặc do công cụ trả về. Không suy đoán về dữ liệu nội bộ.
- Khi cần dữ liệu Jira hoặc Confluence, hãy gọi công cụ tương ứng thay vì đoán.
- Mọi thao tác thay đổi dữ liệu đều phải được người dùng xác nhận; bạn chỉ đề xuất, không tự quyết.
- Nếu không đủ thông tin để trả lời, hãy nói rõ là không biết và nêu cần thêm gì.`

export interface ContextBudget {
  /** Cửa sổ ngữ cảnh của model đang chọn. */
  readonly contextWindowTokens: number
  /** Chừa chỗ cho câu trả lời. */
  readonly reserveForCompletionTokens?: number
  /**
   * Hệ số an toàn bù cho việc ước lượng token bằng heuristic ký tự (OPEN-QUESTIONS B2).
   * 0.8 nghĩa là chỉ dùng 80% ngân sách tính được.
   */
  readonly safetyMargin?: number
}

export interface BuildContextInput {
  readonly history: readonly { role: MessageRole; content: string }[]
  readonly documents?: readonly ProcessedDocument[]
  readonly systemPrompt?: string
  readonly budget: ContextBudget
}

export interface BuiltContext {
  readonly messages: readonly ChatMessage[]
  /** Số message lịch sử bị lược bỏ — UI phải nói cho người dùng biết. */
  readonly truncatedCount: number
  readonly estimatedTokens: number
  /** true nếu tài liệu bị cắt bớt chunk để vừa ngân sách. */
  readonly documentsTruncated: boolean
}

export function buildContext(input: BuildContextInput): BuiltContext {
  const window = input.budget.contextWindowTokens
  const reserve = input.budget.reserveForCompletionTokens ?? Math.min(4_000, Math.floor(window / 8))
  const margin = input.budget.safetyMargin ?? 0.8
  const available = Math.max(1_000, Math.floor((window - reserve) * margin))

  const systemPrompt = input.systemPrompt ?? DEFAULT_SYSTEM_PROMPT
  const systemMessage: ChatMessage = { role: 'system', content: systemPrompt }
  let used = estimateTokens(systemPrompt)

  // Tài liệu đính kèm được ưu tiên hơn lịch sử cũ: người dùng vừa chủ động chọn chúng
  // cho câu hỏi này.
  const documentMessages: ChatMessage[] = []
  let documentsTruncated = false

  for (const doc of input.documents ?? []) {
    const { text, truncated } = fitDocument(doc, Math.floor(available * 0.6) - used)
    if (text === '') {
      documentsTruncated = true
      continue
    }
    if (truncated) documentsTruncated = true
    const content = `Nội dung tài liệu người dùng đính kèm — "${doc.fileName}"${
      truncated ? ' (đã rút gọn)' : ''
    }:\n\n${text}`
    documentMessages.push({ role: 'user', content })
    used += estimateTokens(content)
  }

  // Lịch sử: lấy từ mới nhất ngược về, dừng khi hết ngân sách.
  const kept: ChatMessage[] = []
  let truncatedCount = 0

  for (let i = input.history.length - 1; i >= 0; i--) {
    const entry = input.history[i]
    if (entry === undefined) continue
    // System message trong lịch sử đã được thay bằng systemPrompt hiện tại.
    if (entry.role === 'system') continue

    const cost = estimateTokens(entry.content) + 4 // chi phí bao gói mỗi message
    if (used + cost > available) {
      truncatedCount = i + 1
      break
    }
    used += cost
    kept.unshift({ role: entry.role, content: entry.content })
  }

  return {
    messages: [systemMessage, ...documentMessages, ...kept],
    truncatedCount,
    estimatedTokens: used,
    documentsTruncated,
  }
}

/**
 * Nhét tài liệu vào ngân sách bằng cách lấy chunk từ đầu.
 *
 * Lấy từ đầu chứ không lấy giữa: phần đầu tài liệu gần như luôn chứa tiêu đề, mục lục và
 * bối cảnh — hữu ích hơn một lát cắt ngẫu nhiên ở giữa. §14.1 cũng nhắc "Không gửi toàn bộ
 * file nếu câu hỏi chỉ cần một phần nhỏ".
 */
function fitDocument(
  doc: ProcessedDocument,
  budgetTokens: number,
): { text: string; truncated: boolean } {
  if (budgetTokens <= 0) return { text: '', truncated: true }
  if (doc.estimatedTokens <= budgetTokens) return { text: doc.text, truncated: doc.truncated }

  const parts: string[] = []
  let used = 0
  for (const chunk of doc.chunks) {
    if (used + chunk.estimatedTokens > budgetTokens) break
    parts.push(`[${chunk.locationLabel}]\n${chunk.text}`)
    used += chunk.estimatedTokens
  }

  return { text: parts.join('\n\n'), truncated: true }
}

/** Ghép kết quả tool vào hội thoại theo đúng định dạng OpenAI (§5.2 Agent Runtime). */
export function toolResultMessage(toolCallId: string, content: string): ChatMessage {
  return { role: 'tool', content, tool_call_id: toolCallId }
}
