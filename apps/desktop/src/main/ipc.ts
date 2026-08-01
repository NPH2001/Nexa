import { ipcMain, type BrowserWindow } from 'electron'
import { app } from 'electron'
import {
  ERROR_CODES,
  IPC_SCHEMAS,
  NexaError,
  fail,
  ok,
  type Envelope,
  type IpcChannel,
} from '@nexa/shared-types'
import { SECURITY_EVENTS, newRequestId } from '@nexa/observability'
import type { ChatController } from './chat-controller.js'
import type { NexaServices } from './services.js'
import { buildMcpManager } from './services.js'
import { exportDiagnostics } from './diagnostics.js'

/**
 * Đăng ký IPC.
 *
 * §5.3: "Validate toàn bộ input tại main process bằng schema."
 *
 * Cách thực thi: bảng handler dưới đây có kiểu `Record<IpcChannel, …>` — thiếu một channel là
 * lỗi biên dịch, và không channel nào vào được handler mà chưa qua `IPC_SCHEMAS[channel].parse`.
 * Không có đường vòng.
 */

type Handler<C extends IpcChannel> = (
  input: ReturnType<(typeof IPC_SCHEMAS)[C]['parse']>,
) => unknown | Promise<unknown>

type HandlerMap = { [C in IpcChannel]: Handler<C> }

export interface IpcContext {
  readonly services: NexaServices
  readonly chat: ChatController
  readonly getWindow: () => BrowserWindow | null
  readonly onMcpStatus: Parameters<typeof buildMcpManager>[1]
}

export function registerIpc(ctx: IpcContext): void {
  const handlers = buildHandlers(ctx)

  for (const channel of Object.keys(IPC_SCHEMAS) as IpcChannel[]) {
    ipcMain.handle(channel, async (_event, rawInput: unknown): Promise<Envelope<unknown>> => {
      const requestId = newRequestId()
      const schema = IPC_SCHEMAS[channel]

      const parsed = schema.safeParse(rawInput ?? {})
      if (!parsed.success) {
        // Ghi TÊN trường sai, không ghi giá trị — giá trị có thể là nội dung hoặc secret.
        ctx.services.logger.security(SECURITY_EVENTS.ipcValidationFailed, {
          channel,
          fields: parsed.error.issues.map((i) => i.path.join('.')),
        })
        return fail(
          requestId,
          new NexaError(ERROR_CODES.VALIDATION_FAILED, { requestId, safeDetail: channel }),
        )
      }

      try {
        const handler = handlers[channel] as (input: unknown) => unknown
        const data = await handler(parsed.data)
        return ok(requestId, data, 'local')
      } catch (error) {
        const nexa = NexaError.wrap(error)
        ctx.services.logger.warn('ipc-handler-failed', {
          channel,
          requestId,
          errorCode: nexa.code,
        })
        return fail(requestId, nexa)
      }
    })
  }

  ctx.services.logger.info('ipc-registered', { channelCount: Object.keys(IPC_SCHEMAS).length })
}

function buildHandlers(ctx: IpcContext): HandlerMap {
  const { services, chat } = ctx

  /** MCP phải dựng lại khi cấu hình kết nối đổi — credential và base URL đều nằm trong spec. */
  const rebuildMcp = async (): Promise<void> => {
    await services.mcp?.stop()
    services.mcp = buildMcpManager(services, ctx.onMcpStatus)
    if (services.mcp !== null) {
      try {
        await services.mcp.start()
      } catch {
        // Trạng thái lỗi đã được manager phát ra; không chặn việc lưu cấu hình.
      }
    }
  }

  return {
    // ── Connections ───────────────────────────────────────────────────────
    'connection:list': () => services.connections.list(),
    'connection:save': async (input) => {
      const connection = services.connections.save(input)
      if (input.type !== 'litellm') await rebuildMcp()
      return connection
    },
    'connection:test': (input) => services.connections.test(input.type),
    'connection:delete': async (input) => {
      services.connections.delete(input.type)
      if (input.type !== 'litellm') await rebuildMcp()
      return { deleted: true }
    },

    // ── Models ────────────────────────────────────────────────────────────
    'model:list': () => services.models.list(),
    'model:add': (input) => services.models.add(input),
    'model:remove': (input) => {
      services.models.remove(input.id)
      return { removed: true }
    },
    'model:setDefault': (input) => {
      services.models.setDefault(input.id)
      return { ok: true }
    },
    'model:verifyAll': (input) =>
      services.models.verifyAll(
        input.provider,
        services.connections.buildLlmClient(input.provider, services.settings.get().llmTimeoutMs),
      ),

    // ── Conversations ─────────────────────────────────────────────────────
    'conversation:list': (input) =>
      services.conversations.list(services.profileId, {
        includeArchived: input.includeArchived,
        limit: input.limit,
        offset: input.offset,
      }),
    'conversation:create': (input) =>
      services.conversations.create(
        services.profileId,
        input.title,
        input.modelId === null || input.modelProvider === null
          ? null
          : { modelId: input.modelId, provider: input.modelProvider },
      ),
    'conversation:rename': (input) => {
      services.conversations.rename(input.id, input.title)
      return { ok: true }
    },
    'conversation:delete': (input) => {
      services.conversations.delete(input.id)
      return { ok: true }
    },
    'conversation:archive': (input) => {
      services.conversations.archive(input.id)
      return { ok: true }
    },
    'conversation:search': (input) =>
      services.search.search(services.profileId, input.query, { limit: input.limit }),
    'message:list': (input) => services.conversations.listMessages(input.conversationId, input.limit),

    // ── Chat ──────────────────────────────────────────────────────────────
    'chat:send': (input) => chat.send(input),
    'chat:cancel': (input) => {
      chat.cancel(input.requestId)
      return { ok: true }
    },

    // ── Files ─────────────────────────────────────────────────────────────
    'file:pick': async () => {
      const window = ctx.getWindow()
      if (window === null) {
        throw new NexaError(ERROR_CODES.INTERNAL_ERROR, { safeDetail: 'no window' })
      }
      return services.files.pick(window)
    },
    'file:release': (input) => {
      services.files.release(input.fileToken)
      return { ok: true }
    },

    // ── Tool confirmation ─────────────────────────────────────────────────
    'tool:approve': (input) => {
      chat.approve(input.operationId, input.payloadHash)
      return { ok: true }
    },
    'tool:cancel': (input) => {
      chat.cancelTool(input.operationId)
      return { ok: true }
    },
    'tool:lookupUncertain': async (input) => {
      const operation = services.tracker.get(input.operationId)
      const mcp = services.mcp
      if (operation === null || mcp === null) {
        throw new NexaError(ERROR_CODES.MCP_SERVER_UNAVAILABLE, {
          operationId: input.operationId,
        })
      }
      const definition = mcp.resolveCallable(operation.toolName)
      if (definition.lookupResult === undefined) {
        throw new NexaError(ERROR_CODES.TOOL_EXECUTION_UNCERTAIN, {
          operationId: input.operationId,
          safeDetail: 'tool has no lookup strategy',
        })
      }
      return services.tracker.resolveUncertain(
        input.operationId,
        definition,
        definition.lookupResult,
        {
          actingAccount: services.connections.get('jira')?.username ?? 'unknown',
          readTool: async (name, toolInput) => {
            const readDefinition = mcp.resolveCallable(name)
            const validated = mcp.validateInput(readDefinition, toolInput)
            const outcome = await mcp.callTool(name, validated)
            try {
              return JSON.parse(outcome.rawText)
            } catch {
              return outcome.rawText
            }
          },
        },
      )
    },
    /**
     * §16: thao tác write còn treo từ phiên trước phải hiện lại, nếu không người dùng sẽ
     * không bao giờ biết để đi tra cứu. Đọc từ DB chứ không từ OperationTracker trong RAM —
     * tracker mất sạch khi app đóng.
     */
    'tool:listUncertain': () => services.conversations.listUncertainOperations(services.profileId),

    'tool:list': () =>
      (services.mcp?.availableTools() ?? []).map((t) => ({
        name: t.name,
        description: t.description,
        riskLevel: t.riskLevel,
        targetSystem: t.targetSystem,
      })),

    // ── Settings & policy ─────────────────────────────────────────────────
    'settings:get': () => ({
      settings: services.settings.get(),
      lockedFeatures: services.settings.lockedFeatureNames(),
    }),
    'settings:update': (input) => services.settings.update(input),
    'policy:get': () => services.policy,

    // ── MCP ───────────────────────────────────────────────────────────────
    'mcp:status': () =>
      services.mcp?.statusSnapshot ?? { system: 'jira' as const, state: 'stopped' as const, toolCount: 0 },
    'mcp:restart': async () => {
      await rebuildMcp()
      return services.mcp?.statusSnapshot ?? { system: 'jira' as const, state: 'stopped' as const }
    },

    // ── Diagnostics ───────────────────────────────────────────────────────
    'diagnostics:export': () => exportDiagnostics(services),
    'diagnostics:appInfo': () => ({
      version: app.getVersion(),
      electron: process.versions['electron'] ?? 'unknown',
      platform: process.platform,
      schemaVersion: services.store.schemaVersion,
      sqliteDriver: services.store.driverName,
      secureStorageBackend: services.security.backendName,
      secureStorageProductionGrade: services.security.isProductionGrade,
      logToDisk: services.fileSink !== null,
      approvalStats: services.audit.approvalStats(services.profileId),
    }),

    // ── Xoá dữ liệu (§11.1) ───────────────────────────────────────────────
    'data:purge': (input) => {
      services.store.purgeProfile(services.profileId)
      if (input.alsoDeleteCredentials) services.security.purgeAllSecrets()
      services.logger.security(SECURITY_EVENTS.dataPurged, {
        includedCredentials: input.alsoDeleteCredentials,
      })
      return { purged: true }
    },
  }
}
