import type { BrowserWindow } from 'electron'
import {
  ERROR_CODES,
  NEXA_EVENTS,
  NexaError,
  isExternalProvider,
  type ChatDeltaEvent,
  type ChatDoneEvent,
  type ChatErrorEvent,
  type ChatSendInput,
  type ConfirmationRequest,
  type LlmProvider,
  type ToolStatusEvent,
} from '@nexa/shared-types'
import { newRequestId, type Logger } from '@nexa/observability'
import { AUDIT_EVENTS } from '@nexa/local-store'
import {
  AgentRuntime,
  MAX_BA_KNOWLEDGE_IN_CONTEXT,
  MAX_COMMITMENTS_IN_CONTEXT,
  type ApprovalDecision,
  type ToolCallSink,
} from '@nexa/agent-runtime'
import type { ProcessedDocument } from '@nexa/document-processor'
import type { NexaServices } from './services.js'
import { createCommitmentToolRegistry } from './commitment-tools.js'
import { composeLocalToolRegistries, createBaToolRegistry } from './ba-tools.js'

interface InFlight {
  readonly controller: AbortController
  readonly conversationId: string
}

interface PendingConfirmation {
  resolve(decision: ApprovalDecision): void
  readonly timer: NodeJS.Timeout
  readonly requestId: string
  readonly toolName: string
}

interface ToolCallActivityMeta {
  readonly toolName: string
  readonly operationId?: string
  readonly requestId: string
}

/**
 * Điều phối một lượt chat (§7.1, §7.2, §7.4).
 *
 * Controller này là chỗ duy nhất biết cả ba thứ: hội thoại trong DB, AgentRuntime, và cửa sổ
 * renderer. Nó giữ AgentRuntime hoàn toàn không biết gì về SQLite hay IPC.
 */
export class ChatController {
  private readonly inFlight = new Map<string, InFlight>()
  private readonly pendingConfirmations = new Map<string, PendingConfirmation>()
  private readonly toolCallActivity = new Map<string, ToolCallActivityMeta>()
  private readonly log: Logger
  private activeConversationId: string | null = null

  constructor(
    private readonly services: NexaServices,
    private readonly getWindow: () => BrowserWindow | null,
  ) {
    this.log = services.logger.child({ module: 'chat-controller' })
  }

  /**
   * §7.1 / §7.2 — gửi một tin nhắn.
   *
   * Trả về ngay `requestId` để renderer có thể hiển thị trạng thái và bấm Huỷ; phần còn lại
   * chạy nền và đẩy sự kiện.
   */
  async send(input: ChatSendInput): Promise<{ requestId: string; messageId: string }> {
    const requestId = newRequestId()
    if (this.activeConversationId !== null) {
      throw new NexaError(ERROR_CODES.OPERATION_ALREADY_RUNNING, {
        requestId,
        safeDetail: 'another chat turn is active',
      })
    }
    this.activeConversationId = input.conversationId
    let backgroundStarted = false

    try {
      const conversation = this.services.conversations.get(input.conversationId)
      if (conversation === null) {
        throw new NexaError(ERROR_CODES.VALIDATION_FAILED, {
          requestId,
          safeDetail: 'unknown conversation',
        })
      }

      // Người dùng đổi model ở dropdown thì `input` mang cả model id và provider; nếu không,
      // dùng model đang gán cho hội thoại.
      const selectedProvider = input.modelProvider ?? conversation.modelProvider
      const selectedModelId = input.modelId ?? conversation.modelId
      const model =
        selectedProvider === 'chatgpt'
          ? await this.resolveChatGptModel(selectedModelId)
          : this.services.models.resolveForConversation(selectedModelId, selectedProvider)
      if (conversation.modelId !== model.modelId || conversation.modelProvider !== model.provider) {
        this.services.conversations.setModel(conversation.id, {
          modelId: model.modelId,
          provider: model.provider,
        })
      }

      if (model.provider === 'chatgpt' && input.fileTokens.length > 0) {
        this.services.files.releaseAll(input.fileTokens)
        throw new NexaError(ERROR_CODES.EXTERNAL_MODEL_NOT_ALLOWED_FOR_DOCUMENTS, {
          requestId,
          safeDetail: 'managed ChatGPT text chat does not accept attachments',
        })
      }

      const chatGptHistory =
        model.provider === 'chatgpt'
          ? this.services.conversations
              .listMessages(conversation.id, 200)
              .filter(
                (message) =>
                  (message.role === 'user' || message.role === 'assistant') &&
                  message.status === 'complete' &&
                  message.deletedAt === undefined &&
                  message.content !== '',
              )
              .map((message) => ({
                role: message.role as 'user' | 'assistant',
                content: message.content,
              }))
          : []

      // §7.2 bước 1–3: đọc và trích xuất file TRƯỚC khi ghi message, để nếu file hỏng thì
      // hội thoại không bị dính một tin nhắn cụt.
      const documents = await this.extractDocuments(input.fileTokens, requestId)

      const settings = this.services.settings.get()
      const userMessage = this.services.conversations.appendMessage({
        conversationId: conversation.id,
        role: 'user',
        content: input.content,
        status: 'complete',
        requestId,
      })

      for (const doc of documents) {
        this.services.conversations.addAttachment({
          messageId: userMessage.id,
          fileName: doc.fileName,
          fileType: doc.kind,
          fileSize: doc.sizeBytes,
          sourcePathHash: doc.sourcePathHash,
          // §8.3: chỉ lưu text đã trích xuất nếu chính sách cho phép. Ảnh không có text, và
          // KHÔNG bao giờ lưu bản sao ảnh — §8.1 cấm giữ bản sao file, base64 cũng là bản sao.
          extractedText:
            settings.features.storeExtractedText && doc.text !== '' ? doc.text : null,
          extractedChars: doc.charCount,
          ...(doc.pageCount !== undefined ? { pageCount: doc.pageCount } : {}),
          ...(doc.suspectedScan === true ? { suspectedScan: true } : {}),
        })
      }

      const assistantMessage = this.services.conversations.appendMessage({
        conversationId: conversation.id,
        role: 'assistant',
        content: '',
        status: 'streaming',
        requestId,
      })

      this.services.audit.record({
        profileId: this.services.profileId,
        eventType: AUDIT_EVENTS.chatRequested,
        status: 'pending',
        requestId,
      })

      const controller = new AbortController()
      this.inFlight.set(requestId, { controller, conversationId: conversation.id })

      if (model.provider === 'chatgpt') {
        void this.runChatGptTurn({
          requestId,
          conversationId: conversation.id,
          assistantMessageId: assistantMessage.id,
          modelId: model.modelId,
          reasoningEffort: input.reasoningEffort ?? model.defaultReasoningEffort ?? undefined,
          prompt: input.content,
          history: chatGptHistory,
          controller,
        })
      } else {
        void this.runTurn({
          requestId,
          conversationId: conversation.id,
          assistantMessageId: assistantMessage.id,
          modelId: model.modelId,
          modelProvider: model.provider,
          contextWindowTokens: model.contextWindowTokens,
          modelSupportsVision: model.supportsVision,
          documents,
          controller,
          fileTokens: input.fileTokens,
        })
      }
      backgroundStarted = true

      return { requestId, messageId: assistantMessage.id }
    } finally {
      if (!backgroundStarted) this.activeConversationId = null
    }
  }

  /** §9.3 "hỗ trợ cancel từ UI". */
  cancel(requestId: string): void {
    const entry = this.inFlight.get(requestId)
    if (entry === undefined) return
    entry.controller.abort(new NexaError(ERROR_CODES.LLM_CANCELLED, { requestId }))
    this.services.audit.record({
      profileId: this.services.profileId,
      eventType: AUDIT_EVENTS.chatCancelled,
      status: 'cancelled',
      requestId,
    })
  }

  /** Không cho xoá hội thoại trong lúc lượt chat/tool của nó vẫn có thể tạo side effect. */
  isConversationActive(conversationId: string): boolean {
    return this.activeConversationId === conversationId
  }

  /** Renderer báo người dùng đã bấm Xác nhận. */
  approve(operationId: string, payloadHash: string): void {
    this.services.guard.approve(operationId, payloadHash)
    this.services.audit.record({
      profileId: this.services.profileId,
      eventType: AUDIT_EVENTS.toolApproved,
      status: 'ok',
      operationId,
    })
    const pending = this.pendingConfirmations.get(operationId)
    if (pending !== undefined) {
      this.recordActivity({
        profileId: this.services.profileId,
        type: 'confirmation',
        action: 'approved',
        status: 'success',
        subjectType: 'tool',
        subjectId: pending.toolName,
        requestId: pending.requestId,
        operationId,
      })
    }
    this.settleConfirmation(operationId, 'approved')
  }

  /** Renderer báo người dùng đã bấm Huỷ. */
  cancelTool(operationId: string): void {
    this.services.guard.cancel(operationId)
    this.services.audit.record({
      profileId: this.services.profileId,
      eventType: AUDIT_EVENTS.toolCancelled,
      status: 'cancelled',
      operationId,
    })
    const pending = this.pendingConfirmations.get(operationId)
    if (pending !== undefined) {
      this.recordActivity({
        profileId: this.services.profileId,
        type: 'confirmation',
        action: 'cancelled',
        status: 'cancelled',
        subjectType: 'tool',
        subjectId: pending.toolName,
        requestId: pending.requestId,
        operationId,
      })
    }
    this.settleConfirmation(operationId, 'cancelled')
  }

  /** Dọn khi cửa sổ đóng: mọi thứ đang chờ phải được giải phóng. */
  shutdown(): void {
    for (const [, entry] of this.inFlight) entry.controller.abort()
    this.inFlight.clear()
    for (const [operationId] of this.pendingConfirmations) {
      this.services.guard.cancel(operationId)
      this.settleConfirmation(operationId, 'cancelled')
    }
  }

  // ── Nội bộ ──────────────────────────────────────────────────────────────

  private async resolveChatGptModel(modelId: string | null): Promise<{
    readonly provider: 'chatgpt'
    readonly modelId: string
    readonly defaultReasoningEffort: string | null
  }> {
    if (!this.services.policy.allowDirectOpenAi) {
      throw new NexaError(ERROR_CODES.PROVIDER_DISABLED_BY_POLICY, {
        safeDetail: 'managed ChatGPT chat is disabled by organisation policy',
      })
    }
    if (modelId === null) throw new NexaError(ERROR_CODES.CHATGPT_MODEL_UNAVAILABLE)
    const model = await this.services.chatgpt.resolveModel(modelId)
    return {
      provider: 'chatgpt',
      modelId: model.modelId,
      defaultReasoningEffort: model.defaultReasoningEffort,
    }
  }

  private async extractDocuments(
    fileTokens: readonly string[],
    requestId: string,
  ): Promise<ProcessedDocument[]> {
    if (fileTokens.length === 0) return []
    try {
      const descriptors = this.services.files.resolve(fileTokens)
      const documents = await this.services.documents.process(descriptors)
      this.services.audit.record({
        profileId: this.services.profileId,
        eventType: AUDIT_EVENTS.documentAttached,
        status: 'ok',
        requestId,
      })
      return documents
    } finally {
      // §14.1: giải phóng handle ngay sau khi xử lý, dù thành công hay không.
      this.services.files.releaseAll(fileTokens)
    }
  }

  private async runChatGptTurn(params: {
    requestId: string
    conversationId: string
    assistantMessageId: string
    modelId: string
    reasoningEffort?: string
    prompt: string
    history: readonly { role: 'user' | 'assistant'; content: string }[]
    controller: AbortController
  }): Promise<void> {
    const { requestId, conversationId, assistantMessageId } = params
    let text = ''
    try {
      await this.services.chatgpt.runTurn({
        modelId: params.modelId,
        ...(params.reasoningEffort === undefined
          ? {}
          : { reasoningEffort: params.reasoningEffort }),
        prompt: params.prompt,
        history: params.history,
        signal: params.controller.signal,
        onDelta: (delta) => {
          text += delta
          this.emit<ChatDeltaEvent>(NEXA_EVENTS.chatDelta, {
            requestId,
            conversationId,
            messageId: assistantMessageId,
            delta,
          })
        },
      })
      if (text.trim() === '') {
        throw new NexaError(ERROR_CODES.CHATGPT_TURN_FAILED, {
          safeDetail: 'managed ChatGPT turn completed without an agent message',
        })
      }

      this.services.conversations.finalizeMessage(assistantMessageId, text, 'complete')
      this.services.audit.record({
        profileId: this.services.profileId,
        eventType: AUDIT_EVENTS.chatCompleted,
        status: 'ok',
        requestId,
      })
      this.emit<ChatDoneEvent>(NEXA_EVENTS.chatDone, {
        requestId,
        conversationId,
        messageId: assistantMessageId,
        truncatedContextCount: 0,
      })
    } catch (error) {
      const nexa = NexaError.wrap(error, ERROR_CODES.CHATGPT_TURN_FAILED)
      const cancelled = nexa.code === ERROR_CODES.LLM_CANCELLED
      const persistedText =
        text.trim() !== ''
          ? text
          : cancelled
            ? 'Đã dừng theo yêu cầu.'
            : `Mình chưa thể hoàn tất yêu cầu này. ${nexa.message}${
                nexa.hint === undefined ? '' : ` ${nexa.hint}`
              }`

      this.services.conversations.finalizeMessage(
        assistantMessageId,
        persistedText,
        cancelled ? 'cancelled' : 'error',
        { errorCode: nexa.code },
      )
      this.services.audit.record({
        profileId: this.services.profileId,
        eventType: AUDIT_EVENTS.chatCompleted,
        status: cancelled ? 'cancelled' : 'error',
        requestId,
        errorCode: nexa.code,
      })
      this.log.warn('chatgpt-turn-failed', { requestId, errorCode: nexa.code })
      this.emit<ChatErrorEvent>(NEXA_EVENTS.chatError, {
        request_id: requestId,
        conversationId,
        messageId: assistantMessageId,
        error: {
          code: nexa.code,
          message: nexa.message,
          retryable: nexa.retryable,
          ...(nexa.hint === undefined ? {} : { hint: nexa.hint }),
        },
      })
    } finally {
      this.inFlight.delete(requestId)
      this.activeConversationId = null
    }
  }

  private async runTurn(params: {
    requestId: string
    conversationId: string
    assistantMessageId: string
    modelId: string
    modelProvider: LlmProvider
    contextWindowTokens: number
    modelSupportsVision: boolean
    documents: readonly ProcessedDocument[]
    controller: AbortController
    fileTokens: readonly string[]
  }): Promise<void> {
    const { requestId, conversationId, assistantMessageId } = params
    let text = ''

    const sink: ToolCallSink = {
      begin: (info) => {
        const record = this.services.conversations.recordToolCall({
          messageId: assistantMessageId,
          ...info,
        })
        this.toolCallActivity.set(record.id, {
          toolName: info.toolName,
          operationId: info.operationId,
          requestId,
        })
        if (info.preview !== undefined) {
          this.recordActivity({
            profileId: this.services.profileId,
            type: 'tool_preview',
            action: 'created',
            status: 'pending',
            subjectType: 'tool',
            subjectId: info.toolName,
            requestId,
            ...(info.operationId !== undefined ? { operationId: info.operationId } : {}),
          })
        }
        return record.id
      },
      update: (recordId, patch) => {
        this.services.conversations.updateToolCall(recordId, patch)
        const meta = this.toolCallActivity.get(recordId)
        if (meta === undefined || patch.operationStatus === undefined) return
        if (
          patch.operationStatus === 'failed' &&
          (patch.approvalStatus === 'cancelled' || patch.approvalStatus === 'expired')
        ) {
          return
        }
        if (patch.operationStatus === 'success') {
          this.recordActivity({
            profileId: this.services.profileId,
            type: 'tool_result',
            action: 'completed',
            status: 'success',
            subjectType: 'tool',
            subjectId: meta.toolName,
            requestId: meta.requestId,
            ...(meta.operationId !== undefined ? { operationId: meta.operationId } : {}),
          })
          return
        }
        if (patch.operationStatus === 'failed') {
          this.recordActivity({
            profileId: this.services.profileId,
            type: 'tool_result',
            action: 'failed',
            status: 'failed',
            subjectType: 'tool',
            subjectId: meta.toolName,
            requestId: meta.requestId,
            ...(meta.operationId !== undefined ? { operationId: meta.operationId } : {}),
          })
          return
        }
        if (patch.operationStatus === 'uncertain') {
          this.recordActivity({
            profileId: this.services.profileId,
            type: 'uncertain_operation',
            action: 'became_uncertain',
            status: 'uncertain',
            subjectType: 'tool',
            subjectId: meta.toolName,
            requestId: meta.requestId,
            ...(meta.operationId !== undefined ? { operationId: meta.operationId } : {}),
          })
        }
      },
    }

    try {
      const runtime = new AgentRuntime({
        llm: this.services.connections.buildLlmClient(
          params.modelProvider,
          this.services.settings.get().llmTimeoutMs,
        ),
        mcp: this.services.mcp,
        guard: this.services.guard,
        tracker: this.services.tracker,
        logger: this.services.logger,
        settings: () => this.services.settings.get(),
        actingAccount: () => this.services.connections.get('jira')?.username ?? 'unknown',
        jiraBaseUrl: () => this.services.connections.get('jira')?.baseUrl ?? '',
        confluenceBaseUrl: () => this.services.connections.get('confluence')?.baseUrl ?? '',
        requestConfirmation: (request) => this.askUser(request, requestId),
        // Dựng theo từng lượt để hội thoại nguồn được gắn cứng vào cam kết agent đề xuất.
        // Setting tắt ⇒ null ⇒ tool không xuất hiện trong khối `tools`, model không đề xuất được.
        // Hai registry, hai cờ độc lập, ghép thành một danh sách đóng. Cờ nào tắt thì nhóm tool
        // của nó không có trong khối `tools`, nên model không đề xuất được.
        //
        // Tập prefix `tools` khả dĩ vì thế vẫn hữu hạn và biết trước (ADR 0009): 6 preset nhân
        // với các tổ hợp bật/tắt của hai cờ. Thêm tool BA vào tập CỐ ĐỊNH thì được; chọn tool BA
        // theo ngữ cảnh câu hỏi thì không.
        localTools: composeLocalToolRegistries([
          this.services.settings.get().agentCommitmentToolsEnabled
            ? createCommitmentToolRegistry({
                profileId: this.services.profileId,
                conversationId,
                commitments: this.services.commitments,
                activity: this.services.activity,
                logger: this.services.logger,
              })
            : null,
          this.services.settings.get().features.baWorkbench
            ? createBaToolRegistry({
                profileId: this.services.profileId,
                knowledge: this.services.baKnowledge,
                documents: this.services.baDocuments,
                templates: this.services.baStandards.templates,
                // Tool chat gọi ĐÚNG job mà màn hình Nghiệp vụ gọi. Không có đường trích xuất
                // thứ hai với hành vi thứ hai (D4).
                extract: async (documentId, sourceText) => {
                  const result = await this.services.baExtraction.run(documentId, sourceText)
                  return {
                    itemCount: result.model.items.length,
                    needsReviewCount: result.needsReviewCount,
                    cached: result.cached,
                  }
                },
                // Cùng nguyên tắc: một đường chạy bộ luật duy nhất, dùng chung với màn hình.
                review: (documentId) => this.services.baReview.run(documentId),
                logger: this.services.logger,
              })
            : null,
        ]),
      })

      // Nạp lịch sử SAU khi user message đã ghi, để lượt hiện tại nằm trong context.
      const history = this.services.conversations
        .loadForContext(conversationId)
        // Bỏ message assistant rỗng vừa tạo làm chỗ giữ chỗ.
        .filter((m) => m.content !== '')

      // Memory được chọn trong main process để renderer không thể tự gắn fact của profile khác.
      // Repository lọc scope/expiry/chính sách chia sẻ; runtime lọc lại theo provider như một
      // lớp phòng thủ thứ hai trước khi dựng prompt.
      const memoryFacts = this.services.memory
        .listForContext(this.services.profileId, {
          conversationId,
          externalProvider: isExternalProvider(params.modelProvider),
        })
        .map((fact) => ({
          content: fact.content,
          kind: fact.kind,
          sharingPolicy: fact.sharingPolicy,
        }))

      // Cam kết được chọn ở main process, cùng lý do với memory: renderer không được tự gắn dữ
      // liệu của profile khác. Provider ngoài áp cùng cổng chia sẻ như memory — nội dung cam kết
      // là kế hoạch nội bộ, không mặc nhiên được rời máy.
      const commitmentContext =
        this.services.settings.get().commitmentContextEnabled &&
        !isExternalProvider(params.modelProvider)
          ? this.services.commitments
              .listForContext(this.services.profileId, {
                limit: MAX_COMMITMENTS_IN_CONTEXT,
                nowIso: new Date().toISOString(),
              })
              .map((commitment) => ({
                title: commitment.title,
                nextAction: commitment.nextAction,
                status: commitment.status === 'blocked' ? ('blocked' as const) : ('active' as const),
                dueAt: commitment.dueAt,
                checkInAt: commitment.checkInAt,
              }))
          : []

      // Tri thức nghiệp vụ: chỉ nạp khi cờ BA bật VÀ provider nằm trong tổ chức. Không có
      // ngoại lệ per-item như memory — xem `selectBaKnowledgeForProvider`.
      const baKnowledgeItems =
        this.services.settings.get().features.baWorkbench &&
        !isExternalProvider(params.modelProvider)
          ? this.services.baKnowledge.listForContext(
              this.services.profileId,
              MAX_BA_KNOWLEDGE_IN_CONTEXT,
            )
          : []
      // Đếm lượt dùng ngay khi item được đưa vào context — đây là nguồn của thống kê "tri thức
      // chết" trong màn hình Nghiệp vụ.
      if (baKnowledgeItems.length > 0) {
        this.services.baKnowledge.recordUsage(baKnowledgeItems.map((item) => item.id))
      }
      const baKnowledge = baKnowledgeItems.map((item) => ({
        title: item.title,
        body: item.body,
        category: item.category,
      }))

      const result = await runtime.runTurn({
        requestId,
        conversationId,
        modelId: params.modelId,
        modelProvider: params.modelProvider,
        contextWindowTokens: params.contextWindowTokens,
        modelSupportsVision: params.modelSupportsVision,
        history,
        ...(memoryFacts.length > 0 ? { memoryFacts } : {}),
        ...(commitmentContext.length > 0 ? { commitments: commitmentContext } : {}),
        ...(baKnowledge.length > 0 ? { baKnowledge } : {}),
        ...(params.documents.length > 0 ? { documents: params.documents } : {}),
        signal: params.controller.signal,
        toolCalls: sink,
        emit: (event) => {
          switch (event.type) {
            case 'text-delta':
              text += event.delta
              this.emit<ChatDeltaEvent>(NEXA_EVENTS.chatDelta, {
                requestId,
                conversationId,
                messageId: assistantMessageId,
                delta: event.delta,
              })
              break
            case 'tool-status':
              this.emit<ToolStatusEvent>(NEXA_EVENTS.toolStatus, {
                requestId,
                conversationId,
                toolCallId: event.toolCallRecordId,
                toolName: event.toolName,
                phase: event.phase,
                ...(event.detail !== undefined ? { detail: event.detail } : {}),
              })
              break
            case 'context-truncated':
              break
          }
        },
      })

      this.services.conversations.finalizeMessage(
        assistantMessageId,
        result.text === '' ? text : result.text,
        'complete',
        { truncatedContextCount: result.truncatedContextCount },
      )
      this.services.audit.record({
        profileId: this.services.profileId,
        eventType: AUDIT_EVENTS.chatCompleted,
        status: 'ok',
        requestId,
      })

      this.emit<ChatDoneEvent>(NEXA_EVENTS.chatDone, {
        requestId,
        conversationId,
        messageId: assistantMessageId,
        ...(result.usage !== undefined ? { usage: result.usage } : {}),
        truncatedContextCount: result.truncatedContextCount,
      })
    } catch (error) {
      const nexa = NexaError.wrap(error)
      const cancelled = nexa.code === ERROR_CODES.LLM_CANCELLED
      const persistedText =
        text.trim() !== ''
          ? text
          : cancelled
            ? 'Đã dừng theo yêu cầu.'
            : `Mình chưa thể hoàn tất yêu cầu này. ${nexa.message}${
                nexa.hint === undefined ? '' : ` ${nexa.hint}`
              }`

      // Giữ lại phần text đã stream: người dùng đã đọc nó, xoá đi là mất thông tin.
      this.services.conversations.finalizeMessage(
        assistantMessageId,
        persistedText,
        cancelled ? 'cancelled' : 'error',
        { errorCode: nexa.code },
      )
      this.services.audit.record({
        profileId: this.services.profileId,
        eventType: AUDIT_EVENTS.chatCompleted,
        status: cancelled ? 'cancelled' : 'error',
        requestId,
        errorCode: nexa.code,
      })

      this.log.warn('chat-turn-failed', { requestId, errorCode: nexa.code })
      this.emit<ChatErrorEvent>(NEXA_EVENTS.chatError, {
        request_id: requestId,
        conversationId,
        messageId: assistantMessageId,
        error: {
          code: nexa.code,
          message: nexa.message,
          retryable: nexa.retryable,
          ...(nexa.hint !== undefined ? { hint: nexa.hint } : {}),
        },
      })
    } finally {
      this.inFlight.delete(requestId)
      for (const [recordId, meta] of this.toolCallActivity) {
        if (meta.requestId === requestId) this.toolCallActivity.delete(recordId)
      }
      this.activeConversationId = null
    }
  }

  /**
   * Đẩy yêu cầu xác nhận lên UI và chờ.
   *
   * Có timeout riêng dài hơn TTL của approval một chút: nếu renderer chết hoặc người dùng bỏ đi,
   * lời hứa này phải được giải phóng, nếu không cả lượt chat treo vĩnh viễn.
   */
  private askUser(request: ConfirmationRequest, requestId: string): Promise<ApprovalDecision> {
    return new Promise<ApprovalDecision>((resolve) => {
      const ttlMs = new Date(request.expiresAt).getTime() - Date.now()
      const timer = setTimeout(
        () => {
          this.pendingConfirmations.delete(request.operationId)
          this.services.guard.cancel(request.operationId)
          this.recordActivity({
            profileId: this.services.profileId,
            type: 'confirmation',
            action: 'expired',
            status: 'cancelled',
            subjectType: 'tool',
            subjectId: request.preview.toolName,
            requestId,
            operationId: request.operationId,
          })
          resolve('cancelled')
        },
        Math.max(5_000, ttlMs + 5_000),
      )

      this.pendingConfirmations.set(request.operationId, {
        resolve,
        timer,
        requestId,
        toolName: request.preview.toolName,
      })
      this.recordActivity({
        profileId: this.services.profileId,
        type: 'confirmation',
        action: 'requested',
        status: 'pending',
        subjectType: 'tool',
        subjectId: request.preview.toolName,
        requestId,
        operationId: request.operationId,
      })
      this.emit(NEXA_EVENTS.toolConfirmation, request)
    })
  }

  private settleConfirmation(operationId: string, decision: ApprovalDecision): void {
    const pending = this.pendingConfirmations.get(operationId)
    if (pending === undefined) return
    clearTimeout(pending.timer)
    this.pendingConfirmations.delete(operationId)
    pending.resolve(decision)
  }

  private recordActivity(input: Parameters<NexaServices['activity']['record']>[0]): void {
    this.services.activity.record(input)
  }

  private emit<T>(channel: string, payload: T): void {
    const window = this.getWindow()
    if (window === null || window.isDestroyed()) return
    window.webContents.send(channel, payload)
  }
}
