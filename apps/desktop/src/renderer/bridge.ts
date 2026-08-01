import type {
  AppSettings,
  ChatDeltaEvent,
  ChatDoneEvent,
  ConfirmationRequest,
  Connection,
  ConnectionTestResult,
  Conversation,
  Envelope,
  ErrorEnvelope,
  McpStatusEvent,
  Message,
  ModelConfig,
  OrgPolicy,
  RiskLevel,
  ToolCallRecord,
  ToolStatusEvent,
} from '@nexa/shared-types'

/**
 * Client typed cho preload bridge.
 *
 * Renderer KHÔNG import bất kỳ package nào khác của Nexa ngoài `@nexa/shared-types` (chỉ có
 * type và hằng số, không có Node) — xem quy tắc lint trong eslint.config.js. Mọi việc thật
 * đều nằm sau `window.nexa`.
 */

interface NexaBridge {
  invoke(channel: string, payload?: unknown): Promise<unknown>
  on(eventName: string, listener: (payload: unknown) => void): () => void
}

declare global {
  interface Window {
    readonly nexa?: NexaBridge
  }
}

export class BridgeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly hint?: string,
    readonly requestId?: string,
  ) {
    super(message)
    this.name = 'BridgeError'
  }
}

function bridge(): NexaBridge {
  const api = window.nexa
  if (api === undefined) {
    throw new BridgeError(
      'INTERNAL_ERROR',
      'Không kết nối được với tiến trình chính của Nexa.',
      false,
    )
  }
  return api
}

/**
 * Gọi IPC và mở envelope.
 *
 * Ném `BridgeError` khi main trả nhánh lỗi — nhờ vậy phía UI chỉ cần `try/catch` một kiểu
 * thay vì phải nhớ kiểm tra `'error' in result` ở mọi chỗ gọi.
 */
async function call<T>(channel: string, payload?: unknown): Promise<T> {
  const raw = (await bridge().invoke(channel, payload)) as Envelope<T>
  if ('error' in raw) {
    const e = (raw as ErrorEnvelope).error
    throw new BridgeError(e.code, e.message, e.retryable, e.hint, raw.request_id)
  }
  return raw.data
}

export const api = {
  connections: {
    list: () => call<Connection[]>('connection:list'),
    save: (input: {
      type: 'litellm' | 'jira' | 'confluence'
      baseUrl: string
      username: string | null
      secret?: string
      enabled: boolean
    }) => call<Connection>('connection:save', input),
    test: (type: 'litellm' | 'jira' | 'confluence') =>
      call<ConnectionTestResult>('connection:test', { type }),
    remove: (type: 'litellm' | 'jira' | 'confluence') =>
      call<{ deleted: boolean }>('connection:delete', { type }),
  },

  models: {
    list: () => call<ModelConfig[]>('model:list'),
    add: (input: { modelId: string; displayName: string; contextWindowTokens: number }) =>
      call<ModelConfig>('model:add', input),
    remove: (id: string) => call<{ removed: boolean }>('model:remove', { id }),
    setDefault: (id: string) => call<{ ok: boolean }>('model:setDefault', { id }),
    verifyAll: () => call<{ verified: string[]; unknown: string[] }>('model:verifyAll'),
  },

  conversations: {
    list: (includeArchived = false) =>
      call<Conversation[]>('conversation:list', { includeArchived, limit: 100, offset: 0 }),
    create: (title: string, modelId: string | null) =>
      call<Conversation>('conversation:create', { title, modelId }),
    rename: (id: string, title: string) => call<{ ok: boolean }>('conversation:rename', { id, title }),
    remove: (id: string) => call<{ ok: boolean }>('conversation:delete', { id }),
    archive: (id: string) => call<{ ok: boolean }>('conversation:archive', { id }),
    search: (query: string) =>
      call<{
        hits: { conversationId: string; conversationTitle: string; messageId: string; snippet: string }[]
        truncated: boolean
        scanned: number
      }>('conversation:search', { query, limit: 50 }),
    messages: (conversationId: string) =>
      call<Message[]>('message:list', { conversationId, limit: 200 }),
  },

  chat: {
    send: (input: { conversationId: string; content: string; fileTokens: string[]; modelId?: string }) =>
      call<{ requestId: string; messageId: string }>('chat:send', input),
    cancel: (requestId: string) => call<{ ok: boolean }>('chat:cancel', { requestId }),
  },

  files: {
    pick: () => call<{ token: string; fileName: string; sizeBytes: number }[]>('file:pick'),
    release: (fileToken: string) => call<{ ok: boolean }>('file:release', { fileToken }),
  },

  tools: {
    approve: (operationId: string, payloadHash: string) =>
      call<{ ok: boolean }>('tool:approve', { operationId, payloadHash }),
    cancel: (operationId: string) => call<{ ok: boolean }>('tool:cancel', { operationId }),
    lookupUncertain: (operationId: string) =>
      call<{ status: string; message: string; targetKey?: string; targetUrl?: string }>(
        'tool:lookupUncertain',
        { operationId },
      ),
    list: () =>
      call<{ name: string; description: string; riskLevel: RiskLevel; targetSystem: string }[]>(
        'tool:list',
      ),
    listUncertain: () =>
      call<(ToolCallRecord & { conversationId: string })[]>('tool:listUncertain'),
  },

  settings: {
    get: () => call<{ settings: AppSettings; lockedFeatures: string[] }>('settings:get'),
    update: (patch: Partial<AppSettings>) => call<AppSettings>('settings:update', patch),
    policy: () => call<OrgPolicy>('policy:get'),
  },

  mcp: {
    status: () => call<McpStatusEvent>('mcp:status'),
    restart: () => call<McpStatusEvent>('mcp:restart'),
  },

  diagnostics: {
    export: () => call<{ directory: string; files: string[] }>('diagnostics:export'),
    appInfo: () =>
      call<{
        version: string
        electron: string
        platform: string
        schemaVersion: number
        sqliteDriver: string
        secureStorageBackend: string
        secureStorageProductionGrade: boolean
        logToDisk: boolean
        approvalStats: { approved: number; cancelled: number }
      }>('diagnostics:appInfo'),
  },

  data: {
    purge: (alsoDeleteCredentials: boolean) =>
      call<{ purged: boolean }>('data:purge', {
        confirmPhrase: 'XOA TOAN BO DU LIEU',
        alsoDeleteCredentials,
      }),
  },
}

export const events = {
  onChatDelta: (fn: (e: ChatDeltaEvent) => void) =>
    bridge().on('nexa:chat-delta', (p) => fn(p as ChatDeltaEvent)),
  onChatDone: (fn: (e: ChatDoneEvent) => void) =>
    bridge().on('nexa:chat-done', (p) => fn(p as ChatDoneEvent)),
  onChatError: (
    fn: (e: {
      request_id: string
      conversationId: string
      messageId: string
      error: { code: string; message: string; retryable: boolean }
    }) => void,
  ) => bridge().on('nexa:chat-error', (p) => fn(p as Parameters<typeof fn>[0])),
  onToolConfirmation: (fn: (e: ConfirmationRequest) => void) =>
    bridge().on('nexa:tool-confirmation', (p) => fn(p as ConfirmationRequest)),
  onToolStatus: (fn: (e: ToolStatusEvent) => void) =>
    bridge().on('nexa:tool-status', (p) => fn(p as ToolStatusEvent)),
  onMcpStatus: (fn: (e: McpStatusEvent) => void) =>
    bridge().on('nexa:mcp-status', (p) => fn(p as McpStatusEvent)),
}
