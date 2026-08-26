import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ERROR_CODES,
  IPC_SCHEMAS,
  NexaError,
  type Envelope,
  type IpcChannel,
} from '@nexa/shared-types'
import { Logger, MemorySink } from '@nexa/observability'
import type { ChatController } from './chat-controller.js'
import type { NexaServices } from './services.js'

type RegisteredHandler = (_event: unknown, rawInput: unknown) => Promise<Envelope<unknown>>

const electronMock = vi.hoisted(() => ({
  handle: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: { handle: electronMock.handle },
  app: { getVersion: () => '0.1.0-test' },
}))

const { registerIpc } = await import('./ipc.js')

function registerHarness(getWindow: () => unknown = () => null): {
  readonly handlers: Map<string, RegisteredHandler>
  readonly chatSend: ReturnType<typeof vi.fn>
  readonly chatCancel: ReturnType<typeof vi.fn>
  readonly conversationDelete: ReturnType<typeof vi.fn>
  readonly conversationCreate: ReturnType<typeof vi.fn>
  readonly isConversationActive: ReturnType<typeof vi.fn>
  readonly modelResolve: ReturnType<typeof vi.fn>
  readonly connectionSave: ReturnType<typeof vi.fn>
  readonly connectionDelete: ReturnType<typeof vi.fn>
  readonly mcpStop: ReturnType<typeof vi.fn>
  readonly mcp: { isLifecycleBusy: boolean; stop: ReturnType<typeof vi.fn> }
  readonly sink: MemorySink
} {
  const sink = new MemorySink()
  const chatSend = vi.fn()
  const chatCancel = vi.fn()
  const conversationDelete = vi.fn()
  const conversationCreate = vi.fn((...args: unknown[]) => args)
  const isConversationActive = vi.fn(() => false)
  const modelResolve = vi.fn((modelId: string, provider: string) => ({ modelId, provider }))
  const connectionSave = vi.fn((input) => input)
  const connectionDelete = vi.fn()
  const mcpStop = vi.fn()
  const mcp = { isLifecycleBusy: false, stop: mcpStop }
  const services = {
    logger: new Logger({ sink, minLevel: 'debug' }),
    profileId: 'profile-test',
    conversations: { create: conversationCreate, delete: conversationDelete },
    models: { resolveForConversation: modelResolve },
    connections: { save: connectionSave, delete: connectionDelete, get: vi.fn(() => null) },
    mcp,
  } as unknown as NexaServices
  const chat = {
    send: chatSend,
    cancel: chatCancel,
    isConversationActive,
  } as unknown as ChatController

  registerIpc({ services, chat, getWindow: getWindow as never, onMcpStatus: vi.fn() })

  return {
    handlers: new Map(electronMock.handle.mock.calls as Array<[IpcChannel, RegisteredHandler]>),
    chatSend,
    chatCancel,
    conversationDelete,
    conversationCreate,
    isConversationActive,
    modelResolve,
    connectionSave,
    connectionDelete,
    mcpStop,
    mcp,
    sink,
  }
}

beforeEach(() => {
  electronMock.handle.mockReset()
})

describe('registerIpc', () => {
  it('đăng ký đúng một handler cho mọi channel đã khai báo', () => {
    const h = registerHarness()
    expect(h.handlers.size).toBe(Object.keys(IPC_SCHEMAS).length)
    expect([...h.handlers.keys()].sort()).toEqual(Object.keys(IPC_SCHEMAS).sort())
  })

  it('từ chối payload sai mà chỉ log tên trường, không log giá trị', async () => {
    const h = registerHarness()
    const rawInput = {
      conversationId: 'not-a-uuid',
      content: 'nội dung tuyệt mật',
      fileTokens: [],
    }

    const result = await h.handlers.get('chat:send')?.({}, rawInput)

    expect(result).toMatchObject({ error: { code: ERROR_CODES.VALIDATION_FAILED } })
    expect(h.chatSend).not.toHaveBeenCalled()
    expect(h.sink.records).toContainEqual(
      expect.objectContaining({
        event: 'ipc-validation-failed',
        fields: expect.objectContaining({
          channel: 'chat:send',
          invalidFields: ['conversationId'],
        }),
      }),
    )
    expect(h.sink.asText()).not.toContain('nội dung tuyệt mật')
    expect(h.sink.asText()).not.toContain('not-a-uuid')
  })

  it('bọc lỗi handler thành envelope an toàn và không log message upstream', async () => {
    const h = registerHarness()
    h.chatSend.mockRejectedValueOnce(new Error('Bearer secret-token-that-must-not-leak'))

    const result = await h.handlers.get('chat:send')?.(
      {},
      {
        conversationId: '00000000-0000-4000-8000-000000000001',
        content: 'Xin chào',
        fileTokens: [],
      },
    )

    expect(result).toMatchObject({ error: { code: ERROR_CODES.INTERNAL_ERROR } })
    expect(h.sink.asText()).not.toContain('secret-token-that-must-not-leak')
    expect(h.sink.records).toContainEqual(
      expect.objectContaining({
        event: 'ipc-handler-failed',
        fields: expect.objectContaining({ channel: 'chat:send', errorCode: 'INTERNAL_ERROR' }),
      }),
    )
  })

  it('file picker thất bại an toàn khi cửa sổ đã đóng', async () => {
    const h = registerHarness(() => null)

    const result = await h.handlers.get('file:pick')?.({}, {})

    expect(result).toMatchObject({ error: { code: ERROR_CODES.INTERNAL_ERROR } })
  })

  it('trả success envelope và chuyển đúng request id cho chat cancel', async () => {
    const h = registerHarness()

    const result = await h.handlers.get('chat:cancel')?.({}, { requestId: 'request-123' })

    expect(h.chatCancel).toHaveBeenCalledWith('request-123')
    expect(result).toMatchObject({ data: { ok: true }, meta: { source: 'local' } })
    expect(result?.request_id).toEqual(expect.any(String))
  })

  it('không xoá hội thoại khi lượt chat của nó còn hoạt động', async () => {
    const h = registerHarness()
    const conversationId = '00000000-0000-4000-8000-000000000001'
    h.isConversationActive.mockReturnValueOnce(true)

    const result = await h.handlers.get('conversation:delete')?.({}, { id: conversationId })

    expect(h.isConversationActive).toHaveBeenCalledWith(conversationId)
    expect(h.conversationDelete).not.toHaveBeenCalled()
    expect(result).toMatchObject({ error: { code: ERROR_CODES.OPERATION_ALREADY_RUNNING } })
  })

  it('không ghi thay đổi kết nối Atlassian khi một MCP tool còn chạy', async () => {
    const h = registerHarness()
    h.mcp.isLifecycleBusy = true

    const result = await h.handlers.get('connection:save')?.(
      {},
      {
        type: 'jira',
        baseUrl: 'https://jira.internal',
        username: 'tester',
        secret: 'PAT-never-persisted',
        enabled: true,
      },
    )

    expect(h.connectionSave).not.toHaveBeenCalled()
    expect(h.mcpStop).not.toHaveBeenCalled()
    expect(result).toMatchObject({ error: { code: ERROR_CODES.OPERATION_ALREADY_RUNNING } })
  })

  it('không rebuild MCP khi chỉ lưu kết nối OpenAI', async () => {
    const h = registerHarness()
    const input = {
      type: 'openai',
      baseUrl: 'https://api.openai.com',
      username: null,
      secret: 'sk-test',
      enabled: true,
    }

    const result = await h.handlers.get('connection:save')?.({}, input)

    expect(h.connectionSave).toHaveBeenCalledWith(input)
    expect(h.mcpStop).not.toHaveBeenCalled()
    expect(result).toMatchObject({ data: input })
  })

  it('không restart MCP thủ công khi lifecycle đang bận', async () => {
    const h = registerHarness()
    h.mcp.isLifecycleBusy = true

    const result = await h.handlers.get('mcp:restart')?.({}, {})

    expect(h.mcpStop).not.toHaveBeenCalled()
    expect(result).toMatchObject({ error: { code: ERROR_CODES.OPERATION_ALREADY_RUNNING } })
  })

  it('không cho thao tác cấu hình thứ hai chạy chen vào lúc MCP đang rebuild', async () => {
    const h = registerHarness()
    let finishStop: (() => void) | undefined
    h.mcpStop.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishStop = resolve
        }),
    )

    const restart = h.handlers.get('mcp:restart')?.({}, {})
    await vi.waitFor(() => expect(h.mcpStop).toHaveBeenCalledOnce())

    const concurrentSave = await h.handlers.get('connection:save')?.(
      {},
      {
        type: 'jira',
        baseUrl: 'https://jira.internal',
        username: 'tester',
        secret: 'PAT-never-persisted',
        enabled: true,
      },
    )

    expect(h.connectionSave).not.toHaveBeenCalled()
    expect(concurrentSave).toMatchObject({
      error: { code: ERROR_CODES.OPERATION_ALREADY_RUNNING },
    })

    finishStop?.()
    await expect(restart).resolves.toMatchObject({ data: { state: 'stopped' } })
  })

  it('xác thực policy/model trước khi tạo hội thoại gắn provider', async () => {
    const h = registerHarness()
    h.modelResolve.mockImplementationOnce(() => {
      throw new NexaError(ERROR_CODES.PROVIDER_DISABLED_BY_POLICY)
    })

    const result = await h.handlers.get('conversation:create')?.(
      {},
      { title: 'Blocked', modelId: 'gpt-blocked', modelProvider: 'openai' },
    )

    expect(h.modelResolve).toHaveBeenCalledWith('gpt-blocked', 'openai')
    expect(h.conversationCreate).not.toHaveBeenCalled()
    expect(result).toMatchObject({ error: { code: ERROR_CODES.PROVIDER_DISABLED_BY_POLICY } })
  })
})
