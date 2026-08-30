import type {
  ChatErrorEvent,
  ActivityEvent,
  ActivityActor,
  ActivityStatus,
  ActivityType,
  AppSettings,
  BaDocumentView,
  BaErrorCodePageView,
  BaItemSummaryView,
  BaKnowledgeStatsView,
  BaKnowledgeView,
  BaProjectionsView,
  BaReviewReportView,
  BaTemplateCatalogView,
  BaWordingSuggestionView,
  BankChecklistCaseView,
  BankChecklistReportView,
  BankChecklistTemplateView,
  BankDocumentEvidenceView,
  ChatDeltaEvent,
  ChatDoneEvent,
  ConfirmationRequest,
  ChatGptAccountStatus,
  ChatGptModel,
  ChatModelProvider,
  CheckInSuggestion,
  CheckInsChangedEvent,
  Commitment,
  Connection,
  ConnectionTestResult,
  ConnectionType,
  Conversation,
  LlmProvider,
  Envelope,
  ErrorEnvelope,
  MemoryFact,
  McpStatusEvent,
  Message,
  ModelConfig,
  OrgPolicy,
  RiskLevel,
  ToolCallRecord,
  ToolStatusEvent,
} from '@nexa/shared-types/renderer'

/**
 * Client typed cho preload bridge.
 *
 * Renderer KHÔNG import bất kỳ package nào khác của Nexa ngoài entrypoint
 * `@nexa/shared-types/renderer` (chỉ có type và hằng số, không có Node) — xem quy tắc lint
 * trong eslint.config.js. Mọi việc thật đều nằm sau `window.nexa`.
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
      type: ConnectionType
      baseUrl: string
      username: string | null
      secret?: string
      enabled: boolean
    }) => call<Connection>('connection:save', input),
    test: (type: ConnectionType) => call<ConnectionTestResult>('connection:test', { type }),
    remove: (type: ConnectionType) => call<{ deleted: boolean }>('connection:delete', { type }),
  },

  chatgpt: {
    status: () => call<ChatGptAccountStatus>('chatgpt:status'),
    models: () => call<ChatGptModel[]>('chatgpt:models'),
    login: () => call<ChatGptAccountStatus>('chatgpt:login'),
    logout: () => call<ChatGptAccountStatus>('chatgpt:logout'),
  },

  models: {
    list: () => call<ModelConfig[]>('model:list'),
    add: (input: {
      provider: LlmProvider
      modelId: string
      displayName: string
      contextWindowTokens: number
    }) => call<ModelConfig>('model:add', input),
    remove: (id: string) => call<{ removed: boolean }>('model:remove', { id }),
    setDefault: (id: string) => call<{ ok: boolean }>('model:setDefault', { id }),
    verifyAll: (provider: LlmProvider) =>
      call<{ verified: string[]; unknown: string[] }>('model:verifyAll', { provider }),
  },

  conversations: {
    list: (includeArchived = false) =>
      call<Conversation[]>('conversation:list', { includeArchived, limit: 100, offset: 0 }),
    create: (title: string, model: { modelId: string; provider: ChatModelProvider } | null) =>
      call<Conversation>('conversation:create', {
        title,
        modelId: model?.modelId ?? null,
        modelProvider: model?.provider ?? null,
      }),
    rename: (id: string, title: string) =>
      call<{ ok: boolean }>('conversation:rename', { id, title }),
    remove: (id: string) => call<{ ok: boolean }>('conversation:delete', { id }),
    archive: (id: string) => call<{ ok: boolean }>('conversation:archive', { id }),
    search: (query: string) =>
      call<{
        hits: {
          conversationId: string
          conversationTitle: string
          messageId: string
          snippet: string
        }[]
        truncated: boolean
        scanned: number
      }>('conversation:search', { query, limit: 50 }),
    messages: (conversationId: string) =>
      call<Message[]>('message:list', { conversationId, limit: 200 }),
  },

  messages: {
    edit: (id: string, content: string) => call<{ ok: boolean }>('message:edit', { id, content }),
    remove: (id: string) => call<{ ok: boolean }>('message:delete', { id }),
  },

  memory: {
    list: (includeArchived = false) => call<MemoryFact[]>('memory:list', { includeArchived }),
    create: (input: {
      content: string
      kind?: MemoryFact['kind']
      scope?: MemoryFact['scope']
      sharingPolicy?: MemoryFact['sharingPolicy']
      sourceConversationId?: string | null
      lastConfirmedAt?: string | null
      expiresAt?: string | null
    }) => call<MemoryFact>('memory:create', input),
    update: (
      id: string,
      patch: {
        content?: string
        kind?: MemoryFact['kind']
        scope?: MemoryFact['scope']
        sharingPolicy?: MemoryFact['sharingPolicy']
        sourceConversationId?: string | null
        lastConfirmedAt?: string | null
        expiresAt?: string | null
      },
    ) => call<MemoryFact>('memory:update', { id, ...patch }),
    archive: (id: string) => call<{ ok: boolean }>('memory:archive', { id }),
    restore: (id: string) => call<{ ok: boolean }>('memory:restore', { id }),
    remove: (id: string) => call<{ ok: boolean }>('memory:delete', { id }),
  },

  commitments: {
    list: (includeCompleted = false) => call<Commitment[]>('commitment:list', { includeCompleted }),
    create: (input: {
      title: string
      nextAction?: string | null
      status?: Commitment['status']
      dueAt?: string | null
      checkInAt?: string | null
      sourceConversationId?: string | null
    }) => call<Commitment>('commitment:create', input),
    update: (
      id: string,
      patch: {
        title?: string
        nextAction?: string | null
        status?: Commitment['status']
        dueAt?: string | null
        checkInAt?: string | null
        sourceConversationId?: string | null
      },
    ) => call<Commitment>('commitment:update', { id, ...patch }),
    remove: (id: string) => call<{ ok: boolean }>('commitment:delete', { id }),
  },

  /**
   * Business Analyst workbench (openspec `add-ba-workbench`).
   *
   * Mọi channel ở đây đều bị main từ chối khi cờ `features.baWorkbench` tắt — renderer ẩn đích
   * Nghiệp vụ là để đỡ khó hiểu, không phải là hàng rào.
   */
  ba: {
    knowledge: {
      list: (
        filter: { status?: BaKnowledgeView['status']; category?: BaKnowledgeView['category'] } = {},
      ) => call<BaKnowledgeView[]>('ba:knowledge:list', filter),
      create: (input: {
        title: string
        body: string
        category: BaKnowledgeView['category']
        sourceKind?: BaKnowledgeView['sourceKind']
        sourceRef?: string | null
        sourceConversationId?: string | null
      }) => call<BaKnowledgeView>('ba:knowledge:create', input),
      update: (
        id: string,
        patch: {
          title?: string
          body?: string
          category?: BaKnowledgeView['category']
          sourceRef?: string | null
        },
      ) => call<BaKnowledgeView>('ba:knowledge:update', { id, ...patch }),
      confirm: (id: string) => call<BaKnowledgeView>('ba:knowledge:confirm', { id }),
      supersede: (id: string, replacementId: string) =>
        call<BaKnowledgeView>('ba:knowledge:supersede', { id, replacementId }),
      remove: (id: string) => call<{ ok: boolean }>('ba:knowledge:delete', { id }),
      link: (fromId: string, toId: string, kind: 'supports' | 'conflicts' | 'supersedes') =>
        call<{ id: string }>('ba:knowledge:link', { fromId, toId, kind }),
      unlink: (linkId: string) => call<{ ok: boolean }>('ba:knowledge:unlink', { linkId }),
      stats: () => call<BaKnowledgeStatsView>('ba:knowledge:stats'),
    },
    documents: {
      list: () => call<BaDocumentView[]>('ba:document:list'),
      create: (input: {
        title: string
        kind: BaDocumentView['kind']
        sourceConversationId?: string | null
      }) => call<BaDocumentView>('ba:document:create', input),
      remove: (id: string) => call<{ ok: boolean }>('ba:document:delete', { id }),
      read: (id: string) =>
        call<{ document: BaDocumentView; items: BaItemSummaryView[]; linkCount: number }>(
          'ba:document:read',
          { id },
        ),
      /** Đúng một trong hai: `text` đã có, hoặc `fileToken` do `files.pick` cấp. */
      extract: (id: string, source: { text: string } | { fileToken: string }) =>
        call<{
          items: BaItemSummaryView[]
          nearDuplicates: { a: string; b: string; similarity: number }[]
          potentialContradictions: { a: string; b: string; similarity: number }[]
          mergedCount: number
          needsReviewCount: number
          sectionCount: number
          cached: boolean
        }>('ba:document:extract', { id, ...source }),
      errorCodes: (id: string) => call<BaErrorCodePageView>('ba:document:errorCodes', { id }),
      setTemplate: (id: string, templateId: string | null) =>
        call<BaDocumentView>('ba:document:setTemplate', { id, templateId }),
      /** Mọi phép chiếu chỉ-đọc trong một lượt: Markdown, sơ đồ, ma trận, đối chiếu validate. */
      projections: (id: string) => call<BaProjectionsView>('ba:document:projections', { id }),
      /** Gộp hai item gần-trùng. Người dùng chọn giữ cái nào — hệ thống không tự gộp. */
      mergeItems: (id: string, keepItemId: string, dropItemId: string) =>
        call<{ items: BaItemSummaryView[] }>('ba:document:mergeItems', {
          id,
          keepItemId,
          dropItemId,
        }),
      /** Chạy bộ luật và lưu báo cáo. Không gọi model — phán quyết do code trả (ADR 0010). */
      review: (id: string) => call<BaReviewReportView>('ba:document:review', { id }),
      reviewHistory: (id: string) =>
        call<BaReviewReportView[]>('ba:document:reviewHistory', { id }),
      /**
       * Xin câu chữ cho MỘT finding đã có trong báo cáo mới nhất.
       *
       * Gửi con trỏ tới finding chứ không gửi nội dung: main tự tra lại trong báo cáo đã lưu, nên
       * renderer không mớm được cho model một finding nó tự bịa.
       */
      suggestWording: (id: string, ruleId: string, itemId: string | null) =>
        call<BaWordingSuggestionView>('ba:document:suggestWording', { id, ruleId, itemId }),
      /** Áp một câu chữ lên đúng một ô của đúng một item. Từng chỗ một, không có áp dụng hàng loạt. */
      applyFinding: (id: string, itemId: string, field: string, value: string) =>
        call<{ items: BaItemSummaryView[] }>('ba:document:applyFinding', {
          id,
          itemId,
          field,
          value,
        }),
    },
    templates: {
      list: () => call<BaTemplateCatalogView>('ba:template:list'),
    },
    checklists: {
      templates: () => call<BankChecklistTemplateView[]>('ba:checklist:templates'),
      list: () => call<BankChecklistCaseView[]>('ba:checklist:list'),
      create: (title: string, templateId: string) =>
        call<BankChecklistCaseView>('ba:checklist:create', { title, templateId }),
      remove: (id: string) => call<{ ok: boolean }>('ba:checklist:delete', { id }),
      read: (id: string) =>
        call<{
          item: BankChecklistCaseView
          documents: BankDocumentEvidenceView[]
          latestReport: BankChecklistReportView | null
        }>('ba:checklist:read', { id }),
      ingest: (id: string, fileToken: string) =>
        call<BankDocumentEvidenceView>('ba:checklist:ingest', { id, fileToken }),
      review: (id: string) => call<BankChecklistReportView>('ba:checklist:review', { id }),
    },
  },

  checkIns: {
    list: () => call<{ enabled: boolean; suggestions: CheckInSuggestion[] }>('checkin:list'),
    setEnabled: (enabled: boolean) =>
      call<{ enabled: boolean; suggestions: CheckInSuggestion[] }>('checkin:setEnabled', {
        enabled,
      }),
    respond: (
      id: string,
      action: 'acted' | 'snoozed' | 'dismissed' | 'muted',
      snoozeMinutes?: 60 | 1440 | 10080,
    ) =>
      call<CheckInSuggestion>('checkin:respond', {
        id,
        action,
        ...(snoozeMinutes === undefined ? {} : { snoozeMinutes }),
      }),
    unmute: (commitmentId: string) =>
      call<{ suggestion: CheckInSuggestion | null }>('checkin:unmute', { commitmentId }),
  },

  activity: {
    list: (filters: {
      type?: ActivityType
      status?: ActivityStatus
      actor?: ActivityActor
      limit?: number
      offset?: number
    }) =>
      call<ActivityEvent[]>('activity:list', {
        ...filters,
        limit: filters.limit ?? 200,
        offset: filters.offset ?? 0,
      }),
  },

  chat: {
    send: (input: {
      conversationId: string
      content: string
      fileTokens: string[]
      modelId?: string
      modelProvider?: ChatModelProvider
      reasoningEffort?: string
    }) => call<{ requestId: string; messageId: string }>('chat:send', input),
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
  onChatError: (fn: (e: ChatErrorEvent) => void) =>
    bridge().on('nexa:chat-error', (p) => fn(p as ChatErrorEvent)),
  onToolConfirmation: (fn: (e: ConfirmationRequest) => void) =>
    bridge().on('nexa:tool-confirmation', (p) => fn(p as ConfirmationRequest)),
  onToolStatus: (fn: (e: ToolStatusEvent) => void) =>
    bridge().on('nexa:tool-status', (p) => fn(p as ToolStatusEvent)),
  onMcpStatus: (fn: (e: McpStatusEvent) => void) =>
    bridge().on('nexa:mcp-status', (p) => fn(p as McpStatusEvent)),
  onCheckInsChanged: (fn: (e: CheckInsChangedEvent) => void) =>
    bridge().on('nexa:checkins-changed', (p) => fn(p as CheckInsChangedEvent)),
  onUpdateAvailable: (fn: (e: { version: string; message: string; notes?: string }) => void) =>
    bridge().on('nexa:update-available', (p) => fn(p as Parameters<typeof fn>[0])),
}
