import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, dialog, type BrowserWindow } from 'electron'
import {
  ERROR_CODES,
  FILE_BLOCK_FORMAT_META,
  MAX_FILE_BLOCK_BYTES,
  NexaError,
  isFileBlockFormat,
  normalizeFileName,
  utf8ByteLength,
  type FileBlockFormat,
} from '@nexa/shared-types'
import type { Logger } from '@nexa/observability'

/**
 * Ghi khối nội dung do model sinh ra xuống ổ đĩa (openspec `add-generated-file-download`).
 *
 * Đối xứng với `FileBroker` ở luồng đọc, và chịu đúng những ràng buộc đó:
 *   - §11.1 "Không cho renderer truy cập trực tiếp Node.js hoặc hệ thống file" ⇒ mọi lần ghi đi
 *     qua đây, trong main process.
 *   - §5.3 "Không cho UI truyền đường dẫn tùy ý" ⇒ renderer chỉ gửi nội dung và một tên gợi ý.
 *     Đường dẫn thật do `dialog.showSaveDialog` sinh ra và KHÔNG rời main process.
 *   - Threat model "không coi LLM output là dữ liệu tin cậy" ⇒ tên file và định dạng được kiểm
 *     lại ở đây, bất kể renderer đã kiểm gì.
 *
 * Cố ý KHÔNG có: tự lưu, ghi hàng loạt, `shell.openPath`, `shell.showItemInFolder`. Mở một file do
 * model sinh ra là một bước xa hơn hẳn việc lưu nó, và không nằm trong phạm vi change này.
 */

export interface FileSaveRequest {
  readonly fileName: string
  readonly format: string
  readonly content: string
}

export type FileSaveResult = { saved: true; fileName: string } | { saved: false; canceled: true }

/** Mã lỗi hệ thống file mà người dùng tự xử lý được — phân biệt với lỗi lập trình. */
const RECOVERABLE_WRITE_ERRORS = new Set(['EACCES', 'EBUSY', 'ENOSPC', 'EPERM', 'EROFS', 'EMFILE'])

export class FileWriter {
  private readonly log: Logger

  constructor(logger: Logger) {
    this.log = logger.child({ module: 'file-writer' })
  }

  async save(window: BrowserWindow, request: FileSaveRequest): Promise<FileSaveResult> {
    const format = this.requireFormat(request.format)
    const meta = FILE_BLOCK_FORMAT_META[format]

    const bytes = utf8ByteLength(request.content)
    if (bytes > MAX_FILE_BLOCK_BYTES) {
      throw new NexaError(ERROR_CODES.FILE_TOO_LARGE, {
        safeDetail: `${String(bytes)} bytes exceeds block limit`,
      })
    }

    // Chuẩn hoá LẠI, không tin tên renderer gửi lên: `..`, ký tự Windows cấm và tên thiết bị đều
    // rụng ở đây. Đây là lớp thứ hai, cùng lập trường với `FileBroker.resolve()`.
    const safeName = normalizeFileName(request.fileName, format)

    const result = await dialog.showSaveDialog(window, {
      title: 'Lưu file',
      defaultPath: join(app.getPath('downloads'), safeName),
      filters: [{ name: meta.label, extensions: [meta.extension] }],
      // `dontAddToRecent` cùng lý do như ở `FileBroker.pick()`: tên file thường tiết lộ nội dung,
      // nên nó không nên đọng lại trong danh sách Recent của Windows.
      properties: ['dontAddToRecent', 'showOverwriteConfirmation'],
    })

    if (result.canceled || result.filePath === undefined || result.filePath === '') {
      // Huỷ không phải lỗi: không ghi gì, không báo lỗi, không toast.
      this.log.info('file-save-canceled', { format, bytes })
      return { saved: false, canceled: true }
    }

    try {
      // `writeFile` async chứ không `writeFileSync`: một file 1 MB trên ổ mạng đủ để làm nghẽn
      // main process, và main process nghẽn là cả UI đứng.
      await writeFile(result.filePath, request.content, 'utf8')
    } catch (error) {
      const code = errorCode(error)
      this.log.warn('file-save-failed', { format, bytes, errorType: code })
      throw new NexaError(ERROR_CODES.FILE_WRITE_FAILED, {
        safeDetail: RECOVERABLE_WRITE_ERRORS.has(code) ? code : 'write failed',
      })
    }

    // Log định dạng và số byte, KHÔNG log tên file lẫn đường dẫn (§15.1 cấm nội dung người dùng,
    // và tên file thường tiết lộ nội dung — cùng lý do `FileBroker` không log tên file đã chọn).
    this.log.info('file-saved', { format, bytes })
    return { saved: true, fileName: safeName }
  }

  /**
   * Định dạng phải nằm trong allowlist. Schema Zod đã chặn ở biên IPC; đây là lần kiểm thứ hai,
   * vì allowlist là thứ duy nhất chắn giữa "chuỗi ký tự model sinh ra" và một file trên ổ đĩa.
   */
  private requireFormat(value: string): FileBlockFormat {
    if (!isFileBlockFormat(value)) {
      throw new NexaError(ERROR_CODES.FILE_UNSUPPORTED, {
        safeDetail: 'format not in generated-file allowlist',
      })
    }
    return value
  }
}

function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code
    if (typeof code === 'string') return code
  }
  return error instanceof Error ? error.name : 'unknown'
}
