import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface, type Interface as ReadLineInterface } from 'node:readline'
import {
  ERROR_CODES,
  NexaError,
  type ChatGptAccountStatus,
  type ChatGptModel,
  type ChatGptRateLimitWindow,
  type ErrorCode,
} from '@nexa/shared-types'
import type { Logger } from '@nexa/observability'

interface JsonRpcMessage {
  readonly id?: number | string
  readonly method?: string
  readonly params?: unknown
  readonly result?: unknown
  readonly error?: unknown
}

interface PendingRequest {
  readonly resolve: (value: unknown) => void
  readonly reject: (error: Error) => void
  readonly timer: NodeJS.Timeout
}

interface NotificationWaiter {
  readonly method: string
  readonly matches: (params: unknown) => boolean
  readonly resolve: (params: unknown) => void
  readonly reject: (error: Error) => void
  readonly timer: NodeJS.Timeout
}

interface ActiveTurn {
  readonly threadId: string
  turnId: string | null
  readonly onDelta: (delta: string) => void
  readonly itemText: Map<string, string>
  readonly resolve: () => void
  readonly reject: (error: Error) => void
  readonly timer: NodeJS.Timeout
}

export interface ChatGptHistoryMessage {
  readonly role: 'user' | 'assistant'
  readonly content: string
}

export interface ChatGptTurnInput {
  readonly modelId: string
  readonly reasoningEffort?: string
  readonly prompt: string
  readonly history: readonly ChatGptHistoryMessage[]
  readonly signal: AbortSignal
  readonly onDelta: (delta: string) => void
}

export interface ChatGptAccountServiceOptions {
  readonly logger: Logger
  readonly appVersion: string
  readonly openExternal: (url: string) => Promise<void>
  readonly spawnAppServer?: () => ChildProcessWithoutNullStreams
  readonly requestTimeoutMs?: number
  readonly loginTimeoutMs?: number
  readonly turnTimeoutMs?: number
  readonly chatCwd?: string
}

const EMPTY_STATUS: ChatGptAccountStatus = {
  appServerAvailable: false,
  authenticated: false,
  email: null,
  planType: null,
  rateLimit: null,
}

const CHAT_DEVELOPER_INSTRUCTIONS = [
  'You are the assistant inside Nexa conversational chat.',
  'Answer the user directly in the language they use.',
  'Do not run commands, inspect the local filesystem, modify files, call tools, or ask for tool approval.',
  'Use only the conversation text supplied by Nexa.',
].join(' ')

const MAX_HISTORY_MESSAGES = 60
const MAX_HISTORY_CHARS = 120_000

/**
 * Biên tích hợp duy nhất với `codex app-server`.
 *
 * Codex sở hữu OAuth, token persistence và refresh. Lớp này chỉ nói JSON-RPC qua stdio, lọc
 * dữ liệu trả về và mở URL đăng nhập đã qua allowlist bằng trình duyệt hệ thống.
 */
export class ChatGptAccountService {
  private readonly log: Logger
  private readonly spawnAppServer: () => ChildProcessWithoutNullStreams
  private readonly requestTimeoutMs: number
  private readonly loginTimeoutMs: number
  private readonly turnTimeoutMs: number
  private child: ChildProcessWithoutNullStreams | null = null
  private lines: ReadLineInterface | null = null
  private startPromise: Promise<void> | null = null
  private nextRequestId = 1
  private readonly pending = new Map<number, PendingRequest>()
  private readonly notificationWaiters = new Set<NotificationWaiter>()
  private readonly activeTurns = new Map<string, ActiveTurn>()
  private loginInFlight = false

  constructor(private readonly opts: ChatGptAccountServiceOptions) {
    this.log = opts.logger.child({ module: 'chatgpt-account-service' })
    this.spawnAppServer =
      opts.spawnAppServer ??
      (() =>
        spawn('codex', ['app-server'], {
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        }))
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 15_000
    this.loginTimeoutMs = opts.loginTimeoutMs ?? 5 * 60_000
    this.turnTimeoutMs = opts.turnTimeoutMs ?? 10 * 60_000
  }

  async status(): Promise<ChatGptAccountStatus> {
    try {
      await this.ensureStarted()
      return await this.readStatus()
    } catch (error) {
      const nexa = NexaError.wrap(error)
      if (nexa.code !== ERROR_CODES.CHATGPT_APP_SERVER_UNAVAILABLE) throw nexa
      return EMPTY_STATUS
    }
  }

  async models(): Promise<ChatGptModel[]> {
    try {
      await this.ensureStarted()
      return await this.readModels()
    } catch (error) {
      throw new NexaError(ERROR_CODES.CHATGPT_MODEL_CATALOG_UNAVAILABLE, { cause: error })
    }
  }

  async resolveModel(modelId: string): Promise<ChatGptModel> {
    await this.ensureStarted()
    await this.requireAuthenticated()
    const model = (await this.readModels()).find((item) => item.modelId === modelId)
    if (model === undefined) {
      throw new NexaError(ERROR_CODES.CHATGPT_MODEL_UNAVAILABLE, {
        safeDetail: 'selected model is not present in the managed ChatGPT catalog',
      })
    }
    return model
  }

  /** Chạy một lượt text chat bằng Codex App Server và stream delta đã lọc về controller. */
  async runTurn(input: ChatGptTurnInput): Promise<void> {
    await this.ensureStarted()
    const model = await this.resolveModel(input.modelId)
    const effort = chooseReasoningEffort(model, input.reasoningEffort)
    const started = asRecord(
      await this.request('thread/start', {
        model: model.modelId,
        approvalPolicy: 'never',
        sandbox: 'read-only',
        ephemeral: true,
        serviceName: 'nexa_desktop_chat',
        developerInstructions: CHAT_DEVELOPER_INSTRUCTIONS,
        ...(this.opts.chatCwd === undefined ? {} : { cwd: this.opts.chatCwd }),
      }),
    )
    const threadId = boundedString(asRecord(started['thread'])['id'], 200)
    if (threadId === null) {
      throw new NexaError(ERROR_CODES.CHATGPT_TURN_FAILED, {
        safeDetail: 'thread/start returned no valid thread id',
      })
    }

    const history = buildInjectedHistory(input.history)
    if (history.length > 0) {
      await this.request('thread/inject_items', { threadId, items: history })
    }

    const completion = this.waitForTurn(threadId, input.onDelta)
    const abort = (): void => {
      const active = this.activeTurns.get(threadId)
      if (active?.turnId === null || active === undefined) return
      void this.request('turn/interrupt', { threadId, turnId: active.turnId }).catch(
        () => undefined,
      )
    }
    input.signal.addEventListener('abort', abort, { once: true })

    try {
      const result = asRecord(
        await this.request('turn/start', {
          threadId,
          input: [{ type: 'text', text: input.prompt }],
          model: model.modelId,
          ...(effort === null ? {} : { effort }),
          approvalPolicy: 'never',
          sandboxPolicy: { type: 'readOnly', networkAccess: false },
        }),
      )
      const turnId = boundedString(asRecord(result['turn'])['id'], 200)
      const active = this.activeTurns.get(threadId)
      if (active !== undefined) active.turnId = turnId
      if (turnId === null) {
        throw new NexaError(ERROR_CODES.CHATGPT_TURN_FAILED, {
          safeDetail: 'turn/start returned no valid turn id',
        })
      }
      if (input.signal.aborted) abort()
      await completion
    } catch (error) {
      this.rejectTurn(threadId, NexaError.wrap(error, ERROR_CODES.CHATGPT_TURN_FAILED))
      void completion.catch(() => undefined)
      throw error
    } finally {
      input.signal.removeEventListener('abort', abort)
      this.clearTurn(threadId)
      void this.request('thread/unsubscribe', { threadId }).catch(() => undefined)
    }
  }

  async login(): Promise<ChatGptAccountStatus> {
    if (this.loginInFlight) {
      throw new NexaError(ERROR_CODES.OPERATION_ALREADY_RUNNING, {
        safeDetail: 'ChatGPT login already in progress',
      })
    }

    this.loginInFlight = true
    try {
      await this.ensureStarted()
      const started = asRecord(
        await this.request('account/login/start', {
          type: 'chatgpt',
          useHostedLoginSuccessPage: true,
          appBrand: 'chatgpt',
        }),
      )
      const loginId = boundedString(started['loginId'], 100)
      const authUrl = validateAuthUrl(boundedString(started['authUrl'], 4096))
      if (loginId === null || authUrl === null) {
        throw new NexaError(ERROR_CODES.CHATGPT_AUTH_FAILED, {
          safeDetail: 'app-server returned an invalid managed-login response',
        })
      }

      const completion = this.waitForNotification(
        'account/login/completed',
        (params) => boundedString(asRecord(params)['loginId'], 100) === loginId,
        this.loginTimeoutMs,
        ERROR_CODES.CHATGPT_LOGIN_TIMEOUT,
      )

      // Không log authUrl: URL có state/callback data và không cần xuất hiện trong diagnostics.
      try {
        await this.opts.openExternal(authUrl)
      } catch (error) {
        void completion.catch(() => undefined)
        void this.request('account/login/cancel', { loginId }).catch(() => undefined)
        throw new NexaError(ERROR_CODES.CHATGPT_AUTH_FAILED, { cause: error })
      }
      const completed = asRecord(await completion)
      if (completed['success'] !== true) {
        throw new NexaError(ERROR_CODES.CHATGPT_AUTH_FAILED, {
          safeDetail: 'managed ChatGPT login did not complete successfully',
        })
      }

      const status = await this.readStatusWithRetry()
      if (!status.authenticated) {
        throw new NexaError(ERROR_CODES.CHATGPT_AUTH_FAILED, {
          safeDetail: 'managed login completed but account state was not available',
        })
      }
      this.log.info('chatgpt-login-completed', { authenticated: true })
      return status
    } finally {
      this.loginInFlight = false
    }
  }

  async logout(): Promise<ChatGptAccountStatus> {
    await this.ensureStarted()
    await this.request('account/logout', {})
    const status = await this.readStatusWithRetry()
    this.log.info('chatgpt-logout-completed', { authenticated: status.authenticated })
    return status
  }

  async dispose(): Promise<void> {
    this.failAll(new NexaError(ERROR_CODES.CHATGPT_APP_SERVER_UNAVAILABLE))
    this.lines?.close()
    this.lines = null
    const child = this.child
    this.child = null
    if (child !== null && child.exitCode === null && child.signalCode === null) child.kill()
  }

  private async ensureStarted(): Promise<void> {
    if (this.child !== null) return
    if (this.startPromise !== null) return this.startPromise

    this.startPromise = this.start()
    try {
      await this.startPromise
    } finally {
      this.startPromise = null
    }
  }

  private async start(): Promise<void> {
    let child: ChildProcessWithoutNullStreams
    try {
      child = this.spawnAppServer()
    } catch (error) {
      throw this.unavailable(error)
    }

    this.child = child
    this.lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
    this.lines.on('line', (line) => this.onLine(line))
    child.stderr.on('data', (chunk: Buffer | string) => {
      this.log.debug('codex-app-server-stderr', { byteLength: Buffer.byteLength(chunk) })
    })
    child.once('error', (error) => this.onProcessStopped(error))
    child.once('exit', (code, signal) =>
      this.onProcessStopped(
        new Error(`codex app-server stopped (${String(code ?? signal ?? 'unknown')})`),
      ),
    )

    try {
      await this.rawRequest('initialize', {
        clientInfo: {
          name: 'nexa_desktop',
          title: 'Nexa Desktop',
          version: this.opts.appVersion,
        },
      })
      this.write({ method: 'initialized', params: {} })
      this.log.info('codex-app-server-ready')
    } catch (error) {
      await this.dispose()
      throw this.unavailable(error)
    }
  }

  private request(method: string, params: Record<string, unknown>): Promise<unknown> {
    return this.rawRequest(method, params)
  }

  private rawRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextRequestId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(
          new NexaError(ERROR_CODES.CHATGPT_APP_SERVER_UNAVAILABLE, {
            safeDetail: `app-server request timed out: ${method}`,
          }),
        )
      }, this.requestTimeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      try {
        this.write({ method, id, params })
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(this.unavailable(error))
      }
    })
  }

  private write(message: Record<string, unknown>): void {
    const child = this.child
    if (child === null || child.stdin.destroyed) throw this.unavailable()
    child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  private onLine(line: string): void {
    let message: JsonRpcMessage
    try {
      const parsed: unknown = JSON.parse(line)
      if (typeof parsed !== 'object' || parsed === null) return
      message = parsed as JsonRpcMessage
    } catch {
      this.log.warn('codex-app-server-invalid-json', { byteLength: Buffer.byteLength(line) })
      return
    }

    if (message.id !== undefined && typeof message.method === 'string') {
      this.handleServerRequest(message.id, message.method)
      return
    }

    if (typeof message.id === 'number') {
      const pending = this.pending.get(message.id)
      if (pending === undefined) return
      clearTimeout(pending.timer)
      this.pending.delete(message.id)
      if (message.error !== undefined) {
        pending.reject(
          new NexaError(ERROR_CODES.CHATGPT_APP_SERVER_UNAVAILABLE, {
            safeDetail: 'app-server returned a JSON-RPC error',
          }),
        )
      } else {
        pending.resolve(message.result)
      }
      return
    }

    if (typeof message.method !== 'string') return
    this.handleTurnNotification(message.method, message.params)
    for (const waiter of this.notificationWaiters) {
      if (waiter.method !== message.method || !waiter.matches(message.params)) continue
      clearTimeout(waiter.timer)
      this.notificationWaiters.delete(waiter)
      waiter.resolve(message.params)
    }
  }

  /** Fail-closed: conversational Chat không hỗ trợ command, file change hay client tools. */
  private handleServerRequest(id: number | string, method: string): void {
    if (
      method === 'item/commandExecution/requestApproval' ||
      method === 'item/fileChange/requestApproval'
    ) {
      this.write({ id, result: { decision: 'decline' } })
      return
    }
    this.write({
      id,
      error: { code: -32_601, message: 'Nexa conversational chat does not support this request.' },
    })
  }

  private handleTurnNotification(method: string, rawParams: unknown): void {
    const params = asRecord(rawParams)
    const threadId = boundedString(params['threadId'], 200)
    if (threadId === null) return
    const active = this.activeTurns.get(threadId)
    if (active === undefined) return

    const notificationTurnId = boundedString(params['turnId'], 200)
    if (
      active.turnId !== null &&
      notificationTurnId !== null &&
      notificationTurnId !== active.turnId
    ) {
      return
    }

    if (method === 'item/agentMessage/delta') {
      const itemId = boundedString(params['itemId'], 200)
      const delta = boundedStringAllowEmpty(params['delta'], 200_000)
      if (itemId === null || delta === null || delta === '') return
      active.itemText.set(itemId, `${active.itemText.get(itemId) ?? ''}${delta}`)
      active.onDelta(delta)
      return
    }

    if (method === 'item/completed') {
      const item = asRecord(params['item'])
      if (item['type'] !== 'agentMessage') return
      const itemId = boundedString(item['id'], 200)
      const finalText = boundedStringAllowEmpty(item['text'], 500_000)
      if (itemId === null || finalText === null || finalText === '') return
      const streamed = active.itemText.get(itemId) ?? ''
      if (finalText.startsWith(streamed) && finalText.length > streamed.length) {
        active.onDelta(finalText.slice(streamed.length))
      } else if (streamed === '') {
        active.onDelta(finalText)
      }
      active.itemText.set(itemId, finalText)
      return
    }

    if (method !== 'turn/completed') return
    const turn = asRecord(params['turn'])
    const completedTurnId = boundedString(turn['id'], 200)
    if (active.turnId !== null && completedTurnId !== active.turnId) return
    const status = boundedString(turn['status'], 40)
    if (status === 'completed') {
      this.resolveTurn(threadId)
      return
    }
    if (status === 'interrupted') {
      this.rejectTurn(threadId, new NexaError(ERROR_CODES.LLM_CANCELLED))
      return
    }
    this.rejectTurn(threadId, mapTurnFailure(turn))
  }

  private waitForNotification(
    method: string,
    matches: (params: unknown) => boolean,
    timeoutMs: number,
    timeoutCode: ErrorCode,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const waiter = {} as NotificationWaiter
      const timer = setTimeout(() => {
        this.notificationWaiters.delete(waiter)
        reject(new NexaError(timeoutCode))
      }, timeoutMs)
      Object.assign(waiter, { method, matches, resolve, reject, timer })
      this.notificationWaiters.add(waiter)
    })
  }

  private waitForTurn(threadId: string, onDelta: (delta: string) => void): Promise<void> {
    if (this.activeTurns.has(threadId)) {
      return Promise.reject(
        new NexaError(ERROR_CODES.OPERATION_ALREADY_RUNNING, {
          safeDetail: 'a turn is already active on the managed ChatGPT thread',
        }),
      )
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.activeTurns.delete(threadId)
        reject(new NexaError(ERROR_CODES.CHATGPT_TURN_FAILED, { safeDetail: 'turn timed out' }))
      }, this.turnTimeoutMs)
      this.activeTurns.set(threadId, {
        threadId,
        turnId: null,
        onDelta,
        itemText: new Map(),
        resolve,
        reject,
        timer,
      })
    })
  }

  private resolveTurn(threadId: string): void {
    const active = this.activeTurns.get(threadId)
    if (active === undefined) return
    clearTimeout(active.timer)
    this.activeTurns.delete(threadId)
    active.resolve()
  }

  private rejectTurn(threadId: string, error: Error): void {
    const active = this.activeTurns.get(threadId)
    if (active === undefined) return
    clearTimeout(active.timer)
    this.activeTurns.delete(threadId)
    active.reject(error)
  }

  private clearTurn(threadId: string): void {
    const active = this.activeTurns.get(threadId)
    if (active === undefined) return
    clearTimeout(active.timer)
    this.activeTurns.delete(threadId)
  }

  private async readStatus(): Promise<ChatGptAccountStatus> {
    const result = asRecord(await this.request('account/read', { refreshToken: false }))
    const account = asRecordOrNull(result['account'])
    if (boundedString(account?.['type'], 40) !== 'chatgpt') {
      return { ...EMPTY_STATUS, appServerAvailable: true }
    }

    let rateLimit: ChatGptRateLimitWindow | null = null
    try {
      rateLimit = parseRateLimit(await this.request('account/rateLimits/read', {}))
    } catch (error) {
      this.log.warn('chatgpt-rate-limit-read-failed', {
        errorCode: NexaError.wrap(error).code,
      })
    }

    return {
      appServerAvailable: true,
      authenticated: true,
      email: boundedString(account?.['email'], 320),
      planType: boundedString(account?.['planType'], 64),
      rateLimit,
    }
  }

  private async requireAuthenticated(): Promise<void> {
    const result = asRecord(await this.request('account/read', { refreshToken: false }))
    const account = asRecordOrNull(result['account'])
    if (boundedString(account?.['type'], 40) !== 'chatgpt') {
      throw new NexaError(ERROR_CODES.CHATGPT_AUTH_REQUIRED)
    }
  }

  private async readStatusWithRetry(): Promise<ChatGptAccountStatus> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const status = await this.readStatus()
      if (attempt === 4 || status.authenticated) return status
      await delay(150)
    }
    return { ...EMPTY_STATUS, appServerAvailable: true }
  }

  private async readModels(): Promise<ChatGptModel[]> {
    const models: ChatGptModel[] = []
    const seenIds = new Set<string>()
    const seenCursors = new Set<string>()
    let cursor: string | null = null

    // Giới hạn năm trang/500 model để một App Server lỗi không thể làm IPC tăng vô hạn.
    for (let page = 0; page < 5; page++) {
      const params: Record<string, unknown> = { limit: 100, includeHidden: false }
      if (cursor !== null) params['cursor'] = cursor
      const result = asRecord(await this.request('model/list', params))
      const data = Array.isArray(result['data']) ? result['data'].slice(0, 100) : []

      for (const item of data) {
        const model = parseModel(item)
        if (model === null || seenIds.has(model.id)) continue
        seenIds.add(model.id)
        models.push(model)
      }

      const nextCursor = boundedString(result['nextCursor'], 1024)
      if (nextCursor === null) break
      if (seenCursors.has(nextCursor)) {
        throw new NexaError(ERROR_CODES.CHATGPT_MODEL_CATALOG_UNAVAILABLE, {
          safeDetail: 'app-server repeated a model-list cursor',
        })
      }
      seenCursors.add(nextCursor)
      cursor = nextCursor
    }

    return models
  }

  private onProcessStopped(error: Error): void {
    if (this.child === null) return
    this.child = null
    this.lines?.close()
    this.lines = null
    this.failAll(this.unavailable(error))
    this.log.warn('codex-app-server-stopped')
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
    for (const waiter of this.notificationWaiters) {
      clearTimeout(waiter.timer)
      waiter.reject(error)
    }
    this.notificationWaiters.clear()
    for (const active of this.activeTurns.values()) {
      clearTimeout(active.timer)
      active.reject(error)
    }
    this.activeTurns.clear()
  }

  private unavailable(cause?: unknown): NexaError {
    return new NexaError(ERROR_CODES.CHATGPT_APP_SERVER_UNAVAILABLE, { cause })
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function asRecordOrNull(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function boundedString(value: unknown, maxLength: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength ? value : null
}

function boundedStringAllowEmpty(value: unknown, maxLength: number): string | null {
  return typeof value === 'string' && value.length <= maxLength ? value : null
}

function boundedNumber(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? value
    : null
}

function parseModel(value: unknown): ChatGptModel | null {
  const item = asRecord(value)
  if (item['hidden'] === true) return null
  const id = boundedString(item['id'], 200) ?? boundedString(item['model'], 200)
  if (id === null) return null
  const modelId = boundedString(item['model'], 200) ?? id
  const displayName = boundedString(item['displayName'], 120) ?? modelId

  const rawEfforts = Array.isArray(item['supportedReasoningEfforts'])
    ? item['supportedReasoningEfforts'].slice(0, 20)
    : []
  const supportedReasoningEfforts = rawEfforts.flatMap((raw) => {
    const effort = asRecord(raw)
    const reasoningEffort = boundedString(effort['reasoningEffort'], 40)
    if (reasoningEffort === null) return []
    return [
      {
        reasoningEffort,
        description: boundedString(effort['description'], 240),
      },
    ]
  })

  const inputModalities = Array.isArray(item['inputModalities'])
    ? item['inputModalities'].slice(0, 10).flatMap((modality) => boundedString(modality, 40) ?? [])
    : ['text', 'image']

  return {
    id,
    modelId,
    displayName,
    isDefault: item['isDefault'] === true,
    defaultReasoningEffort: boundedString(item['defaultReasoningEffort'], 40),
    supportedReasoningEfforts,
    inputModalities,
  }
}

function chooseReasoningEffort(model: ChatGptModel, requested: string | undefined): string | null {
  const supported = new Set(
    model.supportedReasoningEfforts.map((item) => item.reasoningEffort).filter(Boolean),
  )
  if (requested !== undefined && supported.has(requested)) return requested
  if (
    model.defaultReasoningEffort !== null &&
    (supported.size === 0 || supported.has(model.defaultReasoningEffort))
  ) {
    return model.defaultReasoningEffort
  }
  return model.supportedReasoningEfforts[0]?.reasoningEffort ?? null
}

function buildInjectedHistory(
  history: readonly ChatGptHistoryMessage[],
): Record<string, unknown>[] {
  const selected: ChatGptHistoryMessage[] = []
  let usedChars = 0
  for (const message of history.slice(-MAX_HISTORY_MESSAGES).reverse()) {
    if (message.content === '' || message.content.length > 200_000) continue
    if (usedChars + message.content.length > MAX_HISTORY_CHARS) break
    selected.push(message)
    usedChars += message.content.length
  }
  return selected.reverse().map((message) => ({
    type: 'message',
    role: message.role,
    content: [
      {
        type: message.role === 'assistant' ? 'output_text' : 'input_text',
        text: message.content,
      },
    ],
  }))
}

function mapTurnFailure(turn: Record<string, unknown>): NexaError {
  const info = asRecord(turn['error'])['codexErrorInfo']
  if (info === 'usageLimitExceeded' || info === 'rateLimitExceeded') {
    return new NexaError(ERROR_CODES.CHATGPT_RATE_LIMITED)
  }
  if (info === 'unauthorized') return new NexaError(ERROR_CODES.CHATGPT_AUTH_REQUIRED)
  return new NexaError(ERROR_CODES.CHATGPT_TURN_FAILED, {
    safeDetail: 'managed ChatGPT turn completed with failed status',
  })
}

function validateAuthUrl(raw: string | null): string | null {
  if (raw === null) return null
  try {
    const url = new URL(raw)
    const hostAllowed =
      url.hostname === 'chatgpt.com' ||
      url.hostname.endsWith('.chatgpt.com') ||
      url.hostname === 'auth.openai.com'
    return url.protocol === 'https:' && hostAllowed ? url.toString() : null
  } catch {
    return null
  }
}

function parseRateLimit(value: unknown): ChatGptRateLimitWindow | null {
  const result = asRecord(value)
  const byId = asRecord(result['rateLimitsByLimitId'])
  const bucket = asRecord(byId['codex'] ?? result['rateLimits'])
  const primary = asRecord(bucket['primary'])
  const usedPercent = boundedNumber(primary['usedPercent'], 0, 100)
  const windowDurationMins = boundedNumber(primary['windowDurationMins'], 1, 525_600)
  const resetsAt = boundedNumber(primary['resetsAt'], 0, Number.MAX_SAFE_INTEGER)
  if (usedPercent === null || windowDurationMins === null || resetsAt === null) return null
  return { usedPercent, windowDurationMins, resetsAt }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
