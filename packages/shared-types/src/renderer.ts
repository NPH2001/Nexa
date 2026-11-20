/**
 * Entry hẹp cho renderer sandboxed.
 *
 * Chỉ các export giá trị bên dưới được đưa vào bundle. Mọi type export bị TypeScript xoá, nên
 * renderer không kéo Zod hay schema IPC vào tiến trình không tin cậy.
 */
export { PROVIDER_LABELS, isExternalProvider, isProviderAllowedByPolicy } from './provider.js'
export { RETENTION_CHOICES, THEME_CHOICES } from './ui-constants.js'
export { AGENT_ICONS } from './domain.js'
export type { ThemePreference } from './ui-constants.js'

/**
 * Khối file trong câu trả lời của model. `file-blocks.ts` cố ý không import zod, nên đưa nó qua
 * đây không kéo theo gì vào bundle renderer ngoài chính logic parse.
 */
export {
  FILE_BLOCK_FORMATS,
  FILE_BLOCK_FORMAT_META,
  MAX_FILE_BLOCK_BYTES,
  MAX_FILE_BLOCKS_PER_MESSAGE,
  MAX_FILE_NAME_LENGTH,
  isFileBlockFormat,
  normalizeFileName,
  parseFileBlocks,
  utf8ByteLength,
} from './file-blocks.js'

export type {
  ContentSegment,
  FileBlockFormat,
  FileBlockFormatMeta,
  FileBlockSegment,
  OmittedBlocksSegment,
  OversizeBlockSegment,
  PartialBlockSegment,
  TextSegment,
} from './file-blocks.js'

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
  BriefingGroupName,
  BriefingGroupView,
  BriefingItemView,
  BriefingReasonKindName,
  BriefingReasonView,
  BriefingSourceName,
  BriefingSourceStateView,
  BriefingSourceStatusName,
  BriefingSummaryStatusName,
  BriefingSummaryView,
  DailyBriefingView,
  CheckInSuggestion,
  CheckInState,
  CheckInTriggerKind,
  Connection,
  ConnectionTestResult,
  ConnectionType,
  Agent,
  AgentIcon,
  AgentLocalGroups,
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
export type { ToolPreset } from './tools.js'
export type { ChatModelProvider, LlmProvider } from './provider.js'
export type { AppSettings, OrgPolicy } from './settings.js'
export type { ConfirmationRequest } from './tools.js'
export type {
  ChatDeltaEvent,
  ChatDoneEvent,
  ChatErrorEvent,
  CheckInsChangedEvent,
  McpStatusEvent,
  NavigateEvent,
  NavigateView,
  ToolStatusEvent,
} from './ipc.js'
export type { Envelope, ErrorEnvelope } from './result.js'
