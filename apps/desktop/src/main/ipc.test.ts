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

type MemoryFact = {
  readonly id: string
  readonly profileId: string
  readonly content: string
  readonly kind: 'identity' | 'preference' | 'goal' | 'constraint' | 'note'
  readonly scope: 'global' | 'conversation'
  readonly sharingPolicy: 'internal_only' | 'allow_external'
  readonly status: 'active' | 'archived'
  readonly sourceConversationId: string | null
  readonly createdAt: string
  readonly updatedAt: string
  readonly lastConfirmedAt: string | null
  readonly expiresAt: string | null
}

type Commitment = {
  readonly id: string
  readonly profileId: string
  readonly title: string
  readonly nextAction: string | null
  readonly status: 'active' | 'blocked' | 'paused' | 'completed'
  readonly dueAt: string | null
  readonly checkInAt: string | null
  readonly completedAt: string | null
  readonly sourceConversationId: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

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
  readonly memoryGet: ReturnType<typeof vi.fn>
  readonly memoryList: ReturnType<typeof vi.fn>
  readonly memoryCreate: ReturnType<typeof vi.fn>
  readonly memoryUpdate: ReturnType<typeof vi.fn>
  readonly memoryArchive: ReturnType<typeof vi.fn>
  readonly memoryRestore: ReturnType<typeof vi.fn>
  readonly memoryDelete: ReturnType<typeof vi.fn>
  readonly commitmentGet: ReturnType<typeof vi.fn>
  readonly commitmentList: ReturnType<typeof vi.fn>
  readonly commitmentCreate: ReturnType<typeof vi.fn>
  readonly commitmentUpdate: ReturnType<typeof vi.fn>
  readonly commitmentDelete: ReturnType<typeof vi.fn>
  readonly purgeProfile: ReturnType<typeof vi.fn>
  readonly purgeAllSecrets: ReturnType<typeof vi.fn>
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
  const memoryGet = vi.fn()
  const memoryList = vi.fn(() => [])
  const memoryCreate = vi.fn((input) => ({ ...makeMemoryFact(), ...input }))
  const memoryUpdate = vi.fn((id: string, patch: Record<string, unknown>) => ({
    ...makeMemoryFact({ id }),
    ...patch,
  }))
  const memoryArchive = vi.fn((id: string) => ({ ...makeMemoryFact({ id }), status: 'archived' }))
  const memoryRestore = vi.fn((id: string) => ({ ...makeMemoryFact({ id }), status: 'active' }))
  const memoryDelete = vi.fn()
  const commitmentGet = vi.fn()
  const commitmentList = vi.fn(() => [])
  const commitmentCreate = vi.fn((input) => ({ ...makeCommitment(), ...input }))
  const commitmentUpdate = vi.fn((id: string, patch: Record<string, unknown>) => ({
    ...makeCommitment({ id }),
    ...patch,
  }))
  const commitmentDelete = vi.fn()
  const purgeProfile = vi.fn()
  const purgeAllSecrets = vi.fn()
  const mcpStop = vi.fn()
  const mcp = { isLifecycleBusy: false, stop: mcpStop }
  const services = {
    logger: new Logger({ sink, minLevel: 'debug' }),
    profileId: 'profile-test',
    conversations: { create: conversationCreate, delete: conversationDelete },
    memory: {
      get: memoryGet,
      list: memoryList,
      create: memoryCreate,
      update: memoryUpdate,
      archive: memoryArchive,
      restore: memoryRestore,
      delete: memoryDelete,
    },
    commitments: {
      get: commitmentGet,
      list: commitmentList,
      create: commitmentCreate,
      update: commitmentUpdate,
      delete: commitmentDelete,
    },
    models: { resolveForConversation: modelResolve },
    connections: { save: connectionSave, delete: connectionDelete, get: vi.fn(() => null) },
    store: { purgeProfile },
    security: { purgeAllSecrets },
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
    memoryGet,
    memoryList,
    memoryCreate,
    memoryUpdate,
    memoryArchive,
    memoryRestore,
    memoryDelete,
    commitmentGet,
    commitmentList,
    commitmentCreate,
    commitmentUpdate,
    commitmentDelete,
    purgeProfile,
    purgeAllSecrets,
    mcpStop,
    mcp,
    sink,
  }
}

function makeMemoryFact(overrides: Partial<MemoryFact> = {}): MemoryFact {
  return {
    id: '00000000-0000-4000-8000-000000000111',
    profileId: 'profile-test',
    content: 'Remember this',
    kind: 'preference',
    scope: 'global',
    sharingPolicy: 'internal_only',
    status: 'active',
    sourceConversationId: null,
    createdAt: '2026-08-26T00:00:00.000Z',
    updatedAt: '2026-08-26T00:00:00.000Z',
    lastConfirmedAt: null,
    expiresAt: null,
    ...overrides,
  }
}

function makeCommitment(overrides: Partial<Commitment> = {}): Commitment {
  return {
    id: '00000000-0000-4000-8000-000000000333',
    profileId: 'profile-test',
    title: 'Ship the pilot',
    nextAction: 'Review the UAT list',
    status: 'active',
    dueAt: null,
    checkInAt: null,
    completedAt: null,
    sourceConversationId: null,
    createdAt: '2026-08-27T00:00:00.000Z',
    updatedAt: '2026-08-27T00:00:00.000Z',
    ...overrides,
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

  it('liệt kê memory theo profile hiện tại', async () => {
    const h = registerHarness()
    const fact = makeMemoryFact()
    h.memoryList.mockReturnValueOnce([fact])

    const result = await h.handlers.get('memory:list')?.({}, { includeArchived: true })

    expect(h.memoryList).toHaveBeenCalledWith('profile-test', { includeArchived: true })
    expect(result).toMatchObject({ data: [fact] })
  })

  it('tạo memory luôn bind vào profile hiện tại', async () => {
    const h = registerHarness()
    const created = makeMemoryFact({
      scope: 'conversation',
      sourceConversationId: '00000000-0000-4000-8000-000000000222',
    })
    h.memoryCreate.mockReturnValueOnce(created)

    const result = await h.handlers.get('memory:create')?.(
      {},
      {
        content: 'Need dark coffee',
        kind: 'preference',
        scope: 'conversation',
        sharingPolicy: 'allow_external',
        sourceConversationId: '00000000-0000-4000-8000-000000000222',
        lastConfirmedAt: '2026-08-26T12:00:00.000Z',
        expiresAt: '2026-08-27T00:00:00.000Z',
      },
    )

    expect(h.memoryCreate).toHaveBeenCalledWith({
      profileId: 'profile-test',
      content: 'Need dark coffee',
      kind: 'preference',
      scope: 'conversation',
      sharingPolicy: 'allow_external',
      sourceConversationId: '00000000-0000-4000-8000-000000000222',
      lastConfirmedAt: '2026-08-26T12:00:00.000Z',
      expiresAt: '2026-08-27T00:00:00.000Z',
    })
    expect(result).toMatchObject({ data: created })
    expect(h.sink.asText()).not.toContain('Need dark coffee')
  })

  it('từ chối update memory không thuộc profile hiện tại', async () => {
    const h = registerHarness()
    h.memoryGet.mockReturnValueOnce(makeMemoryFact({ profileId: 'profile-other' }))

    const result = await h.handlers.get('memory:update')?.(
      {},
      {
        id: '00000000-0000-4000-8000-000000000111',
        content: 'should fail',
      },
    )

    expect(h.memoryUpdate).not.toHaveBeenCalled()
    expect(result).toMatchObject({ error: { code: ERROR_CODES.VALIDATION_FAILED } })
    expect(h.sink.asText()).not.toContain('should fail')
  })

  it('update memory sau khi xác thực ownership hiện tại', async () => {
    const h = registerHarness()
    const fact = makeMemoryFact()
    const updated = makeMemoryFact({
      content: 'Updated memory',
      expiresAt: '2026-08-28T00:00:00.000Z',
    })
    h.memoryGet.mockReturnValueOnce(fact)
    h.memoryUpdate.mockReturnValueOnce(updated)

    const result = await h.handlers.get('memory:update')?.(
      {},
      {
        id: fact.id,
        content: 'Updated memory',
        lastConfirmedAt: '2026-08-27T09:00:00.000Z',
        expiresAt: '2026-08-28T00:00:00.000Z',
      },
    )

    expect(h.memoryGet).toHaveBeenCalledWith(fact.id)
    expect(h.memoryUpdate).toHaveBeenCalledWith(fact.id, {
      content: 'Updated memory',
      kind: undefined,
      scope: undefined,
      sharingPolicy: undefined,
      sourceConversationId: undefined,
      lastConfirmedAt: '2026-08-27T09:00:00.000Z',
      expiresAt: '2026-08-28T00:00:00.000Z',
    })
    expect(result).toMatchObject({ data: updated })
  })

  it('archive, restore và delete memory chỉ chạy sau khi xác thực ownership hiện tại', async () => {
    const h = registerHarness()
    const fact = makeMemoryFact()
    h.memoryGet.mockReturnValueOnce(fact).mockReturnValueOnce(fact).mockReturnValueOnce(fact)

    const archiveResult = await h.handlers.get('memory:archive')?.({}, { id: fact.id })
    const restoreResult = await h.handlers.get('memory:restore')?.({}, { id: fact.id })
    const deleteResult = await h.handlers.get('memory:delete')?.({}, { id: fact.id })

    expect(h.memoryArchive).toHaveBeenCalledWith(fact.id)
    expect(h.memoryRestore).toHaveBeenCalledWith(fact.id)
    expect(h.memoryDelete).toHaveBeenCalledWith(fact.id)
    expect(archiveResult).toMatchObject({ data: { ok: true } })
    expect(restoreResult).toMatchObject({ data: { ok: true } })
    expect(deleteResult).toMatchObject({ data: { ok: true } })
  })

  it('liệt kê và tạo commitment bằng profile hiện tại', async () => {
    const h = registerHarness()
    const commitment = makeCommitment()
    h.commitmentList.mockReturnValueOnce([commitment])
    h.commitmentCreate.mockReturnValueOnce(commitment)

    const listResult = await h.handlers
      .get('commitment:list')
      ?.({}, { includeCompleted: true })
    const createResult = await h.handlers.get('commitment:create')?.(
      {},
      {
        title: 'Ship the pilot',
        nextAction: 'Review the UAT list',
        status: 'active',
        dueAt: null,
        checkInAt: null,
        sourceConversationId: null,
      },
    )

    expect(h.commitmentList).toHaveBeenCalledWith('profile-test', { includeCompleted: true })
    expect(h.commitmentCreate).toHaveBeenCalledWith({
      profileId: 'profile-test',
      title: 'Ship the pilot',
      nextAction: 'Review the UAT list',
      status: 'active',
      dueAt: null,
      checkInAt: null,
      sourceConversationId: null,
    })
    expect(listResult).toMatchObject({ data: [commitment] })
    expect(createResult).toMatchObject({ data: commitment })
    expect(h.sink.asText()).not.toContain('Ship the pilot')
  })

  it('chỉ update và delete commitment sau ownership gate', async () => {
    const h = registerHarness()
    const own = makeCommitment()
    h.commitmentGet
      .mockReturnValueOnce(makeCommitment({ profileId: 'profile-other' }))
      .mockReturnValueOnce(own)
      .mockReturnValueOnce(own)

    const rejected = await h.handlers.get('commitment:update')?.(
      {},
      { id: own.id, status: 'completed' },
    )
    const updated = await h.handlers.get('commitment:update')?.(
      {},
      { id: own.id, status: 'completed' },
    )
    const deleted = await h.handlers.get('commitment:delete')?.({}, { id: own.id })

    expect(rejected).toMatchObject({ error: { code: ERROR_CODES.VALIDATION_FAILED } })
    expect(h.commitmentUpdate).toHaveBeenCalledTimes(1)
    expect(h.commitmentUpdate).toHaveBeenCalledWith(own.id, {
      title: undefined,
      nextAction: undefined,
      status: 'completed',
      dueAt: undefined,
      checkInAt: undefined,
      sourceConversationId: undefined,
    })
    expect(updated).toMatchObject({ data: { status: 'completed' } })
    expect(h.commitmentDelete).toHaveBeenCalledWith(own.id)
    expect(deleted).toMatchObject({ data: { ok: true } })
  })

  it('purge dữ liệu chỉ xoá profile hiện tại và dựa vào cascade trong store', async () => {
    const h = registerHarness()

    const result = await h.handlers.get('data:purge')?.(
      {},
      { confirmPhrase: 'XOA TOAN BO DU LIEU', alsoDeleteCredentials: true },
    )

    expect(h.purgeProfile).toHaveBeenCalledWith('profile-test')
    expect(h.purgeAllSecrets).toHaveBeenCalledOnce()
    expect(result).toMatchObject({ data: { purged: true } })
  })
})
