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
  const sendToRenderer = vi.fn()
  const sink = new MemorySink()

  const services = {
    logger: new Logger({ sink, minLevel: 'debug' }),
    profileId: 'profile-1',
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
