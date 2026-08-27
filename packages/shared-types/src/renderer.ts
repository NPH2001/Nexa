/**
 * Entry hẹp cho renderer sandboxed.
 *
 * Chỉ các export giá trị bên dưới được đưa vào bundle. Mọi type export bị TypeScript xoá, nên
 * renderer không kéo Zod hay schema IPC vào tiến trình không tin cậy.
 */
export { PROVIDER_LABELS, isExternalProvider, isProviderAllowedByPolicy } from './provider.js'
export { RETENTION_CHOICES } from './ui-constants.js'

export type {
  Connection,
  ConnectionTestResult,
  ConnectionType,
  Commitment,
  CommitmentStatus,
  Conversation,
  MemoryFact,
  MemoryFactKind,
  MemoryFactScope,
  Message,
  ModelConfig,
  RiskLevel,
  ToolCallRecord,
} from './domain.js'
export type { LlmProvider } from './provider.js'
export type { AppSettings, OrgPolicy } from './settings.js'
export type { ConfirmationRequest } from './tools.js'
export type {
  ChatDeltaEvent,
  ChatDoneEvent,
  ChatErrorEvent,
  McpStatusEvent,
  ToolStatusEvent,
} from './ipc.js'
export type { Envelope, ErrorEnvelope } from './result.js'
