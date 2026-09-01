import { inflateRawSync } from 'node:zlib'
import { ERROR_CODES, NexaError } from '@nexa/shared-types'

/**
 * Bộ đọc ZIP tối thiểu, chỉ đọc — dùng cho các định dạng OOXML (`.xlsx`, `.pptx`).
 *
 * Vì sao tự viết thay vì thêm thư viện: §14.1 yêu cầu trích xuất chạy trong sandbox có TRẦN
 * bộ nhớ. Một file OOXML là dữ liệu KHÔNG tin cậy do người dùng đưa vào, và ZIP là định dạng
 * khuếch đại rất mạnh — 1 MB nén có thể bung ra vài GB (zip bomb). Ở đây mọi lối bung dữ liệu
 * đều đi qua một trần tường minh:
 *
 *   - `maxEntries`     — chặn central directory có hàng triệu entry rác.
 *   - `maxEntryBytes`  — truyền thẳng vào `inflateRawSync` qua `maxOutputLength`, nên zlib DỪNG
 *                        giữa chừng thay vì cấp phát xong rồi mới phát hiện quá cỡ.
 *   - `maxTotalBytes`  — tổng đã bung của cả archive trong một lần trích xuất.
 *
 * Chỉ hỗ trợ hai phương thức nén mà OOXML dùng thật: 0 (store) và 8 (deflate). Entry mã hoá bị
 * từ chối — Nexa không hỏi mật khẩu file.
 */

const EOCD_SIGNATURE = 0x06054b50
const EOCD64_LOCATOR_SIGNATURE = 0x07064b50
const EOCD64_SIGNATURE = 0x06064b50
const CENTRAL_FILE_SIGNATURE = 0x02014b50
const LOCAL_FILE_SIGNATURE = 0x04034b50

const EOCD_MIN_SIZE = 22
/** Comment cuối file dài tối đa 65535 byte, nên EOCD nằm trong ngần này byte cuối. */
const EOCD_MAX_SEARCH = 0xffff + EOCD_MIN_SIZE

const METHOD_STORE = 0
const METHOD_DEFLATE = 8

/** Cờ bit 0 của general purpose flags: entry được mã hoá. */
const FLAG_ENCRYPTED = 0x0001

export interface ZipLimits {
  /** Trần byte sau khi bung cho MỘT entry. */
  readonly maxEntryBytes: number
  /** Trần byte sau khi bung cộng dồn cho cả archive. */
  readonly maxTotalBytes: number
  readonly maxEntries: number
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxEntryBytes: 64 * 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024,
  maxEntries: 5_000,
}

interface CentralEntry {
  readonly name: string
  readonly method: number
  readonly compressedSize: number
  readonly uncompressedSize: number
  readonly localHeaderOffset: number
  readonly flags: number
}

export class ZipArchive {
  private readonly buffer: Buffer
  private readonly limits: ZipLimits
  private readonly entries: Map<string, CentralEntry>
  private inflatedTotal = 0

  private constructor(buffer: Buffer, limits: ZipLimits, entries: Map<string, CentralEntry>) {
    this.buffer = buffer
    this.limits = limits
    this.entries = entries
  }

  static open(buffer: Buffer, limits: ZipLimits = DEFAULT_ZIP_LIMITS): ZipArchive {
    const directory = readCentralDirectory(buffer, limits)
    return new ZipArchive(buffer, limits, directory)
  }

  has(name: string): boolean {
    return this.entries.has(name)
  }

  names(): string[] {
    return [...this.entries.keys()]
  }

  /** Trả về nội dung entry, hoặc `null` nếu archive không có tên đó. */
  read(name: string): Buffer | null {
    const entry = this.entries.get(name)
    if (entry === undefined) return null
    return this.inflate(entry)
  }

  /** Đọc entry dạng văn bản UTF-8. OOXML luôn là UTF-8. */
  readText(name: string): string | null {
    const raw = this.read(name)
    return raw === null ? null : raw.toString('utf8')
  }

  private inflate(entry: CentralEntry): Buffer {
    if ((entry.flags & FLAG_ENCRYPTED) !== 0) {
      throw fail('zip entry is encrypted')
    }

    const dataStart = this.locateData(entry)
    const dataEnd = dataStart + entry.compressedSize
    if (dataEnd > this.buffer.length) throw fail('zip entry runs past end of file')

    const compressed = this.buffer.subarray(dataStart, dataEnd)
    const budget = Math.min(
      this.limits.maxEntryBytes,
      Math.max(0, this.limits.maxTotalBytes - this.inflatedTotal),
    )
    if (budget <= 0) throw fail('zip inflate budget exhausted')

    let out: Buffer
    if (entry.method === METHOD_STORE) {
      if (compressed.length > budget) throw fail('stored zip entry exceeds inflate budget')
      out = Buffer.from(compressed)
    } else if (entry.method === METHOD_DEFLATE) {
      try {
        out = inflateRawSync(compressed, { maxOutputLength: budget })
      } catch (cause) {
        throw fail('zip entry could not be inflated (corrupt or oversized)', cause)
      }
    } else {
      throw fail(`unsupported zip compression method ${String(entry.method)}`)
    }

    this.inflatedTotal += out.length
    return out
  }

  /**
   * Central directory ghi offset của local header, nhưng dữ liệu nằm sau một phần đuôi có độ dài
   * thay đổi (tên + extra field). Extra field của local header KHÔNG bắt buộc giống central
   * directory, nên phải đọc lại chính local header thay vì tin vào bản sao.
   */
  private locateData(entry: CentralEntry): number {
    const at = entry.localHeaderOffset
    if (at + 30 > this.buffer.length) throw fail('zip local header out of range')
    if (this.buffer.readUInt32LE(at) !== LOCAL_FILE_SIGNATURE) throw fail('bad zip local header')
    const nameLength = this.buffer.readUInt16LE(at + 26)
    const extraLength = this.buffer.readUInt16LE(at + 28)
    return at + 30 + nameLength + extraLength
  }
}

function readCentralDirectory(buffer: Buffer, limits: ZipLimits): Map<string, CentralEntry> {
  const eocd = findEocd(buffer)
  let entryCount = buffer.readUInt16LE(eocd + 10)
  let directoryOffset = buffer.readUInt32LE(eocd + 16)

  // ZIP64: các trường 16/32 bit bị bão hoà, số thật nằm trong bản ghi EOCD64.
  if (entryCount === 0xffff || directoryOffset === 0xffffffff) {
    const zip64 = findEocd64(buffer, eocd)
    entryCount = Number(buffer.readBigUInt64LE(zip64 + 32))
    directoryOffset = Number(buffer.readBigUInt64LE(zip64 + 48))
  }

  if (entryCount > limits.maxEntries) {
    throw fail(`zip has ${String(entryCount)} entries, limit is ${String(limits.maxEntries)}`)
  }

  const entries = new Map<string, CentralEntry>()
  let at = directoryOffset

  for (let i = 0; i < entryCount; i++) {
    if (at + 46 > buffer.length) throw fail('zip central directory is truncated')
    if (buffer.readUInt32LE(at) !== CENTRAL_FILE_SIGNATURE) {
      throw fail('bad zip central directory signature')
    }

    const flags = buffer.readUInt16LE(at + 8)
    const method = buffer.readUInt16LE(at + 10)
    const nameLength = buffer.readUInt16LE(at + 28)
    const extraLength = buffer.readUInt16LE(at + 30)
    const commentLength = buffer.readUInt16LE(at + 32)
    const nameStart = at + 46
    const nameEnd = nameStart + nameLength
    if (nameEnd > buffer.length) throw fail('zip entry name is truncated')

    // Bit 11 = tên đã ở UTF-8. Phần còn lại theo lịch sử là CP437; OOXML chỉ dùng ASCII cho
    // tên part, nên đọc UTF-8 cho cả hai trường hợp là an toàn.
    const name = buffer.subarray(nameStart, nameEnd).toString('utf8')
    const extra = buffer.subarray(nameEnd, nameEnd + extraLength)

    let compressedSize = buffer.readUInt32LE(at + 20)
    let uncompressedSize = buffer.readUInt32LE(at + 24)
    let localHeaderOffset = buffer.readUInt32LE(at + 42)

    if (
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localHeaderOffset === 0xffffffff
    ) {
      const patched = readZip64Extra(extra, {
        uncompressedSize,
        compressedSize,
        localHeaderOffset,
      })
      compressedSize = patched.compressedSize
      uncompressedSize = patched.uncompressedSize
      localHeaderOffset = patched.localHeaderOffset
    }

    // Thư mục (tên kết thúc bằng '/') không mang dữ liệu — bỏ qua.
    if (!name.endsWith('/')) {
      entries.set(name, {
        name,
        method,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
        flags,
      })
    }

    at = nameEnd + extraLength + commentLength
  }

  return entries
}

function findEocd(buffer: Buffer): number {
  if (buffer.length < EOCD_MIN_SIZE) throw fail('file is too small to be a zip')
  const from = Math.max(0, buffer.length - EOCD_MAX_SEARCH)
  for (let at = buffer.length - EOCD_MIN_SIZE; at >= from; at--) {
    if (buffer.readUInt32LE(at) === EOCD_SIGNATURE) return at
  }
  throw fail('zip end-of-central-directory record not found')
}

function findEocd64(buffer: Buffer, eocd: number): number {
  const locator = eocd - 20
  if (locator < 0 || buffer.readUInt32LE(locator) !== EOCD64_LOCATOR_SIGNATURE) {
    throw fail('zip64 locator not found')
  }
  const at = Number(buffer.readBigUInt64LE(locator + 8))
  if (at < 0 || at + 56 > buffer.length || buffer.readUInt32LE(at) !== EOCD64_SIGNATURE) {
    throw fail('zip64 end-of-central-directory record not found')
  }
  return at
}

/**
 * Extra field 0x0001 chứa các giá trị 64-bit, và CHỈ chứa những trường đã bị bão hoà ở
 * central directory — theo đúng thứ tự cố định. Đọc sai thứ tự này là lỗi kinh điển khi
 * đọc zip64, nên phải bám vào việc trường nào đang là 0xFFFFFFFF.
 */
function readZip64Extra(
  extra: Buffer,
  current: { uncompressedSize: number; compressedSize: number; localHeaderOffset: number },
): { uncompressedSize: number; compressedSize: number; localHeaderOffset: number } {
  let at = 0
  while (at + 4 <= extra.length) {
    const id = extra.readUInt16LE(at)
    const size = extra.readUInt16LE(at + 2)
    const body = extra.subarray(at + 4, at + 4 + size)
    if (id === 0x0001) {
      let cursor = 0
      const next = (): number => {
        if (cursor + 8 > body.length) throw fail('zip64 extra field is truncated')
        const value = Number(body.readBigUInt64LE(cursor))
        cursor += 8
        return value
      }
      return {
        uncompressedSize:
          current.uncompressedSize === 0xffffffff ? next() : current.uncompressedSize,
        compressedSize: current.compressedSize === 0xffffffff ? next() : current.compressedSize,
        localHeaderOffset:
          current.localHeaderOffset === 0xffffffff ? next() : current.localHeaderOffset,
      }
    }
    at += 4 + size
  }
  throw fail('zip64 sizes are missing from the extra field')
}

function fail(detail: string, cause?: unknown): NexaError {
  return new NexaError(ERROR_CODES.DOCUMENT_EXTRACTION_FAILED, {
    safeDetail: detail,
    ...(cause !== undefined ? { cause } : {}),
  })
}
