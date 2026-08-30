import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { createInterface } from 'node:readline'
import { describe, expect, it, vi } from 'vitest'
import { ERROR_CODES, NexaError } from '@nexa/shared-types'
import { Logger, MemorySink } from '@nexa/observability'
import { ChatGptAccountService } from './chatgpt-account-service.js'

class FakeChild extends EventEmitter {
  readonly stdin = new PassThrough()
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null

  kill(): boolean {
    this.exitCode = 0
    this.emit('exit', 0, null)
    return true
  }
}

function logger(): Logger {
  return new Logger({ sink: new MemorySink(), minLevel: 'debug' })
}

function reply(child: FakeChild, id: number, result: unknown): void {
  child.stdout.write(`${JSON.stringify({ id, result })}\n`)
}

function notify(child: FakeChild, method: string, params: unknown): void {
  child.stdout.write(`${JSON.stringify({ method, params })}\n`)
}

function serve(
  child: FakeChild,
  route: (message: Record<string, unknown>) => unknown,
): { readonly messages: Record<string, unknown>[]; close(): void } {
  const messages: Record<string, unknown>[] = []
  const lines = createInterface({ input: child.stdin, crlfDelay: Infinity })
  lines.on('line', (line) => {
    const message = JSON.parse(line) as Record<string, unknown>
    messages.push(message)
    if (typeof message['id'] !== 'number' || typeof message['method'] !== 'string') return
    reply(child, message['id'], route(message))
  })
  return { messages, close: () => lines.close() }
}

describe('ChatGptAccountService', () => {
  it('trả trạng thái unavailable an toàn khi Codex CLI không tồn tại', async () => {
    const service = new ChatGptAccountService({
      logger: logger(),
      appVersion: '0.1.0-test',
      openExternal: vi.fn(),
      spawnAppServer: () => {
        throw new Error('ENOENT codex')
      },
    })

    await expect(service.status()).resolves.toEqual({
      appServerAvailable: false,
      authenticated: false,
      email: null,
      planType: null,
      rateLimit: null,
    })
  })

  it('chỉ đưa thông tin tài khoản và hạn mức đã rút gọn ra ngoài main', async () => {
    const child = new FakeChild()
    const server = serve(child, (message) => {
      switch (message['method']) {
        case 'initialize':
          return { userAgent: 'codex-test' }
        case 'account/read':
          return {
            account: {
              type: 'chatgpt',
              email: 'user@example.com',
              planType: 'plus',
              accessToken: 'must-not-cross-ipc',
            },
            requiresOpenaiAuth: true,
          }
        case 'account/rateLimits/read':
          return {
            rateLimitsByLimitId: {
              codex: {
                primary: { usedPercent: 25, windowDurationMins: 15, resetsAt: 1_800_000_000 },
              },
            },
          }
        default:
          return {}
      }
    })
    const service = new ChatGptAccountService({
      logger: logger(),
      appVersion: '0.1.0-test',
      openExternal: vi.fn(),
      spawnAppServer: () => child as never,
    })

    const status = await service.status()

    expect(status).toEqual({
      appServerAvailable: true,
      authenticated: true,
      email: 'user@example.com',
      planType: 'plus',
      rateLimit: { usedPercent: 25, windowDurationMins: 15, resetsAt: 1_800_000_000 },
    })
    expect(JSON.stringify(status)).not.toContain('must-not-cross-ipc')
    expect(server.messages[0]).toMatchObject({
      method: 'initialize',
      params: { clientInfo: { name: 'nexa_desktop', version: '0.1.0-test' } },
    })

    await service.dispose()
    server.close()
  })

  it('phân trang và lọc model picker-visible từ Codex App Server', async () => {
    const child = new FakeChild()
    const server = serve(child, (message) => {
      if (message['method'] === 'initialize') return {}
      if (message['method'] !== 'model/list') return {}
      const params = message['params'] as Record<string, unknown>
      if (params['cursor'] === 'page-2') {
        return {
          data: [
            {
              id: 'gpt-5.6-terra',
              model: 'gpt-5.6-terra',
              displayName: 'GPT-5.6 Terra',
              isDefault: false,
            },
            { id: 'gpt-5.6-sol', model: 'duplicate-must-be-ignored' },
          ],
          nextCursor: null,
        }
      }
      return {
        data: [
          {
            id: 'gpt-5.6-sol',
            model: 'gpt-5.6-sol',
            displayName: 'GPT-5.6 Sol',
            hidden: false,
            isDefault: true,
            defaultReasoningEffort: 'low',
            supportedReasoningEfforts: [
              { reasoningEffort: 'low', description: 'Fast' },
              { reasoningEffort: 'max', description: 'Maximum reasoning' },
            ],
            inputModalities: ['text', 'image'],
            internalToken: 'must-not-cross-ipc',
          },
          { id: 'hidden-model', hidden: true },
          { displayName: 'missing id' },
        ],
        nextCursor: 'page-2',
      }
    })
    const service = new ChatGptAccountService({
      logger: logger(),
      appVersion: '0.1.0-test',
      openExternal: vi.fn(),
      spawnAppServer: () => child as never,
    })

    const models = await service.models()

    expect(models).toEqual([
      {
        id: 'gpt-5.6-sol',
        modelId: 'gpt-5.6-sol',
        displayName: 'GPT-5.6 Sol',
        isDefault: true,
        defaultReasoningEffort: 'low',
        supportedReasoningEfforts: [
          { reasoningEffort: 'low', description: 'Fast' },
          { reasoningEffort: 'max', description: 'Maximum reasoning' },
        ],
        inputModalities: ['text', 'image'],
      },
      {
        id: 'gpt-5.6-terra',
        modelId: 'gpt-5.6-terra',
        displayName: 'GPT-5.6 Terra',
        isDefault: false,
        defaultReasoningEffort: null,
        supportedReasoningEfforts: [],
        inputModalities: ['text', 'image'],
      },
    ])
    expect(JSON.stringify(models)).not.toContain('must-not-cross-ipc')
    expect(server.messages.filter((message) => message['method'] === 'model/list')).toHaveLength(2)

    await service.dispose()
    server.close()
  })

  it('stream lượt chat Plus bằng thread tạm, lịch sử text giới hạn và sandbox read-only', async () => {
    const child = new FakeChild()
    const deltas: string[] = []
    const server = serve(child, (message) => {
      switch (message['method']) {
        case 'initialize':
          return {}
        case 'account/read':
          return { account: { type: 'chatgpt', email: 'plus@example.com', planType: 'plus' } }
        case 'model/list':
          return {
            data: [
              {
                id: 'gpt-5.6-sol',
                model: 'gpt-5.6-sol',
                displayName: 'GPT-5.6 Sol',
                isDefault: true,
                defaultReasoningEffort: 'low',
                supportedReasoningEfforts: [
                  { reasoningEffort: 'low', description: 'Fast' },
                  { reasoningEffort: 'max', description: 'Maximum' },
                ],
              },
            ],
            nextCursor: null,
          }
        case 'thread/start':
          return { thread: { id: 'thread-1' } }
        case 'thread/inject_items':
          return {}
        case 'turn/start':
          setImmediate(() => {
            child.stdout.write(
              `${JSON.stringify({
                id: 700,
                method: 'item/commandExecution/requestApproval',
                params: { threadId: 'thread-1', turnId: 'turn-1' },
              })}\n`,
            )
            notify(child, 'item/agentMessage/delta', {
              threadId: 'thread-1',
              turnId: 'turn-1',
              itemId: 'item-1',
              delta: 'Xin ',
            })
            notify(child, 'item/completed', {
              threadId: 'thread-1',
              turnId: 'turn-1',
              item: { id: 'item-1', type: 'agentMessage', text: 'Xin chào' },
            })
            notify(child, 'turn/completed', {
              threadId: 'thread-1',
              turn: { id: 'turn-1', status: 'completed' },
            })
          })
          return { turn: { id: 'turn-1' } }
        default:
          return {}
      }
    })
    const service = new ChatGptAccountService({
      logger: logger(),
      appVersion: '0.1.0-test',
      openExternal: vi.fn(),
      chatCwd: '/tmp/nexa-chat',
      spawnAppServer: () => child as never,
    })

    await service.runTurn({
      modelId: 'gpt-5.6-sol',
      reasoningEffort: 'max',
      prompt: 'Chào bạn',
      history: [
        { role: 'user', content: 'Câu trước' },
        { role: 'assistant', content: 'Trả lời trước' },
      ],
      signal: new AbortController().signal,
      onDelta: (delta) => deltas.push(delta),
    })

    expect(deltas.join('')).toBe('Xin chào')
    expect(server.messages.find((message) => message['method'] === 'thread/start')).toMatchObject({
      params: {
        model: 'gpt-5.6-sol',
        approvalPolicy: 'never',
        sandbox: 'read-only',
        ephemeral: true,
        serviceName: 'nexa_desktop_chat',
        cwd: '/tmp/nexa-chat',
      },
    })
    expect(
      server.messages.find((message) => message['method'] === 'thread/inject_items'),
    ).toMatchObject({
      params: {
        threadId: 'thread-1',
        items: [
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Câu trước' }],
          },
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Trả lời trước' }],
          },
        ],
      },
    })
    expect(server.messages.find((message) => message['method'] === 'turn/start')).toMatchObject({
      params: {
        threadId: 'thread-1',
        input: [{ type: 'text', text: 'Chào bạn' }],
        model: 'gpt-5.6-sol',
        effort: 'max',
        approvalPolicy: 'never',
        sandboxPolicy: { type: 'readOnly', networkAccess: false },
      },
    })
    expect(server.messages).toContainEqual({ id: 700, result: { decision: 'decline' } })

    await service.dispose()
    server.close()
  })

  it('interrupt đúng turn khi người dùng dừng chat Plus', async () => {
    const child = new FakeChild()
    const server = serve(child, (message) => {
      switch (message['method']) {
        case 'initialize':
          return {}
        case 'account/read':
          return { account: { type: 'chatgpt', email: 'plus@example.com', planType: 'plus' } }
        case 'model/list':
          return { data: [{ id: 'gpt-5.6-sol', model: 'gpt-5.6-sol' }], nextCursor: null }
        case 'thread/start':
          return { thread: { id: 'thread-cancel' } }
        case 'turn/start':
          return { turn: { id: 'turn-cancel' } }
        case 'turn/interrupt':
          setImmediate(() =>
            notify(child, 'turn/completed', {
              threadId: 'thread-cancel',
              turn: { id: 'turn-cancel', status: 'interrupted' },
            }),
          )
          return {}
        default:
          return {}
      }
    })
    const service = new ChatGptAccountService({
      logger: logger(),
      appVersion: '0.1.0-test',
      openExternal: vi.fn(),
      spawnAppServer: () => child as never,
    })
    const abort = new AbortController()

    const turn = service.runTurn({
      modelId: 'gpt-5.6-sol',
      prompt: 'Một câu dài',
      history: [],
      signal: abort.signal,
      onDelta: vi.fn(),
    })
    await vi.waitFor(() => {
      expect(server.messages.some((message) => message['method'] === 'turn/start')).toBe(true)
    })
    abort.abort()

    await expect(turn).rejects.toSatisfy(
      (error: unknown) => NexaError.is(error) && error.code === ERROR_CODES.LLM_CANCELLED,
    )
    expect(server.messages.find((message) => message['method'] === 'turn/interrupt')).toMatchObject(
      {
        params: { threadId: 'thread-cancel', turnId: 'turn-cancel' },
      },
    )

    await service.dispose()
    server.close()
  })

  it('mở URL chính thức và hoàn tất browser login cho tài khoản Plus', async () => {
    const child = new FakeChild()
    let authenticated = false
    const server = serve(child, (message) => {
      switch (message['method']) {
        case 'initialize':
          return {}
        case 'account/login/start':
          return {
            type: 'chatgpt',
            loginId: 'login-123',
            authUrl: 'https://chatgpt.com/auth?state=secret-state',
          }
        case 'account/read':
          return authenticated
            ? { account: { type: 'chatgpt', email: 'plus@example.com', planType: 'plus' } }
            : { account: null }
        case 'account/rateLimits/read':
          return {
            rateLimits: {
              primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: 1_800_000_100 },
            },
          }
        default:
          return {}
      }
    })
    const openExternal = vi.fn(async () => {
      authenticated = true
      notify(child, 'account/login/completed', {
        loginId: 'login-123',
        success: true,
        error: null,
      })
    })
    const service = new ChatGptAccountService({
      logger: logger(),
      appVersion: '0.1.0-test',
      openExternal,
      spawnAppServer: () => child as never,
    })

    await expect(service.login()).resolves.toMatchObject({
      authenticated: true,
      email: 'plus@example.com',
      planType: 'plus',
    })
    expect(openExternal).toHaveBeenCalledWith('https://chatgpt.com/auth?state=secret-state')

    await service.dispose()
    server.close()
  })

  it('từ chối auth URL ngoài allowlist trước khi mở trình duyệt', async () => {
    const child = new FakeChild()
    const server = serve(child, (message) => {
      if (message['method'] === 'account/login/start') {
        return {
          type: 'chatgpt',
          loginId: 'login-evil',
          authUrl: 'https://evil.example/steal',
        }
      }
      return {}
    })
    const openExternal = vi.fn()
    const service = new ChatGptAccountService({
      logger: logger(),
      appVersion: '0.1.0-test',
      openExternal,
      spawnAppServer: () => child as never,
    })

    await expect(service.login()).rejects.toSatisfy(
      (error: unknown) => NexaError.is(error) && error.code === ERROR_CODES.CHATGPT_AUTH_FAILED,
    )
    expect(openExternal).not.toHaveBeenCalled()

    await service.dispose()
    server.close()
  })

  it('đăng xuất qua App Server và phản ánh trạng thái mới', async () => {
    const child = new FakeChild()
    let authenticated = true
    const server = serve(child, (message) => {
      switch (message['method']) {
        case 'account/logout':
          authenticated = false
          return {}
        case 'account/read':
          return authenticated
            ? { account: { type: 'chatgpt', email: 'user@example.com', planType: 'plus' } }
            : { account: null }
        case 'account/rateLimits/read':
          return {}
        default:
          return {}
      }
    })
    const service = new ChatGptAccountService({
      logger: logger(),
      appVersion: '0.1.0-test',
      openExternal: vi.fn(),
      spawnAppServer: () => child as never,
    })

    await expect(service.logout()).resolves.toMatchObject({
      appServerAvailable: true,
      authenticated: false,
    })

    await service.dispose()
    server.close()
  })
})
