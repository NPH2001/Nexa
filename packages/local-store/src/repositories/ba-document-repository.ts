import { randomUUID } from 'node:crypto'
import { baDocItemSchema, type BaDocItem, type BaDocLink, type BaDocModel } from '@nexa/ba-kit'
import { ERROR_CODES, NexaError } from '@nexa/shared-types'
import { n } from '../driver.js'
import type { LocalStore } from '../store.js'

/**
 * Tài liệu BA lưu dưới dạng item có cấu trúc (D1).
 *
 * Nội dung nghiệp vụ nằm trọn trong `payload_ciphertext`. Cột rõ chỉ có id, enum, ordinal và
 * timestamp — mở file SQLite bằng công cụ thường không đọc được tên use case hay mã lỗi nào.
 * Việc gom và dò trùng chạy trên object đã giải mã ở đây rồi chuyển lên main process.
 */

const CTX = {
  title: 'ba_documents.title',
  payload: 'ba_doc_items.payload',
  linkLabel: 'ba_doc_links.label',
} as const

export type BaDocumentKind = 'us' | 'srs' | 'brd' | 'note'
export type BaDocumentStatus = 'draft' | 'reviewed'

export interface BaDocument {
  readonly id: string
  readonly profileId: string
  readonly title: string
  readonly kind: BaDocumentKind
  readonly status: BaDocumentStatus
  readonly templateId: string | null
  readonly templateVersion: string | null
  /** Hash nội dung nguồn — cơ sở để không trích xuất lại tài liệu không đổi. */
  readonly sourceHash: string | null
  readonly sourceConversationId: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

export interface CreateBaDocumentInput {
  readonly profileId: string
  readonly title: string
  readonly kind: BaDocumentKind
  readonly templateId?: string | null
  readonly templateVersion?: string | null
  readonly sourceConversationId?: string | null
}

export interface UpdateBaDocumentInput {
  readonly title?: string
  readonly kind?: BaDocumentKind
  readonly status?: BaDocumentStatus
  readonly templateId?: string | null
  readonly templateVersion?: string | null
  readonly sourceHash?: string | null
}

export class BaDocumentRepository {
  constructor(private readonly store: LocalStore) {}

  create(input: CreateBaDocumentInput): BaDocument {
    return this.store.transaction(() => {
      this.assertSourceConversation(input.profileId, input.sourceConversationId)
      const id = randomUUID()
      const now = this.store.nowIso()
      this.store.handle
        .prepare(
          `INSERT INTO ba_documents
             (id, profile_id, title_ciphertext, kind, status, template_id, template_version,
              source_hash, source_conversation_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'draft', ?, ?, NULL, ?, ?, ?)`,
        )
        .run(
          id,
          input.profileId,
          this.store.cipher.encrypt(CTX.title, input.title),
          input.kind,
          n(input.templateId),
          n(input.templateVersion),
          n(input.sourceConversationId),
          now,
          now,
        )
      this.store.log.info('ba-document-created', {
        documentId: id,
        profileId: input.profileId,
        kind: input.kind,
      })
      return this.getOrThrow(id)
    })
  }

  get(id: string): BaDocument | null {
    const row = this.store.handle.prepare('SELECT * FROM ba_documents WHERE id = ?').get(id)
    return row === undefined ? null : this.mapDocument(row)
  }

  list(profileId: string): BaDocument[] {
    return this.store.handle
      .prepare(
        `SELECT * FROM ba_documents WHERE profile_id = ?
         ORDER BY updated_at DESC, created_at DESC, rowid DESC`,
      )
      .all(profileId)
      .map((row) => this.mapDocument(row))
  }

  update(id: string, patch: UpdateBaDocumentInput): BaDocument {
    return this.store.transaction(() => {
      const current = this.getOrThrow(id)
      const updates: string[] = []
      const params: (string | null)[] = []

      if (patch.title !== undefined) {
        updates.push('title_ciphertext = ?')
        params.push(this.store.cipher.encrypt(CTX.title, patch.title))
      }
      if (patch.kind !== undefined) {
        updates.push('kind = ?')
        params.push(patch.kind)
      }
      if (patch.status !== undefined) {
        updates.push('status = ?')
        params.push(patch.status)
      }
      if (patch.templateId !== undefined) {
        updates.push('template_id = ?')
        params.push(n(patch.templateId))
      }
      if (patch.templateVersion !== undefined) {
        updates.push('template_version = ?')
        params.push(n(patch.templateVersion))
      }
      if (patch.sourceHash !== undefined) {
        updates.push('source_hash = ?')
        params.push(n(patch.sourceHash))
      }

      updates.push('updated_at = ?')
      params.push(this.store.nowIso())
      params.push(id)

      this.store.handle.prepare(`UPDATE ba_documents SET ${updates.join(', ')} WHERE id = ?`).run(...params)
      this.store.log.info('ba-document-updated', { documentId: id, profileId: current.profileId })
      return this.getOrThrow(id)
    })
  }

  delete(id: string): void {
    const current = this.getOrThrow(id)
    this.store.handle.prepare('DELETE FROM ba_documents WHERE id = ?').run(id)
    this.store.log.info('ba-document-deleted', { documentId: id, profileId: current.profileId })
  }

  /**
   * Ghi đè trọn mô hình của một tài liệu.
   *
   * Thay thế trọn gói chứ không merge từng item: bộ hợp nhất của `ba-kit` đã quyết định xong mô
   * hình cuối cùng, và một đường merge thứ hai ở tầng DB sẽ là nơi thứ hai định nghĩa "hai item
   * này có phải một không" — đúng loại lệch nhau khó tìm nhất.
   *
   * `item_type`, `ordinal` và `needs_review` được suy ra từ payload ngay tại đây, nên hai bản
   * không thể lệch nhau.
   */
  replaceModel(documentId: string, model: BaDocModel): void {
    this.store.transaction(() => {
      this.getOrThrow(documentId)
      const now = this.store.nowIso()

      // Xoá item trước; ba_doc_links CASCADE theo item nên không cần xoá tay.
      this.store.handle.prepare('DELETE FROM ba_doc_items WHERE document_id = ?').run(documentId)

      const insertItem = this.store.handle.prepare(
        `INSERT INTO ba_doc_items
           (id, document_id, item_type, ordinal, needs_review, payload_ciphertext, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      for (const item of model.items) {
        insertItem.run(
          item.id,
          documentId,
          item.itemType,
          item.ordinal,
          item.needsReview ? 1 : 0,
          this.store.cipher.encrypt(CTX.payload, JSON.stringify(item)),
          now,
          now,
        )
      }

      const alive = new Set(model.items.map((item) => item.id))
      const insertLink = this.store.handle.prepare(
        `INSERT INTO ba_doc_links (id, document_id, from_item_id, to_item_id, kind, label_ciphertext, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      for (const link of model.links) {
        // Link mồ côi bị FK từ chối; bỏ sớm để lỗi nói đúng nguyên nhân thay vì báo constraint.
        if (!alive.has(link.from) || !alive.has(link.to)) {
          throw new NexaError(ERROR_CODES.VALIDATION_FAILED, {
            safeDetail: 'document link references an item that is not part of the model',
          })
        }
        insertLink.run(
          randomUUID(),
          documentId,
          link.from,
          link.to,
          link.kind,
          link.label === undefined ? null : this.store.cipher.encrypt(CTX.linkLabel, link.label),
          now,
        )
      }

      this.store.handle
        .prepare('UPDATE ba_documents SET updated_at = ? WHERE id = ?')
        .run(now, documentId)
      this.store.log.info('ba-document-model-replaced', {
        documentId,
        itemCount: model.items.length,
        linkCount: model.links.length,
      })
    })
  }

  /**
   * Đọc trọn mô hình và **kiểm lại bằng schema**.
   *
   * Dữ liệu từ DB đi qua `baDocItemSchema.parse` chứ không cast: file database là dữ liệu ngoài
   * process, và §11.3 không cho phép tin dữ liệu ngoài. Row hỏng làm cả lượt đọc thất bại một cách
   * ồn ào thay vì lặng lẽ đẩy một item méo mó vào bộ luật review.
   */
  readModel(documentId: string): BaDocModel {
    const itemRows = this.store.handle
      .prepare(
        `SELECT payload_ciphertext FROM ba_doc_items WHERE document_id = ?
         ORDER BY item_type, ordinal, rowid`,
      )
      .all(documentId)

    const items: BaDocItem[] = itemRows.map((row) => {
      const raw = this.store.cipher.decrypt(CTX.payload, String(row['payload_ciphertext']))
      const parsed = baDocItemSchema.safeParse(JSON.parse(raw))
      if (!parsed.success) {
        throw new NexaError(ERROR_CODES.VALIDATION_FAILED, {
          safeDetail: 'stored document item does not match the current item schema',
        })
      }
      return parsed.data
    })

    const linkRows = this.store.handle
      .prepare(
        `SELECT from_item_id, to_item_id, kind, label_ciphertext FROM ba_doc_links
         WHERE document_id = ? ORDER BY rowid`,
      )
      .all(documentId)

    const links: BaDocLink[] = linkRows.map((row) => {
      const label = row['label_ciphertext']
      return {
        from: String(row['from_item_id']),
        to: String(row['to_item_id']),
        kind: row['kind'] as BaDocLink['kind'],
        ...(label === null || label === undefined
          ? {}
          : { label: this.store.cipher.decrypt(CTX.linkLabel, String(label)) }),
      }
    })

    return { items, links }
  }

  /** Số item còn cần soát — đếm được mà không phải giải mã gì (D4). */
  countNeedsReview(documentId: string): number {
    const row = this.store.handle
      .prepare('SELECT COUNT(*) AS total FROM ba_doc_items WHERE document_id = ? AND needs_review = 1')
      .get(documentId)
    return Number(row?.['total'] ?? 0)
  }

  private getOrThrow(id: string): BaDocument {
    const document = this.get(id)
    if (document !== null) return document
    throw new NexaError(ERROR_CODES.VALIDATION_FAILED, {
      safeDetail: `ba document not found: ${id}`,
    })
  }

  private assertSourceConversation(
    profileId: string,
    sourceConversationId: string | null | undefined,
  ): void {
    if (sourceConversationId === undefined || sourceConversationId === null) return
    const row = this.store.handle
      .prepare('SELECT profile_id FROM conversations WHERE id = ?')
      .get(sourceConversationId)
    if (row === undefined) {
      throw new NexaError(ERROR_CODES.VALIDATION_FAILED, {
        safeDetail: 'source conversation does not exist',
      })
    }
    if (String(row['profile_id']) !== profileId) {
      throw new NexaError(ERROR_CODES.VALIDATION_FAILED, {
        safeDetail: 'source conversation belongs to another profile',
      })
    }
  }

  private mapDocument(row: Record<string, unknown>): BaDocument {
    return {
      id: String(row['id']),
      profileId: String(row['profile_id']),
      title: this.store.cipher.decrypt(CTX.title, String(row['title_ciphertext'])),
      kind: row['kind'] as BaDocumentKind,
      status: row['status'] as BaDocumentStatus,
      templateId: row['template_id'] === null ? null : String(row['template_id']),
      templateVersion: row['template_version'] === null ? null : String(row['template_version']),
      sourceHash: row['source_hash'] === null ? null : String(row['source_hash']),
      sourceConversationId:
        row['source_conversation_id'] === null ? null : String(row['source_conversation_id']),
      createdAt: String(row['created_at']),
      updatedAt: String(row['updated_at']),
    }
  }
}
