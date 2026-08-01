import { z } from 'zod'

/** Vai trò message. `tool` dùng cho kết quả tool trả về model (§7.3). */
export const MESSAGE_ROLES = ['system', 'user', 'assistant', 'tool'] as const
export type MessageRole = (typeof MESSAGE_ROLES)[number]

export const MESSAGE_STATUSES = ['pending', 'streaming', 'complete', 'error', 'cancelled'] as const
export type MessageStatus = (typeof MESSAGE_STATUSES)[number]

/**
 * Một profile theo tài khoản OS (§8.1).
 * Tài liệu ghi `windows_sid`; đổi thành `os_account_id` để chạy được cả trên máy dev
 * không phải Windows — xem OPEN-QUESTIONS B5.
 */
export interface Profile {
  readonly id: string
  readonly osAccountId: string
  readonly displayName: string
  readonly createdAt: string
}

export interface Conversation {
  readonly id: string
  /** Đã giải mã. Trong DB lưu ciphertext. */
  readonly title: string
  readonly modelId: string | null
  /**
   * Provider của model đang gán. Lưu cùng `modelId` vì cùng một model id có thể tồn tại ở
   * hai provider — thiếu trường này thì mở lại hội thoại sẽ không biết gửi đi đâu.
   */
  readonly modelProvider: LlmProvider | null
  readonly createdAt: string
  readonly updatedAt: string
  readonly archivedAt: string | null
  readonly messageCount: number
}

export interface Message {
  readonly id: string
  readonly conversationId: string
  readonly role: MessageRole
  /** Đã giải mã. Trong DB lưu `content_ciphertext`. */
  readonly content: string
  readonly status: MessageStatus
  readonly createdAt: string
  /** Chỉ có với message có đính kèm. */
  readonly attachments?: readonly AttachmentMeta[]
  /** Chỉ có với message assistant đã gọi tool. */
  readonly toolCalls?: readonly ToolCallRecord[]
  /** Mã lỗi nếu status = 'error'. */
  readonly errorCode?: string
  readonly requestId?: string
  /** Số message cũ bị lược khỏi context khi gửi (OPEN-QUESTIONS B2). */
  readonly truncatedContextCount?: number
}

/**
 * §8.1: KHÔNG lưu bản sao file. Chỉ metadata + hash đường dẫn + (tuỳ chọn) text đã trích xuất.
 * `sourcePathHash` để phát hiện "file không còn tồn tại" mà không lưu đường dẫn thật (§8.3).
 */
export interface AttachmentMeta {
  readonly id: string
  readonly messageId: string
  readonly fileName: string
  readonly fileType: string
  readonly fileSize: number
  readonly sourcePathHash: string
  /** Số ký tự đã trích xuất — hiển thị "lượng nội dung dự kiến gửi" (§7.2 bước 4). */
  readonly extractedChars: number
  /** true nếu text trích xuất được lưu (mã hoá) theo chính sách (§8.3). */
  readonly extractedTextStored: boolean
  readonly pageCount?: number
  /** PDF nghi là bản scan — cảnh báo cho người dùng (§14). */
  readonly suspectedScan?: boolean
}

/** Mức rủi ro tool (§10.1). */
export const RISK_LEVELS = ['READ', 'WRITE_LOW', 'WRITE_HIGH', 'DESTRUCTIVE'] as const
export type RiskLevel = (typeof RISK_LEVELS)[number]

export const APPROVAL_STATUSES = [
  'not_required',
  'pending',
  'approved',
  'cancelled',
  'expired',
] as const
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number]

/** Vòng đời một thao tác write (§10.3, §16). */
export const OPERATION_STATUSES = [
  'pending',
  'running',
  'success',
  'failed',
  'uncertain',
] as const
export type OperationStatus = (typeof OPERATION_STATUSES)[number]

export interface ToolCallRecord {
  readonly id: string
  readonly messageId: string
  readonly toolName: string
  readonly riskLevel: RiskLevel
  readonly approvalStatus: ApprovalStatus
  readonly operationStatus: OperationStatus
  /** Đã giải mã. Chỉ có với tool write. */
  readonly preview?: ToolPreview
  /** Tóm tắt kết quả, đã giải mã. Không phải payload đầy đủ. */
  readonly resultSummary?: string
  readonly operationId?: string
  readonly createdAt: string
  /** Link tới đối tượng vừa tạo/cập nhật (§7.4 bước 8). */
  readonly targetUrl?: string
  readonly targetKey?: string
  readonly errorCode?: string
}

/** Nội dung màn hình xác nhận (§10.2 — đủ 8 mục). */
export interface ToolPreview {
  /** Mục 1: tên công cụ + hệ thống đích. */
  readonly toolName: string
  readonly targetSystem: 'jira' | 'confluence'
  readonly targetSystemUrl: string
  /** Mục 2: hành động cụ thể, tiếng Việt. */
  readonly action: string
  /** Mục 3: tài khoản thực hiện. */
  readonly actingAccount: string
  /** Mục 4: dữ liệu sẽ được gửi. */
  readonly payloadFields: readonly PreviewField[]
  /** Mục 5: trường/đối tượng sẽ bị thay đổi — có giá trị cũ nếu đọc trước được (B4). */
  readonly changes: readonly PreviewChange[]
  /** Mục 6: cảnh báo tác động và khả năng hoàn tác. */
  readonly impactWarning: string
  readonly reversible: boolean
  readonly riskLevel: RiskLevel
  /** true nếu giá trị "trước" lấy từ một lần đọc trước đó và có thể đã cũ (TOCTOU, B4). */
  readonly beforeValuesMayBeStale?: boolean
}

export interface PreviewField {
  readonly label: string
  readonly value: string
  /** Giá trị dài bị cắt trong preview; UI hiện nút "xem đầy đủ". */
  readonly truncated?: boolean
}

export interface PreviewChange {
  readonly field: string
  readonly before: string | null
  readonly after: string
}

/**
 * Provider LLM.
 *
 * `litellm` là cổng nội bộ của tổ chức — §4.1 đặt nó làm chỗ duy nhất áp quota, usage log và
 * quyết định key nào gọi được model nào.
 *
 * `openai` gọi THẲNG api.openai.com, bỏ qua cổng đó. §6 của tài liệu thiết kế nói
 * *"Nexa không kết nối trực tiếp provider"* — nên đây là một sai lệch có chủ ý so với thiết kế
 * gốc, được chủ sở hữu sản phẩm chấp nhận ngày 2026-08-01. Xem OPEN-QUESTIONS F1.
 *
 * Hệ quả bảo mật được xử lý ở hai chỗ:
 *   - `isExternalProvider()` bên dưới phân loại provider nằm ngoài kiểm soát tổ chức
 *   - chính sách tài liệu FAIL-CLOSED với provider ngoài (`document-policy.ts`)
 */
export const LLM_PROVIDERS = ['litellm', 'openai'] as const
export type LlmProvider = (typeof LLM_PROVIDERS)[number]

/**
 * Provider nào nằm ngoài tầm kiểm soát của tổ chức.
 *
 * Đây là hàm quyết định cho mọi biện pháp bảo vệ dữ liệu. Thêm provider mới thì phải trả lời
 * câu hỏi này một cách tường minh — mặc định phải là "ngoài", không phải "trong".
 */
export function isExternalProvider(provider: LlmProvider): boolean {
  return provider !== 'litellm'
}

/** Tên hiển thị cho người dùng. */
export const PROVIDER_LABELS: Readonly<Record<LlmProvider, string>> = {
  litellm: 'LiteLLM (nội bộ)',
  openai: 'OpenAI / ChatGPT (bên ngoài)',
}

/** §8.1 bảng `connections`. Không chứa API key/PAT. */
export const CONNECTION_TYPES = ['litellm', 'openai', 'jira', 'confluence'] as const
export type ConnectionType = (typeof CONNECTION_TYPES)[number]

export function isLlmConnection(type: ConnectionType): type is LlmProvider {
  return (LLM_PROVIDERS as readonly string[]).includes(type)
}

export interface Connection {
  readonly id: string
  readonly type: ConnectionType
  readonly baseUrl: string
  /** Chỉ Jira/Confluence. LiteLLM không có username. */
  readonly username: string | null
  readonly enabled: boolean
  /** true nếu có credential trong secure storage. Không tiết lộ giá trị. */
  readonly hasCredential: boolean
  readonly createdAt: string
  readonly updatedAt: string
  /** Kết quả lần test gần nhất — để UI hiện trạng thái mà không phải test lại. */
  readonly lastTest?: ConnectionTestResult
}

export interface ConnectionTestResult {
  readonly ok: boolean
  readonly checkedAt: string
  readonly errorCode?: string
  /** Với LiteLLM: số model server báo có. Với Atlassian: tên hiển thị của tài khoản. */
  readonly detail?: string
}

export interface ModelConfig {
  readonly id: string
  /** Provider sẽ nhận request cho model này. */
  readonly provider: LlmProvider
  /** Model id gửi cho provider. */
  readonly modelId: string
  /** Tên người dùng đặt để dễ nhận. */
  readonly displayName: string
  readonly isDefault: boolean
  /** Đã đối chiếu với GET /v1/models thành công lần nào chưa. */
  readonly verified: boolean
  readonly contextWindowTokens: number
  readonly createdAt: string
}

/** Chỉ giữ schema thật sự được dùng ở biên IPC. */
export const connectionTypeSchema = z.enum(CONNECTION_TYPES)
