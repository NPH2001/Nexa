import type { BrowserWindow } from 'electron'
import {
  ERROR_CODES,
  NEXA_EVENTS,
  NexaError,
  type ChatDeltaEvent,
  type ChatDoneEvent,
  type ChatSendInput,
  type ConfirmationRequest,
  type ToolStatusEvent,
} from '@nexa/shared-types'
import { newRequestId, type Logger } from '@nexa/observability'
import { AUDIT_EVENTS } from '@nexa/local-store'
import { AgentRuntime, type ApprovalDecision, type ToolCallSink } from '@nexa/agent-runtime'
import type { ProcessedDocument } from '@nexa/document-processor'
import type { NexaServices } from './services.js'

interface InFlight {
  readonly controller: AbortController
  readonly conversationId: string
}

interface PendingConfirmation {
  resolve(decision: ApprovalDecision): void
  readonly timer: NodeJS.Timeout
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
  private readonly log: Logger

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
    const conversation = this.services.conversations.get(input.conversationId)
    if (conversation === null) {
      throw new NexaError(ERROR_CODES.VALIDATION_FAILED, {
        requestId,
        safeDetail: 'unknown conversation',
      })
    }

    const model = this.services.models.resolveForConversation(
      input.modelId ?? conversation.modelId,
    )
    if (conversation.modelId !== model.modelId) {
      this.services.conversations.setModel(conversation.id, model.modelId)
    }

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
        // §8.3: chỉ lưu text đã trích xuất nếu chính sách cho phép.
        extractedText: settings.features.storeExtractedText ? doc.text : null,
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

    void this.runTurn({
      requestId,
      conversationId: conversation.id,
      assistantMessageId: assistantMessage.id,
      modelId: model.modelId,
      contextWindowTokens: model.contextWindowTokens,
      documents,
      controller,
      fileTokens: input.fileTokens,
    })

    return { requestId, messageId: assistantMessage.id }
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

  /** Renderer báo người dùng đã bấm Xác nhận. */
  approve(operationId: string, payloadHash: string): void {
    this.services.guard.approve(operationId, payloadHash)
    this.services.audit.record({
      profileId: this.services.profileId,
      eventType: AUDIT_EVENTS.toolApproved,
      status: 'ok',
      operationId,
    })
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
    this.settleConfirmation(operationId, 'cancelled')
  }

  /** Dọn khi cửa sổ đóng: mọi thứ đang chờ phải được giải phóng. */
  shutdown(): void {
    for (const [, entry] of this.inFlight) entry.controller.abort()
    this.inFlight.clear()
    for (const [operationId] of this.pendingConfirmations) {
      this.settleConfirmation(operationId, 'cancelled')
    }
  }

  // ── Nội bộ ──────────────────────────────────────────────────────────────

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

  private async runTurn(params: {
    requestId: string
    conversationId: string
    assistantMessageId: string
    modelId: string
    contextWindowTokens: number
    documents: readonly ProcessedDocument[]
    controller: AbortController
    fileTokens: readonly string[]
  }): Promise<void> {
    const { requestId, conversationId, assistantMessageId } = params
    let text = ''

    const sink: ToolCallSink = {
      begin: (info) =>
        this.services.conversations.recordToolCall({
          messageId: assistantMessageId,
          ...info,
        }).id,
      update: (recordId, patch) => this.services.conversations.updateToolCall(recordId, patch),
    }

    try {
      const runtime = new AgentRuntime({
        llm: this.services.connections.buildLiteLlmClient(this.services.settings.get().llmTimeoutMs),
        mcp: this.services.mcp,
        guard: this.services.guard,
        tracker: this.services.tracker,
        logger: this.services.logger,
        settings: () => this.services.settings.get(),
        actingAccount: () => this.services.connections.get('jira')?.username ?? 'unknown',
        jiraBaseUrl: () => this.services.connections.get('jira')?.baseUrl ?? '',
        confluenceBaseUrl: () => this.services.connections.get('confluence')?.baseUrl ?? '',
        requestConfirmation: (request) => this.askUser(request),
      })

      // Nạp lịch sử SAU khi user message đã ghi, để lượt hiện tại nằm trong context.
      const history = this.services.conversations
        .loadForContext(conversationId)
        // Bỏ message assistant rỗng vừa tạo làm chỗ giữ chỗ.
        .filter((m) => m.content !== '')

      const result = await runtime.runTurn({
        requestId,
        conversationId,
        modelId: params.modelId,
        contextWindowTokens: params.contextWindowTokens,
        history,
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

      // Giữ lại phần text đã stream: người dùng đã đọc nó, xoá đi là mất thông tin.
      this.services.conversations.finalizeMessage(
        assistantMessageId,
        text,
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
      this.emit(NEXA_EVENTS.chatError, {
        request_id: requestId,
        conversationId,
        messageId: assistantMessageId,
        error: { code: nexa.code, message: nexa.message, retryable: nexa.retryable },
      })
    } finally {
      this.inFlight.delete(requestId)
    }
  }

  /**
   * Đẩy yêu cầu xác nhận lên UI và chờ.
   *
   * Có timeout riêng dài hơn TTL của approval một chút: nếu renderer chết hoặc người dùng bỏ đi,
   * lời hứa này phải được giải phóng, nếu không cả lượt chat treo vĩnh viễn.
   */
  private askUser(request: ConfirmationRequest): Promise<ApprovalDecision> {
    return new Promise<ApprovalDecision>((resolve) => {
      const ttlMs = new Date(request.expiresAt).getTime() - Date.now()
      const timer = setTimeout(
        () => {
          this.pendingConfirmations.delete(request.operationId)
          this.services.guard.cancel(request.operationId)
          resolve('cancelled')
        },
        Math.max(5_000, ttlMs + 5_000),
      )

      this.pendingConfirmations.set(request.operationId, { resolve, timer })
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

  private emit<T>(channel: string, payload: T): void {
    const window = this.getWindow()
    if (window === null || window.isDestroyed()) return
    window.webContents.send(channel, payload)
  }
}
