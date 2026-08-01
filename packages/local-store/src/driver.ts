import { createRequire } from 'node:module'
import { ERROR_CODES, NexaError } from '@nexa/shared-types'

/**
 * Nạp driver bằng `createRequire` chứ không `import()`.
 *
 * Lý do: cả Vite (khi chạy test) lẫn electron-vite (khi build) đều cố phân giải `import()`
 * lúc bundle — Vite thì làm rụng mất tiền tố `node:` của `node:sqlite`, còn electron-vite thì
 * muốn kéo native binding vào bundle. `createRequire` đi thẳng ra runtime, không bundler nào
 * chạm vào.
 */
const nodeRequire = createRequire(import.meta.url)

/**
 * Lớp trừu tượng mỏng trên SQLite.
 *
 * **`node:sqlite` là driver được dùng thật** — cả trong test lẫn trong bản phát hành. Electron 43
 * mang Node 24 nên nó có sẵn, và bộ cài không chứa native module nào. Xem ADR 0003.
 *
 * `better-sqlite3` **KHÔNG được cài và KHÔNG được đóng gói**. Đường dẫn tới nó giữ lại làm lối
 * thoát: nếu một bản Electron sau này bỏ `node:sqlite`, chỉ cần `pnpm add better-sqlite3` rồi đổi
 * `driver: 'better-sqlite3'` là quay về được, không phải viết lại tầng lưu trữ. Dữ liệu là file
 * SQLite chuẩn nên không cần chuyển đổi gì.
 *
 * Chỉ dùng tham số vị trí `?`. Không dùng named parameter, không truyền boolean hay `undefined`
 * — hai driver xử lý khác nhau ở đúng chỗ đó, nên ta chuẩn hoá về `0/1` và `null` bằng `b()`
 * và `n()` ở tầng repository.
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

export type DriverKind = 'node:sqlite' | 'better-sqlite3'

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

/**
 * Mở database, thử driver ưu tiên trước rồi tới driver còn lại.
 *
 * Khi CẢ HAI đều không nạp được thì lỗi phải nói rõ vì sao từng cái thất bại — đây chính là
 * tình huống đã gặp thật khi Electron 33 (Node 20) không có `node:sqlite` và cũng không có
 * binding của better-sqlite3. Một thông báo "không mở được DB" không kèm nguyên nhân thì
 * mất hàng giờ để chẩn đoán.
 */
export function openDatabase(path: string, preferred: DriverKind = 'node:sqlite'): SqlDatabase {
  const order: DriverKind[] =
    preferred === 'node:sqlite'
      ? ['node:sqlite', 'better-sqlite3']
      : ['better-sqlite3', 'node:sqlite']

  const failures: string[] = []
  for (const kind of order) {
    try {
      const db = kind === 'node:sqlite' ? openNodeSqlite(path) : openBetterSqlite(path)
      for (const pragma of PRAGMAS) {
        try {
          db.exec(pragma)
        } catch {
          // Một vài pragma trả về giá trị thay vì chạy im lặng; không ảnh hưởng tính đúng đắn.
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

/** Lối thoát — chỉ chạy nếu ai đó cài better-sqlite3 bằng tay. Xem ghi chú ở đầu file. */
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
