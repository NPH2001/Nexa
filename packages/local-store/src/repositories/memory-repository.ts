import { randomUUID } from 'node:crypto'
import { ERROR_CODES, NexaError } from '@nexa/shared-types'
import { n } from '../driver.js'
import type { LocalStore } from '../store.js'

const CTX = {
  content: 'memory_facts.content',
} as const

export type MemoryFactKind = 'identity' | 'preference' | 'goal' | 'constraint' | 'note'
export type MemoryFactScope = 'global' | 'conversation'
export type MemoryFactSharingPolicy = 'internal_only' | 'allow_external'
export type MemoryFactStatus = 'active' | 'archived'

export interface MemoryFact {
  readonly id: string
  readonly profileId: string
  readonly content: string
  readonly kind: MemoryFactKind
  readonly scope: MemoryFactScope
  readonly sharingPolicy: MemoryFactSharingPolicy
  readonly status: MemoryFactStatus
  readonly sourceConversationId: string | null
  readonly createdAt: string
  readonly updatedAt: string
  readonly lastConfirmedAt: string | null
  readonly expiresAt: string | null
}

export interface CreateMemoryFactInput {
  readonly profileId: string
  readonly content: string
  readonly kind: MemoryFactKind
  readonly scope: MemoryFactScope
  readonly sharingPolicy: MemoryFactSharingPolicy
  readonly sourceConversationId?: string | null
  readonly lastConfirmedAt?: string | null
  readonly expiresAt?: string | null
}

export interface UpdateMemoryFactInput {
  readonly content?: string
  readonly kind?: MemoryFactKind
  readonly scope?: MemoryFactScope
  readonly sharingPolicy?: MemoryFactSharingPolicy
  readonly sourceConversationId?: string | null
  readonly lastConfirmedAt?: string | null
  readonly expiresAt?: string | null
}

export interface ListMemoryFactsOptions {
  readonly includeArchived?: boolean
}

export interface ListMemoryFactsForContextOptions {
  readonly conversationId?: string | null
  readonly externalProvider: boolean
}

export class MemoryRepository {
  constructor(private readonly store: LocalStore) {}

  create(input: CreateMemoryFactInput): MemoryFact {
    return this.store.transaction(() => {
      this.assertSourceConversation(input.profileId, input.scope, input.sourceConversationId)

      const id = randomUUID()
      const now = this.store.nowIso()
      this.store.handle
        .prepare(
          `INSERT INTO memory_facts
             (id, profile_id, content_ciphertext, kind, scope, sharing_policy, status,
              source_conversation_id, created_at, updated_at, last_confirmed_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.profileId,
          this.store.cipher.encrypt(CTX.content, input.content),
          input.kind,
          input.scope,
          input.sharingPolicy,
          n(input.sourceConversationId),
          now,
          now,
          n(input.lastConfirmedAt),
          n(input.expiresAt),
        )
      this.store.log.info('memory-fact-created', {
        memoryFactId: id,
        profileId: input.profileId,
        scope: input.scope,
      })
      return this.getOrThrow(id)
    })
  }

  get(id: string): MemoryFact | null {
    const row = this.store.handle.prepare('SELECT * FROM memory_facts WHERE id = ?').get(id)
    return row === undefined ? null : this.mapFact(row)
  }

  list(profileId: string, opts: ListMemoryFactsOptions = {}): MemoryFact[] {
    const includeArchived = opts.includeArchived ?? true
    const where = includeArchived ? '' : `AND status = 'active'`
    return this.store.handle
      .prepare(
        `SELECT * FROM memory_facts
         WHERE profile_id = ? ${where}
         ORDER BY updated_at DESC, created_at DESC, rowid DESC`,
      )
      .all(profileId)
      .map((row) => this.mapFact(row))
  }

  listActive(profileId: string): MemoryFact[] {
    return this.list(profileId, { includeArchived: false })
  }

  update(id: string, patch: UpdateMemoryFactInput): MemoryFact {
    return this.store.transaction(() => {
      const current = this.getOrThrow(id)
      const nextScope = patch.scope ?? current.scope
      const nextSourceConversationId =
        patch.sourceConversationId !== undefined
          ? patch.sourceConversationId
          : current.sourceConversationId

      this.assertSourceConversation(current.profileId, nextScope, nextSourceConversationId)

      const updates: string[] = []
      const params: (string | null)[] = []

      if (patch.content !== undefined) {
        updates.push('content_ciphertext = ?')
        params.push(this.store.cipher.encrypt(CTX.content, patch.content))
      }
      if (patch.kind !== undefined) {
        updates.push('kind = ?')
        params.push(patch.kind)
      }
      if (patch.scope !== undefined) {
        updates.push('scope = ?')
        params.push(patch.scope)
      }
      if (patch.sharingPolicy !== undefined) {
        updates.push('sharing_policy = ?')
        params.push(patch.sharingPolicy)
      }
      if (patch.sourceConversationId !== undefined) {
        updates.push('source_conversation_id = ?')
        params.push(n(patch.sourceConversationId))
      }
      if (patch.lastConfirmedAt !== undefined) {
        updates.push('last_confirmed_at = ?')
        params.push(n(patch.lastConfirmedAt))
      }
      if (patch.expiresAt !== undefined) {
        updates.push('expires_at = ?')
        params.push(n(patch.expiresAt))
      }

      updates.push('updated_at = ?')
      params.push(this.store.nowIso())
      params.push(id)

      this.store.handle
        .prepare(`UPDATE memory_facts SET ${updates.join(', ')} WHERE id = ?`)
        .run(...params)
      this.store.log.info('memory-fact-updated', { memoryFactId: id, profileId: current.profileId })
      return this.getOrThrow(id)
    })
  }

  archive(id: string): MemoryFact {
    return this.store.transaction(() => {
      const current = this.getOrThrow(id)
      const now = this.store.nowIso()
      this.store.handle
        .prepare('UPDATE memory_facts SET status = ?, updated_at = ? WHERE id = ?')
        .run('archived', now, id)
      this.store.log.info('memory-fact-archived', {
        memoryFactId: id,
        profileId: current.profileId,
      })
      return this.getOrThrow(id)
    })
  }

  restore(id: string): MemoryFact {
    return this.store.transaction(() => {
      const current = this.getOrThrow(id)
      const now = this.store.nowIso()
      this.store.handle
        .prepare('UPDATE memory_facts SET status = ?, updated_at = ? WHERE id = ?')
        .run('active', now, id)
      this.store.log.info('memory-fact-restored', {
        memoryFactId: id,
        profileId: current.profileId,
      })
      return this.getOrThrow(id)
    })
  }

  delete(id: string): void {
    const current = this.getOrThrow(id)
    this.store.handle.prepare('DELETE FROM memory_facts WHERE id = ?').run(id)
    this.store.log.info('memory-fact-deleted', { memoryFactId: id, profileId: current.profileId })
  }

  listForContext(profileId: string, opts: ListMemoryFactsForContextOptions): MemoryFact[] {
    const now = this.store.nowIso()
    const sharingPolicySql = opts.externalProvider ? `AND sharing_policy = 'allow_external'` : ''

    return this.store.handle
      .prepare(
        `SELECT * FROM memory_facts
         WHERE profile_id = ?
           AND status = 'active'
           AND (expires_at IS NULL OR expires_at > ?)
           ${sharingPolicySql}
         AND (
             scope = 'global'
             OR (scope = 'conversation' AND source_conversation_id = ?)
           )
         ORDER BY updated_at DESC, created_at DESC, rowid DESC`,
      )
      .all(profileId, now, n(opts.conversationId))
      .map((row) => this.mapFact(row))
  }

  private getOrThrow(id: string): MemoryFact {
    const fact = this.get(id)
    if (fact !== null) return fact
    throw new NexaError(ERROR_CODES.VALIDATION_FAILED, {
      safeDetail: `memory fact not found: ${id}`,
    })
  }

  private assertSourceConversation(
    profileId: string,
    scope: MemoryFactScope,
    sourceConversationId: string | null | undefined,
  ): void {
    if (
      scope === 'conversation' &&
      (sourceConversationId === undefined || sourceConversationId === null)
    ) {
      throw new NexaError(ERROR_CODES.VALIDATION_FAILED, {
        safeDetail: 'conversation-scoped memory fact requires sourceConversationId',
      })
    }
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

  private mapFact(row: Record<string, unknown>): MemoryFact {
    return {
      id: String(row['id']),
      profileId: String(row['profile_id']),
      content: this.store.cipher.decrypt(CTX.content, String(row['content_ciphertext'])),
      kind: row['kind'] as MemoryFactKind,
      scope: row['scope'] as MemoryFactScope,
      sharingPolicy: row['sharing_policy'] as MemoryFactSharingPolicy,
      status: row['status'] as MemoryFactStatus,
      sourceConversationId:
        row['source_conversation_id'] === null ? null : String(row['source_conversation_id']),
      createdAt: String(row['created_at']),
      updatedAt: String(row['updated_at']),
      lastConfirmedAt: row['last_confirmed_at'] === null ? null : String(row['last_confirmed_at']),
      expiresAt: row['expires_at'] === null ? null : String(row['expires_at']),
    }
  }
}
