import { randomUUID } from 'node:crypto'
import {
  ERROR_CODES,
  NexaError,
  type Commitment,
  type CommitmentStatus,
} from '@nexa/shared-types'
import { n } from '../driver.js'
import type { LocalStore } from '../store.js'

const CTX = {
  title: 'commitments.title',
  nextAction: 'commitments.next_action',
} as const

export interface CreateCommitmentInput {
  readonly profileId: string
  readonly title: string
  readonly nextAction?: string | null
  readonly status?: CommitmentStatus
  readonly dueAt?: string | null
  readonly checkInAt?: string | null
  readonly sourceConversationId?: string | null
}

export interface UpdateCommitmentInput {
  readonly title?: string
  readonly nextAction?: string | null
  readonly status?: CommitmentStatus
  readonly dueAt?: string | null
  readonly checkInAt?: string | null
  readonly sourceConversationId?: string | null
}

export interface ListCommitmentsOptions {
  readonly includeCompleted?: boolean
}

export class CommitmentRepository {
  constructor(private readonly store: LocalStore) {}

  create(input: CreateCommitmentInput): Commitment {
    return this.store.transaction(() => {
      this.assertSourceConversation(input.profileId, input.sourceConversationId)

      const id = randomUUID()
      const now = this.store.nowIso()
      const status = input.status ?? 'active'
      this.store.handle
        .prepare(
          `INSERT INTO commitments
             (id, profile_id, title_ciphertext, next_action_ciphertext, status, due_at, check_in_at,
              completed_at, source_conversation_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.profileId,
          this.store.cipher.encrypt(CTX.title, input.title),
          input.nextAction === undefined || input.nextAction === null
            ? null
            : this.store.cipher.encrypt(CTX.nextAction, input.nextAction),
          status,
          n(input.dueAt),
          n(input.checkInAt),
          status === 'completed' ? now : null,
          n(input.sourceConversationId),
          now,
          now,
        )
      this.store.log.info('commitment-created', {
        commitmentId: id,
        profileId: input.profileId,
        status,
      })
      return this.getOrThrow(id)
    })
  }

  get(id: string): Commitment | null {
    const row = this.store.handle.prepare('SELECT * FROM commitments WHERE id = ?').get(id)
    return row === undefined ? null : this.mapCommitment(row)
  }

  list(profileId: string, opts: ListCommitmentsOptions = {}): Commitment[] {
    const includeCompleted = opts.includeCompleted ?? false
    const completedFilter = includeCompleted ? '' : `AND status <> 'completed'`
    return this.store.handle
      .prepare(
        `SELECT * FROM commitments
         WHERE profile_id = ? ${completedFilter}
         ORDER BY
           CASE status
             WHEN 'blocked' THEN 0
             WHEN 'active' THEN 1
             WHEN 'paused' THEN 2
             ELSE 3
           END,
           COALESCE(MIN(check_in_at, due_at), check_in_at, due_at, '9999-12-31T23:59:59.999Z'),
           updated_at DESC,
           rowid DESC`,
      )
      .all(profileId)
      .map((row) => this.mapCommitment(row))
  }

  update(id: string, patch: UpdateCommitmentInput): Commitment {
    return this.store.transaction(() => {
      const current = this.getOrThrow(id)
      const nextSourceConversationId =
        patch.sourceConversationId === undefined
          ? current.sourceConversationId
          : patch.sourceConversationId
      this.assertSourceConversation(current.profileId, nextSourceConversationId)

      const updates: string[] = []
      const params: (string | null)[] = []

      if (patch.title !== undefined) {
        updates.push('title_ciphertext = ?')
        params.push(this.store.cipher.encrypt(CTX.title, patch.title))
      }
      if (patch.nextAction !== undefined) {
        updates.push('next_action_ciphertext = ?')
        params.push(
          patch.nextAction === null
            ? null
            : this.store.cipher.encrypt(CTX.nextAction, patch.nextAction),
        )
      }
      if (patch.status !== undefined) {
        updates.push('status = ?', 'completed_at = ?')
        params.push(
          patch.status,
          patch.status === 'completed' ? (current.completedAt ?? this.store.nowIso()) : null,
        )
      }
      if (patch.dueAt !== undefined) {
        updates.push('due_at = ?')
        params.push(n(patch.dueAt))
      }
      if (patch.checkInAt !== undefined) {
        updates.push('check_in_at = ?')
        params.push(n(patch.checkInAt))
      }
      if (patch.sourceConversationId !== undefined) {
        updates.push('source_conversation_id = ?')
        params.push(n(patch.sourceConversationId))
      }

      if (updates.length === 0) {
        throw new NexaError(ERROR_CODES.VALIDATION_FAILED, {
          safeDetail: 'commitment update requires at least one field',
        })
      }

      updates.push('updated_at = ?')
      params.push(this.store.nowIso(), id)
      this.store.handle
        .prepare(`UPDATE commitments SET ${updates.join(', ')} WHERE id = ?`)
        .run(...params)
      this.store.log.info('commitment-updated', {
        commitmentId: id,
        profileId: current.profileId,
      })
      return this.getOrThrow(id)
    })
  }

  delete(id: string): void {
    const current = this.getOrThrow(id)
    this.store.handle.prepare('DELETE FROM commitments WHERE id = ?').run(id)
    this.store.log.info('commitment-deleted', {
      commitmentId: id,
      profileId: current.profileId,
    })
  }

  private getOrThrow(id: string): Commitment {
    const commitment = this.get(id)
    if (commitment !== null) return commitment
    throw new NexaError(ERROR_CODES.VALIDATION_FAILED, {
      safeDetail: `commitment not found: ${id}`,
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

  private mapCommitment(row: Record<string, unknown>): Commitment {
    return {
      id: String(row['id']),
      profileId: String(row['profile_id']),
      title: this.store.cipher.decrypt(CTX.title, String(row['title_ciphertext'])),
      nextAction:
        row['next_action_ciphertext'] === null
          ? null
          : this.store.cipher.decrypt(CTX.nextAction, String(row['next_action_ciphertext'])),
      status: row['status'] as CommitmentStatus,
      dueAt: row['due_at'] === null ? null : String(row['due_at']),
      checkInAt: row['check_in_at'] === null ? null : String(row['check_in_at']),
      completedAt: row['completed_at'] === null ? null : String(row['completed_at']),
      sourceConversationId:
        row['source_conversation_id'] === null ? null : String(row['source_conversation_id']),
      createdAt: String(row['created_at']),
      updatedAt: String(row['updated_at']),
    }
  }
}
