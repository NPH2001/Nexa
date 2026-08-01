import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import { statSync } from 'node:fs'
import { dialog, type BrowserWindow } from 'electron'
import { ERROR_CODES, NexaError } from '@nexa/shared-types'
import type { Logger } from '@nexa/observability'
import type { FileDescriptor } from '@nexa/document-processor'

/**
 * §5.3: "Không cho UI truyền đường dẫn tùy ý để đọc file; chỉ sử dụng handle từ file picker."
 * §3: "Explicit file access — Chỉ đọc file do người dùng chủ động chọn; không quét thư mục."
 *
 * Cách thực thi: đường dẫn thật KHÔNG BAO GIỜ rời main process. `file:pick` mở hộp thoại,
 * lưu đường dẫn vào một Map trong bộ nhớ và trả về một UUID. Renderer chỉ cầm UUID đó.
 *
 * Hệ quả có chủ ý: renderer không thể yêu cầu đọc một file mà người dùng chưa tự tay chọn,
 * kể cả khi renderer bị chèn mã.
 */

export interface PickedFile {
  readonly token: string
  readonly fileName: string
  readonly sizeBytes: number
}

interface Lease {
  readonly path: string
  readonly fileName: string
  readonly sizeBytes: number
  readonly pickedAtMs: number
}

/** Handle hết hạn sau 30 phút — không để một token cũ mở lại file sau khi người dùng quên. */
const LEASE_TTL_MS = 30 * 60 * 1000

export class FileBroker {
  private readonly leases = new Map<string, Lease>()
  private readonly log: Logger

  constructor(
    logger: Logger,
    private readonly limits: { maxFilesPerRequest: number; maxFileSizeMb: number },
  ) {
    this.log = logger.child({ module: 'file-broker' })
  }

  async pick(window: BrowserWindow): Promise<PickedFile[]> {
    const result = await dialog.showOpenDialog(window, {
      title: 'Chọn tài liệu để đính kèm',
      properties: ['openFile', 'multiSelections', 'dontAddToRecent'],
      filters: [
        { name: 'Tài liệu được hỗ trợ', extensions: ['txt', 'md', 'markdown', 'csv', 'log', 'pdf', 'docx'] },
      ],
    })
    if (result.canceled) return []

    if (result.filePaths.length > this.limits.maxFilesPerRequest) {
      throw new NexaError(ERROR_CODES.TOO_MANY_FILES, {
        safeDetail: `${String(result.filePaths.length)} files selected`,
      })
    }

    this.sweep()

    const picked: PickedFile[] = []
    for (const path of result.filePaths) {
      const stats = statSync(path)
      const token = randomUUID()
      const fileName = basename(path)

      this.leases.set(token, {
        path,
        fileName,
        sizeBytes: stats.size,
        pickedAtMs: Date.now(),
      })
      picked.push({ token, fileName, sizeBytes: stats.size })
    }

    // Log số lượng và dung lượng, KHÔNG log tên file (§15.1 cấm nội dung người dùng, và
    // tên file thường tiết lộ nội dung).
    this.log.info('files-picked', {
      count: picked.length,
      totalBytes: picked.reduce((sum, f) => sum + f.sizeBytes, 0),
    })
    return picked
  }

  /** Đổi token thành đường dẫn thật. Chỉ main process gọi được hàm này. */
  resolve(tokens: readonly string[]): FileDescriptor[] {
    this.sweep()
    return tokens.map((token) => {
      const lease = this.leases.get(token)
      if (lease === undefined) {
        throw new NexaError(ERROR_CODES.FILE_UNSUPPORTED, {
          safeDetail: 'file handle expired or unknown; please pick the file again',
        })
      }
      return { path: lease.path, fileName: lease.fileName, sizeBytes: lease.sizeBytes }
    })
  }

  release(token: string): void {
    this.leases.delete(token)
  }

  releaseAll(tokens: readonly string[]): void {
    for (const token of tokens) this.leases.delete(token)
  }

  get activeCount(): number {
    return this.leases.size
  }

  private sweep(): void {
    const cutoff = Date.now() - LEASE_TTL_MS
    for (const [token, lease] of this.leases) {
      if (lease.pickedAtMs < cutoff) this.leases.delete(token)
    }
  }
}
