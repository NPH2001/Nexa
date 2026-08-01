import {
  ERROR_CODES,
  NexaError,
  type ApprovalStatus,
  type AppSettings,
  type ConfirmationRequest,
  type MessageRole,
  type OperationStatus,
  type RiskLevel,
  type ToolDefinition,
  type ToolPreview,
} from '@nexa/shared-types'
import type { Logger } from '@nexa/observability'
import type {
  ChatMessage,
  ChatToolCall,
  ChatToolSpec,
  LiteLlmClient,
  TokenUsage,
} from '@nexa/llm-client'
import type { ProcessedDocument } from '@nexa/document-processor'
import type { AtlassianMcpManager } from '@nexa/atlassian-mcp-manager'
import { buildContext, toolResultMessage, type ContextBudget } from './context-builder.js'
import { ConfirmationGuard, type ApprovalDecision } from './confirmation-guard.js'
import { OperationTracker, isUncertainOutcome } from './operation-tracker.js'
import { assertModelMayReceiveDocuments } from './document-policy.js'

/** Sự kiện runtime đẩy ra ngoài cho host (main process) chuyển tiếp tới UI. */
export type RuntimeEvent =
  | { readonly type: 'text-delta'; readonly delta: string }
  | {
      readonly type: 'tool-status'
      readonly toolCallRecordId: string
      readonly toolName: string
      readonly phase: 'started' | 'awaiting-approval' | 'running' | 'done' | 'failed' | 'uncertain'
      readonly detail?: string
    }
  | { readonly type: 'context-truncated'; readonly droppedMessages: number }

/** Host lưu lifecycle tool xuống DB. Runtime không biết gì về SQLite. */
export interface ToolCallSink {
  begin(info: {
    toolName: string
    riskLevel: RiskLevel
    approvalStatus: ApprovalStatus
    operationStatus: OperationStatus
    preview?: ToolPreview
    operationId?: string
    payloadHash?: string
  }): string
  update(
    recordId: string,
    patch: {
      approvalStatus?: ApprovalStatus
      operationStatus?: OperationStatus
      resultSummary?: string
      targetKey?: string
      targetUrl?: string
      errorCode?: string
    },
  ): void
}

export interface AgentRuntimeDeps {
  readonly llm: LiteLlmClient
  /** null khi người dùng chưa cấu hình Atlassian — chat vẫn phải chạy được. */
  readonly mcp: AtlassianMcpManager | null
  readonly guard: ConfirmationGuard
  readonly tracker: OperationTracker
  readonly logger: Logger
  readonly settings: () => AppSettings
  readonly actingAccount: () => string
  /** Base URL của hệ thống đích — preview phải hiện đúng "gửi đi đâu" (§10.2 mục 1). */
  readonly jiraBaseUrl: () => string
  readonly confluenceBaseUrl: () => string
  /** Đẩy yêu cầu xác nhận lên UI và chờ người dùng quyết (§7.4 bước 3–4). */
  readonly requestConfirmation: (request: ConfirmationRequest) => Promise<ApprovalDecision>
}

export interface RunTurnInput {
  readonly requestId: string
  readonly conversationId: string
  readonly modelId: string
  readonly contextWindowTokens: number
  readonly history: readonly { role: MessageRole; content: string }[]
  readonly documents?: readonly ProcessedDocument[]
  readonly signal?: AbortSignal
  readonly emit: (event: RuntimeEvent) => void
  readonly toolCalls: ToolCallSink
}

export interface RunTurnResult {
  readonly text: string
  readonly truncatedContextCount: number
  readonly usage?: TokenUsage
  readonly toolCallCount: number
  /** Operation write rơi vào `uncertain` trong lượt này — UI cần hiện nút tra cứu. */
  readonly uncertainOperationIds: readonly string[]
}

/**
 * Agent Runtime (§5.2): tạo request, quản lý context, quyết định gọi model/tool, ghép kết quả
 * vào hội thoại.
 *
 * Vòng lặp tool-calling không được đặc tả trong tài liệu — các ràng buộc dưới đây là lựa chọn
 * của tôi, ghi ở docs/OPEN-QUESTIONS.md B3:
 *   - tối đa `maxToolIterations` vòng mỗi lượt (mặc định 5)
 *   - tool chạy TUẦN TỰ, không song song, để hộp thoại xác nhận không chồng nhau
 *   - tối đa MỘT tool write mỗi lượt
 *   - tool lỗi ⇒ trả lỗi lại cho model như một tool result, TRỪ lỗi cấu hình/xác thực thì dừng hẳn
 */
export class AgentRuntime {
  private readonly deps: AgentRuntimeDeps
  private readonly log: Logger

  constructor(deps: AgentRuntimeDeps) {
    this.deps = deps
    this.log = deps.logger.child({ module: 'agent-runtime' })
  }

  async runTurn(input: RunTurnInput): Promise<RunTurnResult> {
    const settings = this.deps.settings()

    if (input.documents !== undefined && input.documents.length > 0) {
      // §11.2 — chặn trước khi bất kỳ byte nào rời máy.
      assertModelMayReceiveDocuments(input.modelId, settings)
    }

    const budget: ContextBudget = { contextWindowTokens: input.contextWindowTokens }
    const context = buildContext({
      history: input.history,
      ...(input.documents !== undefined ? { documents: input.documents } : {}),
      budget,
    })
    if (context.truncatedCount > 0) {
      input.emit({ type: 'context-truncated', droppedMessages: context.truncatedCount })
    }

    const messages: ChatMessage[] = [...context.messages]
    const tools = this.buildToolSpecs()

    let finalText = ''
    let usage: TokenUsage | undefined
    let toolCallCount = 0
    const uncertainOperationIds: string[] = []

    for (let iteration = 0; iteration < settings.maxToolIterations; iteration++) {
      const turn = await this.streamOnce(messages, tools, input)
      if (turn.usage !== undefined) usage = turn.usage

      if (turn.toolCalls.length === 0) {
        finalText = turn.text
        return {
          text: finalText,
          truncatedContextCount: context.truncatedCount,
          ...(usage !== undefined ? { usage } : {}),
          toolCallCount,
          uncertainOperationIds,
        }
      }

      // Giữ lại lời đề xuất tool của model — nếu thiếu, message role='tool' sau đó sẽ mồ côi
      // và gateway từ chối cả request.
      messages.push({ role: 'assistant', content: turn.text, tool_calls: turn.toolCalls })
      if (turn.text !== '') finalText = turn.text

      let writesThisTurn = 0
      for (const call of turn.toolCalls) {
        input.signal?.throwIfAborted()
        toolCallCount++

        const outcome = await this.executeToolCall(call, input, writesThisTurn)
        if (outcome.wasWrite) writesThisTurn++
        if (outcome.uncertainOperationId !== undefined) {
          uncertainOperationIds.push(outcome.uncertainOperationId)
        }
        messages.push(toolResultMessage(call.id, outcome.resultForModel))

        if (outcome.fatal) {
          return {
            text: finalText,
            truncatedContextCount: context.truncatedCount,
            ...(usage !== undefined ? { usage } : {}),
            toolCallCount,
            uncertainOperationIds,
          }
        }
      }
    }

    // Vượt trần vòng lặp: dừng và nói rõ, thay vì lặp mãi hoặc trả lời cụt lủn.
    throw new NexaError(ERROR_CODES.MAX_TOOL_ITERATIONS, { requestId: input.requestId })
  }

  // ── Một lượt gọi model ──────────────────────────────────────────────────

  private async streamOnce(
    messages: readonly ChatMessage[],
    tools: readonly ChatToolSpec[],
    input: RunTurnInput,
  ): Promise<{ text: string; toolCalls: ChatToolCall[]; usage?: TokenUsage }> {
    let text = ''
    let toolCalls: ChatToolCall[] = []
    let usage: TokenUsage | undefined

    const stream = this.deps.llm.streamChat(
      {
        model: input.modelId,
        messages,
        ...(tools.length > 0 ? { tools } : {}),
      },
      {
        requestId: input.requestId,
        ...(input.signal !== undefined ? { signal: input.signal } : {}),
      },
    )

    for await (const event of stream) {
      switch (event.type) {
        case 'text':
          text += event.delta
          input.emit({ type: 'text-delta', delta: event.delta })
          break
        case 'tool-calls':
          toolCalls = [...event.toolCalls]
          break
        case 'usage':
          usage = event.usage
          break
        case 'finish':
          break
      }
    }

    return { text, toolCalls, ...(usage !== undefined ? { usage } : {}) }
  }

  // ── Thực thi một tool call ──────────────────────────────────────────────

  private async executeToolCall(
    call: ChatToolCall,
    input: RunTurnInput,
    writesAlreadyThisTurn: number,
  ): Promise<{
    resultForModel: string
    wasWrite: boolean
    fatal: boolean
    uncertainOperationId?: string
  }> {
    const mcp = this.deps.mcp
    if (mcp === null || !mcp.isReady) {
      return {
        resultForModel: 'Lỗi: chưa kết nối được Jira/Confluence. Hãy yêu cầu người dùng kiểm tra cấu hình.',
        wasWrite: false,
        fatal: true,
      }
    }

    let definition: ToolDefinition
    let payload: Record<string, unknown>
    try {
      definition = mcp.resolveCallable(call.function.name)
      payload = mcp.validateInput(definition, safeParseArguments(call.function.arguments))
    } catch (error) {
      // Model gọi sai tên tool hoặc sai tham số: trả lỗi lại để nó tự sửa ở vòng sau.
      const nexa = NexaError.wrap(error)
      this.log.tool('tool-rejected', {
        toolName: call.function.name,
        phase: 'failed',
        requestId: input.requestId,
        errorCode: nexa.code,
      })
      return {
        resultForModel: `Lỗi: ${nexa.message}${nexa.safeDetail === undefined ? '' : ` (${nexa.safeDetail})`}`,
        wasWrite: false,
        // Không fatal: model có cơ hội sửa tên tool hoặc tham số ở vòng sau.
        fatal: false,
      }
    }

    const isWrite = this.deps.guard.requiresApproval(definition.riskLevel)

    if (isWrite && writesAlreadyThisTurn >= 1) {
      // Xem OPEN-QUESTIONS B3: chặn nhiều write trong một lượt là lựa chọn thiên về an toàn.
      return {
        resultForModel:
          'Lỗi: mỗi lượt trả lời chỉ được thực hiện một thao tác thay đổi dữ liệu. Hãy đề xuất từng thao tác một để người dùng xác nhận riêng.',
        wasWrite: false,
        fatal: false,
      }
    }

    return isWrite
      ? this.executeWrite(definition, payload, input)
      : this.executeRead(definition, payload, input)
  }

  private async executeRead(
    definition: ToolDefinition,
    payload: Record<string, unknown>,
    input: RunTurnInput,
  ): Promise<{ resultForModel: string; wasWrite: false; fatal: boolean }> {
    const recordId = input.toolCalls.begin({
      toolName: definition.name,
      riskLevel: definition.riskLevel,
      approvalStatus: 'not_required',
      operationStatus: 'running',
    })
    input.emit({
      type: 'tool-status',
      toolCallRecordId: recordId,
      toolName: definition.name,
      phase: 'running',
    })

    try {
      const outcome = await (this.deps.mcp as AtlassianMcpManager).callTool(definition.name, payload)
      input.toolCalls.update(recordId, {
        operationStatus: 'success',
        resultSummary: outcome.summary.forUser,
        ...(outcome.summary.targetKey !== undefined ? { targetKey: outcome.summary.targetKey } : {}),
        ...(outcome.summary.targetUrl !== undefined ? { targetUrl: outcome.summary.targetUrl } : {}),
      })
      input.emit({
        type: 'tool-status',
        toolCallRecordId: recordId,
        toolName: definition.name,
        phase: 'done',
        detail: outcome.summary.forUser,
      })
      return { resultForModel: outcome.summary.forModel, wasWrite: false, fatal: false }
    } catch (error) {
      const nexa = NexaError.wrap(error)
      input.toolCalls.update(recordId, { operationStatus: 'failed', errorCode: nexa.code })
      input.emit({
        type: 'tool-status',
        toolCallRecordId: recordId,
        toolName: definition.name,
        phase: 'failed',
        detail: nexa.message,
      })
      // Lỗi cấu hình/xác thực thì dừng hẳn (§3 fail closed) — model không tự sửa được,
      // và thử lại chỉ tốn quota.
      const fatal =
        nexa.code === ERROR_CODES.ATLASSIAN_AUTH_FAILED ||
        nexa.code === ERROR_CODES.ATLASSIAN_CONFIG_REQUIRED ||
        nexa.code === ERROR_CODES.MCP_SERVER_UNAVAILABLE
      return { resultForModel: `Lỗi: ${nexa.message}`, wasWrite: false, fatal }
    }
  }

  /** §7.4 — toàn bộ luồng tool thay đổi dữ liệu, tám bước. */
  private async executeWrite(
    definition: ToolDefinition,
    payload: Record<string, unknown>,
    input: RunTurnInput,
  ): Promise<{
    resultForModel: string
    wasWrite: true
    fatal: boolean
    uncertainOperationId?: string
  }> {
    const mcp = this.deps.mcp as AtlassianMcpManager

    // Bước 2: dựng bản xem trước.
    let preview: ToolPreview
    try {
      preview = await this.buildPreview(definition, payload)
    } catch (error) {
      const nexa = NexaError.wrap(error)
      return { resultForModel: `Lỗi khi dựng bản xem trước: ${nexa.message}`, wasWrite: true, fatal: false }
    }

    const request = this.deps.guard.open({
      conversationId: input.conversationId,
      toolName: definition.name,
      validatedPayload: payload,
      preview,
    })

    const recordId = input.toolCalls.begin({
      toolName: definition.name,
      riskLevel: definition.riskLevel,
      approvalStatus: 'pending',
      operationStatus: 'pending',
      preview,
      operationId: request.operationId,
      payloadHash: request.payloadHash,
    })
    input.emit({
      type: 'tool-status',
      toolCallRecordId: recordId,
      toolName: definition.name,
      phase: 'awaiting-approval',
    })

    // Bước 3–4: chờ người dùng quyết.
    const decision = await this.deps.requestConfirmation(request)

    if (decision !== 'approved') {
      input.toolCalls.update(recordId, { approvalStatus: 'cancelled', operationStatus: 'failed' })
      input.emit({
        type: 'tool-status',
        toolCallRecordId: recordId,
        toolName: definition.name,
        phase: 'done',
        detail: 'Người dùng đã huỷ',
      })
      // §17.2 kịch bản 2: KHÔNG có request nào được gửi tới hệ thống đích.
      return {
        resultForModel: 'Người dùng đã huỷ thao tác này. Không thực hiện gì cả.',
        wasWrite: true,
        fatal: false,
      }
    }

    // Bước 5–6: tiêu approval, kiểm tra lần cuối trên payload thật sẽ gửi.
    try {
      this.deps.guard.consume(request.operationId, definition.name, payload)
    } catch (error) {
      const nexa = NexaError.wrap(error)
      input.toolCalls.update(recordId, {
        approvalStatus: nexa.code === ERROR_CODES.TOOL_APPROVAL_EXPIRED ? 'expired' : 'cancelled',
        operationStatus: 'failed',
        errorCode: nexa.code,
      })
      input.emit({
        type: 'tool-status',
        toolCallRecordId: recordId,
        toolName: definition.name,
        phase: 'failed',
        detail: nexa.message,
      })
      return { resultForModel: `Lỗi: ${nexa.message}`, wasWrite: true, fatal: false }
    }

    input.toolCalls.update(recordId, { approvalStatus: 'approved', operationStatus: 'running' })
    input.emit({
      type: 'tool-status',
      toolCallRecordId: recordId,
      toolName: definition.name,
      phase: 'running',
    })

    this.deps.tracker.begin({
      operationId: request.operationId,
      toolName: definition.name,
      conversationId: input.conversationId,
      toolCallRecordId: recordId,
      startedAt: new Date().toISOString(),
      payload,
    })

    // Bước 7: thực thi.
    try {
      const outcome = await mcp.callTool(definition.name, payload)
      this.deps.tracker.succeed(request.operationId, {
        ...(outcome.summary.targetKey !== undefined ? { key: outcome.summary.targetKey } : {}),
        ...(outcome.summary.targetUrl !== undefined ? { url: outcome.summary.targetUrl } : {}),
      })
      this.deps.guard.finishExecution(request.operationId, 'success')

      input.toolCalls.update(recordId, {
        operationStatus: 'success',
        resultSummary: outcome.summary.forUser,
        ...(outcome.summary.targetKey !== undefined ? { targetKey: outcome.summary.targetKey } : {}),
        ...(outcome.summary.targetUrl !== undefined ? { targetUrl: outcome.summary.targetUrl } : {}),
      })
      input.emit({
        type: 'tool-status',
        toolCallRecordId: recordId,
        toolName: definition.name,
        phase: 'done',
        detail: outcome.summary.forUser,
      })
      return { resultForModel: outcome.summary.forModel, wasWrite: true, fatal: false }
    } catch (error) {
      const nexa = NexaError.wrap(error)
      const uncertain = isUncertainOutcome(nexa)

      if (uncertain) {
        this.deps.tracker.markUncertain(request.operationId, nexa.code)
        this.deps.guard.finishExecution(request.operationId, 'uncertain')
        input.toolCalls.update(recordId, {
          operationStatus: 'uncertain',
          errorCode: ERROR_CODES.TOOL_EXECUTION_UNCERTAIN,
        })
        input.emit({
          type: 'tool-status',
          toolCallRecordId: recordId,
          toolName: definition.name,
          phase: 'uncertain',
        })
        return {
          resultForModel:
            'Không xác định được thao tác đã hoàn tất hay chưa. KHÔNG được thử lại. Hãy báo người dùng kiểm tra kết quả tại hệ thống đích.',
          wasWrite: true,
          fatal: true,
          uncertainOperationId: request.operationId,
        }
      }

      this.deps.tracker.fail(request.operationId, nexa.code)
      this.deps.guard.finishExecution(request.operationId, 'failed')
      input.toolCalls.update(recordId, { operationStatus: 'failed', errorCode: nexa.code })
      input.emit({
        type: 'tool-status',
        toolCallRecordId: recordId,
        toolName: definition.name,
        phase: 'failed',
        detail: nexa.message,
      })
      return { resultForModel: `Lỗi: ${nexa.message}`, wasWrite: true, fatal: false }
    }
  }

  private async buildPreview(
    definition: ToolDefinition,
    payload: Record<string, unknown>,
  ): Promise<ToolPreview> {
    const mcp = this.deps.mcp as AtlassianMcpManager
    if (definition.buildPreview === undefined) {
      // Không có preview builder cho một tool write là lỗi lập trình, không phải lỗi runtime —
      // nhưng fail closed vẫn tốt hơn là gọi tool không xác nhận.
      throw new NexaError(ERROR_CODES.TOOL_NOT_ALLOWED, {
        safeDetail: `${definition.name} has no preview builder`,
      })
    }

    return definition.buildPreview(payload, {
      actingAccount: this.deps.actingAccount(),
      targetSystemUrl:
        definition.targetSystem === 'jira'
          ? this.deps.jiraBaseUrl()
          : this.deps.confluenceBaseUrl(),
      readTool: async (name, toolInput) => {
        if (!mcp.canCallReadTool(name)) {
          throw new NexaError(ERROR_CODES.TOOL_NOT_ALLOWED, { safeDetail: `${name} unavailable` })
        }
        const readDefinition = mcp.resolveCallable(name)
        const validated = mcp.validateInput(readDefinition, toolInput)
        const outcome = await mcp.callTool(name, validated)
        try {
          return JSON.parse(outcome.rawText)
        } catch {
          return outcome.rawText
        }
      },
    })
  }

  /** Danh sách tool gửi cho model — chỉ những tool thực sự khả dụng lúc này (§10.1). */
  private buildToolSpecs(): ChatToolSpec[] {
    const mcp = this.deps.mcp
    if (mcp === null || !mcp.isReady) return []
    return mcp.availableTools().map((definition) => ({
      type: 'function' as const,
      function: {
        name: definition.name,
        description: definition.description,
        parameters: definition.jsonSchema,
      },
    }))
  }
}

/** Model đôi khi trả arguments rỗng hoặc JSON hỏng. Không được để nó ném ra ngoài vòng lặp. */
function safeParseArguments(raw: string): unknown {
  const trimmed = raw.trim()
  if (trimmed === '') return {}
  try {
    return JSON.parse(trimmed)
  } catch {
    return { __invalid_json__: true }
  }
}

export { ConfirmationGuard, OperationTracker }
