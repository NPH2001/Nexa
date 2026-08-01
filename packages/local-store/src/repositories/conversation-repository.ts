import { randomUUID } from 'node:crypto'
import type {
  AttachmentMeta,
  ApprovalStatus,
  Conversation,
  Message,
  MessageRole,
  LlmProvider,
  MessageStatus,
  OperationStatus,
  RiskLevel,
  ToolCallRecord,
  ToolPreview,
} from '@nexa/shared-types'
import { b, n } from '../driver.js'
import type { LocalStore } from '../store.js'

/** Context mã hoá — dạng `table.column`. Đổi các chuỗi này là làm hỏng dữ liệu cũ. */
const CTX = {
  title: 'conversations.title',
  content: 'messages.content',
  fileName: 'attachments.file_name',
  extracted: 'attachments.extracted_text',
  preview: 'tool_calls.preview',
  resultSummary: 'tool_calls.result_summary',
} as const

export interface AppendMessageInput {
  readonly conversationId: string
  readonly role: MessageRole
  readonly content: string
  readonly status?: MessageStatus
  readonly requestId?: string
  readonly errorCode?: string
  readonly truncatedContextCount?: number
}

export interface AddAttachmentInput {
  readonly messageId: string
  readonly fileName: string
  readonly fileType: string
  readonly fileSize: number
  readonly sourcePathHash: string
  readonly extractedText: string | null
  readonly extractedChars: number
  readonly pageCount?: number
  readonly suspectedScan?: boolean
}

export interface RecordToolCallInput {
  readonly messageId: string
  readonly toolName: string
  readonly riskLevel: RiskLevel
  readonly approvalStatus: ApprovalStatus
  readonly operationStatus: OperationStatus
  readonly preview?: ToolPreview
  readonly operationId?: string
  readonly payloadHash?: string
}

/** Một tool call còn treo, kèm hội thoại chứa nó. */
export interface UncertainOperation extends ToolCallRecord {
  readonly conversationId: string
}

export interface UpdateToolCallInput {
  readonly approvalStatus?: ApprovalStatus
  readonly operationStatus?: OperationStatus
  readonly resultSummary?: string
  readonly targetKey?: string
  readonly targetUrl?: string
  readonly errorCode?: string
}

export class ConversationRepository {
  constructor(private readonly store: LocalStore) {}

  // ── Conversations ───────────────────────────────────────────────────────

  create(
    profileId: string,
    title: string,
    model: { modelId: string; provider: LlmProvider } | null,
  ): Conversation {
    const now = this.store.nowIso()
    const id = randomUUID()
    this.store.handle
      .prepare(
        `INSERT INTO conversations
           (id, profile_id, title_ciphertext, model_id, model_provider, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        profileId,
        this.store.cipher.encrypt(CTX.title, title),
        n(model?.modelId),
        n(model?.provider),
        now,
        now,
      )
    return {
      id,
      title,
      modelId: model?.modelId ?? null,
      modelProvider: model?.provider ?? null,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      messageCount: 0,
    }
  }

  get(id: string): Conversation | null {
    const row = this.store.handle
      .prepare(
        `SELECT c.*, (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
         FROM conversations c WHERE c.id = ?`,
      )
      .get(id)
    return row === undefined ? null : this.mapConversation(row)
  }

  list(
    profileId: string,
    opts: { includeArchived: boolean; limit: number; offset: number },
  ): Conversation[] {
    const where = opts.includeArchived ? '' : 'AND c.archived_at IS NULL'
    return this.store.handle
      .prepare(
        `SELECT c.*, (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
         FROM conversations c
         WHERE c.profile_id = ? ${where}
         ORDER BY c.updated_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(profileId, opts.limit, opts.offset)
      .map((r) => this.mapConversation(r))
  }

  rename(id: string, title: string): void {
    this.store.handle
      .prepare('UPDATE conversations SET title_ciphertext = ?, updated_at = ? WHERE id = ?')
      .run(this.store.cipher.encrypt(CTX.title, title), this.store.nowIso(), id)
  }

  setModel(id: string, model: { modelId: string; provider: LlmProvider } | null): void {
    this.store.handle
      .prepare(
        'UPDATE conversations SET model_id = ?, model_provider = ?, updated_at = ? WHERE id = ?',
      )
      .run(n(model?.modelId), n(model?.provider), this.store.nowIso(), id)
  }

  archive(id: string): void {
    const now = this.store.nowIso()
    this.store.handle
      .prepare('UPDATE conversations SET archived_at = ?, updated_at = ? WHERE id = ?')
      .run(now, now, id)
  }

  delete(id: string): void {
    // CASCADE xoá messages → attachments/tool_calls.
    this.store.handle.prepare('DELETE FROM conversations WHERE id = ?').run(id)
  }

  touch(id: string): void {
    this.store.handle
      .prepare('UPDATE conversations SET updated_at = ? WHERE id = ?')
      .run(this.store.nowIso(), id)
  }

  // ── Messages ────────────────────────────────────────────────────────────

  appendMessage(input: AppendMessageInput): Message {
    return this.store.transaction(() => {
      const seqRow = this.store.handle
        .prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM messages WHERE conversation_id = ?')
        .get(input.conversationId)
      const seq = Number(seqRow?.['next'] ?? 1)
      const id = randomUUID()
      const now = this.store.nowIso()
      const status = input.status ?? 'complete'

      this.store.handle
        .prepare(
          `INSERT INTO messages
             (id, conversation_id, seq, role, content_ciphertext, status,
              error_code, request_id, truncated_context_count, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.conversationId,
          seq,
          input.role,
          this.store.cipher.encrypt(CTX.content, input.content),
          status,
          n(input.errorCode),
          n(input.requestId),
          input.truncatedContextCount ?? 0,
          now,
        )
      this.touch(input.conversationId)

      return {
        id,
        conversationId: input.conversationId,
        role: input.role,
        content: input.content,
        status,
        createdAt: now,
        ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
        ...(input.errorCode !== undefined ? { errorCode: input.errorCode } : {}),
      }
    })
  }

  /** Cập nhật nội dung khi streaming kết thúc. */
  finalizeMessage(
    messageId: string,
    content: string,
    status: MessageStatus,
    extra: { errorCode?: string; truncatedContextCount?: number } = {},
  ): void {
    this.store.handle
      .prepare(
        `UPDATE messages
         SET content_ciphertext = ?, status = ?, error_code = ?, truncated_context_count = ?
         WHERE id = ?`,
      )
      .run(
        this.store.cipher.encrypt(CTX.content, content),
        status,
        n(extra.errorCode),
        extra.truncatedContextCount ?? 0,
        messageId,
      )
  }

  listMessages(conversationId: string, limit: number): Message[] {
    const rows = this.store.handle
      .prepare(
        `SELECT * FROM messages WHERE conversation_id = ? ORDER BY seq DESC LIMIT ?`,
      )
      .all(conversationId, limit)
      .reverse()

    const messages = rows.map((r) => this.mapMessage(r))
    if (messages.length === 0) return messages

    // Nạp attachment và tool call theo lô — tránh N+1 khi mở hội thoại dài.
    const ids = messages.map((m) => m.id)
    const attachments = this.attachmentsFor(ids)
    const toolCalls = this.toolCallsFor(ids)

    return messages.map((m) => ({
      ...m,
      ...(attachments.has(m.id) ? { attachments: attachments.get(m.id) } : {}),
      ...(toolCalls.has(m.id) ? { toolCalls: toolCalls.get(m.id) } : {}),
    }))
  }

  /**
   * Lấy toàn bộ nội dung hội thoại để dựng context cho LLM.
   * Trả theo thứ tự tăng dần, đã giải mã.
   */
  loadForContext(conversationId: string): { role: MessageRole; content: string }[] {
    return this.store.handle
      .prepare(
        `SELECT role, content_ciphertext FROM messages
         WHERE conversation_id = ? AND status IN ('complete','streaming')
         ORDER BY seq ASC`,
      )
      .all(conversationId)
      .map((r) => ({
        role: String(r['role']) as MessageRole,
        content: this.store.cipher.decrypt(CTX.content, String(r['content_ciphertext'])),
      }))
  }

  // ── Attachments ─────────────────────────────────────────────────────────

  addAttachment(input: AddAttachmentInput): AttachmentMeta {
    const id = randomUUID()
    const store = input.extractedText !== null
    this.store.handle
      .prepare(
        `INSERT INTO attachments
           (id, message_id, file_name_ciphertext, file_type, file_size, source_path_hash,
            extracted_text_ciphertext, extracted_chars, page_count, suspected_scan, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.messageId,
        this.store.cipher.encrypt(CTX.fileName, input.fileName),
        input.fileType,
        input.fileSize,
        input.sourcePathHash,
        store ? this.store.cipher.encrypt(CTX.extracted, input.extractedText as string) : null,
        input.extractedChars,
        n(input.pageCount),
        b(input.suspectedScan ?? false),
        this.store.nowIso(),
      )
    return {
      id,
      messageId: input.messageId,
      fileName: input.fileName,
      fileType: input.fileType,
      fileSize: input.fileSize,
      sourcePathHash: input.sourcePathHash,
      extractedChars: input.extractedChars,
      extractedTextStored: store,
      ...(input.pageCount !== undefined ? { pageCount: input.pageCount } : {}),
      ...(input.suspectedScan === true ? { suspectedScan: true } : {}),
    }
  }

  private attachmentsFor(messageIds: readonly string[]): Map<string, AttachmentMeta[]> {
    const out = new Map<string, AttachmentMeta[]>()
    if (messageIds.length === 0) return out
    const placeholders = messageIds.map(() => '?').join(',')
    for (const row of this.store.handle
      .prepare(`SELECT * FROM attachments WHERE message_id IN (${placeholders})`)
      .all(...messageIds)) {
      const meta = this.mapAttachment(row)
      const list = out.get(meta.messageId) ?? []
      list.push(meta)
      out.set(meta.messageId, list)
    }
    return out
  }

  // ── Tool calls (§8.1, §10.3) ────────────────────────────────────────────

  recordToolCall(input: RecordToolCallInput): ToolCallRecord {
    const id = randomUUID()
    const now = this.store.nowIso()
    this.store.handle
      .prepare(
        `INSERT INTO tool_calls
           (id, message_id, tool_name, risk_level, preview_ciphertext, approval_status,
            operation_status, operation_id, payload_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.messageId,
        input.toolName,
        input.riskLevel,
        input.preview === undefined
          ? null
          : this.store.cipher.encrypt(CTX.preview, JSON.stringify(input.preview)),
        input.approvalStatus,
        input.operationStatus,
        n(input.operationId),
        n(input.payloadHash),
        now,
        now,
      )
    return {
      id,
      messageId: input.messageId,
      toolName: input.toolName,
      riskLevel: input.riskLevel,
      approvalStatus: input.approvalStatus,
      operationStatus: input.operationStatus,
      createdAt: now,
      ...(input.preview !== undefined ? { preview: input.preview } : {}),
      ...(input.operationId !== undefined ? { operationId: input.operationId } : {}),
    }
  }

  updateToolCall(id: string, patch: UpdateToolCallInput): void {
    const sets: string[] = []
    const params: (string | number | null)[] = []
    const push = (col: string, value: string | number | null): void => {
      sets.push(`${col} = ?`)
      params.push(value)
    }

    if (patch.approvalStatus !== undefined) push('approval_status', patch.approvalStatus)
    if (patch.operationStatus !== undefined) push('operation_status', patch.operationStatus)
    if (patch.resultSummary !== undefined) {
      push('result_summary_ciphertext', this.store.cipher.encrypt(CTX.resultSummary, patch.resultSummary))
    }
    if (patch.targetKey !== undefined) push('target_key', patch.targetKey)
    if (patch.targetUrl !== undefined) push('target_url', patch.targetUrl)
    if (patch.errorCode !== undefined) push('error_code', patch.errorCode)
    if (sets.length === 0) return

    push('updated_at', this.store.nowIso())
    params.push(id)
    this.store.handle.prepare(`UPDATE tool_calls SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  }

  findByOperationId(operationId: string): ToolCallRecord | null {
    const row = this.store.handle
      .prepare('SELECT * FROM tool_calls WHERE operation_id = ?')
      .get(operationId)
    return row === undefined ? null : this.mapToolCall(row)
  }

  /**
   * Thao tác write còn treo từ phiên trước — hiện lại cho người dùng lúc khởi động (§16).
   *
   * Trả kèm `conversationId` để UI mở được đúng hội thoại. `ToolCallRecord` chỉ có `messageId`,
   * và đi từ message về conversation ở phía renderer sẽ tốn thêm một vòng IPC cho mỗi bản ghi.
   */
  listUncertainOperations(profileId: string): UncertainOperation[] {
    return this.store.handle
      .prepare(
        `SELECT tc.*, m.conversation_id AS conversation_id FROM tool_calls tc
           JOIN messages m ON m.id = tc.message_id
           JOIN conversations c ON c.id = m.conversation_id
         WHERE c.profile_id = ? AND tc.operation_status IN ('uncertain','running')
         ORDER BY tc.created_at DESC`,
      )
      .all(profileId)
      .map((r) => ({
        ...this.mapToolCall(r),
        conversationId: String(r['conversation_id']),
      }))
  }

  private toolCallsFor(messageIds: readonly string[]): Map<string, ToolCallRecord[]> {
    const out = new Map<string, ToolCallRecord[]>()
    if (messageIds.length === 0) return out
    const placeholders = messageIds.map(() => '?').join(',')
    for (const row of this.store.handle
      .prepare(`SELECT * FROM tool_calls WHERE message_id IN (${placeholders}) ORDER BY created_at`)
      .all(...messageIds)) {
      const rec = this.mapToolCall(row)
      const list = out.get(rec.messageId) ?? []
      list.push(rec)
      out.set(rec.messageId, list)
    }
    return out
  }

  // ── Mapping ─────────────────────────────────────────────────────────────

  private mapConversation(row: Record<string, unknown>): Conversation {
    return {
      id: String(row['id']),
      title: this.store.cipher.decrypt(CTX.title, String(row['title_ciphertext'])),
      modelId: row['model_id'] === null ? null : String(row['model_id']),
      modelProvider:
        row['model_provider'] === null || row['model_provider'] === undefined
          ? null
          : (String(row['model_provider']) as LlmProvider),
      createdAt: String(row['created_at']),
      updatedAt: String(row['updated_at']),
      archivedAt: row['archived_at'] === null ? null : String(row['archived_at']),
      messageCount: Number(row['message_count'] ?? 0),
    }
  }

  private mapMessage(row: Record<string, unknown>): Message {
    return {
      id: String(row['id']),
      conversationId: String(row['conversation_id']),
      role: String(row['role']) as MessageRole,
      content: this.store.cipher.decrypt(CTX.content, String(row['content_ciphertext'])),
      status: String(row['status']) as MessageStatus,
      createdAt: String(row['created_at']),
      ...(row['error_code'] === null ? {} : { errorCode: String(row['error_code']) }),
      ...(row['request_id'] === null ? {} : { requestId: String(row['request_id']) }),
      ...(Number(row['truncated_context_count']) > 0
        ? { truncatedContextCount: Number(row['truncated_context_count']) }
        : {}),
    }
  }

  private mapAttachment(row: Record<string, unknown>): AttachmentMeta {
    return {
      id: String(row['id']),
      messageId: String(row['message_id']),
      fileName: this.store.cipher.decrypt(CTX.fileName, String(row['file_name_ciphertext'])),
      fileType: String(row['file_type']),
      fileSize: Number(row['file_size']),
      sourcePathHash: String(row['source_path_hash']),
      extractedChars: Number(row['extracted_chars']),
      extractedTextStored: row['extracted_text_ciphertext'] !== null,
      ...(row['page_count'] === null ? {} : { pageCount: Number(row['page_count']) }),
      ...(Number(row['suspected_scan']) === 1 ? { suspectedScan: true } : {}),
    }
  }

  private mapToolCall(row: Record<string, unknown>): ToolCallRecord {
    const previewRaw = row['preview_ciphertext']
    const summaryRaw = row['result_summary_ciphertext']
    return {
      id: String(row['id']),
      messageId: String(row['message_id']),
      toolName: String(row['tool_name']),
      riskLevel: String(row['risk_level']) as RiskLevel,
      approvalStatus: String(row['approval_status']) as ApprovalStatus,
      operationStatus: String(row['operation_status']) as OperationStatus,
      createdAt: String(row['created_at']),
      ...(previewRaw === null
        ? {}
        : {
            preview: JSON.parse(
              this.store.cipher.decrypt(CTX.preview, String(previewRaw)),
            ) as ToolPreview,
          }),
      ...(summaryRaw === null
        ? {}
        : { resultSummary: this.store.cipher.decrypt(CTX.resultSummary, String(summaryRaw)) }),
      ...(row['operation_id'] === null ? {} : { operationId: String(row['operation_id']) }),
      ...(row['target_key'] === null ? {} : { targetKey: String(row['target_key']) }),
      ...(row['target_url'] === null ? {} : { targetUrl: String(row['target_url']) }),
      ...(row['error_code'] === null ? {} : { errorCode: String(row['error_code']) }),
    }
  }

  /** Dùng cho search — trả ciphertext thô theo lô, không map thành Message đầy đủ. */
  scanBatch(
    profileId: string,
    offset: number,
    batchSize: number,
  ): { conversationId: string; messageId: string; createdAt: string; ciphertext: string }[] {
    return this.store.handle
      .prepare(
        `SELECT m.id, m.conversation_id, m.created_at, m.content_ciphertext
         FROM messages m JOIN conversations c ON c.id = m.conversation_id
         WHERE c.profile_id = ?
         ORDER BY m.created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(profileId, batchSize, offset)
      .map((r) => ({
        messageId: String(r['id']),
        conversationId: String(r['conversation_id']),
        createdAt: String(r['created_at']),
        ciphertext: String(r['content_ciphertext']),
      }))
  }

  decryptContent(ciphertext: string): string {
    return this.store.cipher.decrypt(CTX.content, ciphertext)
  }

  decryptTitle(ciphertext: string): string {
    return this.store.cipher.decrypt(CTX.title, ciphertext)
  }
}
