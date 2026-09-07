import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_APP_SETTINGS,
  ERROR_CODES,
  NEXA_EVENTS,
  NexaError,
  type ChatSendInput,
  type ConfirmationRequest,
} from '@nexa/shared-types'
import { Logger, MemorySink } from '@nexa/observability'
import type { NexaServices } from './services.js'

interface RuntimeDependencies {
  requestConfirmation(
    request: ConfirmationRequest,
    requestId: string,
  ): Promise<'approved' | 'cancelled'>
  readonly localTools: unknown
}

interface RuntimeInput {
  readonly signal: AbortSignal
  readonly emit: (event: unknown) => void
  readonly toolCalls: {
    begin(info: unknown): string
    update(recordId: string, patch: unknown): void
  }
  readonly memoryFacts?: readonly {
    readonly content: string
    readonly kind: string
    readonly sharingPolicy: string
  }[]
}

const runtimeMock = vi.hoisted(() => ({
  deps: null as RuntimeDependencies | null,
  runTurn: vi.fn(),
}))

vi.mock('@nexa/agent-runtime', () => ({
  MAX_COMMITMENTS_IN_CONTEXT: 10,
  AgentRuntime: class {
    constructor(deps: RuntimeDependencies) {
      runtimeMock.deps = deps
    }

    runTurn(input: RuntimeInput): unknown {
      return runtimeMock.runTurn(input)
    }
  },
}))

const { ChatController } = await import('./chat-controller.js')

const CONVERSATION_ID = '00000000-0000-4000-8000-000000000001'
const OPERATION_ID = '00000000-0000-4000-8000-000000000002'

interface Harness {
  readonly controller: InstanceType<typeof ChatController>
  readonly services: NexaServices
  readonly mocks: {
    readonly auditRecord: ReturnType<typeof vi.fn>
    readonly activityRecord: ReturnType<typeof vi.fn>
    readonly appendMessage: ReturnType<typeof vi.fn>
    readonly finalizeMessage: ReturnType<typeof vi.fn>
    readonly addAttachment: ReturnType<typeof vi.fn>
    readonly setModel: ReturnType<typeof vi.fn>
    readonly processDocuments: ReturnType<typeof vi.fn>
    readonly releaseAll: ReturnType<typeof vi.fn>
    readonly guardApprove: ReturnType<typeof vi.fn>
    readonly guardCancel: ReturnType<typeof vi.fn>
    readonly listMemoryForContext: ReturnType<typeof vi.fn>
    readonly listCommitmentsForContext: ReturnType<typeof vi.fn>
    readonly listMessages: ReturnType<typeof vi.fn>
    readonly chatGptResolveModel: ReturnType<typeof vi.fn>
    readonly chatGptRunTurn: ReturnType<typeof vi.fn>
    readonly sendToRenderer: ReturnType<typeof vi.fn>
  }
}

function makeHarness(): Harness {
  const auditRecord = vi.fn()
  const activityRecord = vi.fn()
  const appendMessage = vi.fn((input: { role: string }) => ({
    id: input.role === 'user' ? 'message-user' : 'message-assistant',
  }))
  const finalizeMessage = vi.fn()
  const addAttachment = vi.fn()
  const setModel = vi.fn()
  const processDocuments = vi.fn().mockResolvedValue([])
  const releaseAll = vi.fn()
  const guardApprove = vi.fn()
  const guardCancel = vi.fn()
  const listMemoryForContext = vi.fn(() => [])
  const listCommitmentsForContext = vi.fn(() => [])
  const listMessages = vi.fn(() => [])
  const chatGptResolveModel = vi.fn(() => ({
    modelId: 'gpt-5.6-sol',
    defaultReasoningEffort: 'low',
  }))
  const chatGptRunTurn = vi.fn()
  const sendToRenderer = vi.fn()
  const sink = new MemorySink()

  const services = {
    logger: new Logger({ sink, minLevel: 'debug' }),
    profileId: 'profile-1',
    policy: { allowDirectOpenAi: true },
    chatgpt: {
      resolveModel: chatGptResolveModel,
      runTurn: chatGptRunTurn,
    },
    conversations: {
      get: vi.fn(() => ({
        id: CONVERSATION_ID,
        modelId: 'model-a',
        modelProvider: 'litellm',
      })),
      setModel,
      appendMessage,
      addAttachment,
      loadForContext: vi.fn(() => [
        { role: 'user', content: 'Xin chào' },
        { role: 'assistant', content: '' },
      ]),
      listMessages,
      finalizeMessage,
      recordToolCall: vi.fn(() => ({ id: 'tool-call-1' })),
      updateToolCall: vi.fn(),
    },
    models: {
      resolveForConversation: vi.fn(() => ({
        modelId: 'model-a',
        provider: 'litellm',
        contextWindowTokens: 128_000,
      })),
    },
    settings: { get: vi.fn(() => DEFAULT_APP_SETTINGS) },
    memory: { listForContext: listMemoryForContext },
    commitments: { listForContext: listCommitmentsForContext },
    documents: { process: processDocuments },
    files: {
      resolve: vi.fn(() => [{ path: '/tmp/document.txt' }]),
      releaseAll,
    },
    audit: { record: auditRecord },
    activity: { record: activityRecord },
    connections: {
      buildLlmClient: vi.fn(() => ({})),
      get: vi.fn(() => null),
    },
    guard: { approve: guardApprove, cancel: guardCancel },
    tracker: {},
    mcp: null,
  } as unknown as NexaServices

  const window = {
    isDestroyed: () => false,
    webContents: { send: sendToRenderer },
  }
  const controller = new ChatController(services, () => window as never)

  return {
    controller,
    services,
    mocks: {
      auditRecord,
      activityRecord,
      appendMessage,
      finalizeMessage,
      addAttachment,
      setModel,
      processDocuments,
      releaseAll,
      guardApprove,
      guardCancel,
      listMemoryForContext,
      listCommitmentsForContext,
      listMessages,
      chatGptResolveModel,
      chatGptRunTurn,
      sendToRenderer,
    },
  }
}

function input(fileTokens: string[] = []): ChatSendInput {
  return { conversationId: CONVERSATION_ID, content: 'Xin chào', fileTokens }
}

beforeEach(() => {
  runtimeMock.deps = null
  runtimeMock.runTurn.mockReset()
})

describe('ChatController', () => {
  it('từ chối hội thoại không tồn tại trước khi ghi message', async () => {
    const h = makeHarness()
    vi.mocked(h.services.conversations.get).mockReturnValue(null)

    await expect(h.controller.send(input())).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_FAILED,
    })
    expect(h.mocks.appendMessage).not.toHaveBeenCalled()
    expect(runtimeMock.runTurn).not.toHaveBeenCalled()
  })

  it('luôn giải phóng file token khi trích xuất thất bại', async () => {
    const h = makeHarness()
    const tokens = ['00000000-0000-4000-8000-000000000003']
    h.mocks.processDocuments.mockRejectedValueOnce(new Error('extract failed'))

    await expect(h.controller.send(input(tokens))).rejects.toThrow('extract failed')
    expect(h.mocks.releaseAll).toHaveBeenCalledWith(tokens)
    expect(h.mocks.appendMessage).not.toHaveBeenCalled()
  })

  it('lưu kết quả, audit và phát sự kiện theo đúng conversation', async () => {
    const h = makeHarness()
    runtimeMock.runTurn.mockImplementationOnce(async (rawInput: RuntimeInput) => {
      rawInput.emit({ type: 'text-delta', delta: 'Xin ' })
      rawInput.emit({ type: 'text-delta', delta: 'chào' })
      rawInput.emit({
        type: 'tool-status',
        toolCallRecordId: 'tool-call-1',
        toolName: 'jira_search',
        phase: 'done',
      })
      return { text: '', truncatedContextCount: 1 }
    })

    const result = await h.controller.send(input())

    await vi.waitFor(() => {
      expect(h.mocks.finalizeMessage).toHaveBeenCalledWith(
        'message-assistant',
        'Xin chào',
        'complete',
        { truncatedContextCount: 1 },
      )
    })
    expect(result.messageId).toBe('message-assistant')
    expect(h.mocks.sendToRenderer).toHaveBeenCalledWith(
      NEXA_EVENTS.chatDelta,
      expect.objectContaining({
        requestId: result.requestId,
        conversationId: CONVERSATION_ID,
        messageId: 'message-assistant',
      }),
    )
    expect(h.mocks.sendToRenderer).toHaveBeenCalledWith(
      NEXA_EVENTS.chatDone,
      expect.objectContaining({ requestId: result.requestId, conversationId: CONVERSATION_ID }),
    )
  })

  it('định tuyến model Plus qua App Server và stream vào hội thoại hiện tại', async () => {
    const h = makeHarness()
    h.mocks.listMessages.mockReturnValueOnce([
      {
        role: 'user',
        content: 'Câu trước',
        status: 'complete',
        deletedAt: undefined,
      },
      {
        role: 'assistant',
        content: 'Trả lời trước',
        status: 'complete',
        deletedAt: undefined,
      },
      { role: 'assistant', content: 'Bỏ qua lỗi cũ', status: 'error', deletedAt: undefined },
    ])
    h.mocks.chatGptRunTurn.mockImplementationOnce(
      async (turn: { onDelta(delta: string): void }) => {
        turn.onDelta('Phản hồi từ Plus')
      },
    )

    const result = await h.controller.send({
      ...input(),
      modelId: 'gpt-5.6-sol',
      modelProvider: 'chatgpt',
      reasoningEffort: 'max',
    })

    await vi.waitFor(() => {
      expect(h.mocks.finalizeMessage).toHaveBeenCalledWith(
        'message-assistant',
        'Phản hồi từ Plus',
        'complete',
      )
    })
    expect(h.mocks.chatGptResolveModel).toHaveBeenCalledWith('gpt-5.6-sol')
    expect(h.mocks.setModel).toHaveBeenCalledWith(CONVERSATION_ID, {
      modelId: 'gpt-5.6-sol',
      provider: 'chatgpt',
    })
    expect(h.mocks.chatGptRunTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: 'gpt-5.6-sol',
        reasoningEffort: 'max',
        prompt: 'Xin chào',
        history: [
          { role: 'user', content: 'Câu trước' },
          { role: 'assistant', content: 'Trả lời trước' },
        ],
      }),
    )
    expect(h.services.connections.buildLlmClient).not.toHaveBeenCalled()
    expect(runtimeMock.runTurn).not.toHaveBeenCalled()
    expect(h.mocks.sendToRenderer).toHaveBeenCalledWith(
      NEXA_EVENTS.chatDone,
      expect.objectContaining({ requestId: result.requestId, truncatedContextCount: 0 }),
    )
  })

  it('chặn file trước khi ghi message khi model Plus đang được chọn', async () => {
    const h = makeHarness()
    const tokens = ['00000000-0000-4000-8000-000000000003']

    await expect(
      h.controller.send({
        ...input(tokens),
        modelId: 'gpt-5.6-sol',
        modelProvider: 'chatgpt',
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.EXTERNAL_MODEL_NOT_ALLOWED_FOR_DOCUMENTS })

    expect(h.mocks.releaseAll).toHaveBeenCalledWith(tokens)
    expect(h.mocks.appendMessage).not.toHaveBeenCalled()
    expect(h.mocks.chatGptRunTurn).not.toHaveBeenCalled()
  })

  it('chọn memory theo profile, conversation và provider trước khi gọi runtime', async () => {
    const h = makeHarness()
    h.mocks.listMemoryForContext.mockReturnValueOnce([
      {
        content: 'Người dùng thích câu trả lời ngắn.',
        kind: 'preference',
        sharingPolicy: 'internal_only',
      },
    ])
    runtimeMock.runTurn.mockResolvedValueOnce({ text: 'Đã hiểu', truncatedContextCount: 0 })

    await h.controller.send(input())

    await vi.waitFor(() => expect(runtimeMock.runTurn).toHaveBeenCalledOnce())
    expect(h.mocks.listMemoryForContext).toHaveBeenCalledWith('profile-1', {
      conversationId: CONVERSATION_ID,
      externalProvider: false,
    })
    expect(runtimeMock.runTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        memoryFacts: [
          {
            content: 'Người dùng thích câu trả lời ngắn.',
            kind: 'preference',
            sharingPolicy: 'internal_only',
          },
        ],
      }),
    )
  })

  it('nạp cam kết đang treo vào context cho model nội bộ', async () => {
    const h = makeHarness()
    h.mocks.listCommitmentsForContext.mockReturnValueOnce([
      {
        id: 'c1',
        profileId: 'profile-1',
        title: 'Gửi báo cáo quý',
        nextAction: 'Xin số liệu',
        status: 'blocked',
        dueAt: '2026-09-11T10:00:00.000Z',
        checkInAt: null,
        completedAt: null,
        sourceConversationId: null,
        createdBy: 'user',
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
      },
    ])
    runtimeMock.runTurn.mockResolvedValueOnce({ text: 'Đã hiểu', truncatedContextCount: 0 })

    await h.controller.send(input())

    await vi.waitFor(() => expect(runtimeMock.runTurn).toHaveBeenCalledOnce())
    expect(runtimeMock.runTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        commitments: [
          {
            title: 'Gửi báo cáo quý',
            nextAction: 'Xin số liệu',
            status: 'blocked',
            dueAt: '2026-09-11T10:00:00.000Z',
            checkInAt: null,
          },
        ],
      }),
    )
  })

  it('không gửi cam kết khi người dùng đã tắt nạp context', async () => {
    const h = makeHarness()
    vi.mocked(h.services.settings.get).mockReturnValue({
      ...DEFAULT_APP_SETTINGS,
      commitmentContextEnabled: false,
    })
    runtimeMock.runTurn.mockResolvedValueOnce({ text: 'Đã hiểu', truncatedContextCount: 0 })

    await h.controller.send(input())

    await vi.waitFor(() => expect(runtimeMock.runTurn).toHaveBeenCalledOnce())
    expect(h.mocks.listCommitmentsForContext).not.toHaveBeenCalled()
    expect(runtimeMock.runTurn.mock.calls[0]?.[0]).not.toHaveProperty('commitments')
  })

  it('không công bố tool cam kết khi setting chưa bật', async () => {
    const h = makeHarness()
    runtimeMock.runTurn.mockResolvedValueOnce({ text: 'Đã hiểu', truncatedContextCount: 0 })

    await h.controller.send(input())

    await vi.waitFor(() => expect(runtimeMock.runTurn).toHaveBeenCalledOnce())
    expect(runtimeMock.deps?.localTools).toBeNull()
  })

  it('abort đúng lượt chat và giữ phần text đã stream', async () => {
    const h = makeHarness()
    runtimeMock.runTurn.mockImplementationOnce(
      (rawInput: RuntimeInput) =>
        new Promise((_resolve, reject) => {
          rawInput.emit({ type: 'text-delta', delta: 'Một phần' })
          rawInput.signal.addEventListener('abort', () => reject(rawInput.signal.reason), {
            once: true,
          })
        }),
    )

    const { requestId } = await h.controller.send(input())
    h.controller.cancel(requestId)

    await vi.waitFor(() => {
      expect(h.mocks.finalizeMessage).toHaveBeenCalledWith(
        'message-assistant',
        'Một phần',
        'cancelled',
        { errorCode: ERROR_CODES.LLM_CANCELLED },
      )
    })
    expect(h.mocks.auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({ requestId, status: 'cancelled' }),
    )
    expect(h.mocks.sendToRenderer).toHaveBeenCalledWith(
      NEXA_EVENTS.chatError,
      expect.objectContaining({ request_id: requestId, conversationId: CONVERSATION_ID }),
    )
  })

  it('không lưu message rỗng khi runtime lỗi trước delta đầu tiên và gửi kèm hướng xử lý', async () => {
    const h = makeHarness()
    runtimeMock.runTurn.mockRejectedValueOnce(new NexaError(ERROR_CODES.ATLASSIAN_AUTH_FAILED))

    const result = await h.controller.send(input())

    await vi.waitFor(() => {
      expect(h.mocks.finalizeMessage).toHaveBeenCalledWith(
        'message-assistant',
        expect.stringContaining('Kiểm tra lại PAT'),
        'error',
        { errorCode: ERROR_CODES.ATLASSIAN_AUTH_FAILED },
      )
    })
    expect(h.mocks.sendToRenderer).toHaveBeenCalledWith(
      NEXA_EVENTS.chatError,
      expect.objectContaining({
        request_id: result.requestId,
        error: expect.objectContaining({
          code: ERROR_CODES.ATLASSIAN_AUTH_FAILED,
          hint: expect.stringContaining('Kiểm tra lại PAT'),
        }),
      }),
    )
  })

  it('đánh dấu hội thoại active cho tới khi lượt chat kết thúc', async () => {
    const h = makeHarness()
    let finishTurn: ((value: { text: string; truncatedContextCount: number }) => void) | undefined
    runtimeMock.runTurn.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishTurn = resolve
        }),
    )

    await h.controller.send(input())
    expect(h.controller.isConversationActive(CONVERSATION_ID)).toBe(true)
    await expect(h.controller.send(input())).rejects.toMatchObject({
      code: ERROR_CODES.OPERATION_ALREADY_RUNNING,
    })

    finishTurn?.({ text: 'Xong', truncatedContextCount: 0 })
    await vi.waitFor(() => expect(h.controller.isConversationActive(CONVERSATION_ID)).toBe(false))
  })

  it('shutdown huỷ cả lượt chat và approval đang chờ trong guard', async () => {
    const h = makeHarness()
    const request = {
      operationId: OPERATION_ID,
      payloadHash: 'a'.repeat(64),
      conversationId: CONVERSATION_ID,
      preview: { toolName: 'jira_create_issue' },
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    } as ConfirmationRequest
    runtimeMock.runTurn.mockImplementationOnce(async () => {
      const decision = await runtimeMock.deps?.requestConfirmation(request, 'request-1')
      if (decision !== 'cancelled') throw new NexaError(ERROR_CODES.INTERNAL_ERROR)
      return { text: 'Đã huỷ', truncatedContextCount: 0 }
    })

    await h.controller.send(input())
    await vi.waitFor(() => {
      expect(h.mocks.sendToRenderer).toHaveBeenCalledWith(NEXA_EVENTS.toolConfirmation, request)
    })

    h.controller.shutdown()

    await vi.waitFor(() => {
      expect(h.mocks.finalizeMessage).toHaveBeenCalledWith(
        'message-assistant',
        'Đã huỷ',
        'complete',
        { truncatedContextCount: 0 },
      )
    })
    expect(h.mocks.guardCancel).toHaveBeenCalledWith(OPERATION_ID)
  })

  it('ghi activity cho tool preview, confirmation và tool result mà không lưu preview nhạy cảm', async () => {
    const h = makeHarness()
    const sensitiveText = 'SECRET-DO-NOT-STORE'
    runtimeMock.runTurn.mockImplementationOnce(async (rawInput: RuntimeInput) => {
      const recordId = rawInput.toolCalls.begin({
        toolName: 'jira_create_issue',
        riskLevel: 'WRITE_HIGH',
        approvalStatus: 'pending',
        operationStatus: 'pending',
        operationId: OPERATION_ID,
        payloadHash: 'b'.repeat(64),
        preview: {
          toolName: 'jira_create_issue',
          targetSystem: 'jira',
          targetSystemUrl: 'https://jira.example.com',
          action: 'Tạo issue',
          actingAccount: 'alice',
          payloadFields: [{ label: 'Summary', value: sensitiveText, fullValue: sensitiveText }],
          changes: [],
          impactWarning: sensitiveText,
          reversible: false,
          riskLevel: 'WRITE_HIGH',
        },
      })
      const request = {
        operationId: OPERATION_ID,
        payloadHash: 'b'.repeat(64),
        conversationId: CONVERSATION_ID,
        preview: { toolName: 'jira_create_issue' },
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      } as ConfirmationRequest
      const decision = await runtimeMock.deps?.requestConfirmation(request, 'request-1')
      expect(decision).toBe('approved')
      rawInput.toolCalls.update(recordId, {
        operationStatus: 'success',
        resultSummary: sensitiveText,
      })
      return { text: 'Đã làm', truncatedContextCount: 0 }
    })

    const result = await h.controller.send(input())
    await vi.waitFor(() => {
      expect(h.mocks.sendToRenderer).toHaveBeenCalledWith(
        NEXA_EVENTS.toolConfirmation,
        expect.objectContaining({ operationId: OPERATION_ID }),
      )
    })
    const confirmationPayload = h.mocks.sendToRenderer.mock.calls.find(
      ([channel]) => channel === NEXA_EVENTS.toolConfirmation,
    )?.[1] as ConfirmationRequest
    h.controller.approve(OPERATION_ID, confirmationPayload.payloadHash)

    await vi.waitFor(() => {
      expect(h.mocks.activityRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'tool_result',
          action: 'completed',
          status: 'success',
          subjectId: 'jira_create_issue',
          requestId: result.requestId,
          operationId: OPERATION_ID,
        }),
      )
    })

    expect(h.mocks.activityRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tool_preview',
        action: 'created',
        status: 'pending',
        subjectId: 'jira_create_issue',
        requestId: result.requestId,
        operationId: OPERATION_ID,
      }),
    )
    expect(h.mocks.activityRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'confirmation',
        action: 'requested',
        status: 'pending',
        subjectId: 'jira_create_issue',
        requestId: result.requestId,
        operationId: OPERATION_ID,
      }),
    )
    expect(h.mocks.activityRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'confirmation',
        action: 'approved',
        status: 'success',
        subjectId: 'jira_create_issue',
        requestId: result.requestId,
        operationId: OPERATION_ID,
      }),
    )

    for (const [payload] of h.mocks.activityRecord.mock.calls) {
      expect(payload).not.toHaveProperty('preview')
      expect(payload).not.toHaveProperty('resultSummary')
      expect(JSON.stringify(payload)).not.toContain(sensitiveText)
    }
  })

  it('bỏ qua tool_result failed nếu tool chưa chạy vì confirmation bị huỷ hoặc hết hạn', async () => {
    const h = makeHarness()
    runtimeMock.runTurn.mockImplementationOnce(async (rawInput: RuntimeInput) => {
      const recordId = rawInput.toolCalls.begin({
        toolName: 'jira_create_issue',
        riskLevel: 'WRITE_HIGH',
        approvalStatus: 'pending',
        operationStatus: 'pending',
        operationId: OPERATION_ID,
        payloadHash: 'c'.repeat(64),
        preview: { toolName: 'jira_create_issue' } as never,
      })
      rawInput.toolCalls.update(recordId, {
        approvalStatus: 'cancelled',
        operationStatus: 'failed',
      })
      rawInput.toolCalls.update(recordId, {
        approvalStatus: 'expired',
        operationStatus: 'failed',
      })
      return { text: 'Bỏ qua', truncatedContextCount: 0 }
    })

    await h.controller.send(input())
    await vi.waitFor(() => expect(h.mocks.finalizeMessage).toHaveBeenCalled())

    expect(
      h.mocks.activityRecord.mock.calls.some(
        ([payload]) => payload.type === 'tool_result' && payload.status === 'failed',
      ),
    ).toBe(false)
  })

  it('ghi uncertain operation với requestId và operationId', async () => {
    const h = makeHarness()
    runtimeMock.runTurn.mockImplementationOnce(async (rawInput: RuntimeInput) => {
      const recordId = rawInput.toolCalls.begin({
        toolName: 'jira_create_issue',
        riskLevel: 'WRITE_HIGH',
        approvalStatus: 'approved',
        operationStatus: 'running',
        operationId: OPERATION_ID,
        payloadHash: 'd'.repeat(64),
        preview: { toolName: 'jira_create_issue' } as never,
      })
      rawInput.toolCalls.update(recordId, { operationStatus: 'uncertain' })
      return { text: 'Kiểm tra lại', truncatedContextCount: 0 }
    })

    const result = await h.controller.send(input())
    await vi.waitFor(() => {
      expect(h.mocks.activityRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'uncertain_operation',
          action: 'became_uncertain',
          status: 'uncertain',
          subjectId: 'jira_create_issue',
          requestId: result.requestId,
          operationId: OPERATION_ID,
        }),
      )
    })
  })

  it('ghi confirmation cancelled khi người dùng huỷ', async () => {
    const h = makeHarness()
    const request = {
      operationId: OPERATION_ID,
      payloadHash: 'e'.repeat(64),
      conversationId: CONVERSATION_ID,
      preview: { toolName: 'jira_create_issue' },
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    } as ConfirmationRequest
    runtimeMock.runTurn.mockImplementationOnce(async () => {
      const decision = await runtimeMock.deps?.requestConfirmation(request, 'request-1')
      expect(decision).toBe('cancelled')
      return { text: 'Đã huỷ', truncatedContextCount: 0 }
    })

    const result = await h.controller.send(input())
    await vi.waitFor(() => {
      expect(h.mocks.sendToRenderer).toHaveBeenCalledWith(NEXA_EVENTS.toolConfirmation, request)
    })
    h.controller.cancelTool(OPERATION_ID)

    await vi.waitFor(() => {
      expect(h.mocks.activityRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'confirmation',
          action: 'cancelled',
          status: 'cancelled',
          subjectId: 'jira_create_issue',
          requestId: result.requestId,
          operationId: OPERATION_ID,
        }),
      )
    })
  })
})

/**
 * Ảnh không bao giờ xuống đĩa (openspec `add-multi-format-file-upload`, spec `file-ingestion`:
 * "Images are never persisted").
 *
 * Cả cam kết này hiện nằm ở một biểu thức duy nhất trong `chat-controller.ts`: ảnh có
 * `text === ''` nên không thoả điều kiện ghi. Nó đúng, nhưng nó đúng một cách mong manh — một
 * thay đổi trông vô hại kiểu "lưu luôn mô tả ảnh cho dễ tìm" là đủ để phá, và không cổng nào đỏ.
 * §8.1 cấm giữ bản sao file; base64 của một tấm ảnh cũng là một bản sao.
 */
describe('ảnh không bao giờ được lưu', () => {
  function imageDoc() {
    return {
      fileName: 'so-do.png',
      kind: 'image',
      sizeBytes: 2_048,
      sourcePathHash: 'a'.repeat(64),
      text: '',
      chunks: [],
      charCount: 0,
      estimatedTokens: 765,
      truncated: false,
      image: {
        mediaType: 'image/png',
        dataBase64: 'BASE64ANHRIENGTU',
        byteSize: 12,
        width: 1024,
        height: 1024,
        metadataStripped: true,
      },
    }
  }

  function textDoc() {
    return {
      fileName: 'ghi-chu.txt',
      kind: 'txt',
      sizeBytes: 64,
      sourcePathHash: 'b'.repeat(64),
      text: 'Nội dung đọc được',
      chunks: [],
      charCount: 17,
      estimatedTokens: 5,
      truncated: false,
    }
  }

  function withStorageOn(h: Harness): void {
    vi.mocked(h.services.settings.get).mockReturnValue({
      ...DEFAULT_APP_SETTINGS,
      features: { ...DEFAULT_APP_SETTINGS.features, storeExtractedText: true },
    })
  }

  it('không lưu nội dung ảnh kể cả khi chính sách cho phép lưu text trích xuất', async () => {
    const h = makeHarness()
    withStorageOn(h)
    h.mocks.processDocuments.mockResolvedValueOnce([imageDoc()])

    await h.controller.send(input(['00000000-0000-4000-8000-000000000004']))

    expect(h.mocks.addAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: 'so-do.png', extractedText: null }),
    )

    // Khẳng định mạnh hơn cái trên: base64 không được xuất hiện Ở BẤT KỲ ĐÂU trong lời gọi ghi,
    // kể cả một trường phụ mà ai đó thêm vào sau này.
    const written = JSON.stringify(h.mocks.addAttachment.mock.calls)
    expect(written).not.toContain('BASE64ANHRIENGTU')
  })

  it('vẫn lưu text của tài liệu chữ trong cùng lượt — đây là cấm ảnh, không phải tắt tính năng', async () => {
    const h = makeHarness()
    withStorageOn(h)
    h.mocks.processDocuments.mockResolvedValueOnce([imageDoc(), textDoc()])

    await h.controller.send(input(['00000000-0000-4000-8000-000000000005']))

    expect(h.mocks.addAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: 'so-do.png', extractedText: null }),
    )
    expect(h.mocks.addAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: 'ghi-chu.txt', extractedText: 'Nội dung đọc được' }),
    )
  })

  it('chính sách tắt thì không tài liệu nào được lưu text', async () => {
    const h = makeHarness()
    // `storeExtractedText` mặc định BẬT, nên phải tắt tường minh — nhánh này không tự chạy.
    vi.mocked(h.services.settings.get).mockReturnValue({
      ...DEFAULT_APP_SETTINGS,
      features: { ...DEFAULT_APP_SETTINGS.features, storeExtractedText: false },
    })
    h.mocks.processDocuments.mockResolvedValueOnce([imageDoc(), textDoc()])

    await h.controller.send(input(['00000000-0000-4000-8000-000000000006']))

    for (const [call] of h.mocks.addAttachment.mock.calls) {
      expect(call.extractedText).toBeNull()
    }
  })
})
