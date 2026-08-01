import { appendFileSync, existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type { LogRecord, LogSink } from './logger.js'

export interface FileSinkOptions {
  readonly dir: string
  /** Tên cơ sở, không kèm đuôi. Mặc định 'nexa'. */
  readonly baseName?: string
  /** Xoay vòng khi file vượt ngưỡng. §8.3 "giới hạn dung lượng". */
  readonly maxBytes?: number
  /** Số file lịch sử giữ lại. */
  readonly maxFiles?: number
  /** §8.3 "Log debug 7–14 ngày". */
  readonly retentionDays?: number
}

/**
 * Ghi JSON-lines ra đĩa, xoay vòng theo dung lượng và dọn theo tuổi.
 *
 * Ghi đồng bộ có chủ ý: log bảo mật và log crash phải nằm trên đĩa TRƯỚC khi tiến trình chết.
 * Khối lượng log của một desktop app đơn người dùng đủ nhỏ để không cần async batching.
 */
export class FileSink implements LogSink {
  private readonly dir: string
  private readonly baseName: string
  private readonly maxBytes: number
  private readonly maxFiles: number
  private readonly retentionDays: number
  private currentPath: string
  /** Khi ổ đĩa hỏng/không ghi được: chuyển sang im lặng thay vì làm sập app. */
  private disabled = false

  constructor(opts: FileSinkOptions) {
    this.dir = opts.dir
    this.baseName = opts.baseName ?? 'nexa'
    this.maxBytes = opts.maxBytes ?? 8 * 1024 * 1024
    this.maxFiles = opts.maxFiles ?? 5
    this.retentionDays = opts.retentionDays ?? 14
    this.currentPath = join(this.dir, `${this.baseName}.log`)

    try {
      mkdirSync(this.dir, { recursive: true })
      this.pruneOld()
    } catch {
      this.disabled = true
    }
  }

  get active(): boolean {
    return !this.disabled
  }

  get path(): string {
    return this.currentPath
  }

  write(record: LogRecord): void {
    if (this.disabled) return
    try {
      this.rotateIfNeeded()
      appendFileSync(this.currentPath, `${JSON.stringify(record)}\n`, 'utf8')
    } catch {
      this.disabled = true
    }
  }

  private rotateIfNeeded(): void {
    if (!existsSync(this.currentPath)) return
    if (statSync(this.currentPath).size < this.maxBytes) return

    // nexa.4.log bị xoá, nexa.3.log → nexa.4.log, ..., nexa.log → nexa.1.log
    for (let i = this.maxFiles - 1; i >= 1; i--) {
      const from = join(this.dir, `${this.baseName}.${i}.log`)
      const to = join(this.dir, `${this.baseName}.${i + 1}.log`)
      if (!existsSync(from)) continue
      if (i + 1 > this.maxFiles) {
        unlinkSync(from)
      } else {
        renameSync(from, to)
      }
    }
    renameSync(this.currentPath, join(this.dir, `${this.baseName}.1.log`))
  }

  /** Xoá log quá hạn (§8.3). Chạy lúc khởi tạo. */
  private pruneOld(): void {
    const cutoff = Date.now() - this.retentionDays * 24 * 60 * 60 * 1000
    for (const name of readdirSync(this.dir)) {
      if (!name.startsWith(this.baseName) || !name.endsWith('.log')) continue
      const full = join(this.dir, name)
      try {
        if (statSync(full).mtimeMs < cutoff) unlinkSync(full)
      } catch {
        // File bị tiến trình khác giữ — bỏ qua, lần sau dọn tiếp.
      }
    }
  }

  /** Danh sách file log hiện có, mới nhất trước — dùng cho diagnostics export. */
  listFiles(): string[] {
    if (this.disabled) return []
    try {
      return readdirSync(this.dir)
        .filter((n) => n.startsWith(this.baseName) && n.endsWith('.log'))
        .map((n) => join(this.dir, n))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    } catch {
      return []
    }
  }
}
