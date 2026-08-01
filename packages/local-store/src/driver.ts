import { createRequire } from 'node:module'
import { ERROR_CODES, NexaError } from '@nexa/shared-types'

/**
 * Nạp driver bằng `createRequire` chứ không `import()`.
 *
 * Lý do: cả Vite (khi chạy test) lẫn electron-vite (khi build) đều cố phân giải `import()`
 * lúc bundle — Vite thì làm rụng mất tiền tố `node:` của `node:sqlite`, còn electron-vite thì
 * muốn kéo native binding của better-sqlite3 vào bundle. `createRequire` đi thẳng ra runtime,
 * không bundler nào chạm vào.
 */
const nodeRequire = createRequire(import.meta.url)

/**
 * Lớp trừu tượng mỏng trên SQLite.
 *
 * Tồn tại vì hai lý do:
 *  1. Bản phát hành Electron dùng `better-sqlite3` — nhanh, ổn định, nhưng là native module
 *     phải rebuild theo ABI của Electron.
 *  2. Test và máy dev không có toolchain C++ dùng `node:sqlite` (có sẵn từ Node 22.5+).
 *
 * Chỉ dùng tham số vị trí `?`. Không dùng named parameter, không truyền boolean hay `undefined`
 * — hai driver xử lý khác nhau ở đúng chỗ đó, nên ta chuẩn hoá về `0/1` và `null` ở tầng repository.
 */

export type SqlParam = string | number | bigint | Buffer | Uint8Array | null

export interface SqlRunResult {
  readonly changes: number
}

export interface SqlStatement {
  run(...params: SqlParam[]): SqlRunResult
  get(...params: SqlParam[]): Record<string, unknown> | undefined
  all(...params: SqlParam[]): Record<string, unknown>[]
}

export interface SqlDatabase {
  exec(sql: string): void
  prepare(sql: string): SqlStatement
  close(): void
  readonly driverName: string
}

export type DriverKind = 'better-sqlite3' | 'node:sqlite'

/** Điều kiện chung cho mọi kết nối, áp ngay sau khi mở. */
const PRAGMAS = [
  // WAL: đọc không chặn ghi. Quan trọng vì search quét cả bảng messages.
  'PRAGMA journal_mode = WAL',
  // FULL sẽ an toàn hơn nhưng chậm; NORMAL + WAL đủ bền với crash ứng dụng
  // (chỉ mất dữ liệu khi mất điện đột ngột, và ta không lưu giao dịch tài chính).
  'PRAGMA synchronous = NORMAL',
  'PRAGMA foreign_keys = ON',
  // Nếu DB đang bị tiến trình khác giữ, chờ tối đa 5s rồi báo LOCAL_DB_LOCKED (§16).
  'PRAGMA busy_timeout = 5000',
  // §11.1: không để SQLite ghi file tạm chứa dữ liệu đã giải mã ra đĩa.
  'PRAGMA temp_store = MEMORY',
]

export function openDatabase(
  path: string,
  preferred: DriverKind = 'better-sqlite3',
): SqlDatabase {
  const order: DriverKind[] =
    preferred === 'better-sqlite3'
      ? ['better-sqlite3', 'node:sqlite']
      : ['node:sqlite', 'better-sqlite3']

  const failures: string[] = []
  for (const kind of order) {
    try {
      const db = kind === 'better-sqlite3' ? openBetterSqlite(path) : openNodeSqlite(path)
      for (const pragma of PRAGMAS) {
        try {
          db.exec(pragma)
        } catch {
          // node:sqlite từ chối một vài pragma trả về giá trị; không ảnh hưởng tính đúng đắn.
        }
      }
      return db
    } catch (e) {
      failures.push(`${kind}: ${e instanceof Error ? e.message : 'unknown'}`)
    }
  }

  throw new NexaError(ERROR_CODES.LOCAL_DB_LOCKED, {
    safeDetail: `no sqlite driver available (${failures.join('; ')})`,
  })
}

function openBetterSqlite(path: string): SqlDatabase {
  const Ctor = nodeRequire('better-sqlite3') as new (p: string) => BetterSqliteHandle
  const db = new Ctor(path)
  return {
    driverName: 'better-sqlite3',
    exec: (sql) => db.exec(sql),
    prepare: (sql) => {
      const st = db.prepare(sql)
      return {
        run: (...p) => ({ changes: Number(st.run(...p).changes) }),
        get: (...p) => st.get(...p) as Record<string, unknown> | undefined,
        all: (...p) => st.all(...p) as Record<string, unknown>[],
      }
    },
    close: () => db.close(),
  }
}

function openNodeSqlite(path: string): SqlDatabase {
  const mod = nodeRequire('node:sqlite') as { DatabaseSync: new (p: string) => NodeSqliteHandle }
  const db = new mod.DatabaseSync(path)
  return {
    driverName: 'node:sqlite',
    exec: (sql) => db.exec(sql),
    prepare: (sql) => {
      const st = db.prepare(sql)
      return {
        run: (...p) => ({ changes: Number(st.run(...p).changes) }),
        // node:sqlite trả object có prototype null; sao chép sang object thường để
        // `'col' in row` và spread hoạt động như mong đợi ở tầng trên.
        get: (...p) => {
          const row = st.get(...p)
          return row === undefined ? undefined : { ...(row as Record<string, unknown>) }
        },
        all: (...p) => (st.all(...p) as Record<string, unknown>[]).map((r) => ({ ...r })),
      }
    },
    close: () => db.close(),
  }
}

interface BetterSqliteHandle {
  exec(sql: string): unknown
  prepare(sql: string): {
    run(...p: SqlParam[]): { changes: number | bigint }
    get(...p: SqlParam[]): unknown
    all(...p: SqlParam[]): unknown[]
  }
  close(): void
}

interface NodeSqliteHandle {
  exec(sql: string): void
  prepare(sql: string): {
    run(...p: SqlParam[]): { changes: number | bigint }
    get(...p: SqlParam[]): unknown
    all(...p: SqlParam[]): unknown[]
  }
  close(): void
}

/** Chuẩn hoá boolean → 0/1. Cả hai driver đều từ chối boolean thuần. */
export function b(value: boolean): number {
  return value ? 1 : 0
}

/** Chuẩn hoá `undefined` → null. Cả hai driver đều từ chối `undefined`. */
export function n<T extends SqlParam>(value: T | undefined | null): T | null {
  return value ?? null
}
