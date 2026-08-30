import { z } from 'zod'
import { IPC_CHANNEL_NAMES, type IpcChannelName } from './channels.js'
import {
  ACTIVITY_ACTORS,
  ACTIVITY_STATUSES,
  ACTIVITY_TYPES,
  ACTIVITY_SUBJECT_TYPES,
  ACTIVITY_ACTIONS,
  CHECK_IN_STATES,
  CHECK_IN_TRIGGER_KINDS,
  CHAT_MODEL_PROVIDERS,
  LLM_PROVIDERS,
  baDocumentKindSchema,
  baKnowledgeCategorySchema,
  baKnowledgeLinkKindSchema,
  baKnowledgeSourceKindSchema,
  commitmentStatusSchema,
  connectionTypeSchema,
  memoryFactKindSchema,
  memoryFactScopeSchema,
  memorySharingPolicySchema,
} from './domain.js'
import { appSettingsSchema } from './settings.js'

/**
 * Hợp đồng IPC giữa renderer và main.
 *
 * §5.3: "Validate toàn bộ input tại main process bằng schema." Mọi channel dưới đây BẮT BUỘC
 * có schema; main process từ chối payload không khớp bằng VALIDATION_FAILED.
 *
 * §5.3: "Không cho UI truyền đường dẫn tùy ý để đọc file" — vì vậy không channel nào nhận
 * `path: string`. File chỉ vào hệ thống qua `files.pick` (main mở dialog) và sau đó được
 * tham chiếu bằng `fileToken` do main cấp.
 */

// ── Connection & credential (EPIC-02) ─────────────────────────────────────

/** Không có trường nào tên `apiKey`/`pat` đi ngược từ main ra renderer. Chỉ đi vào. */
export const connectionSaveSchema = z.object({
  type: connectionTypeSchema,
  baseUrl: z.string().min(1).max(2048),
  username: z.string().max(320).nullable().default(null),
  /** Bỏ trống = giữ nguyên secret đang lưu (dùng khi người dùng chỉ sửa URL). */
  secret: z.string().max(8192).optional(),
  enabled: z.boolean().default(true),
})
export type ConnectionSaveInput = z.infer<typeof connectionSaveSchema>

export const connectionRefSchema = z.object({ type: connectionTypeSchema })

// ── Model registry (EPIC-03) ──────────────────────────────────────────────

export const llmProviderSchema = z.enum(LLM_PROVIDERS)
export const chatModelProviderSchema = z.enum(CHAT_MODEL_PROVIDERS)

export const modelAddSchema = z.object({
  provider: llmProviderSchema,
  modelId: z.string().min(1).max(200),
  displayName: z.string().min(1).max(120),
  contextWindowTokens: z.number().int().min(1024).max(2_000_000).default(128_000),
})

export const modelRefSchema = z.object({ id: z.string().uuid() })

// ── Conversation & chat (EPIC-04, EPIC-05) ────────────────────────────────

export const conversationCreateSchema = z.object({
  title: z.string().max(200).default('Hội thoại mới'),
  modelId: z.string().max(200).nullable().default(null),
  modelProvider: chatModelProviderSchema.nullable().default(null),
})

export const conversationRefSchema = z.object({ id: z.string().uuid() })

export const conversationRenameSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(200),
})

export const conversationListSchema = z.object({
  includeArchived: z.boolean().default(false),
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().min(0).default(0),
})

export const conversationSearchSchema = z.object({
  query: z.string().min(1).max(200),
  limit: z.number().int().min(1).max(100).default(50),
})

export const messageListSchema = z.object({
  conversationId: z.string().uuid(),
  limit: z.number().int().min(1).max(1000).default(200),
  before: z.string().datetime().optional(),
})

export const messageRefSchema = z.object({ id: z.string().uuid() })

export const messageEditSchema = z.object({
  id: z.string().uuid(),
  content: z.string().min(1).max(200_000),
})

const memoryContentSchema = z.string().min(1).max(500)
const memoryDateTimeSchema = z.string().datetime()

export const memoryListSchema = z.object({
  includeArchived: z.boolean().default(false),
})

export const memoryCreateSchema = z
  .object({
    content: memoryContentSchema,
    kind: memoryFactKindSchema.default('preference'),
    scope: memoryFactScopeSchema.default('global'),
    sharingPolicy: memorySharingPolicySchema.default('internal_only'),
    sourceConversationId: z.string().uuid().nullable().optional(),
    lastConfirmedAt: memoryDateTimeSchema.nullable().optional(),
    expiresAt: memoryDateTimeSchema.nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.scope === 'conversation' &&
      (value.sourceConversationId === null || value.sourceConversationId === undefined)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sourceConversationId'],
        message: 'Conversation-scoped memory requires sourceConversationId.',
      })
    }
  })

export const memoryUpdateSchema = z
  .object({
    id: z.string().uuid(),
    content: memoryContentSchema.optional(),
    kind: memoryFactKindSchema.optional(),
    scope: memoryFactScopeSchema.optional(),
    sharingPolicy: memorySharingPolicySchema.optional(),
    sourceConversationId: z.string().uuid().nullable().optional(),
    lastConfirmedAt: memoryDateTimeSchema.nullable().optional(),
    expiresAt: memoryDateTimeSchema.nullable().optional(),
  })
  .superRefine((value, ctx) => {
    const hasChange = [
      value.content,
      value.kind,
      value.scope,
      value.sharingPolicy,
      value.sourceConversationId,
      value.lastConfirmedAt,
      value.expiresAt,
    ].some((field) => field !== undefined)

    if (!hasChange) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At least one editable memory field must be provided.',
      })
    }

    if (
      value.scope === 'conversation' &&
      (value.sourceConversationId === null || value.sourceConversationId === undefined)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sourceConversationId'],
        message: 'Conversation-scoped memory requires sourceConversationId.',
      })
    }
  })

export const memoryRefSchema = z.object({ id: z.string().uuid() })

// ── Commitments / goals ──────────────────────────────────────────────────

const commitmentTitleSchema = z.string().trim().min(1).max(200)
const commitmentNextActionSchema = z.string().trim().min(1).max(500)
const checkInActionSchema = z.enum(['acted', 'snoozed', 'dismissed', 'muted'])
const snoozeMinutesSchema = z.union([z.literal(60), z.literal(1440), z.literal(10080)])

export const commitmentListSchema = z.object({
  includeCompleted: z.boolean().default(false),
})

export const commitmentCreateSchema = z.object({
  title: commitmentTitleSchema,
  nextAction: commitmentNextActionSchema.nullable().default(null),
  status: commitmentStatusSchema.default('active'),
  dueAt: memoryDateTimeSchema.nullable().default(null),
  checkInAt: memoryDateTimeSchema.nullable().default(null),
  sourceConversationId: z.string().uuid().nullable().default(null),
})

export const commitmentUpdateSchema = z
  .object({
    id: z.string().uuid(),
    title: commitmentTitleSchema.optional(),
    nextAction: commitmentNextActionSchema.nullable().optional(),
    status: commitmentStatusSchema.optional(),
    dueAt: memoryDateTimeSchema.nullable().optional(),
    checkInAt: memoryDateTimeSchema.nullable().optional(),
    sourceConversationId: z.string().uuid().nullable().optional(),
  })
  .superRefine((value, ctx) => {
    const hasChange = [
      value.title,
      value.nextAction,
      value.status,
      value.dueAt,
      value.checkInAt,
      value.sourceConversationId,
    ].some((field) => field !== undefined)

    if (!hasChange) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At least one editable commitment field must be provided.',
      })
    }
  })

export const commitmentRefSchema = z.object({ id: z.string().uuid() })

export const checkInListSchema = z.object({})

export const checkInSetEnabledSchema = z.object({
  enabled: z.boolean(),
})

export const checkInRespondSchema = z
  .object({
    id: z.string().uuid(),
    action: checkInActionSchema,
    snoozeMinutes: snoozeMinutesSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.action === 'snoozed' && value.snoozeMinutes === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['snoozeMinutes'],
        message: 'snoozeMinutes is required when action is snoozed.',
      })
    }
    if (value.action !== 'snoozed' && value.snoozeMinutes !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['snoozeMinutes'],
        message: 'snoozeMinutes is only allowed when action is snoozed.',
      })
    }
  })

export const checkInUnmuteSchema = z.object({
  commitmentId: z.string().uuid(),
})

export const activityTypeSchema = z.enum(ACTIVITY_TYPES)
export const activityStatusSchema = z.enum(ACTIVITY_STATUSES)
export const activitySubjectTypeSchema = z.enum(ACTIVITY_SUBJECT_TYPES)
export const activityActionSchema = z.enum(ACTIVITY_ACTIONS)
export const checkInTriggerKindSchema = z.enum(CHECK_IN_TRIGGER_KINDS)
export const checkInStateSchema = z.enum(CHECK_IN_STATES)

export const activityActorSchema = z.enum(ACTIVITY_ACTORS)

export const activityListSchema = z.object({
  type: activityTypeSchema.optional(),
  status: activityStatusSchema.optional(),
  actor: activityActorSchema.optional(),
  limit: z.number().int().min(1).max(500).default(200),
  offset: z.number().int().min(0).default(0),
})

// ── Business Analyst workbench (openspec `add-ba-workbench`) ──────────────

const baTitleSchema = z.string().trim().min(1).max(200)
const baBodySchema = z.string().trim().min(1).max(5_000)
const baSourceRefSchema = z.string().trim().min(1).max(500)

export const baKnowledgeListSchema = z.object({
  status: z.enum(['draft', 'confirmed', 'outdated']).optional(),
  category: baKnowledgeCategorySchema.optional(),
})

/**
 * Renderer tạo tri thức qua màn hình Nghiệp vụ, nên nó luôn là `manual` + `user`.
 *
 * `status` KHÔNG có mặt ở đây có chủ ý: item mới luôn là `draft`, và việc chốt là một channel
 * riêng (`ba:knowledge:confirm`). Gộp hai việc vào một payload sẽ khiến "tạo" và "chốt tri thức
 * của tổ chức" trở thành cùng một thao tác — chúng không phải.
 */
export const baKnowledgeCreateSchema = z.object({
  title: baTitleSchema,
  body: baBodySchema,
  category: baKnowledgeCategorySchema,
  sourceKind: baKnowledgeSourceKindSchema.default('manual'),
  sourceRef: baSourceRefSchema.nullable().default(null),
  sourceConversationId: z.string().uuid().nullable().default(null),
})

export const baKnowledgeUpdateSchema = z
  .object({
    id: z.string().uuid(),
    title: baTitleSchema.optional(),
    body: baBodySchema.optional(),
    category: baKnowledgeCategorySchema.optional(),
    sourceRef: baSourceRefSchema.nullable().optional(),
  })
  .superRefine((value, ctx) => {
    const hasChange = [value.title, value.body, value.category, value.sourceRef].some(
      (field) => field !== undefined,
    )
    if (!hasChange) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At least one editable knowledge field must be provided.',
      })
    }
  })

export const baKnowledgeRefSchema = z.object({ id: z.string().uuid() })

export const baKnowledgeSupersedeSchema = z.object({
  id: z.string().uuid(),
  replacementId: z.string().uuid(),
})

export const baKnowledgeLinkSchema = z.object({
  fromId: z.string().uuid(),
  toId: z.string().uuid(),
  kind: baKnowledgeLinkKindSchema,
})

export const baKnowledgeUnlinkSchema = z.object({ linkId: z.string().uuid() })

export const baDocumentListSchema = z.object({})

export const baDocumentCreateSchema = z.object({
  title: baTitleSchema,
  kind: baDocumentKindSchema,
  sourceConversationId: z.string().uuid().nullable().default(null),
})

export const baDocumentRefSchema = z.object({ id: z.string().uuid() })

/**
 * Trích xuất nhận **text đã có** hoặc một `fileToken` do `file:pick` cấp — không bao giờ nhận
 * đường dẫn (§5.3). Đây là lý do channel này không có trường `path`.
 */
export const baDocumentExtractSchema = z
  .object({
    id: z.string().uuid(),
    text: z.string().min(1).max(500_000).optional(),
    fileToken: z.string().uuid().optional(),
  })
  .superRefine((value, ctx) => {
    const provided = [value.text, value.fileToken].filter((field) => field !== undefined).length
    if (provided !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide exactly one of text or fileToken.',
      })
    }
  })

export const baDocumentSetTemplateSchema = z.object({
  id: z.string().uuid(),
  /** `null` gỡ mẫu khỏi tài liệu; tài liệu vẫn giữ nguyên item. */
  templateId: z.string().trim().min(1).max(64).nullable(),
})

/**
 * Gộp hai item gần-trùng.
 *
 * Người dùng quyết định giữ cái nào — hệ thống chỉ đề xuất (D5). Không có đường nào để gộp tự
 * động, kể cả khi similarity bằng 1.
 */
export const baDocumentMergeItemsSchema = z
  .object({
    id: z.string().uuid(),
    keepItemId: z.string().trim().min(1).max(64),
    dropItemId: z.string().trim().min(1).max(64),
  })
  .superRefine((value, ctx) => {
    if (value.keepItemId === value.dropItemId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dropItemId'],
        message: 'Cannot merge an item into itself.',
      })
    }
  })

/**
 * Xin gợi ý câu chữ cho **một finding đã có trong báo cáo mới nhất**.
 *
 * Renderer gửi con trỏ tới finding (`ruleId` + `itemId`), không gửi nội dung finding. Đó là điều
 * làm cho model không thể được mớm một finding do renderer bịa ra: main tự tra lại trong báo cáo
 * đã lưu, và tra hụt thì từ chối.
 */
export const baDocumentSuggestWordingSchema = z.object({
  id: z.string().uuid(),
  ruleId: z.string().trim().min(1).max(32),
  itemId: z.string().trim().min(1).max(64).nullable(),
})

/**
 * Áp một câu chữ đã sửa lên đúng một ô của đúng một item.
 *
 * Từng finding một, không có "áp dụng tất cả": review không tự sửa tài liệu, và một nút gộp mọi
 * thay đổi lại thành một cú bấm chính là cách biến nó thành tự sửa (D2).
 */
export const baDocumentApplyFindingSchema = z.object({
  id: z.string().uuid(),
  itemId: z.string().trim().min(1).max(64),
  field: z.enum([
    'name',
    'label',
    'actor',
    'role',
    'precondition',
    'postcondition',
    'statement',
    'message',
    'meaning',
    'description',
    'noAlternateReason',
    'noValidationReason',
  ]),
  value: z.string().trim().min(1).max(500),
})

export const chatSendSchema = z.object({
  conversationId: z.string().uuid(),
  content: z.string().min(1).max(200_000),
  /** Token do `files.pick` cấp. Không phải đường dẫn. */
  fileTokens: z.array(z.string().uuid()).max(20).default([]),
  /**
   * Bỏ trống = dùng model mặc định của hội thoại.
   * Có `modelId` thì BẮT BUỘC có `provider` — cùng model id tồn tại ở hai provider.
   */
  modelId: z.string().max(200).optional(),
  modelProvider: chatModelProviderSchema.optional(),
  reasoningEffort: z.string().min(1).max(40).optional(),
})
export type ChatSendInput = z.infer<typeof chatSendSchema>

export const chatCancelSchema = z.object({ requestId: z.string().min(1).max(100) })

// ── File (EPIC-06) ────────────────────────────────────────────────────────

/** Không tham số: main mở dialog, người dùng chọn. Renderer không đề xuất path. */
export const filePickSchema = z.object({})

export const fileReleaseSchema = z.object({ fileToken: z.string().uuid() })

// ── Tool confirmation (EPIC-08) ───────────────────────────────────────────

export const toolApproveSchema = z.object({
  operationId: z.string().uuid(),
  /**
   * Renderer phải gửi lại hash nó đã hiển thị. Main so với hash nó đang giữ —
   * nếu lệch thì approval vô hiệu (§17.2 kịch bản 3).
   */
  payloadHash: z.string().length(64),
})

export const toolCancelSchema = z.object({ operationId: z.string().uuid() })

export const toolLookupSchema = z.object({ operationId: z.string().uuid() })

// ── Settings & diagnostics ────────────────────────────────────────────────

export const settingsUpdateSchema = appSettingsSchema.partial()

export const purgeSchema = z.object({
  /** Bắt buộc gõ đúng chuỗi này để tránh bấm nhầm (§11.1 xoá toàn bộ dữ liệu). */
  confirmPhrase: z.literal('XOA TOAN BO DU LIEU'),
  alsoDeleteCredentials: z.boolean().default(true),
})

export const emptySchema = z.object({})

/**
 * Bảng tra cứu channel → schema. Main process đăng ký handler dựa vào đúng bảng này,
 * nên không thể lỡ quên validate một channel.
 */
export const IPC_SCHEMAS = {
  'connection:list': emptySchema,
  'connection:save': connectionSaveSchema,
  'connection:test': connectionRefSchema,
  'connection:delete': connectionRefSchema,

  'chatgpt:status': emptySchema,
  'chatgpt:models': emptySchema,
  'chatgpt:login': emptySchema,
  'chatgpt:logout': emptySchema,

  'model:list': emptySchema,
  'model:add': modelAddSchema,
  'model:remove': modelRefSchema,
  'model:setDefault': modelRefSchema,
  'model:verifyAll': z.object({ provider: llmProviderSchema }),

  'conversation:list': conversationListSchema,
  'conversation:create': conversationCreateSchema,
  'conversation:rename': conversationRenameSchema,
  'conversation:delete': conversationRefSchema,
  'conversation:archive': conversationRefSchema,
  'conversation:search': conversationSearchSchema,
  'message:list': messageListSchema,
  'message:edit': messageEditSchema,
  'message:delete': messageRefSchema,

  'memory:list': memoryListSchema,
  'memory:create': memoryCreateSchema,
  'memory:update': memoryUpdateSchema,
  'memory:archive': memoryRefSchema,
  'memory:restore': memoryRefSchema,
  'memory:delete': memoryRefSchema,

  'commitment:list': commitmentListSchema,
  'commitment:create': commitmentCreateSchema,
  'commitment:update': commitmentUpdateSchema,
  'commitment:delete': commitmentRefSchema,
  'checkin:list': checkInListSchema,
  'checkin:setEnabled': checkInSetEnabledSchema,
  'checkin:respond': checkInRespondSchema,
  'checkin:unmute': checkInUnmuteSchema,
  'activity:list': activityListSchema,

  'ba:knowledge:list': baKnowledgeListSchema,
  'ba:knowledge:create': baKnowledgeCreateSchema,
  'ba:knowledge:update': baKnowledgeUpdateSchema,
  'ba:knowledge:confirm': baKnowledgeRefSchema,
  'ba:knowledge:supersede': baKnowledgeSupersedeSchema,
  'ba:knowledge:delete': baKnowledgeRefSchema,
  'ba:knowledge:link': baKnowledgeLinkSchema,
  'ba:knowledge:unlink': baKnowledgeUnlinkSchema,
  'ba:knowledge:stats': emptySchema,
  'ba:document:list': baDocumentListSchema,
  'ba:document:create': baDocumentCreateSchema,
  'ba:document:delete': baDocumentRefSchema,
  'ba:document:read': baDocumentRefSchema,
  'ba:document:extract': baDocumentExtractSchema,
  'ba:document:errorCodes': baDocumentRefSchema,
  'ba:document:setTemplate': baDocumentSetTemplateSchema,
  'ba:document:projections': baDocumentRefSchema,
  'ba:document:mergeItems': baDocumentMergeItemsSchema,
  'ba:document:review': baDocumentRefSchema,
  'ba:document:reviewHistory': baDocumentRefSchema,
  'ba:document:suggestWording': baDocumentSuggestWordingSchema,
  'ba:document:applyFinding': baDocumentApplyFindingSchema,
  'ba:template:list': emptySchema,

  'chat:send': chatSendSchema,
  'chat:cancel': chatCancelSchema,

  'file:pick': filePickSchema,
  'file:release': fileReleaseSchema,

  'tool:approve': toolApproveSchema,
  'tool:cancel': toolCancelSchema,
  'tool:lookupUncertain': toolLookupSchema,
  'tool:listUncertain': emptySchema,
  'tool:list': emptySchema,

  'settings:get': emptySchema,
  'settings:update': settingsUpdateSchema,
  'policy:get': emptySchema,

  'mcp:status': emptySchema,
  'mcp:restart': emptySchema,

  'diagnostics:export': emptySchema,
  'diagnostics:appInfo': emptySchema,
  'data:purge': purgeSchema,
} as const

export type IpcChannel = keyof typeof IPC_SCHEMAS
export type IpcInput<C extends IpcChannel> = z.infer<(typeof IPC_SCHEMAS)[C]>

/**
 * Chốt chặn ở mức kiểu: `channels.ts` (không có zod, dùng cho preload) và `IPC_SCHEMAS`
 * (có zod, dùng cho main) phải liệt kê ĐÚNG cùng một tập channel.
 *
 * Thiếu hoặc thừa một channel ở bất kỳ bên nào là lỗi biên dịch, không phải lỗi runtime.
 */
type Covers<A, B> = [A] extends [B] ? true : false
const channelListsMatch: Covers<IpcChannel, IpcChannelName> & Covers<IpcChannelName, IpcChannel> =
  true
// Chỉ tồn tại để phép kiểm tra trên không bị coi là mã chết.
export const IPC_CHANNELS_VERIFIED = channelListsMatch && IPC_CHANNEL_NAMES.length > 0

// ── Sự kiện main → renderer ───────────────────────────────────────────────

export interface ChatDeltaEvent {
  readonly requestId: string
  readonly conversationId: string
  readonly messageId: string
  readonly delta: string
}

export interface ChatDoneEvent {
  readonly requestId: string
  readonly conversationId: string
  readonly messageId: string
  readonly usage?: { promptTokens: number; completionTokens: number }
  readonly truncatedContextCount: number
}

export interface ChatErrorEvent {
  readonly request_id: string
  readonly conversationId: string
  readonly messageId: string
  readonly error: {
    readonly code: string
    readonly message: string
    readonly retryable: boolean
    readonly hint?: string
  }
}

export interface ToolStatusEvent {
  readonly requestId: string
  readonly conversationId: string
  readonly toolCallId: string
  readonly toolName: string
  readonly phase: 'started' | 'awaiting-approval' | 'running' | 'done' | 'failed' | 'uncertain'
  readonly detail?: string
}

export interface McpStatusEvent {
  readonly system: 'jira' | 'confluence'
  readonly state: 'stopped' | 'starting' | 'ready' | 'error'
  readonly errorCode?: string
  readonly toolCount?: number
}

export interface CheckInsChangedEvent {
  readonly changedAt: string
}
