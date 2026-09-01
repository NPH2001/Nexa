import { z } from 'zod'
import { LLM_PROVIDERS, type ChatModelProvider, type LlmProvider } from './provider.js'

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
  readonly modelProvider: ChatModelProvider | null
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
 * Ai đưa cam kết này vào hệ thống: người dùng gõ tay trong Mục tiêu, hay agent đề xuất trong chat
 * rồi người dùng xác nhận. Cả hai đều cần một xác nhận tường minh — khác biệt nằm ở người khởi
 * xướng, không phải ở mức quyền.
 */
export const COMMITMENT_CREATORS = ['user', 'agent'] as const
export type CommitmentCreator = (typeof COMMITMENT_CREATORS)[number]

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
  readonly createdBy: CommitmentCreator
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

// ── Business Analyst workbench (openspec `add-ba-workbench`) ──────────────

export const BA_KNOWLEDGE_CATEGORIES = ['domain', 'rule', 'term', 'constraint', 'decision'] as const
export type BaKnowledgeCategoryName = (typeof BA_KNOWLEDGE_CATEGORIES)[number]

/**
 * `draft` → `confirmed` → `outdated`.
 *
 * Chỉ `confirmed` được đưa vào context và được luật review lấy làm căn cứ. Đây là điều mà chữ
 * "đã confirm" trong yêu cầu gốc phải thật sự mang nghĩa, chứ không phải một nhãn trang trí.
 */
export const BA_KNOWLEDGE_STATUSES = ['draft', 'confirmed', 'outdated'] as const
export type BaKnowledgeStatusName = (typeof BA_KNOWLEDGE_STATUSES)[number]

export const BA_KNOWLEDGE_SOURCE_KINDS = ['conversation', 'document', 'url', 'manual'] as const
export type BaKnowledgeSourceKindName = (typeof BA_KNOWLEDGE_SOURCE_KINDS)[number]

export const BA_KNOWLEDGE_LINK_KINDS = ['supports', 'conflicts', 'supersedes'] as const
export type BaKnowledgeLinkKindName = (typeof BA_KNOWLEDGE_LINK_KINDS)[number]

export const BA_DOCUMENT_KINDS = ['us', 'srs', 'brd', 'note'] as const
export type BaDocumentKindName = (typeof BA_DOCUMENT_KINDS)[number]

export const BA_DOCUMENT_STATUSES = ['draft', 'reviewed'] as const
export type BaDocumentStatusName = (typeof BA_DOCUMENT_STATUSES)[number]

/**
 * Tri thức BA hiển thị cho renderer.
 *
 * Không có `sharingPolicy` — tri thức nghiệp vụ luôn nội bộ, không có ngoại lệ per-item (D6).
 * Thiếu trường này là một quyết định, không phải một thiếu sót cần bổ sung sau.
 */
export interface BaKnowledgeView {
  readonly id: string
  readonly title: string
  readonly body: string
  readonly category: BaKnowledgeCategoryName
  readonly status: BaKnowledgeStatusName
  readonly sourceKind: BaKnowledgeSourceKindName
  readonly sourceRef: string | null
  readonly sourceConversationId: string | null
  readonly supersededBy: string | null
  readonly createdBy: ActivityActor
  readonly useCount: number
  readonly lastUsedAt: string | null
  readonly confirmedAt: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

export const BA_ITEM_TYPES = [
  'actor',
  'field',
  'use_case',
  'rule',
  'flow_step',
  'error_code',
] as const
export type BaItemTypeName = (typeof BA_ITEM_TYPES)[number]

/**
 * Item rút gọn để hiển thị.
 *
 * Renderer nhận bản này chứ không nhận `BaDocItem` đầy đủ: mô hình đầy đủ mang trọn nội dung
 * nghiệp vụ lồng nhau, còn danh sách chỉ cần hai dòng. Phép rút gọn nằm trong `ba-kit`.
 */
export interface BaItemSummaryView {
  readonly id: string
  readonly itemType: BaItemTypeName
  readonly ordinal: number
  readonly needsReview: boolean
  readonly title: string
  readonly detail: string
}

export interface BaErrorCodeEntryView {
  readonly code: string
  readonly message: string
  readonly meaning?: string
  readonly httpStatus?: number
  readonly itemId: string
  readonly referencedBy: readonly string[]
}

export interface BaErrorCodePageView {
  readonly declared: readonly BaErrorCodeEntryView[]
  readonly undeclared: readonly {
    readonly code: string
    readonly referencedBy: readonly string[]
  }[]
  readonly unreferenced: readonly BaErrorCodeEntryView[]
  readonly inconsistent: readonly {
    readonly code: string
    readonly variants: readonly { readonly message: string; readonly itemId: string }[]
  }[]
  readonly counts: {
    readonly declared: number
    readonly undeclared: number
    readonly unreferenced: number
    readonly inconsistent: number
    readonly excludedNeedsReview: number
  }
}

export interface BaTemplateSectionView {
  readonly key: string
  readonly title: string
  readonly required: boolean
  readonly itemTypes: readonly BaItemTypeName[]
  readonly guidance?: string
}

export interface BaTemplateView {
  readonly id: string
  readonly version: string
  readonly name: string
  readonly documentKind: BaDocumentKindName
  readonly description?: string
  readonly sections: readonly BaTemplateSectionView[]
}

export interface BaTemplateCatalogView {
  readonly templates: readonly BaTemplateView[]
  /** Chỉ metadata của rulebook; nội dung chuẩn validate không cần đi qua ranh giới renderer. */
  readonly rulebook: { readonly id: string; readonly version: string; readonly name: string } | null
}

export interface BaFieldAuditView {
  readonly fieldId: string
  readonly fieldName: string
  readonly fieldType: string
  readonly expected: readonly {
    readonly key: string
    readonly label: string
    readonly rationale?: string
  }[]
  readonly missing: readonly {
    readonly key: string
    readonly label: string
    readonly rationale?: string
  }[]
  readonly unknownKeys: readonly string[]
  readonly exemptReason?: string
}

export interface BaSimilarPairView {
  readonly a: string
  readonly b: string
  readonly similarity: number
}

export interface BaTraceabilityView {
  readonly steps: readonly {
    readonly id: string
    readonly label: string
    readonly coveredBy: readonly string[]
  }[]
  readonly useCases: readonly {
    readonly id: string
    readonly name: string
    readonly standalone: boolean
    readonly covers: readonly string[]
  }[]
  readonly uncoveredSteps: readonly string[]
  readonly unusedUseCases: readonly string[]
  readonly excludedNeedsReview: number
}

/** Toàn bộ phép chiếu chỉ-đọc của một tài liệu, trả trong một lượt IPC. */
export interface BaProjectionsView {
  readonly mermaid: {
    readonly code: string
    readonly isolatedSteps: readonly string[]
    readonly stepCount: number
    readonly edgeCount: number
  }
  readonly matrix: BaTraceabilityView
  readonly fieldAudits: readonly BaFieldAuditView[]
  readonly nearDuplicates: readonly BaSimilarPairView[]
  readonly potentialContradictions: readonly BaSimilarPairView[]
  readonly template: { readonly id: string; readonly version: string; readonly name: string } | null
  readonly markdown: string | null
  readonly missingRequired: readonly string[]
  readonly unplacedCount: number
  /** Tài liệu đang theo một bản mẫu cũ hơn bản IT đang phát hành. */
  readonly templateOutdated?: boolean
}

export interface BaKnowledgeStatsView {
  readonly byCategory: readonly {
    readonly category: BaKnowledgeCategoryName
    readonly draft: number
    readonly confirmed: number
    readonly outdated: number
  }[]
  readonly total: { readonly draft: number; readonly confirmed: number; readonly outdated: number }
  readonly conflictPairs: number
  readonly unusedConfirmed: number
  readonly mostUsed: readonly {
    readonly id: string
    readonly title: string
    readonly useCount: number
  }[]
}

export const BA_FINDING_SEVERITIES = ['blocker', 'warning', 'info'] as const
export type BaFindingSeverityName = (typeof BA_FINDING_SEVERITIES)[number]

/**
 * Một phát hiện của bộ luật.
 *
 * `ruleId` không nullable là chủ đích, không phải tiện tay: bất biến của cả tính năng review là
 * **không có nhận xét nào không truy được về một luật**. Cho phép `null` ở đây là mở đúng cánh cửa
 * mà D2 đóng lại — một câu nhận xét không có nguồn.
 */
export interface BaFindingView {
  readonly ruleId: string
  readonly severity: BaFindingSeverityName
  readonly itemId: string | null
  readonly message: string
  readonly fix: string
  readonly evidence: readonly string[]
}

/** Một luật của pack và kết quả của nó trong lần chạy này. */
export interface BaReviewRuleView {
  readonly id: string
  readonly description: string
  readonly status: 'passed' | 'failed' | 'skipped'
  readonly findingCount: number
  /** Chỉ có khi `status = 'skipped'`: thứ còn thiếu nên luật chưa kiểm được. */
  readonly missing?: 'template' | 'rulebook' | 'knowledge'
}

/**
 * Báo cáo review.
 *
 * Mọi trường ở đây tồn tại để trả lời **"đã kiểm cái gì"**, chứ không để trả lời "tài liệu có đúng
 * không" — câu sau bộ luật không biết và không được phép trả lời (ADR 0010).
 */
export interface BaReviewReportView {
  readonly reviewId: string
  readonly documentId: string
  readonly rulePackId: string
  readonly rulePackVersion: string
  readonly rulesTotal: number
  readonly rulesRun: number
  readonly rulesPassed: number
  readonly excludedNeedsReview: number
  readonly knowledgeConsidered: number
  readonly countsBySeverity: Readonly<Record<BaFindingSeverityName, number>>
  readonly findings: readonly BaFindingView[]
  readonly rules: readonly BaReviewRuleView[]
  readonly createdAt: string
  /**
   * Phiên bản pack của báo cáo liền trước, khi nó khác phiên bản lần này.
   *
   * Có mặt để giao diện nói được "hai báo cáo này đo bằng hai thước khác nhau" thay vì để người
   * đọc tự so hai con số ra đời từ hai bộ luật.
   */
  readonly previousRulePackVersion?: string
}

/**
 * Gợi ý câu chữ cho MỘT finding.
 *
 * `finding` đi kèm nguyên văn bản do code sinh ra, không phải bản model trả về. Đó là hình dạng
 * làm cho "model không thêm, không xoá, không hạ mức finding" thành một tính chất kiểm được: cái
 * duy nhất model đóng góp là chuỗi `suggestion`.
 */
export interface BaWordingSuggestionView {
  readonly finding: BaFindingView
  readonly suggestion: string
}

export interface BaDocumentView {
  readonly id: string
  readonly title: string
  readonly kind: BaDocumentKindName
  readonly status: BaDocumentStatusName
  readonly templateId: string | null
  readonly templateVersion: string | null
  readonly needsReviewCount: number
  readonly createdAt: string
  readonly updatedAt: string
}

// ── Bank document checklist (openspec `add-bank-document-checklists`) ─────

export type BankDocumentTypeName =
  | 'national_id'
  | 'passport'
  | 'application_form'
  | 'proof_of_residence'
  | 'proof_of_income'
  | 'bank_statement'
  | 'other'

export type BankChecklistStatusName =
  'passed' | 'missing' | 'expired' | 'mismatch' | 'unreadable' | 'needs_review'

export interface BankChecklistCaseView {
  readonly id: string
  readonly title: string
  readonly templateId: string
  readonly templateVersion: string
  readonly status: 'draft' | 'reviewed'
  readonly documentCount: number
  readonly createdAt: string
  readonly updatedAt: string
}

export interface BankExtractedFieldView {
  readonly key: string
  readonly value: string
  readonly sourceLabel: string
  readonly needsReview: boolean
}

export interface BankDocumentEvidenceView {
  readonly id: string
  readonly fileName: string
  readonly documentType: BankDocumentTypeName
  readonly fields: readonly BankExtractedFieldView[]
  readonly needsReview: boolean
  readonly suspectedScan: boolean
  readonly truncated: boolean
}

export interface BankChecklistTemplateView {
  readonly id: string
  readonly version: string
  readonly name: string
  readonly caseType: string
  readonly requirements: readonly {
    readonly id: string
    readonly label: string
    readonly acceptedDocumentTypes: readonly BankDocumentTypeName[]
  }[]
}

export interface BankChecklistEvidenceRefView {
  readonly documentId: string
  readonly fileName: string
  readonly fieldKey?: string
  readonly value?: string
  readonly sourceLabel?: string
}

export interface BankChecklistItemView {
  readonly id: string
  readonly label: string
  readonly ruleId: string
  readonly status: BankChecklistStatusName
  readonly message: string
  readonly fix: string
  readonly evidence: readonly BankChecklistEvidenceRefView[]
}

export interface BankChecklistReportView {
  readonly reviewId: string
  readonly rulePackId: string
  readonly rulePackVersion: string
  readonly templateId: string
  readonly templateVersion: string
  readonly reviewedAt: string
  readonly items: readonly BankChecklistItemView[]
  readonly counts: Readonly<Record<BankChecklistStatusName, number>>
}

export const ACTIVITY_TYPES = [
  'suggestion',
  'memory_mutation',
  'commitment_mutation',
  'tool_preview',
  'confirmation',
  'tool_result',
  'uncertain_operation',
  /**
   * Người dùng áp dụng một gợi ý của review lên một item tài liệu.
   *
   * Ghi lại vì đây là một thao tác sửa dữ liệu người dùng, và mỗi lần áp dụng là một quyết định
   * riêng (D2). Dòng activity chỉ có id tài liệu và enum — nội dung sửa không đi vào đây.
   */
  'ba_document_mutation',
  'document_checklist_mutation',
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

export const ACTIVITY_SUBJECT_TYPES = [
  'memory',
  'commitment',
  'tool',
  'ba_document',
  'document_checklist',
] as const
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

/**
 * Ai khởi xướng sự kiện. Enum, không phải nội dung — activity row vẫn không được chứa plaintext.
 * `null` cho record ghi trước khi có cột này.
 */
export const ACTIVITY_ACTORS = ['user', 'agent'] as const
export type ActivityActor = (typeof ACTIVITY_ACTORS)[number]

export interface ActivityEvent {
  readonly id: string
  readonly type: ActivityType
  readonly action: ActivityAction
  readonly status: ActivityStatus
  readonly actor: ActivityActor | null
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
  /**
   * `local` = thao tác lên dữ liệu trên chính máy người dùng (ví dụ commitment), không gửi ra
   * mạng. Preview vẫn bắt buộc: người dùng phải thấy rõ cái gì sắp bị ghi, kể cả khi đích đến
   * không phải hệ thống bên ngoài.
   */
  readonly targetSystem: 'jira' | 'confluence' | 'local'
  /** Rỗng với `local` — không có hệ thống đích để hiển thị URL. */
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
  CHAT_MODEL_PROVIDERS,
  LLM_PROVIDERS,
  PROVIDER_LABELS,
  isExternalProvider,
  isProviderAllowedByPolicy,
} from './provider.js'
export type { LlmProvider } from './provider.js'
export type { ChatModelProvider } from './provider.js'

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

export interface ChatGptRateLimitWindow {
  readonly usedPercent: number
  readonly windowDurationMins: number
  /** Unix timestamp theo giây, đúng với contract của Codex App Server. */
  readonly resetsAt: number
}

/**
 * Trạng thái tài khoản ChatGPT do Codex App Server quản lý.
 *
 * Không type nào ở đây chứa auth URL, access token hay refresh token: renderer không có lý do
 * hợp lệ để nhìn thấy những giá trị đó.
 */
export interface ChatGptAccountStatus {
  readonly appServerAvailable: boolean
  readonly authenticated: boolean
  readonly email: string | null
  readonly planType: string | null
  readonly rateLimit: ChatGptRateLimitWindow | null
}

export interface ChatGptReasoningEffort {
  /** Giữ dạng chuỗi để tương thích khi Codex bổ sung mức reasoning mới. */
  readonly reasoningEffort: string
  readonly description: string | null
}

/** Metadata model picker-visible đã được main process lọc từ Codex App Server. */
export interface ChatGptModel {
  readonly id: string
  readonly modelId: string
  readonly displayName: string
  readonly isDefault: boolean
  readonly defaultReasoningEffort: string | null
  readonly supportedReasoningEfforts: readonly ChatGptReasoningEffort[]
  readonly inputModalities: readonly string[]
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
  /**
   * Model này đọc được ảnh hay không.
   *
   * Do người dùng khai chứ không tự dò: `GET /v1/models` của LiteLLM không nói gì về phương
   * thức đầu vào, và đoán theo tên model là cách hỏng âm thầm — mặc định FALSE để một lượt gửi
   * ảnh bị chặn ngay tại máy, kèm lời giải thích, thay vì bị gateway trả 400 khó hiểu hoặc bị
   * model lặng lẽ bỏ qua tấm ảnh.
   */
  readonly supportsVision: boolean
  readonly createdAt: string
}

// ── Bản tin công việc cá nhân (openspec `add-daily-briefing`) ─────────────

export type BriefingGroupName = 'overdue' | 'due_today' | 'due_this_week' | 'in_progress'
export type BriefingSourceName = 'commitment' | 'jira'
export type BriefingReasonKindName =
  | 'overdue'
  | 'due_today'
  | 'due_this_week'
  | 'in_progress'
  | 'check_in_due'

/**
 * Vì sao một nguồn không có dữ liệu.
 *
 * Tách `empty` khỏi mọi trạng thái lỗi là điểm mấu chốt: một nguồn hỏng không bao giờ được trình
 * bày thành "hôm nay bạn không có việc gì".
 */
export type BriefingSourceStatusName =
  | 'ok'
  | 'empty'
  | 'disabled_by_policy'
  | 'not_configured'
  | 'unauthenticated'
  /**
   * Server có đó nhưng không trả lời được — mất kết nối, đang khởi động lại, hoặc quá hạn chờ.
   *
   * Timeout nằm chung ở đây một cách có chủ ý: MCP báo lỗi bằng text chứ không bằng mã, và tầng
   * manager đã gộp "timed out" vào `MCP_SERVER_UNAVAILABLE`. Tách ra ở tầng này sẽ phải đoán
   * theo chuỗi lỗi — một cách sai âm thầm. Cả hai đều thử lại được, nên người dùng không mất gì.
   */
  | 'unavailable'
  | 'error'

export interface BriefingReasonView {
  readonly kind: BriefingReasonKindName
  readonly at: string | null
  readonly days: number | null
}

export interface BriefingItemView {
  readonly id: string
  readonly source: BriefingSourceName
  readonly title: string
  readonly detail: string | null
  /** Issue key với nguồn Jira. */
  readonly reference: string | null
  /** Link mở thẳng issue; main dựng từ base URL đã cấu hình. */
  readonly url: string | null
  readonly sourceConversationId: string | null
  readonly status: string
  readonly group: BriefingGroupName
  readonly reason: BriefingReasonView
  readonly at: string | null
  readonly updatedAt: string
  readonly inActiveSprint: boolean
}

export interface BriefingGroupView {
  readonly group: BriefingGroupName
  readonly items: readonly BriefingItemView[]
  readonly truncatedCount: number
}

export interface BriefingSourceStateView {
  readonly source: BriefingSourceName
  readonly status: BriefingSourceStatusName
  /** Thời điểm lấy dữ liệu thành công gần nhất của nguồn này. */
  readonly fetchedAt: string | null
  readonly itemCount: number
  /** Còn bao nhiêu mục nguồn trả về mà bản tin không hiển thị. */
  readonly truncatedCount: number
}

/** Tóm tắt là phần duy nhất có model tham gia, và nó không được đổi nội dung bản tin. */
export type BriefingSummaryStatusName = 'disabled' | 'ok' | 'unavailable'

export interface BriefingSummaryView {
  readonly status: BriefingSummaryStatusName
  readonly text: string | null
}

export interface DailyBriefingView {
  /** `false` khi người dùng tắt bản tin; Today quay lại phần tổng quan cũ. */
  readonly enabled: boolean
  readonly generatedAt: string
  /** Ngày địa phương bản tin thuộc về, `YYYY-MM-DD`. */
  readonly localDate: string
  readonly groups: readonly BriefingGroupView[]
  readonly totalItems: number
  readonly truncatedTotal: number
  /** Trạng thái từng nguồn, kể cả nguồn hỏng — luôn đủ mọi nguồn đã biết. */
  readonly sources: readonly BriefingSourceStateView[]
  readonly summary: BriefingSummaryView
}

/** Chỉ giữ schema thật sự được dùng ở biên IPC. */
export const connectionTypeSchema = z.enum(CONNECTION_TYPES)
export const memoryFactKindSchema = z.enum(MEMORY_FACT_KINDS)
export const memoryFactScopeSchema = z.enum(MEMORY_FACT_SCOPES)
export const memorySharingPolicySchema = z.enum(MEMORY_SHARING_POLICIES)
export const memoryFactStatusSchema = z.enum(MEMORY_FACT_STATUSES)
export const commitmentStatusSchema = z.enum(COMMITMENT_STATUSES)
export const baKnowledgeCategorySchema = z.enum(BA_KNOWLEDGE_CATEGORIES)
export const baKnowledgeStatusSchema = z.enum(BA_KNOWLEDGE_STATUSES)
export const baKnowledgeSourceKindSchema = z.enum(BA_KNOWLEDGE_SOURCE_KINDS)
export const baKnowledgeLinkKindSchema = z.enum(BA_KNOWLEDGE_LINK_KINDS)
export const baDocumentKindSchema = z.enum(BA_DOCUMENT_KINDS)
