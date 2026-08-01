import type { AuditRepository } from './repositories/audit-repository.js'
import type { LocalStore } from './store.js'

/**
 * §8.3 Chính sách lưu giữ.
 *
 * Chạy lúc khởi động và mỗi 6 giờ. Xoá là không hoàn tác được, nên:
 *  - `historyRetentionDays = 0` nghĩa là KHÔNG tự xoá (theo §8.3 "Lưu cục bộ cho đến khi
 *    người dùng xóa" là mặc định).
 *  - Hội thoại đã archive vẫn tính theo cùng mốc — archive không phải cách giữ vĩnh viễn.
 */
export interface RetentionPolicy {
  readonly historyRetentionDays: number
  readonly logRetentionDays: number
}

export interface RetentionOutcome {
  readonly conversationsDeleted: number
  readonly auditRowsDeleted: number
}

export class RetentionService {
  constructor(
    private readonly store: LocalStore,
    private readonly audit: AuditRepository,
  ) {}

  apply(profileId: string, policy: RetentionPolicy): RetentionOutcome {
    let conversationsDeleted = 0

    if (policy.historyRetentionDays > 0) {
      const cutoff = this.cutoff(policy.historyRetentionDays)
      conversationsDeleted = this.store.transaction(
        () =>
          this.store.handle
            .prepare('DELETE FROM conversations WHERE profile_id = ? AND updated_at < ?')
            .run(profileId, cutoff).changes,
      )
    }

    const auditRowsDeleted = this.audit.pruneOlderThan(this.cutoff(policy.logRetentionDays))

    if (conversationsDeleted > 0 || auditRowsDeleted > 0) {
      this.store.log.info('retention-applied', {
        conversationsDeleted,
        auditRowsDeleted,
        historyRetentionDays: policy.historyRetentionDays,
      })
    }
    return { conversationsDeleted, auditRowsDeleted }
  }

  private cutoff(days: number): string {
    return new Date(this.store.now().getTime() - days * 24 * 60 * 60 * 1000).toISOString()
  }
}
