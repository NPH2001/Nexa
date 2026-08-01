import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import type { AppSettings, McpStatusEvent, OrgPolicy } from '@nexa/shared-types'
import {
  FileSink,
  Logger,
  MemorySink,
  MultiSink,
  globalRedactor,
  type LogSink,
} from '@nexa/observability'
import {
  DevFileBackend,
  SafeStorageBackend,
  SecurityService,
  type SecureStorageBackend,
} from '@nexa/security'
import {
  AuditRepository,
  ConfigRepository,
  ConversationRepository,
  ConversationSearch,
  LocalStore,
  ProfileRepository,
  RetentionService,
} from '@nexa/local-store'
import { ConnectionService, ModelService, SettingsService, loadOrgPolicy } from '@nexa/connection-config'
import {
  AtlassianMcpManager,
  DEFAULT_ATLASSIAN_MCP_SPEC,
  type AtlassianCredentials,
} from '@nexa/atlassian-mcp-manager'
import {
  ConfirmationGuard,
  OperationTracker,
} from '@nexa/agent-runtime'
import {
  DocumentProcessor,
  InlineRunner,
  TempWorkspace,
  WorkerThreadRunner,
  type ExtractionRunner,
} from '@nexa/document-processor'
import { FileBroker } from './file-broker.js'

/**
 * Composition root.
 *
 * Toàn bộ việc "cái gì nối vào cái gì" nằm ở đúng một file. Các package bên dưới đều nhận
 * dependency qua constructor và không tự đi tìm — nhờ vậy chúng test được mà không cần Electron.
 */
export interface NexaServices {
  readonly logger: Logger
  readonly logSink: LogSink
  readonly fileSink: FileSink | null
  readonly memorySink: MemorySink
  readonly store: LocalStore
  readonly profileId: string
  readonly security: SecurityService
  readonly policy: OrgPolicy
  readonly settings: SettingsService
  readonly connections: ConnectionService
  readonly models: ModelService
  readonly conversations: ConversationRepository
  readonly config: ConfigRepository
  readonly audit: AuditRepository
  readonly search: ConversationSearch
  readonly retention: RetentionService
  readonly guard: ConfirmationGuard
  readonly tracker: OperationTracker
  readonly documents: DocumentProcessor
  readonly extractionRunner: ExtractionRunner
  readonly tempWorkspace: TempWorkspace
  readonly files: FileBroker
  mcp: AtlassianMcpManager | null
  dispose(): Promise<void>
}

export interface BootstrapOptions {
  readonly onMcpStatus: (event: McpStatusEvent) => void
  readonly isDevelopment: boolean
}

export function bootstrapServices(opts: BootstrapOptions): NexaServices {
  const userData = app.getPath('userData')
  const logDir = join(userData, 'logs')

  // MemorySink luôn có mặt: nếu ổ đĩa không ghi được, chế độ chẩn đoán vẫn có log để xuất (§16).
  const memorySink = new MemorySink(2_000)
  const fileSink = new FileSink({ dir: logDir, baseName: 'nexa', retentionDays: 14 })
  const logSink: LogSink = fileSink.active ? new MultiSink([fileSink, memorySink]) : memorySink

  const logger = new Logger({
    sink: logSink,
    redactor: globalRedactor,
    minLevel: opts.isDevelopment ? 'debug' : 'info',
    bindings: { appVersion: app.getVersion() },
  })

  logger.info('app-starting', {
    version: app.getVersion(),
    platform: process.platform,
    logToDisk: fileSink.active,
  })

  const security = new SecurityService({
    backend: chooseSecureStorage(userData, opts.isDevelopment, logger),
    logger,
    redactor: globalRedactor,
    // §3 fail closed: bản phát hành từ chối khởi động nếu không có secure storage thật.
    requireProductionGrade: !opts.isDevelopment,
  })
  security.primeRedactor()

  const store = LocalStore.open({
    path: join(userData, 'nexa.db'),
    cipher: {
      encrypt: (ctx, pt) => security.encrypt(ctx, pt),
      decrypt: (ctx, ct) => security.decrypt(ctx, ct),
    },
    logger,
  })

  const profile = new ProfileRepository(store).ensure(
    ProfileRepository.currentOsAccountId(),
    app.getPath('userData'),
  )

  const config = new ConfigRepository(store)
  const audit = new AuditRepository(store)
  const conversations = new ConversationRepository(store)
  const search = new ConversationSearch(store, conversations)
  const retention = new RetentionService(store, audit)

  const policy = loadOrgPolicy(readPolicyFile(logger), logger)
  const settings = new SettingsService(config, profile.id, policy, logger)
  const models = new ModelService(config, profile.id, logger)

  const tempWorkspace = new TempWorkspace(join(userData, 'temp'), logger)
  // §8.3: dọn tàn dư của phiên trước nếu nó bị crash.
  tempWorkspace.sweepOnStartup()

  const extractionRunner = createExtractionRunner(logger)
  const documents = new DocumentProcessor({
    runner: extractionRunner,
    logger,
    limits: {
      maxFileSizeMb: settings.get().maxFileSizeMb,
      maxFilesPerRequest: settings.get().maxFilesPerRequest,
    },
  })

  const files = new FileBroker(logger, {
    maxFilesPerRequest: settings.get().maxFilesPerRequest,
    maxFileSizeMb: settings.get().maxFileSizeMb,
  })

  const guard = new ConfirmationGuard({ logger, ttlSeconds: settings.get().approvalTtlSeconds })
  const tracker = new OperationTracker(logger)

  const services: NexaServices = {
    logger,
    logSink,
    fileSink: fileSink.active ? fileSink : null,
    memorySink,
    store,
    profileId: profile.id,
    security,
    policy,
    settings,
    connections: new ConnectionService({
      repo: config,
      audit,
      security,
      profileId: profile.id,
      policy,
      logger,
      testAtlassian: async (type) => {
        const manager = services.mcp
        if (manager === null) {
          return {
            ok: false,
            checkedAt: new Date().toISOString(),
            errorCode: 'MCP_SERVER_UNAVAILABLE',
          }
        }
        await manager.restart()
        const probe =
          type === 'jira'
            ? { tool: 'jira.search', args: { jql: 'order by created DESC', limit: 1 } }
            : { tool: 'confluence.search', args: { cql: 'type = page', limit: 1 } }
        await manager.callTool(probe.tool, probe.args)
        return { ok: true, checkedAt: new Date().toISOString(), detail: 'Kết nối thành công' }
      },
    }),
    models,
    conversations,
    config,
    audit,
    search,
    retention,
    guard,
    tracker,
    documents,
    extractionRunner,
    tempWorkspace,
    files,
    mcp: null,
    dispose: async () => {
      await services.mcp?.stop()
      await extractionRunner.dispose()
      tempWorkspace.releaseAll()
      store.close()
      await logger.flush()
    },
  }

  services.mcp = buildMcpManager(services, opts.onMcpStatus)
  return services
}

/**
 * Dựng manager MCP từ cấu hình kết nối hiện tại.
 *
 * Trả null khi chưa cấu hình Jira lẫn Confluence — chat vẫn phải chạy được khi người dùng
 * chỉ mới nhập LiteLLM key.
 */
export function buildMcpManager(
  services: NexaServices,
  onStatus: (event: McpStatusEvent) => void,
): AtlassianMcpManager | null {
  const jira = services.connections.get('jira')
  const confluence = services.connections.get('confluence')
  if ((jira === null || !jira.enabled) && (confluence === null || !confluence.enabled)) return null

  const settings = services.settings.get()

  return new AtlassianMcpManager({
    spec: readMcpSpec(services.settings.get()),
    logger: services.logger,
    credentials: (): AtlassianCredentials => {
      const out: { jira?: AtlassianCredentials['jira']; confluence?: AtlassianCredentials['confluence'] } = {}
      if (jira !== null && jira.enabled && jira.username !== null) {
        out.jira = {
          baseUrl: jira.baseUrl,
          username: jira.username,
          token: services.security.readCredential('jira'),
        }
      }
      if (confluence !== null && confluence.enabled && confluence.username !== null) {
        out.confluence = {
          baseUrl: confluence.baseUrl,
          username: confluence.username,
          token: services.security.readCredential('confluence'),
        }
      }
      return out
    },
    features: () => services.settings.get().features,
    jiraBaseUrl: jira?.baseUrl ?? '',
    confluenceBaseUrl: confluence?.baseUrl ?? '',
    onStatus,
    toolTimeoutMs: settings.toolTimeoutMs,
  })
}

/**
 * Chọn backend secure storage.
 *
 * Trên Windows, `safeStorage` dùng DPAPI gắn với tài khoản đăng nhập — đúng §8.2. Trên máy
 * dev Linux/macOS không có keyring, nó có thể không khả dụng; khi đó rơi xuống DevFileBackend,
 * thứ mà `requireProductionGrade` sẽ từ chối ở bản phát hành.
 */
function chooseSecureStorage(
  userData: string,
  isDevelopment: boolean,
  logger: Logger,
): SecureStorageBackend {
  const backend = new SafeStorageBackend(safeStorage, join(userData, 'secure'))
  if (backend.isAvailable()) return backend

  logger.warn('safe-storage-unavailable', { fallbackToDevBackend: isDevelopment })
  return new DevFileBackend(join(userData, 'secure'))
}

/**
 * Worker trích xuất nằm cạnh bundle main sau khi build. Khi chạy `electron-vite dev`, file
 * đó cũng đã được emit, nên đường dẫn giống nhau ở cả hai chế độ.
 */
function createExtractionRunner(logger: Logger): ExtractionRunner {
  const workerPath = join(app.getAppPath(), 'out', 'main', 'extraction-worker.js')
  if (!existsSync(workerPath)) {
    logger.warn('extraction-worker-missing-running-inline', {})
    return new InlineRunner()
  }
  return new WorkerThreadRunner({ workerPath, timeoutMs: 120_000, maxOldGenerationSizeMb: 512 })
}

/** Policy do IT đặt cạnh bộ cài. Không có file ⇒ không có ràng buộc bổ sung. */
function readPolicyFile(logger: Logger): unknown {
  // `resourcesPath` chỉ có trong bản đã đóng gói; khi dev thì đọc từ thư mục nguồn.
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  const candidates = [
    resourcesPath === undefined ? null : join(resourcesPath, 'policy.json'),
    join(app.getAppPath(), 'resources', 'policy.json'),
  ]
  for (const path of candidates) {
    if (path === null || !existsSync(path)) continue
    try {
      return JSON.parse(readFileSync(path, 'utf8'))
    } catch {
      logger.warn('org-policy-unreadable', { })
    }
  }
  return null
}

/**
 * Lệnh khởi chạy MCP.
 *
 * ⚠️ Mặc định là quy ước chưa được chốt (docs/OPEN-QUESTIONS.md A4). Cho phép ghi đè qua biến
 * môi trường để đội triển khai thử package khác mà không phải build lại app.
 */
function readMcpSpec(_settings: AppSettings): typeof DEFAULT_ATLASSIAN_MCP_SPEC {
  const command = process.env['NEXA_MCP_COMMAND']
  if (command === undefined || command === '') return DEFAULT_ATLASSIAN_MCP_SPEC

  const rawArgs = process.env['NEXA_MCP_ARGS'] ?? ''
  return {
    ...DEFAULT_ATLASSIAN_MCP_SPEC,
    command,
    args: rawArgs === '' ? [] : rawArgs.split(' ').filter((a) => a !== ''),
  }
}
