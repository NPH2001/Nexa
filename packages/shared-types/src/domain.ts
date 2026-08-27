import { z } from 'zod'
import { LLM_PROVIDERS, type LlmProvider } from './provider.js'

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

export const MEMORY_FACT_KINDS = ['identity', 'preference', 'goal', 'constraint', 'note'] as const
export type MemoryFactKind = (typeof MEMORY_FACT_KINDS)[number]

export const MEMORY_FACT_SCOPES = ['global', 'conversation'] as const
export type MemoryFactScope = (typeof MEMORY_FACT_SCOPES)[number]

export const MEMORY_SHARING_POLICIES = ['internal_only', 'allow_external'] as const
export type MemorySharingPolicy = (typeof MEMORY_SHARING_POLICIES)[number]

export const MEMORY_FACT_STATUSES = ['active', 'archived'] as const
export type MemoryFactStatus = (typeof MEMORY_FACT_STATUSES)[number]

export interface MemoryFact {
  readonly id: string
  readonly profileId: string
  readonly content: string
  readonly kind: MemoryFactKind
  readonly scope: MemoryFactScope
  readonly sharingPolicy: MemorySharingPolicy
  readonly status: MemoryFactStatus
  readonly sourceConversationId: string | null
  readonly createdAt: string
  readonly updatedAt: string
  readonly lastConfirmedAt: string | null
  readonly expiresAt: string | null
}

export const COMMITMENT_STATUSES = ['active', 'blocked', 'paused', 'completed'] as const
export type CommitmentStatus = (typeof COMMITMENT_STATUSES)[number]

/**
 * Một kết quả người dùng chủ động yêu cầu Nexa theo dõi xuyên nhiều phiên làm việc.
 *
 * Khác với memory `kind=goal`, commitment là state công việc thay đổi thường xuyên: có bước tiếp
 * theo, thời điểm cần quay lại và lifecycle rõ ràng. Các trường nội dung đã giải mã ở biên domain;
 * trong SQLite chúng luôn là ciphertext.
 */
export interface Commitment {
  readonly id: string
  readonly profileId: string
  readonly title: string
  readonly nextAction: string | null
  readonly status: CommitmentStatus
  readonly dueAt: string | null
  readonly checkInAt: string | null
  readonly completedAt: string | null
  readonly sourceConversationId: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

export const CHECK_IN_TRIGGER_KINDS = ['due', 'check_in'] as const
export type CheckInTriggerKind = (typeof CHECK_IN_TRIGGER_KINDS)[number]

export const CHECK_IN_STATES = ['pending', 'acted', 'snoozed', 'dismissed', 'muted'] as const
export type CheckInState = (typeof CHECK_IN_STATES)[number]

export interface CheckInSuggestion {
  readonly id: string
  readonly commitmentId: string
  readonly title: string
  readonly nextAction: string | null
  readonly sourceConversationId: string | null
  readonly triggerKind: CheckInTriggerKind
  readonly triggerAt: string
  readonly state: CheckInState
  readonly snoozedUntil: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

export const ACTIVITY_TYPES = [
  'suggestion',
  'memory_mutation',
  'commitment_mutation',
  'tool_preview',
  'confirmation',
  'tool_result',
  'uncertain_operation',
] as const
export type ActivityType = (typeof ACTIVITY_TYPES)[number]

export const ACTIVITY_STATUSES = [
  'pending',
  'success',
  'failed',
  'cancelled',
  'uncertain',
  'snoozed',
  'dismissed',
  'muted',
] as const
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number]

export const ACTIVITY_SUBJECT_TYPES = ['memory', 'commitment', 'tool'] as const
export type ActivitySubjectType = (typeof ACTIVITY_SUBJECT_TYPES)[number]

export const ACTIVITY_ACTIONS = [
  'generated',
  'acted',
  'snoozed',
  'dismissed',
  'muted',
  'unmuted',
  'created',
  'updated',
  'archived',
  'restored',
  'deleted',
  'requested',
  'approved',
  'cancelled',
  'expired',
  'completed',
  'failed',
  'became_uncertain',
  'resolved',
] as const
export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number]

export interface ActivityEvent {
  readonly id: string
  readonly type: ActivityType
  readonly action: ActivityAction
  readonly status: ActivityStatus
  readonly subjectType: ActivitySubjectType | null
  readonly subjectId: string | null
  readonly subjectLabel: string | null
  readonly requestId: string | null
  readonly operationId: string | null
  readonly createdAt: string
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
  /** Có mặt nếu người dùng đã sửa nội dung message này (OPEN-QUESTIONS D4). */
  readonly editedAt?: string
  /**
   * Có mặt nếu người dùng đã xoá message này. `content` khi đó là chuỗi rỗng — nội dung thật
   * đã bị ghi đè trong DB, không chỉ ẩn ở UI (OPEN-QUESTIONS D4).
   */
  readonly deletedAt?: string
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
export const OPERATION_STATUSES = ['pending', 'running', 'success', 'failed', 'uncertain'] as const
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
  /** Giá trị dài bị cắt trong preview. */
  readonly truncated?: boolean
  /** Giá trị gốc để người dùng thực sự mở rộng và kiểm tra trước khi xác nhận. */
  readonly fullValue?: string
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
export {
  LLM_PROVIDERS,
  PROVIDER_LABELS,
  isExternalProvider,
  isProviderAllowedByPolicy,
} from './provider.js'
export type { LlmProvider } from './provider.js'

/**
 * §8.1 bảng `connections`. Không chứa API key/PAT.
 *
 * `mcpGateway` (2026-08-03): endpoint MCP Atlassian dạng remote HTTP đứng sau một gateway nội
 * bộ (ví dụ LiteLLM MCP gateway) — thay thế cho việc Nexa tự spawn `uvx mcp-atlassian` bằng
 * stdio khi hạ tầng tổ chức chỉ cung cấp một endpoint HTTP có sẵn. Xem ADR-0005.
 */
export const CONNECTION_TYPES = ['litellm', 'openai', 'jira', 'confluence', 'mcpGateway'] as const
export type ConnectionType = (typeof CONNECTION_TYPES)[number]

export function isLlmConnection(type: ConnectionType): type is LlmProvider {
  return (LLM_PROVIDERS as readonly string[]).includes(type)
}

/**
 * Loại kết nối nào bắt buộc "tên đăng nhập".
 *
 * Tách khỏi `isLlmConnection` có chủ ý: `mcpGateway` không phải LLM nhưng cũng không cần
 * username — nó xác thực bằng một bearer token duy nhất (§ADR-0005), giống cách LLM provider
 * xác thực bằng API key. Gộp chung với `!isLlmConnection` sẽ vô tình bắt nhập username cho nó.
 */
const CONNECTIONS_REQUIRING_USERNAME: readonly ConnectionType[] = ['jira', 'confluence']
export function requiresUsername(type: ConnectionType): boolean {
  return CONNECTIONS_REQUIRING_USERNAME.includes(type)
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
export const memoryFactKindSchema = z.enum(MEMORY_FACT_KINDS)
export const memoryFactScopeSchema = z.enum(MEMORY_FACT_SCOPES)
export const memorySharingPolicySchema = z.enum(MEMORY_SHARING_POLICIES)
export const memoryFactStatusSchema = z.enum(MEMORY_FACT_STATUSES)
export const commitmentStatusSchema = z.enum(COMMITMENT_STATUSES)
