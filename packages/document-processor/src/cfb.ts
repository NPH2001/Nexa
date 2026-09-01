import { ERROR_CODES, NexaError } from '@nexa/shared-types'

/**
 * Bộ đọc Compound File Binary (OLE2) — vỏ chứa của bộ ba Office 97-2003: `.doc`, `.xls`, `.ppt`.
 *
 * CFB là một hệ thống file thu nhỏ nằm trong một file: có bảng cấp phát sector (FAT), có thư mục
 * dạng cây, và có "mini stream" riêng cho các stream nhỏ. Ta chỉ cần một việc — lấy nội dung
 * một stream theo tên — nên ở đây chỉ hiện thực đúng phần đó, ở chế độ CHỈ ĐỌC.
 *
 * Ba chỗ dễ bị lợi dụng khi đọc dữ liệu không tin cậy, và cách chặn:
 *   - Chuỗi sector vòng lặp vô hạn → mỗi lần lần theo chain đều có trần số bước.
 *   - `streamSize` khai láo cực lớn → cắt theo lượng dữ liệu thật đọc được và theo `maxStreamBytes`.
 *   - Sector trỏ ra ngoài file → kiểm tra biên trước từng lần đọc.
 *
 * KHÔNG chạm tới macro: stream `Macros`/`VBA` nằm trong cùng file này nhưng người gọi chỉ hỏi
 * đúng stream văn bản, và không có đường nào ở đây thực thi nội dung (§14 "không xử lý macro").
 */

const CFB_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])

const MAXREGSECT = 0xfffffffa
const DIFSECT = 0xfffffffc
const FATSECT = 0xfffffffd
const ENDOFCHAIN = 0xfffffffe
const FREESECT = 0xffffffff

const DIRECTORY_ENTRY_SIZE = 128
const OBJECT_TYPE_STREAM = 2
const OBJECT_TYPE_ROOT = 5

/** Trần số bước khi lần theo một chain — chặn file dựng ngược tạo vòng lặp. */
const MAX_CHAIN_STEPS = 1_000_000

export interface CfbLimits {
  readonly maxStreamBytes: number
}

export const DEFAULT_CFB_LIMITS: CfbLimits = { maxStreamBytes: 128 * 1024 * 1024 }

interface DirectoryEntry {
  readonly name: string
  readonly objectType: number
  readonly startSector: number
  readonly size: number
}

export class CfbArchive {
  private readonly buffer: Buffer
  private readonly limits: CfbLimits
  private readonly sectorSize: number
  private readonly miniSectorSize: number
  private readonly miniStreamCutoff: number
  private readonly fat: Uint32Array
  private readonly miniFat: Uint32Array
  private readonly entries: Map<string, DirectoryEntry>
  private readonly root: DirectoryEntry
  private miniStream: Buffer | null = null

  private constructor(init: {
    buffer: Buffer
    limits: CfbLimits
    sectorSize: number
    miniSectorSize: number
    miniStreamCutoff: number
    fat: Uint32Array
    miniFat: Uint32Array
    entries: Map<string, DirectoryEntry>
    root: DirectoryEntry
  }) {
    this.buffer = init.buffer
    this.limits = init.limits
    this.sectorSize = init.sectorSize
    this.miniSectorSize = init.miniSectorSize
    this.miniStreamCutoff = init.miniStreamCutoff
    this.fat = init.fat
    this.miniFat = init.miniFat
    this.entries = init.entries
    this.root = init.root
  }

  static isCfb(head: Buffer): boolean {
    return head.length >= 8 && head.subarray(0, 8).equals(CFB_SIGNATURE)
  }

  static open(buffer: Buffer, limits: CfbLimits = DEFAULT_CFB_LIMITS): CfbArchive {
    if (!CfbArchive.isCfb(buffer)) throw failure('not an OLE compound file')
    if (buffer.length < 512) throw failure('compound file header is truncated')

    const sectorShift = buffer.readUInt16LE(0x1e)
    const miniSectorShift = buffer.readUInt16LE(0x20)
    if (sectorShift !== 9 && sectorShift !== 12) {
      throw failure(`unsupported compound file sector shift ${String(sectorShift)}`)
    }
    if (miniSectorShift !== 6) {
      throw failure(`unsupported compound file mini sector shift ${String(miniSectorShift)}`)
    }

    const sectorSize = 1 << sectorShift
    const miniSectorSize = 1 << miniSectorShift
    const miniStreamCutoff = buffer.readUInt32LE(0x38)

    const fat = readFat(buffer, sectorSize)
    const miniFat = readChainAsUint32(
      buffer,
      fat,
      sectorSize,
      buffer.readUInt32LE(0x3c),
      buffer.readUInt32LE(0x40),
    )

    const { entries, root } = readDirectory(buffer, fat, sectorSize, buffer.readUInt32LE(0x30))

    return new CfbArchive({
      buffer,
      limits,
      sectorSize,
      miniSectorSize,
      miniStreamCutoff,
      fat,
      miniFat,
      entries,
      root,
    })
  }

  names(): string[] {
    return [...this.entries.keys()]
  }

  has(name: string): boolean {
    return this.entries.has(name)
  }

  /** Trả nội dung stream theo tên, hoặc `null` nếu không có. Tên phân biệt hoa thường. */
  stream(name: string): Buffer | null {
    const entry = this.entries.get(name)
    if (entry === undefined || entry.objectType !== OBJECT_TYPE_STREAM) return null
    if (entry.size > this.limits.maxStreamBytes) {
      throw failure(`compound file stream "${name}" exceeds the size limit`)
    }
    if (entry.size === 0) return Buffer.alloc(0)

    if (entry.size < this.miniStreamCutoff) {
      return this.readFromMiniStream(entry)
    }
    return readChain(this.buffer, this.fat, this.sectorSize, entry.startSector, entry.size)
  }

  /** Stream đầu tiên có tên nằm trong `candidates` — Office đổi tên stream giữa các phiên bản. */
  firstStream(candidates: readonly string[]): Buffer | null {
    for (const name of candidates) {
      const found = this.stream(name)
      if (found !== null) return found
    }
    return null
  }

  private readFromMiniStream(entry: DirectoryEntry): Buffer {
    // Mini stream là MỘT stream thường do root nắm giữ; các stream nhỏ nằm gọn bên trong nó.
    this.miniStream ??= readChain(
      this.buffer,
      this.fat,
      this.sectorSize,
      this.root.startSector,
      this.root.size,
    )

    const out = Buffer.alloc(entry.size)
    let written = 0
    let sector = entry.startSector
    let steps = 0

    while (sector <= MAXREGSECT && written < entry.size) {
      if (steps++ > MAX_CHAIN_STEPS) throw failure('mini stream chain does not terminate')
      const at = sector * this.miniSectorSize
      if (at + this.miniSectorSize > this.miniStream.length) {
        throw failure('mini stream sector is out of range')
      }
      const take = Math.min(this.miniSectorSize, entry.size - written)
      this.miniStream.copy(out, written, at, at + take)
      written += take
      sector = this.miniFat[sector] ?? ENDOFCHAIN
    }

    return out.subarray(0, written)
  }
}

function readFat(buffer: Buffer, sectorSize: number): Uint32Array {
  const entriesPerSector = sectorSize / 4
  const fatSectorCount = buffer.readUInt32LE(0x2c)
  const sectors: number[] = []

  // 109 mục đầu của DIFAT nằm ngay trong header; phần dư tràn sang các sector DIFAT nối nhau.
  for (let i = 0; i < 109 && sectors.length < fatSectorCount; i++) {
    const sector = buffer.readUInt32LE(0x4c + i * 4)
    if (sector > MAXREGSECT) break
    sectors.push(sector)
  }

  let difatSector = buffer.readUInt32LE(0x44)
  let difatRemaining = buffer.readUInt32LE(0x48)
  let steps = 0

  while (difatSector <= MAXREGSECT && difatRemaining > 0 && sectors.length < fatSectorCount) {
    if (steps++ > MAX_CHAIN_STEPS) throw failure('DIFAT chain does not terminate')
    const at = sectorOffset(difatSector, sectorSize)
    requireRange(buffer, at, sectorSize, 'DIFAT sector')
    for (let i = 0; i < entriesPerSector - 1 && sectors.length < fatSectorCount; i++) {
      const sector = buffer.readUInt32LE(at + i * 4)
      if (sector > MAXREGSECT) continue
      sectors.push(sector)
    }
    // Dword cuối mỗi sector DIFAT trỏ tới sector DIFAT kế tiếp.
    difatSector = buffer.readUInt32LE(at + (entriesPerSector - 1) * 4)
    difatRemaining--
  }

  const fat = new Uint32Array(sectors.length * entriesPerSector)
  sectors.forEach((sector, index) => {
    const at = sectorOffset(sector, sectorSize)
    requireRange(buffer, at, sectorSize, 'FAT sector')
    for (let i = 0; i < entriesPerSector; i++) {
      fat[index * entriesPerSector + i] = buffer.readUInt32LE(at + i * 4)
    }
  })
  return fat
}

function readChainAsUint32(
  buffer: Buffer,
  fat: Uint32Array,
  sectorSize: number,
  start: number,
  sectorCount: number,
): Uint32Array {
  if (start > MAXREGSECT || sectorCount === 0) return new Uint32Array(0)
  const raw = readChain(buffer, fat, sectorSize, start, sectorCount * sectorSize)
  const out = new Uint32Array(Math.floor(raw.length / 4))
  for (let i = 0; i < out.length; i++) out[i] = raw.readUInt32LE(i * 4)
  return out
}

function readChain(
  buffer: Buffer,
  fat: Uint32Array,
  sectorSize: number,
  start: number,
  size: number,
): Buffer {
  const chunks: Buffer[] = []
  let sector = start
  let remaining = size
  let steps = 0

  while (sector <= MAXREGSECT && remaining > 0) {
    if (steps++ > MAX_CHAIN_STEPS) throw failure('sector chain does not terminate')
    const at = sectorOffset(sector, sectorSize)
    requireRange(buffer, at, sectorSize, 'stream sector')
    const take = Math.min(sectorSize, remaining)
    chunks.push(buffer.subarray(at, at + take))
    remaining -= take

    const next = fat[sector]
    if (next === undefined) break
    if (next === FATSECT || next === DIFSECT || next === FREESECT || next === ENDOFCHAIN) break
    sector = next
  }

  return Buffer.concat(chunks)
}

function readDirectory(
  buffer: Buffer,
  fat: Uint32Array,
  sectorSize: number,
  firstDirectorySector: number,
): { entries: Map<string, DirectoryEntry>; root: DirectoryEntry } {
  // Số sector thư mục không được khai ở v3, nên đọc theo chain tới hết.
  const raw = readChain(buffer, fat, sectorSize, firstDirectorySector, Number.MAX_SAFE_INTEGER)
  const entries = new Map<string, DirectoryEntry>()
  let root: DirectoryEntry | null = null

  for (let at = 0; at + DIRECTORY_ENTRY_SIZE <= raw.length; at += DIRECTORY_ENTRY_SIZE) {
    const objectType = raw.readUInt8(at + 0x42)
    if (objectType !== OBJECT_TYPE_STREAM && objectType !== OBJECT_TYPE_ROOT) continue

    const nameLength = raw.readUInt16LE(at + 0x40)
    if (nameLength < 2 || nameLength > 64) continue
    // `nameLength` tính cả ký tự NUL kết thúc, nên bỏ 2 byte cuối.
    const name = raw.subarray(at, at + nameLength - 2).toString('utf16le')

    const entry: DirectoryEntry = {
      name,
      objectType,
      startSector: raw.readUInt32LE(at + 0x74),
      // Kích thước là 64-bit; file thật của Office không bao giờ chạm trần 32-bit, và ta
      // cũng chặn theo `maxStreamBytes` trước khi cấp phát.
      size: Number(raw.readBigUInt64LE(at + 0x78) & 0xffffffffn),
    }

    if (objectType === OBJECT_TYPE_ROOT) {
      root ??= entry
      continue
    }
    // Tên trùng: giữ bản gặp trước, đúng như thứ tự thư mục khai báo.
    if (!entries.has(name)) entries.set(name, entry)
  }

  if (root === null) throw failure('compound file has no root directory entry')
  return { entries, root }
}

function sectorOffset(sector: number, sectorSize: number): number {
  return (sector + 1) * sectorSize
}

function requireRange(buffer: Buffer, at: number, length: number, what: string): void {
  if (at < 0 || at + length > buffer.length) {
    throw failure(`${what} is out of range`)
  }
}

function failure(detail: string): NexaError {
  return new NexaError(ERROR_CODES.DOCUMENT_EXTRACTION_FAILED, { safeDetail: detail })
}
