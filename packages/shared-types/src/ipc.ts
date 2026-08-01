import { z } from 'zod'
import { IPC_CHANNEL_NAMES, type IpcChannelName } from './channels.js'
import { LLM_PROVIDERS, connectionTypeSchema } from './domain.js'
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
  modelProvider: llmProviderSchema.nullable().default(null),
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
  modelProvider: llmProviderSchema.optional(),
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
