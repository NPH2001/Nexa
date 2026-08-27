import { randomUUID } from 'node:crypto'
import {
  type ActivityAction,
  type ActivityEvent,
  type ActivityStatus,
  type ActivitySubjectType,
  type ActivityType,
} from '@nexa/shared-types'
import { n } from '../driver.js'
import type { LocalStore } from '../store.js'

export interface RecordActivityInput {
  readonly profileId: string
  readonly type: ActivityType
  readonly action: ActivityAction
  readonly status: ActivityStatus
  readonly subjectType: ActivitySubjectType
  readonly subjectId: string
  readonly requestId?: string
  readonly operationId?: string
}

export interface ListActivityOptions {
  readonly type?: ActivityType
  readonly status?: ActivityStatus
  readonly limit: number
  readonly offset: number
}

export class ActivityRepository {
  constructor(private readonly store: LocalStore) {}

  record(input: RecordActivityInput): ActivityEvent {
    const id = randomUUID()
    const createdAt = this.store.nowIso()
    this.store.handle
      .prepare(
        `INSERT INTO local_audit
           (id, profile_id, event_type, request_id, operation_id, status, error_code, created_at,
            activity_type, activity_action, subject_type, subject_id)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.profileId,
        `${input.type}.${input.action}`,
        n(input.requestId),
        n(input.operationId),
        input.status,
        createdAt,
        input.type,
        input.action,
        input.subjectType,
        input.subjectId,
      )
    return this.getById(id)
  }

  list(profileId: string, opts: ListActivityOptions): ActivityEvent[] {
    const clauses = ['profile_id = ?']
    const params: (string | number)[] = [profileId]
    if (opts.type !== undefined) {
      clauses.push('activity_type = ?')
      params.push(opts.type)
    }
    if (opts.status !== undefined) {
      clauses.push('status = ?')
      params.push(opts.status)
    }
    params.push(opts.limit, opts.offset)

    return this.store.handle
      .prepare(
        `SELECT id, activity_type, activity_action, status, subject_type, subject_id, request_id, operation_id, created_at
         FROM local_audit
         WHERE ${clauses.join(' AND ')}
         ORDER BY created_at DESC, id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params)
      .map(mapActivity)
  }

  private getById(id: string): ActivityEvent {
    const row = this.store.handle
      .prepare(
        `SELECT id, activity_type, activity_action, status, subject_type, subject_id, request_id, operation_id, created_at
         FROM local_audit WHERE id = ? LIMIT 1`,
      )
      .get(id)
    if (row === undefined) {
      throw new Error(`activity not found after insert: ${id}`)
    }
    return mapActivity(row)
  }
}

function mapActivity(row: Record<string, unknown>): ActivityEvent {
  return {
    id: String(row['id']),
    type: String(row['activity_type']) as ActivityType,
    action: String(row['activity_action']) as ActivityAction,
    status: String(row['status']) as ActivityStatus,
    subjectType: String(row['subject_type']) as ActivitySubjectType,
    subjectId: String(row['subject_id']),
    subjectLabel: null,
    requestId: row['request_id'] === null ? null : String(row['request_id']),
    operationId: row['operation_id'] === null ? null : String(row['operation_id']),
    createdAt: String(row['created_at']),
  }
}
