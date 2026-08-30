import { randomUUID } from 'node:crypto'
import { ERROR_CODES, NexaError } from '@nexa/shared-types'
import { n } from '../driver.js'
import type { LocalStore } from '../store.js'

/**
 * Kho tri thức nghiệp vụ đã được người dùng xác nhận (openspec `add-ba-workbench`).
 *
 * Tách khỏi `memory_facts` có chủ đích (D6): một quy tắc tính phí không mô tả người dùng, nên nó
 * không phải memory. Hệ quả quan trọng nhất của việc tách: **không có `sharing_policy`**. Tri thức
 * nghiệp vụ luôn nội bộ, không có ngoại lệ per-item. Memory có hộp chọn đó vì nó là preference cá
 * nhân; đặt một hộp như thế ở đây là một sự cố rò rỉ đang chờ xảy ra.
 */

const CTX = {
  title: 'ba_knowledge.title',
  body: 'ba_knowledge.body',
  sourceRef: 'ba_knowledge.source_ref',
} as const

export type BaKnowledgeCategory = 'domain' | 'rule' | 'term' | 'constraint' | 'decision'
export type BaKnowledgeStatus = 'draft' | 'confirmed' | 'outdated'
export type BaKnowledgeSourceKind = 'conversation' | 'document' | 'url' | 'manual'
export type BaKnowledgeLinkKind = 'supports' | 'conflicts' | 'supersedes'
export type BaKnowledgeCreator = 'user' | 'agent'

export const BA_KNOWLEDGE_CATEGORIES: readonly BaKnowledgeCategory[] = [
  'domain',
  'rule',
  'term',
  'constraint',
  'decision',
]

export interface BaKnowledgeItem {
  readonly id: string
  readonly profileId: string
  readonly title: string
  readonly body: string
  readonly category: BaKnowledgeCategory
  readonly status: BaKnowledgeStatus
  readonly sourceKind: BaKnowledgeSourceKind
  readonly sourceRef: string | null
  readonly sourceConversationId: string | null
  readonly supersededBy: string | null
  readonly createdBy: BaKnowledgeCreator
  readonly useCount: number
  readonly lastUsedAt: string | null
  readonly confirmedAt: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

export interface CreateBaKnowledgeInput {
  readonly profileId: string
  readonly title: string
  readonly body: string
  readonly category: BaKnowledgeCategory
  readonly sourceKind: BaKnowledgeSourceKind
  readonly createdBy: BaKnowledgeCreator
  readonly sourceRef?: string | null
  readonly sourceConversationId?: string | null
  /**
   * Chỉ người dùng mới đặt được `confirmed`. Agent tạo item thì luôn là `draft` — tầng IPC/tool
   * chặn trước, còn đây là hàng rào cuối cùng.
   */
  readonly status?: BaKnowledgeStatus
}

export interface UpdateBaKnowledgeInput {
  readonly title?: string
  readonly body?: string
  readonly category?: BaKnowledgeCategory
  readonly sourceRef?: string | null
}

export interface ListBaKnowledgeOptions {
  readonly status?: BaKnowledgeStatus
  readonly category?: BaKnowledgeCategory
}

export interface BaKnowledgeLink {
  readonly id: string
  readonly fromId: string
  readonly toId: string
  readonly kind: BaKnowledgeLinkKind
  readonly createdAt: string
}

export interface BaKnowledgeStats {
  readonly byCategory: readonly {
    readonly category: BaKnowledgeCategory
    readonly draft: number
    readonly confirmed: number
    readonly outdated: number
  }[]
  readonly total: { readonly draft: number; readonly confirmed: number; readonly outdated: number }
  readonly conflictPairs: number
  /** Tri thức chết: đã confirm nhưng chưa lần nào được dùng. Dấu hiệu research sai hướng. */
  readonly unusedConfirmed: number
  readonly mostUsed: readonly { readonly id: string; readonly title: string; readonly useCount: number }[]
}

const MOST_USED_LIMIT = 5

export class BaKnowledgeRepository {
  constructor(private readonly store: LocalStore) {}

  create(input: CreateBaKnowledgeInput): BaKnowledgeItem {
    return this.store.transaction(() => {
      this.assertSourceConversation(input.profileId, input.sourceConversationId)

      const id = randomUUID()
      const now = this.store.nowIso()
      const status = input.status ?? 'draft'
      this.store.handle
        .prepare(
          `INSERT INTO ba_knowledge
             (id, profile_id, title_ciphertext, body_ciphertext, category, status, source_kind,
              source_ref_ciphertext, source_conversation_id, superseded_by, created_by,
              use_count, last_used_at, confirmed_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 0, NULL, ?, ?, ?)`,
        )
        .run(
          id,
          input.profileId,
          this.store.cipher.encrypt(CTX.title, input.title),
          this.store.cipher.encrypt(CTX.body, input.body),
          input.category,
          status,
          input.sourceKind,
          input.sourceRef === undefined || input.sourceRef === null
            ? null
            : this.store.cipher.encrypt(CTX.sourceRef, input.sourceRef),
          n(input.sourceConversationId),
          input.createdBy,
          status === 'confirmed' ? now : null,
          now,
          now,
        )
      this.store.log.info('ba-knowledge-created', {
        knowledgeId: id,
        profileId: input.profileId,
        category: input.category,
        status,
        createdBy: input.createdBy,
      })
      return this.getOrThrow(id)
    })
  }

  get(id: string): BaKnowledgeItem | null {
    const row = this.store.handle.prepare('SELECT * FROM ba_knowledge WHERE id = ?').get(id)
    return row === undefined ? null : this.mapItem(row)
  }

  list(profileId: string, opts: ListBaKnowledgeOptions = {}): BaKnowledgeItem[] {
    const filters: string[] = []
    const params: (string | number)[] = [profileId]
    if (opts.status !== undefined) {
      filters.push('AND status = ?')
      params.push(opts.status)
    }
    if (opts.category !== undefined) {
      filters.push('AND category = ?')
      params.push(opts.category)
    }
    return this.store.handle
      .prepare(
        `SELECT * FROM ba_knowledge
         WHERE profile_id = ? ${filters.join(' ')}
         ORDER BY updated_at DESC, created_at DESC, rowid DESC`,
      )
      .all(...params)
      .map((row) => this.mapItem(row))
  }

  /**
   * Item đưa vào khối context bị động — chỉ `confirmed`, mới nhất trước (D6).
   *
   * Không có xếp hạng liên quan ở đây: làm thế cần embedding, và điều đó mâu thuẫn với quyết định
   * "dò trùng và truy hồi phải xác định". Tra cứu theo liên quan là việc của tool tra cứu.
   */
  listForContext(profileId: string, limit: number): BaKnowledgeItem[] {
    return this.store.handle
      .prepare(
        `SELECT * FROM ba_knowledge
         WHERE profile_id = ? AND status = 'confirmed'
         ORDER BY updated_at DESC, created_at DESC, rowid DESC
         LIMIT ?`,
      )
      .all(profileId, limit)
      .map((row) => this.mapItem(row))
  }

  update(id: string, patch: UpdateBaKnowledgeInput): BaKnowledgeItem {
    return this.store.transaction(() => {
      const current = this.getOrThrow(id)
      const updates: string[] = []
      const params: (string | null)[] = []

      if (patch.title !== undefined) {
        updates.push('title_ciphertext = ?')
        params.push(this.store.cipher.encrypt(CTX.title, patch.title))
      }
      if (patch.body !== undefined) {
        updates.push('body_ciphertext = ?')
        params.push(this.store.cipher.encrypt(CTX.body, patch.body))
      }
      if (patch.category !== undefined) {
        updates.push('category = ?')
        params.push(patch.category)
      }
      if (patch.sourceRef !== undefined) {
        updates.push('source_ref_ciphertext = ?')
        params.push(
          patch.sourceRef === null ? null : this.store.cipher.encrypt(CTX.sourceRef, patch.sourceRef),
        )
      }

      updates.push('updated_at = ?')
      params.push(this.store.nowIso())
      params.push(id)

      this.store.handle.prepare(`UPDATE ba_knowledge SET ${updates.join(', ')} WHERE id = ?`).run(...params)
      this.store.log.info('ba-knowledge-updated', { knowledgeId: id, profileId: current.profileId })
      return this.getOrThrow(id)
    })
  }

  /** Người dùng chốt một item. Đây là hành động duy nhất biến tri thức thành căn cứ đối chiếu. */
  confirm(id: string): BaKnowledgeItem {
    return this.store.transaction(() => {
      const current = this.getOrThrow(id)
      if (current.status === 'outdated') {
        throw new NexaError(ERROR_CODES.VALIDATION_FAILED, {
          safeDetail: 'cannot confirm an outdated knowledge item; create a replacement instead',
        })
      }
      const now = this.store.nowIso()
      this.store.handle
        .prepare(
          `UPDATE ba_knowledge SET status = 'confirmed', confirmed_at = ?, updated_at = ? WHERE id = ?`,
        )
        .run(now, now, id)
      this.store.log.info('ba-knowledge-confirmed', { knowledgeId: id, profileId: current.profileId })
      return this.getOrThrow(id)
    })
  }

  /**
   * Thay thế chứ không ghi đè: item cũ chuyển `outdated` và trỏ tới item mới.
   *
   * Lịch sử quyết định nghiệp vụ là thứ BA phải tra lại được — "vì sao hồi đó chốt thế này" mất đi
   * là mất đúng thứ kho tri thức sinh ra để giữ.
   */
  supersede(id: string, replacementId: string): BaKnowledgeItem {
    return this.store.transaction(() => {
      const current = this.getOrThrow(id)
      const replacement = this.getOrThrow(replacementId)
      if (current.profileId !== replacement.profileId) {
        throw new NexaError(ERROR_CODES.VALIDATION_FAILED, {
          safeDetail: 'replacement knowledge item belongs to another profile',
        })
      }
      if (id === replacementId) {
        throw new NexaError(ERROR_CODES.VALIDATION_FAILED, {
          safeDetail: 'knowledge item cannot supersede itself',
        })
      }

      const now = this.store.nowIso()
      this.store.handle
        .prepare(
          `UPDATE ba_knowledge SET status = 'outdated', superseded_by = ?, updated_at = ? WHERE id = ?`,
        )
        .run(replacementId, now, id)
      this.linkInternal(replacementId, id, 'supersedes', now)
      this.store.log.info('ba-knowledge-superseded', {
        knowledgeId: id,
        replacementId,
        profileId: current.profileId,
      })
      return this.getOrThrow(id)
    })
  }

  delete(id: string): void {
    const current = this.getOrThrow(id)
    this.store.handle.prepare('DELETE FROM ba_knowledge WHERE id = ?').run(id)
    this.store.log.info('ba-knowledge-deleted', { knowledgeId: id, profileId: current.profileId })
  }

  link(fromId: string, toId: string, kind: BaKnowledgeLinkKind): BaKnowledgeLink {
    return this.store.transaction(() => {
      const from = this.getOrThrow(fromId)
      const to = this.getOrThrow(toId)
      if (from.profileId !== to.profileId) {
        throw new NexaError(ERROR_CODES.VALIDATION_FAILED, {
          safeDetail: 'cannot link knowledge items across profiles',
        })
      }
      if (fromId === toId) {
        throw new NexaError(ERROR_CODES.VALIDATION_FAILED, {
          safeDetail: 'cannot link a knowledge item to itself',
        })
      }
      const id = this.linkInternal(fromId, toId, kind, this.store.nowIso())
      const row = this.store.handle.prepare('SELECT * FROM ba_knowledge_links WHERE id = ?').get(id)
      if (row === undefined) {
        throw new NexaError(ERROR_CODES.VALIDATION_FAILED, { safeDetail: 'link not found' })
      }
      return this.mapLink(row)
    })
  }

  unlink(linkId: string): void {
    this.store.handle.prepare('DELETE FROM ba_knowledge_links WHERE id = ?').run(linkId)
  }

  listLinks(profileId: string): BaKnowledgeLink[] {
    return this.store.handle
      .prepare(
        `SELECT l.* FROM ba_knowledge_links l
         JOIN ba_knowledge k ON k.id = l.from_id
         WHERE k.profile_id = ?
         ORDER BY l.created_at DESC, l.rowid DESC`,
      )
      .all(profileId)
      .map((row) => this.mapLink(row))
  }

  /**
   * Ghi nhận item đã được dùng — khi vào context hoặc khi một luật review lấy nó làm căn cứ.
   *
   * Đây là thứ biến "thống kê" trong yêu cầu gốc thành số liệu thật: item chưa từng tăng biến này
   * là tri thức chưa ai dùng tới.
   */
  recordUsage(ids: readonly string[]): void {
    if (ids.length === 0) return
    const now = this.store.nowIso()
    this.store.transaction(() => {
      const statement = this.store.handle.prepare(
        'UPDATE ba_knowledge SET use_count = use_count + 1, last_used_at = ? WHERE id = ?',
      )
      for (const id of ids) statement.run(now, id)
    })
  }

  stats(profileId: string): BaKnowledgeStats {
    const rows = this.store.handle
      .prepare(
        `SELECT category, status, COUNT(*) AS total
         FROM ba_knowledge WHERE profile_id = ?
         GROUP BY category, status`,
      )
      .all(profileId)

    const empty = (): { draft: number; confirmed: number; outdated: number } => ({
      draft: 0,
      confirmed: 0,
      outdated: 0,
    })
    const buckets = new Map(BA_KNOWLEDGE_CATEGORIES.map((category) => [category, empty()]))
    const total = empty()
    for (const row of rows) {
      const category = row['category'] as BaKnowledgeCategory
      const status = row['status'] as BaKnowledgeStatus
      const count = Number(row['total'])
      const bucket = buckets.get(category)
      if (bucket !== undefined) bucket[status] += count
      total[status] += count
    }

    const conflictRow = this.store.handle
      .prepare(
        `SELECT COUNT(*) AS total FROM ba_knowledge_links l
         JOIN ba_knowledge k ON k.id = l.from_id
         WHERE k.profile_id = ? AND l.kind = 'conflicts'`,
      )
      .get(profileId)

    const unusedRow = this.store.handle
      .prepare(
        `SELECT COUNT(*) AS total FROM ba_knowledge
         WHERE profile_id = ? AND status = 'confirmed' AND use_count = 0`,
      )
      .get(profileId)

    const mostUsed = this.store.handle
      .prepare(
        `SELECT id, title_ciphertext, use_count FROM ba_knowledge
         WHERE profile_id = ? AND use_count > 0
         ORDER BY use_count DESC, updated_at DESC
         LIMIT ?`,
      )
      .all(profileId, MOST_USED_LIMIT)
      .map((row) => ({
        id: String(row['id']),
        title: this.store.cipher.decrypt(CTX.title, String(row['title_ciphertext'])),
        useCount: Number(row['use_count']),
      }))

    return {
      byCategory: BA_KNOWLEDGE_CATEGORIES.map((category) => ({
        category,
        ...(buckets.get(category) ?? empty()),
      })),
      total,
      conflictPairs: Number(conflictRow?.['total'] ?? 0),
      unusedConfirmed: Number(unusedRow?.['total'] ?? 0),
      mostUsed,
    }
  }

  private linkInternal(
    fromId: string,
    toId: string,
    kind: BaKnowledgeLinkKind,
    now: string,
  ): string {
    const existing = this.store.handle
      .prepare('SELECT id FROM ba_knowledge_links WHERE from_id = ? AND to_id = ? AND kind = ?')
      .get(fromId, toId, kind)
    if (existing !== undefined) return String(existing['id'])

    const id = randomUUID()
    this.store.handle
      .prepare(
        'INSERT INTO ba_knowledge_links (id, from_id, to_id, kind, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(id, fromId, toId, kind, now)
    return id
  }

  private getOrThrow(id: string): BaKnowledgeItem {
    const item = this.get(id)
    if (item !== null) return item
    throw new NexaError(ERROR_CODES.VALIDATION_FAILED, {
      safeDetail: `ba knowledge item not found: ${id}`,
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

  private mapItem(row: Record<string, unknown>): BaKnowledgeItem {
    const sourceRef = row['source_ref_ciphertext']
    return {
      id: String(row['id']),
      profileId: String(row['profile_id']),
      title: this.store.cipher.decrypt(CTX.title, String(row['title_ciphertext'])),
      body: this.store.cipher.decrypt(CTX.body, String(row['body_ciphertext'])),
      category: row['category'] as BaKnowledgeCategory,
      status: row['status'] as BaKnowledgeStatus,
      sourceKind: row['source_kind'] as BaKnowledgeSourceKind,
      sourceRef:
        sourceRef === null || sourceRef === undefined
          ? null
          : this.store.cipher.decrypt(CTX.sourceRef, String(sourceRef)),
      sourceConversationId:
        row['source_conversation_id'] === null ? null : String(row['source_conversation_id']),
      supersededBy: row['superseded_by'] === null ? null : String(row['superseded_by']),
      createdBy: row['created_by'] as BaKnowledgeCreator,
      useCount: Number(row['use_count']),
      lastUsedAt: row['last_used_at'] === null ? null : String(row['last_used_at']),
      confirmedAt: row['confirmed_at'] === null ? null : String(row['confirmed_at']),
      createdAt: String(row['created_at']),
      updatedAt: String(row['updated_at']),
    }
  }

  private mapLink(row: Record<string, unknown>): BaKnowledgeLink {
    return {
      id: String(row['id']),
      fromId: String(row['from_id']),
      toId: String(row['to_id']),
      kind: row['kind'] as BaKnowledgeLinkKind,
      createdAt: String(row['created_at']),
    }
  }
}
