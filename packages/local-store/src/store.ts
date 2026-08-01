import { ERROR_CODES, NexaError } from '@nexa/shared-types'
import type { Logger } from '@nexa/observability'
import { openDatabase, type DriverKind, type SqlDatabase } from './driver.js'
import { LATEST_SCHEMA_VERSION, MIGRATIONS } from './migrations.js'

/**
 * Mã hoá trường. `SecurityService` thoả interface này về mặt cấu trúc — local-store cố ý
 * KHÔNG import @nexa/security để tầng lưu trữ có thể test độc lập với secure storage thật.
 */
export interface FieldCipher {
  encrypt(context: string, plaintext: string): string
  decrypt(context: string, ciphertext: string): string
}

export interface LocalStoreOptions {
  readonly path: string
  readonly cipher: FieldCipher
  readonly logger: Logger
  readonly driver?: DriverKind
  /** Cho phép test bơm đồng hồ. */
  readonly now?: () => Date
}

/**
 * Local Repository (§5.2): migrations + CRUD.
 *
 * Mọi truy cập DB đi qua đây. Không nơi nào khác được giữ tham chiếu tới `SqlDatabase`.
 */
export class LocalStore {
  private db: SqlDatabase | null = null
  private txDepth = 0
  readonly cipher: FieldCipher
  readonly log: Logger
  readonly now: () => Date
  private readonly opts: LocalStoreOptions

  private constructor(opts: LocalStoreOptions) {
    this.opts = opts
    this.cipher = opts.cipher
    this.log = opts.logger.child({ module: 'local-store' })
    this.now = opts.now ?? (() => new Date())
  }

  static open(opts: LocalStoreOptions): LocalStore {
    const store = new LocalStore(opts)
    store.db = openDatabase(opts.path, opts.driver)
    store.log.info('local-db-opened', { driver: store.db.driverName })
    store.migrate()
    return store
  }

  get handle(): SqlDatabase {
    if (this.db === null) {
      throw new NexaError(ERROR_CODES.LOCAL_DB_LOCKED, { safeDetail: 'database is closed' })
    }
    return this.db
  }

  get driverName(): string {
    return this.handle.driverName
  }

  nowIso(): string {
    return this.now().toISOString()
  }

  // ── Migration (§13.1) ───────────────────────────────────────────────────

  private migrate(): void {
    const db = this.handle
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    INTEGER PRIMARY KEY,
        name       TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `)

    const applied = new Set(
      db
        .prepare('SELECT version FROM schema_migrations')
        .all()
        .map((r) => Number(r['version'])),
    )

    const current = applied.size === 0 ? 0 : Math.max(...applied)
    if (current > LATEST_SCHEMA_VERSION) {
      // Người dùng vừa cài đè một bản Nexa CŨ hơn lên dữ liệu mới. Ghi tiếp là hỏng dữ liệu.
      // §16: "Local DB bị khóa/hỏng → Khởi động chế độ chẩn đoán; không ghi đè."
      throw new NexaError(ERROR_CODES.LOCAL_DB_LOCKED, {
        safeDetail: `database schema v${current} is newer than this app (v${LATEST_SCHEMA_VERSION})`,
      })
    }

    for (const migration of MIGRATIONS) {
      if (applied.has(migration.version)) continue
      this.transaction(() => {
        db.exec(migration.up)
        db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
          migration.version,
          migration.name,
          this.nowIso(),
        )
      })
      this.log.info('migration-applied', { version: migration.version, name: migration.name })
    }
  }

  get schemaVersion(): number {
    const row = this.handle.prepare('SELECT MAX(version) AS v FROM schema_migrations').get()
    return row === undefined || row['v'] === null ? 0 : Number(row['v'])
  }

  /**
   * Rollback thủ công. KHÔNG được gọi tự động — §13.1 yêu cầu có rollback strategy, nhưng
   * chạy `down` là mất dữ liệu, nên chỉ công cụ chẩn đoán mới được gọi.
   */
  rollbackTo(targetVersion: number): void {
    const toRevert = [...MIGRATIONS]
      .filter((m) => m.version > targetVersion)
      .sort((a, b) => b.version - a.version)
    this.transaction(() => {
      for (const m of toRevert) {
        this.handle.exec(m.down)
        this.handle.prepare('DELETE FROM schema_migrations WHERE version = ?').run(m.version)
        this.log.warn('migration-rolled-back', { version: m.version })
      }
    })
  }

  // ── Transaction ─────────────────────────────────────────────────────────

  /**
   * Transaction lồng nhau dùng SAVEPOINT, nên repository có thể tự bọc transaction mà không
   * cần biết mình đang được gọi từ trong một transaction lớn hơn.
   */
  transaction<T>(fn: () => T): T {
    const db = this.handle
    const depth = this.txDepth
    const savepoint = `sp_${String(depth)}`

    if (depth === 0) db.exec('BEGIN IMMEDIATE')
    else db.exec(`SAVEPOINT ${savepoint}`)
    this.txDepth = depth + 1

    try {
      const result = fn()
      if (depth === 0) db.exec('COMMIT')
      else db.exec(`RELEASE ${savepoint}`)
      return result
    } catch (error) {
      try {
        if (depth === 0) db.exec('ROLLBACK')
        else db.exec(`ROLLBACK TO ${savepoint}`)
      } catch {
        // Rollback hỏng nghĩa là kết nối đã chết; lỗi gốc mới là thứ đáng báo.
      }
      throw error
    } finally {
      this.txDepth = depth
    }
  }

  // ── Vòng đời ────────────────────────────────────────────────────────────

  close(): void {
    if (this.db === null) return
    try {
      this.db.close()
    } finally {
      this.db = null
    }
  }

  /**
   * §11.1 "Cho phép xóa toàn bộ dữ liệu cục bộ theo profile người dùng."
   *
   * Xoá theo profile chứ không DROP bảng, để migration state được giữ nguyên và app khởi động
   * lại bình thường.
   */
  purgeProfile(profileId: string): void {
    this.transaction(() => {
      // ON DELETE CASCADE lo phần còn lại; local_audit có profile_id nullable nên xoá riêng.
      this.handle.prepare('DELETE FROM local_audit WHERE profile_id = ?').run(profileId)
      this.handle.prepare('DELETE FROM profiles WHERE id = ?').run(profileId)
    })
    this.handle.exec('VACUUM')
    this.log.warn('profile-data-purged', { profileId })
  }

  /** Trả kích thước file DB — hiển thị trong màn hình chẩn đoán. */
  get databasePath(): string {
    return this.opts.path
  }
}
