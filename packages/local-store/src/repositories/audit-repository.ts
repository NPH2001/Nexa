import { randomUUID } from 'node:crypto'
import { n } from '../driver.js'
import type { LocalStore } from '../store.js'

/**
 * §8.1 `local_audit`: "Không ghi key, PAT, prompt hoặc payload nghiệp vụ đầy đủ."
 *
 * Vì vậy hàm `record` chỉ nhận các trường có kiểu chặt — không có tham số free-text nào để
 * lỡ tay nhét nội dung vào. Muốn thêm ngữ cảnh thì thêm `event_type` mới, không thêm cột text.
 *
 * Phân vai với `tool_calls`: bảng này ghi sự kiện hệ thống, `tool_calls` ghi nghiệp vụ tool
 * (OPEN-QUESTIONS B6).
 */
export const AUDIT_EVENTS = {
  connectionSaved: 'connection.saved',
  connectionDeleted: 'connection.deleted',
  connectionTested: 'connection.tested',
  credentialSaved: 'credential.saved',
  credentialDeleted: 'credential.deleted',
  chatRequested: 'chat.requested',
  chatCompleted: 'chat.completed',
  chatCancelled: 'chat.cancelled',
  documentAttached: 'document.attached',
  toolApproved: 'tool.approved',
  toolCancelled: 'tool.cancelled',
  toolExecuted: 'tool.executed',
  toolUncertain: 'tool.uncertain',
  mcpStarted: 'mcp.started',
  mcpFailed: 'mcp.failed',
  dbUnlockFailed: 'db.unlock_failed',
  dataPurged: 'data.purged',
  updateChecked: 'update.checked',
} as const

export type AuditEvent = (typeof AUDIT_EVENTS)[keyof typeof AUDIT_EVENTS]
export type AuditStatus = 'ok' | 'error' | 'cancelled' | 'pending'

export interface AuditEntry {
  readonly id: string
  readonly eventType: string
  readonly requestId: string | null
  readonly operationId: string | null
  readonly status: AuditStatus
  readonly errorCode: string | null
  readonly createdAt: string
}

export class AuditRepository {
  constructor(private readonly store: LocalStore) {}

  record(input: {
    profileId: string | null
    eventType: AuditEvent
    status: AuditStatus
    requestId?: string
    operationId?: string
    errorCode?: string
  }): void {
    this.store.handle
      .prepare(
        `INSERT INTO local_audit (id, profile_id, event_type, request_id, operation_id, status, error_code, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        n(input.profileId),
        input.eventType,
        n(input.requestId),
        n(input.operationId),
        input.status,
        n(input.errorCode),
        this.store.nowIso(),
      )
  }

  /** §15.2: đối chiếu request_id/operation_id giữa local log, LiteLLM và Atlassian. */
  findByRequestId(requestId: string): AuditEntry[] {
    return this.store.handle
      .prepare('SELECT * FROM local_audit WHERE request_id = ? ORDER BY created_at')
      .all(requestId)
      .map(mapAudit)
  }

  findByOperationId(operationId: string): AuditEntry[] {
    return this.store.handle
      .prepare('SELECT * FROM local_audit WHERE operation_id = ? ORDER BY created_at')
      .all(operationId)
      .map(mapAudit)
  }

  recent(profileId: string, limit: number): AuditEntry[] {
    return this.store.handle
      .prepare('SELECT * FROM local_audit WHERE profile_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(profileId, limit)
      .map(mapAudit)
  }

  /** §15.2 "thống kê approval confirmed/cancelled cục bộ; không gửi tập trung". */
  approvalStats(profileId: string): { approved: number; cancelled: number } {
    const row = this.store.handle
      .prepare(
        `SELECT
           SUM(CASE WHEN event_type = ? THEN 1 ELSE 0 END) AS approved,
           SUM(CASE WHEN event_type = ? THEN 1 ELSE 0 END) AS cancelled
         FROM local_audit WHERE profile_id = ?`,
      )
      .get(AUDIT_EVENTS.toolApproved, AUDIT_EVENTS.toolCancelled, profileId)
    return {
      approved: Number(row?.['approved'] ?? 0),
      cancelled: Number(row?.['cancelled'] ?? 0),
    }
  }

  /** Dọn theo `logRetentionDays` (§8.3). */
  pruneOlderThan(cutoffIso: string): number {
    return this.store.handle
      .prepare('DELETE FROM local_audit WHERE created_at < ?')
      .run(cutoffIso).changes
  }
}

function mapAudit(row: Record<string, unknown>): AuditEntry {
  return {
    id: String(row['id']),
    eventType: String(row['event_type']),
    requestId: row['request_id'] === null ? null : String(row['request_id']),
    operationId: row['operation_id'] === null ? null : String(row['operation_id']),
    status: String(row['status']) as AuditStatus,
    errorCode: row['error_code'] === null ? null : String(row['error_code']),
    createdAt: String(row['created_at']),
  }
}
