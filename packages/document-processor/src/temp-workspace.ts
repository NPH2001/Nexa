import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Logger } from '@nexa/observability'

/**
 * §8.3 / §14.1: "File tạm — Xóa ngay sau xử lý; dọn thêm khi khởi động nếu phiên trước bị crash."
 *
 * Lưu ý về hiện trạng: pipeline trích xuất hiện đọc thẳng từ file gốc và giữ text trong RAM,
 * nên bình thường thư mục này TRỐNG. Lớp này vẫn tồn tại vì hai lý do:
 *  - `sweepOnStartup()` dọn tàn dư của các bản trước hoặc của tính năng sau này.
 *  - Nó là chỗ duy nhất được phép tạo file tạm, nên khi có tính năng cần temp thì đã có sẵn
 *    đường đi đúng thay vì ai đó gọi `os.tmpdir()` và quên dọn.
 */
export class TempWorkspace {
  private readonly root: string
  private readonly log: Logger
  private readonly leases = new Set<string>()

  constructor(root: string, logger: Logger) {
    this.root = root
    this.log = logger.child({ module: 'temp-workspace' })
    mkdirSync(this.root, { recursive: true })
  }

  get path(): string {
    return this.root
  }

  /**
   * Cấp một thư mục tạm. Người gọi PHẢI `release()` trong `finally` (§14.1).
   */
  lease(prefix = 'doc-'): string {
    const dir = mkdtempSync(join(this.root, prefix))
    this.leases.add(dir)
    return dir
  }

  release(dir: string): void {
    this.leases.delete(dir)
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // Antivirus hoặc file đang mở có thể giữ handle; lần sweep sau sẽ dọn.
    }
  }

  /** Xoá mọi lease còn treo — gọi khi app thoát bình thường. */
  releaseAll(): void {
    for (const dir of [...this.leases]) this.release(dir)
  }

  /**
   * Dọn tàn dư lúc khởi động. Chỉ xoá thứ cũ hơn `maxAgeMs` để không cướp thư mục
   * của một instance Nexa khác đang chạy song song.
   */
  sweepOnStartup(maxAgeMs = 60 * 60 * 1000): number {
    let removed = 0
    const cutoff = Date.now() - maxAgeMs
    let entries: string[]
    try {
      entries = readdirSync(this.root)
    } catch {
      return 0
    }

    for (const name of entries) {
      const full = join(this.root, name)
      try {
        if (statSync(full).mtimeMs >= cutoff) continue
        rmSync(full, { recursive: true, force: true })
        removed++
      } catch {
        // Bỏ qua: không xoá được thì cũng không nên làm hỏng lần khởi động.
      }
    }

    if (removed > 0) this.log.info('temp-swept-on-startup', { removed })
    return removed
  }
}
