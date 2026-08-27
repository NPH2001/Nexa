import { randomUUID } from 'node:crypto'
import {
  ERROR_CODES,
  NexaError,
  type CheckInState,
  type CheckInTriggerKind,
} from '@nexa/shared-types'
import { n } from '../driver.js'
import type { LocalStore } from '../store.js'

const SORT_SQL = `
  ORDER BY
    CASE state
      WHEN 'pending' THEN 0
      WHEN 'snoozed' THEN 1
      WHEN 'dismissed' THEN 2
      WHEN 'acted' THEN 3
      ELSE 4
    END,
    trigger_at ASC,
    created_at ASC,
    id ASC`

export interface CommitmentCheckIn {
  readonly id: string
  readonly profileId: string
  readonly commitmentId: string
  readonly triggerKind: CheckInTriggerKind
  readonly triggerAt: string
  readonly state: CheckInState
  readonly snoozedUntil: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

export type CheckInRecord = CommitmentCheckIn

export interface ReconcileTriggerResult {
  readonly record: CommitmentCheckIn
  readonly changed: boolean
}

export class CheckInRepository {
  constructor(private readonly store: LocalStore) {}

  get(id: string): CommitmentCheckIn | null {
    const row = this.store.handle.prepare('SELECT * FROM commitment_check_ins WHERE id = ?').get(id)
    return row === undefined ? null : mapCheckIn(row)
  }

  getForCommitment(profileId: string, commitmentId: string): CommitmentCheckIn | null {
    const row = this.store.handle
      .prepare(
        'SELECT * FROM commitment_check_ins WHERE profile_id = ? AND commitment_id = ? LIMIT 1',
      )
      .get(profileId, commitmentId)
    return row === undefined ? null : mapCheckIn(row)
  }

  list(profileId: string): CommitmentCheckIn[] {
    return this.store.handle
      .prepare(`SELECT * FROM commitment_check_ins WHERE profile_id = ? ${SORT_SQL}`)
      .all(profileId)
      .map(mapCheckIn)
  }

  listPending(profileId: string): CommitmentCheckIn[] {
    return this.store.handle
      .prepare(
        `SELECT * FROM commitment_check_ins
         WHERE profile_id = ? AND state = 'pending'
         ORDER BY trigger_at ASC, created_at ASC, id ASC`,
      )
      .all(profileId)
      .map(mapCheckIn)
  }

  reconcileTrigger(
    profileId: string,
    commitmentId: string,
    triggerKind: CheckInTriggerKind,
    triggerAt: string,
  ): ReconcileTriggerResult {
    return this.store.transaction(() => {
      this.assertCommitmentOwnership(profileId, commitmentId)

      const current = this.getForCommitment(profileId, commitmentId)
      if (current === null) {
        const now = this.store.nowIso()
        const id = randomUUID()
        this.store.handle
          .prepare(
            `INSERT INTO commitment_check_ins
               (id, profile_id, commitment_id, trigger_kind, trigger_at, state, snoozed_until, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'pending', NULL, ?, ?)`,
          )
          .run(id, profileId, commitmentId, triggerKind, triggerAt, now, now)
        return { record: this.getOrThrow(id), changed: true }
      }

      if (current.triggerKind === triggerKind && current.triggerAt === triggerAt) {
        return { record: current, changed: false }
      }

      const now = this.store.nowIso()
      const nextState = current.state === 'muted' ? 'muted' : 'pending'
      const nextSnoozedUntil = current.state === 'muted' ? current.snoozedUntil : null
      this.store.handle
        .prepare(
          `UPDATE commitment_check_ins
           SET trigger_kind = ?, trigger_at = ?, state = ?, snoozed_until = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(triggerKind, triggerAt, nextState, n(nextSnoozedUntil), now, current.id)
      return { record: this.getOrThrow(current.id), changed: true }
    })
  }

  releaseSnoozed(profileId: string, nowIso: string): CommitmentCheckIn[] {
    return this.store.transaction(() => {
      const rows = this.store.handle
        .prepare(
          `SELECT id FROM commitment_check_ins
           WHERE profile_id = ? AND state = 'snoozed' AND snoozed_until IS NOT NULL AND snoozed_until <= ?
           ORDER BY trigger_at ASC, created_at ASC, id ASC`,
        )
        .all(profileId, nowIso)
      if (rows.length === 0) return []

      this.store.handle
        .prepare(
          `UPDATE commitment_check_ins
           SET state = 'pending', snoozed_until = NULL, updated_at = ?
           WHERE profile_id = ? AND state = 'snoozed' AND snoozed_until IS NOT NULL AND snoozed_until <= ?`,
        )
        .run(this.store.nowIso(), profileId, nowIso)

      return rows.map((row) => this.getOrThrow(String(row['id'])))
    })
  }

  respond(
    profileId: string,
    id: string,
    action: Extract<CheckInState, 'acted' | 'snoozed' | 'dismissed' | 'muted'>,
    snoozedUntil?: string | null,
  ): CommitmentCheckIn {
    return this.store.transaction(() => {
      const current = this.getOwnedOrThrow(profileId, id)
      this.store.handle
        .prepare(
          `UPDATE commitment_check_ins
           SET state = ?, snoozed_until = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(action, action === 'snoozed' ? n(snoozedUntil) : null, this.store.nowIso(), current.id)
      return this.getOrThrow(current.id)
    })
  }

  unmute(profileId: string, commitmentId: string): CommitmentCheckIn {
    return this.store.transaction(() => {
      const current = this.getForCommitment(profileId, commitmentId)
      if (current === null) {
        throw new NexaError(ERROR_CODES.VALIDATION_FAILED, {
          safeDetail: `check-in not found for commitment: ${commitmentId}`,
        })
      }

      this.store.handle
        .prepare(
          `UPDATE commitment_check_ins
           SET state = 'pending', snoozed_until = NULL, updated_at = ?
           WHERE id = ?`,
        )
        .run(this.store.nowIso(), current.id)
      return this.getOrThrow(current.id)
    })
  }

  private getOwnedOrThrow(profileId: string, id: string): CommitmentCheckIn {
    const current = this.get(id)
    if (current === null) {
      throw new NexaError(ERROR_CODES.VALIDATION_FAILED, {
        safeDetail: `check-in not found: ${id}`,
      })
    }
    if (current.profileId !== profileId) {
      throw new NexaError(ERROR_CODES.VALIDATION_FAILED, {
        safeDetail: 'check-in belongs to another profile',
      })
    }
    return current
  }

  private getOrThrow(id: string): CommitmentCheckIn {
    const record = this.get(id)
    if (record !== null) return record
    throw new NexaError(ERROR_CODES.VALIDATION_FAILED, {
      safeDetail: `check-in not found: ${id}`,
    })
  }

  private assertCommitmentOwnership(profileId: string, commitmentId: string): void {
    const row = this.store.handle
      .prepare('SELECT profile_id FROM commitments WHERE id = ?')
      .get(commitmentId)
    if (row === undefined) {
      throw new NexaError(ERROR_CODES.VALIDATION_FAILED, {
        safeDetail: 'commitment does not exist',
      })
    }
    if (String(row['profile_id']) !== profileId) {
      throw new NexaError(ERROR_CODES.VALIDATION_FAILED, {
        safeDetail: 'commitment belongs to another profile',
      })
    }
  }
}

function mapCheckIn(row: Record<string, unknown>): CommitmentCheckIn {
  return {
    id: String(row['id']),
    profileId: String(row['profile_id']),
    commitmentId: String(row['commitment_id']),
    triggerKind: row['trigger_kind'] as CheckInTriggerKind,
    triggerAt: String(row['trigger_at']),
    state: row['state'] as CheckInState,
    snoozedUntil: row['snoozed_until'] === null ? null : String(row['snoozed_until']),
    createdAt: String(row['created_at']),
    updatedAt: String(row['updated_at']),
  }
}
