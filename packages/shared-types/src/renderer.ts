/**
 * Entry hẹp cho renderer sandboxed.
 *
 * Chỉ các export giá trị bên dưới được đưa vào bundle. Mọi type export bị TypeScript xoá, nên
 * renderer không kéo Zod hay schema IPC vào tiến trình không tin cậy.
 */
export { PROVIDER_LABELS, isExternalProvider, isProviderAllowedByPolicy } from './provider.js'
export { RETENTION_CHOICES } from './ui-constants.js'

export type {
  ActivityAction,
  ActivityActor,
  ActivityEvent,
  ActivityStatus,
  ActivitySubjectType,
  ActivityType,
  BaDocumentKindName,
  BaErrorCodeEntryView,
  BaErrorCodePageView,
  BaFindingSeverityName,
  BaFindingView,
  BaReviewReportView,
  BaReviewRuleView,
  BaWordingSuggestionView,
  BaItemSummaryView,
  BaItemTypeName,
  BaKnowledgeStatsView,
  BaFieldAuditView,
  BaProjectionsView,
  BaSimilarPairView,
  BaTemplateCatalogView,
  BaTemplateSectionView,
  BaTemplateView,
  BaTraceabilityView,
  BaDocumentStatusName,
  BaDocumentView,
  BaKnowledgeCategoryName,
  BaKnowledgeLinkKindName,
  BaKnowledgeSourceKindName,
  BaKnowledgeStatusName,
  BaKnowledgeView,
  BankChecklistCaseView,
  BankChecklistItemView,
  BankChecklistReportView,
  BankChecklistStatusName,
  BankChecklistTemplateView,
  BankDocumentEvidenceView,
  BankDocumentTypeName,
  BankExtractedFieldView,
  CheckInSuggestion,
  CheckInState,
  CheckInTriggerKind,
  Connection,
  ConnectionTestResult,
  ConnectionType,
  ChatGptAccountStatus,
  ChatGptModel,
  ChatGptRateLimitWindow,
  ChatGptReasoningEffort,
  Commitment,
  CommitmentCreator,
  CommitmentStatus,
  Conversation,
  MemoryFact,
  MemoryFactKind,
  MemoryFactScope,
  Message,
  ModelConfig,
  RiskLevel,
  ToolCallRecord,
  ToolPreview,
} from './domain.js'
export type { ChatModelProvider, LlmProvider } from './provider.js'
export type { AppSettings, OrgPolicy } from './settings.js'
export type { ConfirmationRequest } from './tools.js'
export type {
  ChatDeltaEvent,
  ChatDoneEvent,
  ChatErrorEvent,
  CheckInsChangedEvent,
  McpStatusEvent,
  ToolStatusEvent,
} from './ipc.js'
export type { Envelope, ErrorEnvelope } from './result.js'
