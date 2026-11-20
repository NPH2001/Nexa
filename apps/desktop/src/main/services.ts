import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, safeStorage, shell } from 'electron'
import type { AppSettings, McpStatusEvent, OrgPolicy } from '@nexa/shared-types'
import { ERROR_CODES, type ErrorCode } from '@nexa/shared-types'
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
  ActivityRepository,
  AuditRepository,
  BaDocumentRepository,
  BaKnowledgeRepository,
  BaReviewRepository,
  BankChecklistRepository,
  CheckInRepository,
  CommitmentRepository,
  ConfigRepository,
  ConversationRepository,
  ConversationSearch,
  LocalStore,
  MemoryRepository,
  AgentRepository,
  ProfileRepository,
  RetentionService,
} from '@nexa/local-store'
import {
  ConnectionService,
  ModelService,
  SettingsService,
  loadOrgPolicy,
} from '@nexa/connection-config'
import {
  AtlassianMcpManager,
  DEFAULT_ATLASSIAN_MCP_SPEC,
  buildToolRegistry,
  type AtlassianCredentials,
} from '@nexa/atlassian-mcp-manager'
import {
  ConfirmationGuard,
  McpToolRouter,
  OperationTracker,
  assertDisjointToolNames,
} from '@nexa/agent-runtime'
import {
  RemoteMcpServer,
  buildRedmineGatewayHeaders,
  buildRedmineTools,
  buildXwikiTools,
  classifyRedmineError,
  classifyXwikiError,
  identifyRedmineUser,
} from '@nexa/work-mcp-servers'
import {
  DocumentProcessor,
  InlineRunner,
  TempWorkspace,
  WorkerThreadRunner,
  type ExtractionRunner,
} from '@nexa/document-processor'
import { BaExtractionJob } from './ba-extraction.js'
import { BaReviewService } from './ba-review.js'
import { createResourceReader, loadBaStandards, type BaStandards } from './ba-standards.js'
import { BankChecklistService, loadBankChecklistTemplates } from './bank-checklist.js'
import type { BankChecklistTemplate } from '@nexa/document-checklist'
import { FileBroker } from './file-broker.js'
import { FileWriter } from './file-writer.js'
import { ProactiveCheckInService } from './proactive-check-in-service.js'
import { DailyBriefingService } from './briefing-service.js'
import { ChatGptAccountService } from './chatgpt-account-service.js'

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
  /**
   * Chỉ `true` ở bản dev chưa đóng gói (`!app.isPackaged`): cho phép `http://` tới loopback để E2E
   * trỏ vào mock server. Bản phát hành luôn là `false` — cùng ranh giới với `ConnectionService`.
   */
  readonly allowInsecureLoopback: boolean
  readonly settings: SettingsService
  readonly chatgpt: ChatGptAccountService
  readonly connections: ConnectionService
  readonly models: ModelService
  readonly conversations: ConversationRepository
  readonly commitments: CommitmentRepository
  readonly checkInState: CheckInRepository
  readonly activity: ActivityRepository
  readonly checkIns: ProactiveCheckInService
  readonly briefing: DailyBriefingService
  readonly memory: MemoryRepository
  readonly agents: AgentRepository
  readonly baKnowledge: BaKnowledgeRepository
  readonly baDocuments: BaDocumentRepository
  readonly baExtraction: BaExtractionJob
  readonly baReviews: BaReviewRepository
  readonly baReview: BaReviewService
  /** Mẫu tài liệu và rulebook validate do IT phân phối — chỉ đọc, nạp một lần lúc khởi động. */
  readonly baStandards: BaStandards
  readonly bankChecklists: BankChecklistRepository
  readonly bankChecklist: BankChecklistService
  readonly bankChecklistTemplates: readonly BankChecklistTemplate[]
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
  /** Chiều ghi của luồng file: nội dung do model sinh ra, lưu bằng hộp thoại của hệ điều hành. */
  readonly fileWriter: FileWriter
  /** MCP Atlassian (Jira + Confluence). Bản tin buổi sáng và kiểm tra kết nối Atlassian dùng thẳng. */
  mcp: AtlassianMcpManager | null
  /** Redmine qua MCP Gateway (ADR 0010). null = chưa cấu hình hoặc gateway chưa sẵn. */
  redmine: RemoteMcpServer | null
  /** XWiki qua endpoint MCP riêng (ADR 0010). */
  xwiki: RemoteMcpServer | null
  /**
   * Gộp mọi MCP source cho chat. Đọc `mcp`/`redmine`/`xwiki` qua closure mỗi lần dùng, nên dựng
   * lại một source (người dùng đổi kết nối) có hiệu lực ngay mà không phải dựng lại router.
   */
  readonly mcpRouter: McpToolRouter
  dispose(): Promise<void>
}

export interface BootstrapOptions {
  readonly onMcpStatus: (event: McpStatusEvent) => void
  readonly onCheckInsChanged?: (changedAt: string) => void
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

  // Tạo/đọc master key NGAY tại đây thay vì đợi lần mã hoá đầu tiên.
  //
  // Nếu để lười, một secure storage hỏng chỉ lộ ra khi người dùng gửi tin nhắn đầu tiên —
  // lúc đó họ đã gõ xong câu hỏi và mất dữ liệu nháp. §3 fail closed: hỏng thì hỏng ngay
  // lúc khởi động, kèm dialog nói rõ nguyên nhân.
  security.getMasterKey()

  const store = LocalStore.open({
    path: join(userData, 'nexa.db'),
    // Chỉ định tường minh dù đây cũng là mặc định: đây là quyết định đã được chốt (ADR 0003),
    // và nó nên hiện ra ở composition root thay vì ẩn trong một giá trị mặc định.
    driver: 'node:sqlite',
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
  const activity = new ActivityRepository(store)
  const conversations = new ConversationRepository(store)
  const commitments = new CommitmentRepository(store)
  const checkInState = new CheckInRepository(store)
  const memory = new MemoryRepository(store)
  const agents = new AgentRepository(store)
  const baKnowledge = new BaKnowledgeRepository(store)
  const baDocuments = new BaDocumentRepository(store)
  const baReviews = new BaReviewRepository(store)
  const bankChecklists = new BankChecklistRepository(store)
  const search = new ConversationSearch(store, conversations)
  const retention = new RetentionService(store, audit)

  const policy = loadOrgPolicy(readPolicyFile(logger), logger)
  // Nạp một lần lúc khởi động: chuẩn của tổ chức không đổi giữa chừng, và đọc lại mỗi lần dùng
  // chỉ mở đường cho hai lượt xuất tài liệu cùng phiên lại theo hai bản mẫu khác nhau.
  const resourceReader = createResourceReader(app.getAppPath(), logger)
  const baStandards = loadBaStandards(resourceReader, logger)
  const bankChecklistTemplates = loadBankChecklistTemplates(resourceReader, logger)
  const settings = new SettingsService(config, profile.id, policy, logger)
  const models = new ModelService(config, profile.id, logger, policy)
  const checkIns = new ProactiveCheckInService({
    profileId: profile.id,
    store,
    repository: checkInState,
    commitments,
    activity,
    settings,
    logger,
    onChanged: opts.onCheckInsChanged,
  })

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
      maxImageSizeMb: settings.get().maxImageSizeMb,
    },
  })

  const files = new FileBroker(logger, {
    maxFilesPerRequest: settings.get().maxFilesPerRequest,
    maxFileSizeMb: settings.get().maxFileSizeMb,
  })

  const fileWriter = new FileWriter(logger)

  const guard = new ConfirmationGuard({ logger, ttlSeconds: settings.get().approvalTtlSeconds })
  const tracker = new OperationTracker(logger)
  const codexChatDir = join(userData, 'codex-chat-workspace')
  mkdirSync(codexChatDir, { recursive: true, mode: 0o700 })
  const chatgpt = new ChatGptAccountService({
    logger,
    appVersion: app.getVersion(),
    openExternal: (url) => shell.openExternal(url),
    chatCwd: codexChatDir,
  })

  const services: NexaServices = {
    logger,
    logSink,
    fileSink: fileSink.active ? fileSink : null,
    memorySink,
    store,
    profileId: profile.id,
    security,
    policy,
    allowInsecureLoopback: opts.isDevelopment,
    settings,
    chatgpt,
    connections: new ConnectionService({
      repo: config,
      audit,
      security,
      profileId: profile.id,
      policy,
      logger,
      /**
       * §11.2 chỉ cho phép HTTPS. Ngoại lệ duy nhất là loopback trong bản dev CHƯA đóng gói,
       * để E2E trỏ được vào mock server cục bộ.
       *
       * `app.isPackaged` là điều kiện duy nhất — không có biến môi trường hay cờ dòng lệnh nào
       * bật được nó. Bản phát hành vì thế KHÔNG THỂ chấp nhận http://, kể cả khi ai đó sửa
       * cấu hình hay policy.
       */
      allowInsecureLoopback: opts.isDevelopment,
      testAtlassian: async (type) => {
        // Redmine/XWiki (ADR 0010): mỗi hệ thống có server riêng. `restart()` chạy lại đúng bước
        // khởi chạy — với Redmine gồm cả `get_current_user`, nên API key sai lộ ra ở đây là
        // `REDMINE_AUTH_FAILED` chứ không đợi tới lúc chat.
        if (type === 'redmine' || type === 'xwiki') {
          const blocker = type === 'redmine' ? redmineBlocker(services) : null
          const server = type === 'redmine' ? services.redmine : services.xwiki
          if (blocker !== null || server === null) {
            return {
              ok: false,
              checkedAt: new Date().toISOString(),
              errorCode:
                blocker ??
                (type === 'redmine'
                  ? ERROR_CODES.REDMINE_CONFIG_REQUIRED
                  : ERROR_CODES.XWIKI_CONFIG_REQUIRED),
            }
          }
          await server.restart()
          if (type === 'xwiki') await server.callTool('xwiki_list_wikis', {})
          const account = server.actingAccount(type)
          return {
            ok: true,
            checkedAt: new Date().toISOString(),
            detail:
              type === 'redmine' && account !== undefined
                ? `Kết nối thành công — đang dùng tài khoản ${account}`
                : 'Kết nối thành công',
          }
        }
        const manager = services.mcp
        if (manager === null) {
          return {
            ok: false,
            checkedAt: new Date().toISOString(),
            errorCode: 'MCP_SERVER_UNAVAILABLE',
          }
        }
        await manager.restart()
        // 'mcpGateway' tự nó không map tới một tool Jira/Confluence cụ thể — chỉ xác nhận bắt
        // tay MCP (initialize) và bearer token được chấp nhận là đủ; test riêng 'jira'/
        // 'confluence' mới gọi thử tool để xác nhận PAT đúng.
        if (type !== 'mcpGateway') {
          const probe =
            type === 'jira'
              ? { tool: 'jira_search', args: { jql: 'order by created DESC', limit: 1 } }
              : { tool: 'confluence_search', args: { query: 'type = page', limit: 1 } }
          await manager.callTool(probe.tool, probe.args)
        }
        return { ok: true, checkedAt: new Date().toISOString(), detail: 'Kết nối thành công' }
      },
    }),
    models,
    conversations,
    commitments,
    checkInState,
    activity,
    checkIns,
    memory,
    agents,
    baKnowledge,
    baDocuments,
    baReviews,
    /**
     * Job trích xuất nhận model và LLM client qua closure vì cả hai chỉ tồn tại sau khi
     * `services` được dựng xong — cùng cách `connections.testAtlassian` đọc `services.mcp`.
     */
    baExtraction: new BaExtractionJob({
      documents: baDocuments,
      resolveModel: () => models.resolveForConversation(null, null),
      buildLlmClient: (provider, timeoutMs) =>
        services.connections.buildLlmClient(provider, timeoutMs),
      settings: () => settings.get(),
      logger,
    }),
    /**
     * Cùng cách nhận model qua closure như job trích xuất — và cũng chỉ dùng tới model ở đúng một
     * chỗ: bước gợi ý câu chữ. Việc chạy bộ luật hoàn toàn cục bộ.
     */
    baReview: new BaReviewService({
      profileId: profile.id,
      documents: baDocuments,
      knowledge: baKnowledge,
      reviews: baReviews,
      activity,
      standards: () => baStandards,
      resolveModel: () => models.resolveForConversation(null, null),
      buildLlmClient: (provider, timeoutMs) =>
        services.connections.buildLlmClient(provider, timeoutMs),
      settings: () => settings.get(),
      logger,
    }),
    /**
     * Bản tin đọc Redmine qua closure vì `services.redmine` được dựng lại mỗi lần đổi kết nối Redmine —
     * giữ một tham chiếu cứng ở đây sẽ khoá bản tin vào manager cũ.
     */
    briefing: new DailyBriefingService({
      profileId: profile.id,
      commitments,
      settings: () => settings.get(),
      redmine: () => services.redmine,
      redmineBaseUrl: () => services.connections.get('redmine')?.baseUrl ?? null,
      summary: {
        resolveModel: () => models.resolveForConversation(null, null),
        buildLlmClient: (provider, timeoutMs) =>
          services.connections.buildLlmClient(provider, timeoutMs),
        timeoutMs: () => settings.get().llmTimeoutMs,
      },
      logger,
    }),
    baStandards,
    bankChecklists,
    bankChecklist: new BankChecklistService({
      repository: bankChecklists,
      templates: bankChecklistTemplates,
      resolveModel: () => models.resolveForConversation(null, null),
      buildLlmClient: (provider, timeoutMs) =>
        services.connections.buildLlmClient(provider, timeoutMs),
      settings: () => settings.get(),
      logger,
    }),
    bankChecklistTemplates,
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
    fileWriter,
    mcp: null,
    redmine: null,
    xwiki: null,
    mcpRouter: new McpToolRouter(() => [
      services.mcp === null ? null : { label: 'Jira/Confluence', source: services.mcp },
      services.redmine === null
        ? null
        : {
            label: 'Redmine',
            source: services.redmine,
            unavailableCode: () => services.redmine?.unavailableCode,
          },
      services.xwiki === null
        ? null
        : {
            label: 'XWiki',
            source: services.xwiki,
            unavailableCode: () => services.xwiki?.unavailableCode,
          },
    ]),
    dispose: async () => {
      checkIns.stop()
      await chatgpt.dispose()
      await services.mcp?.stop()
      await services.redmine?.stop()
      await services.xwiki?.stop()
      await extractionRunner.dispose()
      tempWorkspace.releaseAll()
      store.close()
      await logger.flush()
    },
  }

  services.mcp = buildMcpManager(services, opts.onMcpStatus)
  services.redmine = buildRedmineServer(services, opts.onMcpStatus)
  services.xwiki = buildXwikiServer(services, opts.onMcpStatus)
  return services
}

/**
 * Tên tool của mọi registry không được trùng nhau (ADR 0010). Kiểm một lần khi khởi động với URL
 * giả — tên tool không phụ thuộc URL — để lỗi lập trình lộ ra ngay, không phải lần đầu model gọi.
 */
assertDisjointToolNames({
  atlassian: buildToolRegistry({
    jiraBaseUrl: 'https://x.invalid',
    confluenceBaseUrl: 'https://x.invalid',
  }),
  redmine: buildRedmineTools('https://x.invalid'),
  xwiki: buildXwikiTools('https://x.invalid'),
})

/**
 * Lý do Redmine chưa dựng được, để "Kiểm tra kết nối" báo đúng chỗ cần sửa. `null` = đủ điều kiện.
 *
 * Redmine không có endpoint MCP riêng: nó đi qua URL + bearer token của kết nối `mcpGateway`.
 */
export function redmineBlocker(services: NexaServices): ErrorCode | null {
  const redmine = services.connections.get('redmine')
  if (redmine === null || !redmine.hasCredential) return ERROR_CODES.REDMINE_CONFIG_REQUIRED
  const gateway = services.connections.get('mcpGateway')
  if (gateway === null || !gateway.enabled || !gateway.hasCredential) {
    return ERROR_CODES.REDMINE_GATEWAY_REQUIRED
  }
  return null
}

/** Dựng server Redmine từ cấu hình hiện tại. null khi chưa bật hoặc thiếu MCP Gateway. */
export function buildRedmineServer(
  services: NexaServices,
  onStatus: (event: McpStatusEvent) => void,
): RemoteMcpServer | null {
  const redmine = services.connections.get('redmine')
  const gateway = services.connections.get('mcpGateway')
  if (redmine === null || !redmine.enabled || gateway === null) return null
  if (redmineBlocker(services) !== null) return null

  return new RemoteMcpServer({
    system: 'redmine',
    label: 'Redmine',
    url: gateway.baseUrl,
    ...(services.allowInsecureLoopback ? { allowInsecureLoopback: true } : {}),
    // Đọc cả hai secret NGAY trước mỗi request (ADR-0008 biện pháp 3): không field nào giữ chúng.
    headers: () =>
      buildRedmineGatewayHeaders({
        gatewayToken: services.security.readCredential('mcpGateway'),
        apiKey: services.security.readCredential('redmine'),
      }),
    registry: buildRedmineTools(redmine.baseUrl),
    features: () => services.settings.get().features,
    logger: services.logger,
    targetSystemUrl: redmine.baseUrl,
    toolTimeoutMs: services.settings.get().toolTimeoutMs,
    classifyError: classifyRedmineError,
    // Endpoint là gateway: 401 ở bước initialize là bearer token của GATEWAY sai, không phải API key.
    transportAuthFailedCode: ERROR_CODES.MCP_GATEWAY_AUTH_FAILED,
    identify: identifyRedmineUser,
    actingAccountFallback: 'Chủ sở hữu API key Redmine',
    onStatus,
  })
}

/** Dựng server XWiki. null khi chưa cấu hình hoặc đang tắt. */
export function buildXwikiServer(
  services: NexaServices,
  onStatus: (event: McpStatusEvent) => void,
): RemoteMcpServer | null {
  const xwiki = services.connections.get('xwiki')
  if (xwiki === null || !xwiki.enabled || !xwiki.hasCredential) return null

  const origin = new URL(xwiki.baseUrl).origin
  return new RemoteMcpServer({
    system: 'xwiki',
    label: 'XWiki',
    url: xwiki.baseUrl,
    // Endpoint XWiki trả 404 nếu có "/" cuối (đã kiểm với server thật) — gọi nguyên văn.
    exactUrl: true,
    headers: () => ({ authorization: `Bearer ${services.security.readCredential('xwiki')}` }),
    registry: buildXwikiTools(origin),
    features: () => services.settings.get().features,
    logger: services.logger,
    targetSystemUrl: origin,
    toolTimeoutMs: services.settings.get().toolTimeoutMs,
    classifyError: classifyXwikiError,
    transportAuthFailedCode: ERROR_CODES.XWIKI_AUTH_FAILED,
    actingAccountFallback: 'Chủ sở hữu token XWiki',
    onStatus,
  })
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

  // Có kết nối 'mcpGateway' đã bật ⇒ dùng transport HTTP remote (ADR-0005) thay vì tự spawn
  // `uvx mcp-atlassian` bằng stdio — đúng trường hợp hạ tầng tổ chức chỉ cung cấp một endpoint
  // HTTP có sẵn (ví dụ MCP gateway của LiteLLM) chứ không có package Python cài cục bộ.
  const gatewayConnection = services.connections.get('mcpGateway')
  const transport =
    gatewayConnection !== null && gatewayConnection.enabled
      ? {
          gateway: {
            url: gatewayConnection.baseUrl,
            token: () => services.security.readCredential('mcpGateway'),
            requestTimeoutMs: settings.toolTimeoutMs,
            // Đọc lại mỗi lần dùng, không chụp giá trị lúc dựng manager: người dùng tích/bỏ
            // tích trong Settings là có hiệu lực ngay, không phải khởi động lại app.
            skipAtlassianTlsVerify: () => services.settings.get().mcpGatewaySkipAtlassianTlsVerify,
          },
        }
      : { spec: readMcpSpec(services.settings.get()) }

  return new AtlassianMcpManager({
    ...transport,
    logger: services.logger,
    credentials: (): AtlassianCredentials => {
      const out: {
        jira?: AtlassianCredentials['jira']
        confluence?: AtlassianCredentials['confluence']
      } = {}
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
      logger.warn('org-policy-unreadable', {})
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
