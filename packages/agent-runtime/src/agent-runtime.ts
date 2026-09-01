import {
  ERROR_CODES,
  EXPAND_TOOLS_TOOL_NAME,
  isExternalProvider,
  NexaError,
  TOOL_PRESET_FLAGS,
  type ApprovalStatus,
  type AppSettings,
  type ConfirmationRequest,
  type LlmProvider,
  type LocalToolDefinition,
  type LocalToolRegistry,
  type MessageRole,
  type OperationStatus,
  type RiskLevel,
  type ToolDefinition,
  type ToolPreset,
  type ToolPreview,
  type ToolResultSummary,
} from '@nexa/shared-types'
import type { Logger } from '@nexa/observability'
import type {
  ChatMessage,
  ChatToolCall,
  ChatToolSpec,
  FinishReason,
  OpenAiCompatibleClient,
  TokenUsage,
} from '@nexa/llm-client'
import type { ProcessedDocument } from '@nexa/document-processor'
import type { AtlassianMcpManager } from '@nexa/atlassian-mcp-manager'
import {
  buildContext,
  toolResultMessage,
  type BaKnowledgeContextItem,
  type CommitmentContextItem,
  type ContextBudget,
  type MemoryContextFact,
} from './context-builder.js'
import { ConfirmationGuard, type ApprovalDecision } from './confirmation-guard.js'
import { OperationTracker, isUncertainOutcome } from './operation-tracker.js'
import { assertModelMayReceiveDocuments, assertModelSupportsImages } from './document-policy.js'
import { selectPresetForHistory } from './tool-preset-selector.js'

/**
 * Tool đã phân giải, nhìn từ đường thực thi.
 *
 * Đường write ở §7.4 quan tâm bốn thứ: gọi cái gì, rủi ro mức nào, payload đã validate ra sao,
 * và hai hàm "dựng preview"/"thực thi". Nó KHÔNG cần biết tool nằm trên MCP server hay chạy
 * thẳng trong main process. Nhờ vậy tool cục bộ không sinh ra một đường ghi thứ hai — và một
 * đường ghi thứ hai chính là chỗ mà bất biến approval âm thầm biến mất.
 */
interface CallableTarget {
  readonly name: string
  readonly riskLevel: RiskLevel
  /** Payload ĐÃ validate — cũng chính là thứ được băm vào `payload_hash`. */
  readonly payload: Record<string, unknown>
  buildPreview(): Promise<ToolPreview>
  execute(): Promise<ToolResultSummary>
}

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
  readonly llm: OpenAiCompatibleClient
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
  /**
   * Tool chạy thẳng trong main process (ví dụ cam kết). null khi người dùng chưa bật.
   *
   * Cổng RIÊNG với `mcp`: tool cục bộ không có hệ thống đích bên ngoài, nên nó phải khả dụng cả
   * khi Atlassian chưa cấu hình, và không bao giờ được đi qua `mcp.callTool`.
   */
  readonly localTools?: LocalToolRegistry | null
}

export interface RunTurnInput {
  readonly requestId: string
  readonly conversationId: string
  readonly modelId: string
  readonly modelProvider: LlmProvider
  readonly contextWindowTokens: number
  /**
   * Model đang chọn có đọc được ảnh không. Host lấy từ `ModelConfig.supportsVision`.
   *
   * Mặc định coi như KHÔNG khi caller không truyền: cùng lập trường fail-closed với cột trong
   * DB — thà bắt người dùng bật một lần còn hơn để ảnh bị model bỏ qua trong im lặng.
   */
  readonly modelSupportsVision?: boolean
  readonly history: readonly { role: MessageRole; content: string }[]
  readonly documents?: readonly ProcessedDocument[]
  readonly memoryFacts?: readonly RuntimeMemoryFact[]
  /**
   * Cam kết đang treo. Host đã quyết định có gửi hay không (setting + chính sách provider) —
   * runtime chỉ dựng khối context, không tự đi đọc dữ liệu người dùng.
   */
  readonly commitments?: readonly CommitmentContextItem[]
  /**
   * Tri thức nghiệp vụ đã xác nhận. Host quyết định có nạp hay không (cờ `baWorkbench`), runtime
   * chỉ dựng khối context — và loại sạch khối này khi provider nằm ngoài tổ chức.
   */
  readonly baKnowledge?: readonly BaKnowledgeContextItem[]
  readonly signal?: AbortSignal
  readonly emit: (event: RuntimeEvent) => void
  readonly toolCalls: ToolCallSink
}

export interface RuntimeMemoryFact extends MemoryContextFact {
  readonly sharingPolicy: 'internal_only' | 'allow_external'
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
      // §11.2 — chặn trước khi bất kỳ byte nào rời máy. Provider ngoài là fail-closed.
      assertModelMayReceiveDocuments(input.modelProvider, input.modelId, settings)
      // Rồi mới tới năng lực: được phép gửi không có nghĩa là model đọc được ảnh.
      assertModelSupportsImages(
        { modelId: input.modelId, supportsVision: input.modelSupportsVision ?? false },
        input.documents,
      )
    }

    const budget: ContextBudget = { contextWindowTokens: input.contextWindowTokens }
    const memoryFacts = selectMemoryForProvider(input.memoryFacts ?? [], input.modelProvider)
    const baKnowledge = selectBaKnowledgeForProvider(input.baKnowledge ?? [], input.modelProvider)
    const context = buildContext({
      history: input.history,
      ...(input.documents !== undefined ? { documents: input.documents } : {}),
      ...(memoryFacts.length > 0 ? { memoryFacts } : {}),
      ...(input.commitments !== undefined && input.commitments.length > 0
        ? { commitments: input.commitments }
        : {}),
      ...(baKnowledge.length > 0 ? { baKnowledge } : {}),
      budget,
    })
    this.log.info('memory-context', {
      requestId: input.requestId,
      provider: input.modelProvider,
      eligibleCount: memoryFacts.length,
      includedCount: context.memoryFactsIncluded,
      truncatedCount: context.memoryFactsTruncated,
    })
    if (input.commitments !== undefined && input.commitments.length > 0) {
      // Log số lượng, không log nội dung: đây là chỗ để phát hiện cắt bớt im lặng.
      this.log.info('commitment-context', {
        requestId: input.requestId,
        provider: input.modelProvider,
        eligibleCount: input.commitments.length,
        includedCount: context.commitmentsIncluded,
        truncatedCount: context.commitmentsTruncated,
      })
    }
    if (input.baKnowledge !== undefined && input.baKnowledge.length > 0) {
      // Số lượng, không nội dung. `eligibleCount` là 0 với provider ngoài — đó là bằng chứng
      // trong log rằng tri thức nghiệp vụ đã bị chặn, chứ không phải im lặng biến mất.
      this.log.info('ba-knowledge-context', {
        requestId: input.requestId,
        provider: input.modelProvider,
        offeredCount: input.baKnowledge.length,
        eligibleCount: baKnowledge.length,
        includedCount: context.baKnowledgeIncluded,
        truncatedCount: context.baKnowledgeTruncated,
      })
    }
    // Ảnh bị loại vì hết ngân sách là LỖI, không phải một lần cắt bớt như với văn bản: người
    // dùng đính kèm ảnh rồi nhận về câu trả lời trông có vẻ hợp lý mà model chưa hề nhìn thấy
    // ảnh là kết cục tệ nhất có thể.
    if (context.imagesTruncated > 0) {
      throw new NexaError(ERROR_CODES.IMAGE_EXCEEDS_CONTEXT, {
        requestId: input.requestId,
        safeDetail: `${String(context.imagesTruncated)} image(s) did not fit the remaining context budget`,
      })
    }
    if (context.truncatedCount > 0) {
      input.emit({ type: 'context-truncated', droppedMessages: context.truncatedCount })
    }

    const messages: ChatMessage[] = [...context.messages]

    // ADR 0009 — chỉ gửi preset tool phù hợp câu hỏi, không phải cả 98 tool mỗi vòng.
    // `tools` phải gán lại được: model có thể xin danh mục đầy đủ giữa lượt qua tool meta.
    const scoping = settings.features.toolScoping
    let preset: ToolPreset = scoping ? selectPresetForHistory(input.history) : 'all'
    let tools = this.buildToolSpecs(preset, scoping && preset !== 'all')
    this.log.info('tool-preset', {
      requestId: input.requestId,
      preset,
      toolCount: tools.length,
      expanded: false,
    })

    let finalText = ''
    let usage: TokenUsage | undefined
    let toolCallCount = 0
    const uncertainOperationIds: string[] = []

    for (let iteration = 0; iteration < settings.maxToolIterations; iteration++) {
      const turn = await this.streamOnce(messages, tools, input)
      if (turn.usage !== undefined) usage = turn.usage

      if (turn.finishReason === 'length') {
        const notice =
          '\n\nCâu trả lời này chưa đầy đủ vì model đã chạm giới hạn độ dài. Bạn có thể nhắn “tiếp tục” hoặc thu hẹp phạm vi để mình trả lời phần còn lại.'
        input.emit({ type: 'text-delta', delta: notice })
        return {
          text: `${turn.text}${notice}`,
          truncatedContextCount: context.truncatedCount,
          ...(usage !== undefined ? { usage } : {}),
          toolCallCount,
          uncertainOperationIds,
        }
      }

      if (turn.finishReason === 'content_filter') {
        const notice =
          '\n\nModel chưa thể hoàn thành câu trả lời vì bộ lọc nội dung đã dừng phản hồi. Hãy diễn đạt lại yêu cầu hoặc chia nhỏ phần cần hỗ trợ.'
        input.emit({ type: 'text-delta', delta: notice })
        return {
          text: `${turn.text}${notice}`,
          truncatedContextCount: context.truncatedCount,
          ...(usage !== undefined ? { usage } : {}),
          toolCallCount,
          uncertainOperationIds,
        }
      }

      if (turn.toolCalls.length === 0) {
        finalText = turn.text
        if (finalText.trim() === '') {
          finalText =
            'Mình không nhận được nội dung trả lời từ model. Bạn hãy thử lại; nếu lỗi lặp lại, hãy kiểm tra cấu hình model hoặc kết nối LiteLLM.'
          input.emit({ type: 'text-delta', delta: finalText })
        }
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

        if (call.function.name === EXPAND_TOOLS_TOOL_NAME) {
          // Chặn ở ĐÂY, không trong executeToolCall: tên này không có trong registry nên
          // `resolveCallable()` sẽ — và phải — từ chối nó. Cách "sửa" bằng cách nhét một
          // ToolDefinition giả vào registry đúng là đường vòng mà comment trong
          // `AtlassianMcpManager.callTool` cảnh báo. Cổng bảo mật ở dưới không đổi một dòng.
          //
          // Lời gọi này không phải thao tác lên hệ thống đích mà lên chính request: không
          // preview, không xác nhận, không operation_id, không ghi ToolCallSink, và không
          // chiếm hạn mức một-write-mỗi-lượt (vì `continue` bỏ qua toàn bộ đường write).
          messages.push(toolResultMessage(call.id, this.buildCatalogListing()))
          if (preset !== 'all') {
            preset = 'all'
            tools = this.buildToolSpecs('all', false)
            this.log.info('tool-preset', {
              requestId: input.requestId,
              preset,
              toolCount: tools.length,
              expanded: true,
            })
          }
          continue
        }

        const outcome = await this.executeToolCall(call, input, writesThisTurn)
        if (outcome.wasWrite) writesThisTurn++
        if (outcome.uncertainOperationId !== undefined) {
          uncertainOperationIds.push(outcome.uncertainOperationId)
        }
        messages.push(toolResultMessage(call.id, outcome.resultForModel))

        if (outcome.fatal) {
          const terminalText =
            outcome.terminalText ??
            'Mình chưa thể hoàn tất yêu cầu này. Hãy kiểm tra kết nối và thử lại.'
          const separator = finalText.trim() === '' ? '' : '\n\n'
          input.emit({ type: 'text-delta', delta: `${separator}${terminalText}` })
          return {
            text: `${finalText}${separator}${terminalText}`,
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
  ): Promise<{
    text: string
    toolCalls: ChatToolCall[]
    finishReason: FinishReason
    usage?: TokenUsage
  }> {
    let text = ''
    let toolCalls: ChatToolCall[] = []
    let usage: TokenUsage | undefined
    let finishReason: FinishReason = 'unknown'

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
          finishReason = event.reason
          break
      }
    }

    return { text, toolCalls, finishReason, ...(usage !== undefined ? { usage } : {}) }
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
    terminalText?: string
    uncertainOperationId?: string
  }> {
    // Local TRƯỚC MCP. Danh sách tool cục bộ là tập đóng do main process dựng, nên không có
    // nguy cơ một tool MCP bị che; ngược lại, hỏi MCP trước sẽ chặn tool cục bộ ngay ở cổng
    // "chưa kết nối Atlassian" bên dưới.
    const localDefinition = this.deps.localTools?.get(call.function.name)
    if (localDefinition !== undefined) {
      return this.executeLocalToolCall(localDefinition, call, input, writesAlreadyThisTurn)
    }

    const mcp = this.deps.mcp
    if (mcp === null || !mcp.isReady) {
      return {
        resultForModel:
          'Lỗi: chưa kết nối được Jira/Confluence. Hãy yêu cầu người dùng kiểm tra cấu hình.',
        wasWrite: false,
        fatal: true,
        terminalText:
          'Mình chưa thể hoàn tất yêu cầu vì chưa kết nối được Jira/Confluence. Hãy mở Cài đặt, kiểm tra kết nối Atlassian rồi thử lại.',
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
      ? this.executeWrite(this.mcpTarget(mcp, definition, payload), input)
      : this.executeRead(this.mcpTarget(mcp, definition, payload), input)
  }

  /**
   * Lời gọi tool cục bộ.
   *
   * Đi qua ĐÚNG `executeWrite` của tool ngoài — cùng guard, cùng tracker, cùng `ToolCallSink`,
   * cùng hạn mức một-write-mỗi-lượt. Chỉ điểm thực thi ở bước 7 là khác.
   */
  private async executeLocalToolCall(
    definition: LocalToolDefinition,
    call: ChatToolCall,
    input: RunTurnInput,
    writesAlreadyThisTurn: number,
  ): Promise<{
    resultForModel: string
    wasWrite: boolean
    fatal: boolean
    terminalText?: string
    uncertainOperationId?: string
  }> {
    let payload: Record<string, unknown>
    try {
      const parsed: unknown = definition.inputSchema.parse(
        safeParseArguments(call.function.arguments),
      )
      // Tool cục bộ luôn nhận một object tham số. Ràng buộc ở đây để `payload_hash` và
      // operation tracker nhận đúng kiểu chúng cần, thay vì ép kiểu ở bốn chỗ bên dưới.
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new NexaError(ERROR_CODES.VALIDATION_FAILED, {
          safeDetail: `${definition.name} expects an object payload`,
        })
      }
      payload = parsed as Record<string, unknown>
    } catch (error) {
      const nexa = NexaError.wrap(error)
      this.log.tool('tool-rejected', {
        toolName: definition.name,
        phase: 'failed',
        requestId: input.requestId,
        errorCode: nexa.code,
      })
      return {
        resultForModel: `Lỗi: ${nexa.message}${nexa.safeDetail === undefined ? '' : ` (${nexa.safeDetail})`}`,
        wasWrite: false,
        fatal: false,
      }
    }

    const isWrite = this.deps.guard.requiresApproval(definition.riskLevel)
    if (isWrite && writesAlreadyThisTurn >= 1) {
      return {
        resultForModel:
          'Lỗi: mỗi lượt trả lời chỉ được thực hiện một thao tác thay đổi dữ liệu. Hãy đề xuất từng thao tác một để người dùng xác nhận riêng.',
        wasWrite: false,
        fatal: false,
      }
    }

    const target = this.localTarget(definition, payload)
    return isWrite ? this.executeWrite(target, input) : this.executeRead(target, input)
  }

  /**
   * Cái mà đường write cần biết về một tool — tên, mức rủi ro, payload đã validate, cách dựng
   * preview và cách thực thi. Guard và tracker không cần biết tool đó là MCP hay cục bộ.
   */
  private mcpTarget(
    mcp: AtlassianMcpManager,
    definition: ToolDefinition,
    payload: Record<string, unknown>,
  ): CallableTarget {
    return {
      name: definition.name,
      riskLevel: definition.riskLevel,
      payload,
      buildPreview: () => this.buildPreview(definition, payload),
      execute: async () => (await mcp.callTool(definition.name, payload)).summary,
    }
  }

  private localTarget(
    definition: LocalToolDefinition,
    payload: Record<string, unknown>,
  ): CallableTarget {
    return {
      name: definition.name,
      riskLevel: definition.riskLevel,
      payload,
      buildPreview: async () => {
        if (definition.buildPreview === undefined) {
          // Fail closed, giống nhánh MCP: thiếu preview builder là lỗi lập trình, nhưng hậu quả
          // của việc chạy tiếp là ghi dữ liệu mà người dùng chưa thấy gì.
          throw new NexaError(ERROR_CODES.TOOL_NOT_ALLOWED, {
            safeDetail: `${definition.name} has no preview builder`,
          })
        }
        return definition.buildPreview(payload, { actingAccount: this.deps.actingAccount() })
      },
      execute: () => definition.execute(payload),
    }
  }

  private async executeRead(
    target: CallableTarget,
    input: RunTurnInput,
  ): Promise<{
    resultForModel: string
    wasWrite: false
    fatal: boolean
    terminalText?: string
  }> {
    const definition = target
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
      const outcome = { summary: await target.execute() }
      const resultForUser = formatToolResultForUser(outcome.summary)
      input.toolCalls.update(recordId, {
        operationStatus: 'success',
        resultSummary: resultForUser,
        ...(outcome.summary.targetKey !== undefined
          ? { targetKey: outcome.summary.targetKey }
          : {}),
        ...(outcome.summary.targetUrl !== undefined
          ? { targetUrl: outcome.summary.targetUrl }
          : {}),
      })
      input.emit({
        type: 'tool-status',
        toolCallRecordId: recordId,
        toolName: definition.name,
        phase: 'done',
        detail: resultForUser,
      })
      return {
        resultForModel: formatToolResultForModel(outcome.summary),
        wasWrite: false,
        fatal: false,
      }
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
      return {
        resultForModel: `Lỗi: ${nexa.message}`,
        wasWrite: false,
        fatal,
        ...(fatal ? { terminalText: formatTerminalError(nexa) } : {}),
      }
    }
  }

  /** §7.4 — toàn bộ luồng tool thay đổi dữ liệu, tám bước. */
  private async executeWrite(
    target: CallableTarget,
    input: RunTurnInput,
  ): Promise<{
    resultForModel: string
    wasWrite: true
    fatal: boolean
    terminalText?: string
    uncertainOperationId?: string
  }> {
    const definition = target
    const payload = target.payload

    // Bước 2: dựng bản xem trước.
    let preview: ToolPreview
    try {
      preview = await target.buildPreview()
    } catch (error) {
      const nexa = NexaError.wrap(error)
      return {
        resultForModel: `Lỗi khi dựng bản xem trước: ${nexa.message}`,
        wasWrite: true,
        fatal: false,
      }
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
      const outcome = { summary: await target.execute() }
      this.deps.tracker.succeed(request.operationId, {
        ...(outcome.summary.targetKey !== undefined ? { key: outcome.summary.targetKey } : {}),
        ...(outcome.summary.targetUrl !== undefined ? { url: outcome.summary.targetUrl } : {}),
      })
      this.deps.guard.finishExecution(request.operationId, 'success')

      const resultForUser = formatToolResultForUser(outcome.summary)
      input.toolCalls.update(recordId, {
        operationStatus: 'success',
        resultSummary: resultForUser,
        ...(outcome.summary.targetKey !== undefined
          ? { targetKey: outcome.summary.targetKey }
          : {}),
        ...(outcome.summary.targetUrl !== undefined
          ? { targetUrl: outcome.summary.targetUrl }
          : {}),
      })
      input.emit({
        type: 'tool-status',
        toolCallRecordId: recordId,
        toolName: definition.name,
        phase: 'done',
        detail: resultForUser,
      })
      return {
        resultForModel: formatToolResultForModel(outcome.summary),
        wasWrite: true,
        fatal: false,
      }
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
          terminalText:
            'Mình chưa thể xác nhận thao tác đã hoàn tất hay chưa. Để tránh tạo hoặc cập nhật trùng, hãy bấm “Kiểm tra kết quả” trước khi thử lại.',
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
  /**
   * Khối `tools` cho một vòng (ADR 0009).
   *
   * Lọc chạy SAU `availableTools()` — tức sau feature flag và sau "server có công bố tool này
   * không". Preset chỉ thu hẹp cái model THẤY, không bao giờ nới cái được phép CHẠY.
   *
   * Sort theo tên là bắt buộc, không phải cho đẹp: khối `tools` nằm ở đầu request nên nó là
   * prefix của prompt, và prompt cache chỉ dùng lại được khi prefix giống nhau từng byte. Thứ tự
   * registry vốn đã ổn định, nhưng đó là hệ quả tình cờ của thứ tự bốn hàm `build*Tools()` —
   * sort tường minh biến nó thành thứ được test khẳng định. Áp dụng cho cả nhánh cờ tắt.
   */
  private buildToolSpecs(preset: ToolPreset, includeExpandTool: boolean): ChatToolSpec[] {
    const mcp = this.deps.mcp
    const mcpReady = mcp !== null && mcp.isReady

    const allowedFlags = new Set<string>(TOOL_PRESET_FLAGS[preset])
    const specs: ChatToolSpec[] = !mcpReady
      ? []
      : mcp
          .availableTools()
          .filter((definition) => allowedFlags.has(definition.requiredFeature))
          .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
          .map((definition) => ({
            type: 'function' as const,
            function: {
              name: definition.name,
              description: definition.description,
              parameters: definition.jsonSchema,
            },
          }))

    // Không có tool nào thì không có gì để mở rộng — thêm tool meta chỉ gây nhiễu.
    if (includeExpandTool && specs.length > 0) specs.push(EXPAND_TOOLS_SPEC)

    // Tool cục bộ đứng NGOÀI preset: preset phân hoạch 98 tool Atlassian theo feature flag, còn
    // tool cục bộ không thuộc cờ nào. Thu hẹp chúng theo preset sẽ khiến model không đề xuất
    // được cam kết chỉ vì câu hỏi trông giống việc Jira. Chúng cũng không phụ thuộc MCP, nên vẫn
    // có mặt khi chưa cấu hình Atlassian.
    //
    // Sort riêng rồi nối vào cuối, giữ khối `tools` ổn định từng byte cho prompt cache.
    const localSpecs = (this.deps.localTools?.list() ?? [])
      .slice()
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map((definition) => ({
        type: 'function' as const,
        function: {
          name: definition.name,
          description: definition.description,
          parameters: definition.jsonSchema,
        },
      }))

    return [...specs, ...localSpecs]
  }

  /**
   * Tool result cho lời gọi mở rộng: tên + mô tả rút gọn của mọi tool ĐANG khả dụng.
   *
   * Rút gọn mô tả có chủ ý — mục đích là để model biết tool nào TỒN TẠI; schema đầy đủ đã nằm
   * trong khối `tools` của vòng sau.
   */
  private buildCatalogListing(): string {
    const mcp = this.deps.mcp
    const available = mcp === null || !mcp.isReady ? [] : mcp.availableTools()
    if (available.length === 0) {
      return 'Hiện không có công cụ nào khả dụng. Hãy trả lời bằng thông tin đã có, hoặc nói rõ với người dùng là chưa kết nối được Jira/Confluence.'
    }

    const lines = available
      .slice()
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map((d) => `- ${d.name}: ${shortenDescription(d.description)}`)

    return `Danh mục đầy đủ gồm ${String(lines.length)} công cụ khả dụng. Từ vòng này bạn gọi được mọi công cụ trong danh sách:\n${lines.join('\n')}`
  }
}

/**
 * Tri thức nghiệp vụ KHÔNG rời khỏi tổ chức — không có ngoại lệ per-item.
 *
 * Khác memory ở đúng chỗ này: memory có `sharing_policy` để người dùng tự quyết, vì đó là
 * preference cá nhân. Tri thức nghiệp vụ là tài sản tổ chức, nên câu trả lời cho provider ngoài
 * luôn là mảng rỗng (D6). Đây là lớp lọc thứ hai; repository đã không trả dữ liệu cho lượt như
 * vậy ngay từ đầu.
 */
export function selectBaKnowledgeForProvider(
  items: readonly BaKnowledgeContextItem[],
  provider: LlmProvider,
): readonly BaKnowledgeContextItem[] {
  return isExternalProvider(provider) ? [] : items
}

export function selectMemoryForProvider(
  facts: readonly RuntimeMemoryFact[],
  provider: LlmProvider,
): readonly RuntimeMemoryFact[] {
  if (!isExternalProvider(provider)) return facts
  return facts.filter((fact) => fact.sharingPolicy === 'allow_external')
}

function formatToolResultForModel(summary: ToolResultSummary): string {
  if (summary.incomplete !== true) return summary.forModel

  return [
    '[KẾT QUẢ CÔNG CỤ CHƯA ĐẦY ĐỦ]',
    summary.completenessNote ?? 'Một phần kết quả chưa được đưa vào ngữ cảnh.',
    'Không được trình bày dữ liệu bên dưới như kết quả đầy đủ. Nếu câu hỏi cần phần còn thiếu, hãy gọi công cụ với phạm vi hẹp hơn hoặc nói rõ giới hạn với người dùng.',
    '',
    summary.forModel,
  ].join('\n')
}

function formatToolResultForUser(summary: ToolResultSummary): string {
  return summary.incomplete === true ? `${summary.forUser} · kết quả chưa đầy đủ` : summary.forUser
}

function formatTerminalError(error: NexaError): string {
  return `Mình chưa thể hoàn tất yêu cầu này. ${error.message}${
    error.hint === undefined ? '' : ` ${error.hint}`
  }`
}

/**
 * Tool meta cho phép model tự xin danh mục đầy đủ khi preset hẹp không đủ (ADR 0009).
 *
 * Mô tả viết ở thể mệnh lệnh vì rủi ro lớn nhất của cả cơ chế là model KHÔNG gọi nó mà chỉ trả
 * lời "tôi không có công cụ phù hợp" — biến một câu hỏi làm được thành một lời từ chối âm thầm.
 */
const EXPAND_TOOLS_SPEC: ChatToolSpec = {
  type: 'function',
  function: {
    name: EXPAND_TOOLS_TOOL_NAME,
    description:
      'Lấy danh mục đầy đủ các công cụ khả dụng. Danh sách công cụ bạn đang thấy đã được thu hẹp theo câu hỏi, nên có thể thiếu công cụ bạn cần. Hãy gọi hàm này NGAY khi không thấy công cụ phù hợp — đừng nói với người dùng là không làm được, và đừng giải thích gì trước khi gọi.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
}

/** Một dòng, tối đa 120 ký tự — đủ để model nhận ra tool, không đủ để tốn token. */
function shortenDescription(description: string): string {
  const firstLine = description.split('\n')[0]?.trim() ?? ''
  return firstLine.length <= 120 ? firstLine : `${firstLine.slice(0, 117)}...`
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
