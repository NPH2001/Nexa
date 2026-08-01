import { z } from 'zod'
import type { RiskLevel, ToolPreview } from './domain.js'
import type { FeatureFlags } from './settings.js'

/**
 * §13.1: "Mỗi tool có typed input/output, risk level và policy metadata."
 *
 * Đây là mô tả tool phía Nexa — tách biệt với schema mà MCP server công bố qua `tools/list`.
 * Nexa không tin schema từ MCP (§11.3 "không coi LLM output là dữ liệu tin cậy" và tương tự
 * với input từ server bên ngoài): tool nào không có định nghĩa ở đây thì không được gọi.
 */
export interface ToolDefinition<TInput = unknown> {
  /** Tên Nexa dùng nội bộ và hiển thị cho LLM. */
  readonly name: string
  /** Tên tool thật trên MCP server. Có thể khác `name` nếu package đổi quy ước. */
  readonly mcpToolName: string
  readonly targetSystem: 'jira' | 'confluence'
  readonly riskLevel: RiskLevel
  /** Mô tả gửi cho LLM (tiếng Việt — người dùng và prompt đều tiếng Việt). */
  readonly description: string
  readonly inputSchema: z.ZodType<TInput>
  /** JSON Schema tương ứng, gửi trong `tools` của request LiteLLM. */
  readonly jsonSchema: Record<string, unknown>
  /** Feature flag phải bật thì tool mới khả dụng. */
  readonly requiredFeature: keyof FeatureFlags
  /** Sinh preview cho tool write (§10.2). Bắt buộc với mọi risk khác READ. */
  readonly buildPreview?: (input: TInput, ctx: PreviewContext) => Promise<ToolPreview>
  /**
   * Tra cứu kết quả khi write rơi vào trạng thái `uncertain` (§16, OPEN-QUESTIONS B9).
   * Trả về đối tượng tìm được, hoặc rỗng nếu chắc chắn chưa tạo.
   */
  readonly lookupResult?: (input: TInput, ctx: LookupContext) => Promise<UncertainLookupResult>
  /** Rút gọn kết quả trước khi đưa vào context LLM (§7.3 bước 5). */
  readonly summarizeResult?: (raw: unknown) => ToolResultSummary
}

export interface PreviewContext {
  readonly actingAccount: string
  readonly targetSystemUrl: string
  /** Gọi một tool READ để lấy giá trị hiện tại (B4). Có thể thất bại — preview vẫn phải chạy. */
  readonly readTool: (toolName: string, input: unknown) => Promise<unknown>
}

export interface LookupContext {
  readonly actingAccount: string
  /** Thời điểm bắt đầu thao tác — dùng để giới hạn cửa sổ tìm kiếm. */
  readonly startedAt: string
  readonly readTool: (toolName: string, input: unknown) => Promise<unknown>
}

export interface UncertainLookupResult {
  readonly matches: readonly { key: string; url: string; summary: string }[]
  /** true khi tra cứu không kết luận được (lỗi mạng, tool read cũng hỏng). */
  readonly inconclusive: boolean
}

export interface ToolResultSummary {
  /** Text đưa vào context LLM. Đã rút gọn. */
  readonly forModel: string
  /** Text ngắn hiển thị trong UI và lưu `result_summary_ciphertext`. */
  readonly forUser: string
  readonly targetKey?: string
  readonly targetUrl?: string
}

/** Một lời gọi tool do model đề xuất, đã parse khỏi response LiteLLM. */
export interface ProposedToolCall {
  /** id do model sinh — phải echo lại trong tool result message. */
  readonly id: string
  readonly name: string
  readonly rawArguments: string
}

/** §10.3 — approval gắn cứng với operation_id + payload_hash. */
export interface ApprovalRecord {
  readonly operationId: string
  readonly payloadHash: string
  readonly toolName: string
  readonly approvedAt: string
  readonly expiresAt: string
}

export const approvalRecordSchema = z.object({
  operationId: z.string().uuid(),
  payloadHash: z.string().length(64),
  toolName: z.string(),
  approvedAt: z.string(),
  expiresAt: z.string(),
})

/** Yêu cầu xác nhận đẩy lên UI, kèm mọi thứ cần để hiển thị §10.2. */
export interface ConfirmationRequest {
  readonly operationId: string
  readonly payloadHash: string
  readonly conversationId: string
  readonly preview: ToolPreview
  readonly expiresAt: string
}

export function isWriteRisk(level: RiskLevel): boolean {
  return level !== 'READ'
}
