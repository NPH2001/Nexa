import { ERROR_CODES, NexaError } from '@nexa/shared-types'
import { CfbArchive } from './cfb.js'
import { decodeCp1252, decodeUtf16Le } from './legacy-text.js'
import { formatExcelSerial, isDateFormat, type NumberFormat } from './spreadsheet-dates.js'
import type { LegacyExtraction } from './legacy-word.js'

/**
 * Trích văn bản từ `.xls` (BIFF8 — Excel 97-2003, có dự phòng cho BIFF5/7).
 *
 * BIFF là một dòng bản ghi phẳng: mỗi bản ghi có mã loại 16-bit, độ dài 16-bit, rồi dữ liệu.
 * Ta chỉ quan tâm các bản ghi mang GIÁ TRỊ Ô đã lưu sẵn, và cố tình bỏ qua mọi thứ còn lại —
 * công thức không được tính lại, external link không được mở, macro không được đụng tới.
 *
 * Chỗ khó duy nhất là bảng chuỗi dùng chung (SST): nó có thể dài hơn giới hạn 8.224 byte của
 * một bản ghi và bị cắt sang các bản ghi CONTINUE, mà vết cắt có thể rơi vào GIỮA một chuỗi —
 * và phần tiếp theo được phép đổi luôn cách mã hoá (8-bit ↔ UTF-16). `SstReader` bên dưới tồn
 * tại chỉ để xử lý đúng chỗ đó.
 *
 * Giới hạn đã biết: ngày tháng trong Excel được lưu là số serial kèm định dạng hiển thị. Ta
 * xuất ra số thô thay vì đoán định dạng — thà đưa model con số đúng còn hơn một ngày sai.
 */

const RECORD_BOF = 0x0809
const RECORD_EOF = 0x000a
const RECORD_BOUNDSHEET = 0x0085
const RECORD_SST = 0x00fc
const RECORD_CONTINUE = 0x003c
const RECORD_LABELSST = 0x00fd
const RECORD_LABEL = 0x0204
const RECORD_RK = 0x027e
const RECORD_MULRK = 0x00bd
const RECORD_NUMBER = 0x0203
const RECORD_FORMULA = 0x0006
const RECORD_STRING = 0x0207
const RECORD_BOOLERR = 0x0205
const RECORD_XF = 0x00e0
const RECORD_FORMAT = 0x041e

const SUBSTREAM_WORKSHEET = 0x0010
const BIFF8 = 0x0600

/** Trần phòng thủ cho file dựng ngược khai hàng triệu ô rỗng. */
const MAX_CELLS_PER_SHEET = 200_000
const MAX_SHEETS = 200

export function extractXls(buffer: Buffer, maxChars: number): LegacyExtraction {
  const cfb = CfbArchive.open(buffer)
  // "Workbook" là tên của Excel 97+; "Book" là của Excel 5/95.
  const stream = cfb.firstStream(['Workbook', 'Book'])
  if (stream === null) {
    throw failure('xls has no Workbook stream (not a spreadsheet?)')
  }

  const workbook = readWorkbook(stream)
  return renderSheets(workbook, maxChars)
}

interface SheetData {
  name: string
  readonly rows: Map<number, Map<number, string>>
  cellCount: number
}

interface Workbook {
  readonly sheets: SheetData[]
}

function readWorkbook(stream: Buffer): Workbook {
  const sheets: SheetData[] = []
  const namesByPosition = new Map<number, string>()
  const orderedNames: string[] = []
  let sharedStrings: string[] = []
  /** Định dạng số theo thứ tự bản ghi XF — chỉ số `ixfe` của ô trỏ thẳng vào mảng này. */
  const cellFormats: NumberFormat[] = []
  const customFormatCodes = new Map<number, string>()
  let biffVersion = BIFF8
  let current: SheetData | null = null
  let sheetOrdinal = 0
  /** Ô công thức đang chờ bản ghi STRING đi ngay sau để biết kết quả dạng chuỗi. */
  let pendingFormula: { row: number; column: number } | null = null

  let at = 0
  while (at + 4 <= stream.length) {
    const type = stream.readUInt16LE(at)
    const length = stream.readUInt16LE(at + 2)
    const bodyAt = at + 4
    if (bodyAt + length > stream.length) break
    const body = stream.subarray(bodyAt, bodyAt + length)
    let next = bodyAt + length

    switch (type) {
      case RECORD_BOF: {
        if (body.length >= 4) {
          const version = body.readUInt16LE(0)
          const substream = body.readUInt16LE(2)
          if (version >= 0x0200) biffVersion = version
          if (substream === SUBSTREAM_WORKSHEET && sheets.length < MAX_SHEETS) {
            const name =
              namesByPosition.get(at) ??
              orderedNames[sheetOrdinal] ??
              `Sheet${String(sheetOrdinal + 1)}`
            current = { name, rows: new Map(), cellCount: 0 }
            sheets.push(current)
            sheetOrdinal++
          } else if (substream !== SUBSTREAM_WORKSHEET) {
            current = null
          }
        }
        break
      }

      case RECORD_EOF:
        current = null
        pendingFormula = null
        break

      case RECORD_BOUNDSHEET: {
        if (body.length < 8) break
        const position = body.readUInt32LE(0)
        const name = readShortString(body.subarray(6), biffVersion)
        namesByPosition.set(position, name)
        orderedNames.push(name)
        break
      }

      case RECORD_FORMAT: {
        if (body.length < 3) break
        customFormatCodes.set(
          body.readUInt16LE(0),
          biffVersion >= BIFF8
            ? readUnicodeString(body.subarray(2))
            : readShortString(body.subarray(2), biffVersion),
        )
        break
      }

      case RECORD_XF: {
        // ifnt(2) rồi ifmt(2). Thứ tự xuất hiện CHÍNH LÀ chỉ số mà ô tham chiếu tới.
        if (body.length < 4) break
        cellFormats.push({ id: body.readUInt16LE(2) })
        break
      }

      case RECORD_SST: {
        const segments = [body]
        // Gom mọi CONTINUE đi liền sau vào cùng một dòng byte trước khi đọc chuỗi.
        let scan = next
        while (scan + 4 <= stream.length && stream.readUInt16LE(scan) === RECORD_CONTINUE) {
          const continueLength = stream.readUInt16LE(scan + 2)
          if (scan + 4 + continueLength > stream.length) break
          segments.push(stream.subarray(scan + 4, scan + 4 + continueLength))
          scan += 4 + continueLength
        }
        next = scan
        sharedStrings = readSharedStringTable(segments)
        break
      }

      case RECORD_LABELSST: {
        if (current === null || body.length < 10) break
        const index = body.readUInt32LE(6)
        setCell(current, body.readUInt16LE(0), body.readUInt16LE(2), sharedStrings[index] ?? '')
        break
      }

      case RECORD_LABEL: {
        if (current === null || body.length < 8) break
        const value =
          biffVersion >= BIFF8
            ? readUnicodeString(body.subarray(6))
            : readShortString(body.subarray(6), biffVersion, 2)
        setCell(current, body.readUInt16LE(0), body.readUInt16LE(2), value)
        break
      }

      case RECORD_RK: {
        if (current === null || body.length < 10) break
        const value = decodeRk(body.readInt32LE(6))
        setCell(
          current,
          body.readUInt16LE(0),
          body.readUInt16LE(2),
          formatNumericCell(value, body.readUInt16LE(4), cellFormats, customFormatCodes),
        )
        break
      }

      case RECORD_MULRK: {
        if (current === null || body.length < 6) break
        const row = body.readUInt16LE(0)
        const firstColumn = body.readUInt16LE(2)
        const count = Math.floor((body.length - 6) / 6)
        for (let i = 0; i < count; i++) {
          const value = decodeRk(body.readInt32LE(4 + i * 6 + 2))
          // Mỗi ô trong MULRK mang ixfe RIÊNG — một hàng có thể trộn ô ngày với ô số.
          const styleIndex = body.readUInt16LE(4 + i * 6)
          setCell(
            current,
            row,
            firstColumn + i,
            formatNumericCell(value, styleIndex, cellFormats, customFormatCodes),
          )
        }
        break
      }

      case RECORD_NUMBER: {
        if (current === null || body.length < 14) break
        setCell(
          current,
          body.readUInt16LE(0),
          body.readUInt16LE(2),
          formatNumericCell(
            body.readDoubleLE(6),
            body.readUInt16LE(4),
            cellFormats,
            customFormatCodes,
          ),
        )
        break
      }

      case RECORD_FORMULA: {
        if (current === null || body.length < 14) break
        const row = body.readUInt16LE(0)
        const column = body.readUInt16LE(2)
        // Kết quả có hai dạng: một số IEEE 754, hoặc — khi hai byte cuối là 0xFFFF — một thẻ
        // cho biết kết quả là chuỗi/luận lý/lỗi. Chuỗi nằm ở bản ghi STRING ngay sau.
        if (body.readUInt16LE(12) === 0xffff) {
          const marker = body.readUInt8(6)
          if (marker === 0x00) {
            pendingFormula = { row, column }
          } else if (marker === 0x01) {
            setCell(current, row, column, body.readUInt8(8) === 0 ? 'FALSE' : 'TRUE')
          } else if (marker === 0x02) {
            setCell(current, row, column, errorText(body.readUInt8(8)))
          }
        } else {
          setCell(
            current,
            row,
            column,
            formatNumericCell(
              body.readDoubleLE(6),
              body.readUInt16LE(4),
              cellFormats,
              customFormatCodes,
            ),
          )
        }
        break
      }

      case RECORD_STRING: {
        if (current === null || pendingFormula === null) break
        const value =
          biffVersion >= BIFF8 ? readUnicodeString(body) : readShortString(body, biffVersion, 2)
        setCell(current, pendingFormula.row, pendingFormula.column, value)
        pendingFormula = null
        break
      }

      case RECORD_BOOLERR: {
        if (current === null || body.length < 8) break
        const value =
          body.readUInt8(7) === 1
            ? errorText(body.readUInt8(6))
            : body.readUInt8(6) === 0
              ? 'FALSE'
              : 'TRUE'
        setCell(current, body.readUInt16LE(0), body.readUInt16LE(2), value)
        break
      }

      default:
        break
    }

    if (type !== RECORD_FORMULA && type !== RECORD_STRING) pendingFormula = null
    at = next
  }

  return { sheets }
}

/**
 * Định dạng một ô số, đổi serial thành ngày khi style của ô nói đó là ngày.
 *
 * FORMAT có thể đến SAU XF trong dòng bản ghi, nên `formatCode` tuỳ biến chỉ được tra ở đây —
 * lúc dựng bảng thì chưa chắc đã có.
 */
function formatNumericCell(
  value: number,
  styleIndex: number,
  cellFormats: readonly NumberFormat[],
  customFormatCodes: ReadonlyMap<number, string>,
): string {
  const base = cellFormats[styleIndex]
  if (base !== undefined) {
    const code = customFormatCodes.get(base.id)
    const format: NumberFormat = code === undefined ? base : { id: base.id, code }
    if (isDateFormat(format)) {
      const asDate = formatExcelSerial(value, format)
      if (asDate !== null) return asDate
    }
  }
  return formatNumber(value)
}

function setCell(sheet: SheetData, row: number, column: number, value: string): void {
  if (value === '' || sheet.cellCount >= MAX_CELLS_PER_SHEET) return
  let cells = sheet.rows.get(row)
  if (cells === undefined) {
    cells = new Map()
    sheet.rows.set(row, cells)
  }
  cells.set(column, value)
  sheet.cellCount++
}

function renderSheets(workbook: Workbook, maxChars: number): LegacyExtraction {
  const lines: string[] = []
  let used = 0
  let truncated = false

  const push = (line: string): boolean => {
    if (used + line.length + 1 > maxChars) {
      truncated = true
      return false
    }
    lines.push(line)
    used += line.length + 1
    return true
  }

  for (const sheet of workbook.sheets) {
    if (!push(`## Bảng tính: ${sheet.name}`)) break
    if (sheet.rows.size === 0) {
      push('(trống)')
      continue
    }
    let stop = false
    for (const row of [...sheet.rows.keys()].sort((left, right) => left - right)) {
      const cells = sheet.rows.get(row)
      if (cells === undefined) continue
      const columns = [...cells.keys()].sort((left, right) => left - right)
      const last = columns[columns.length - 1] ?? 0
      const rendered: string[] = []
      // Giữ đúng cột bằng ô rỗng, cùng lý do như bên `.xlsx`.
      for (let column = columns[0] ?? 0; column <= last; column++) {
        rendered.push(cells.get(column) ?? '')
      }
      if (!push(rendered.join('\t'))) {
        stop = true
        break
      }
    }
    if (stop) break
  }

  return { text: lines.join('\n'), truncated }
}

// ── Chuỗi ─────────────────────────────────────────────────────────────────

/**
 * Đọc bảng chuỗi dùng chung, đi xuyên qua ranh giới các bản ghi CONTINUE.
 *
 * Quy tắc của định dạng: khi một chuỗi bị cắt giữa chừng, byte ĐẦU TIÊN của phần tiếp theo là
 * một cờ mã hoá mới cho phần còn lại của đúng chuỗi đó. Không tôn trọng điều này thì kết quả
 * là chữ Hán giả — triệu chứng kinh điển khi đọc SST sai.
 */
function readSharedStringTable(segments: readonly Buffer[]): string[] {
  const reader = new SstReader(segments)
  if (reader.remaining() < 8) return []
  reader.skip(4) // cstTotal — số lần dùng, không phải số chuỗi
  const uniqueCount = reader.readUInt32()

  const strings: string[] = []
  for (let i = 0; i < uniqueCount; i++) {
    if (reader.exhausted()) break
    try {
      strings.push(reader.readString())
    } catch {
      // Bảng hỏng từ giữa: giữ những chuỗi đã đọc được thay vì bỏ cả file.
      break
    }
  }
  return strings
}

class SstReader {
  private readonly segments: readonly Buffer[]
  private segment = 0
  private offset = 0

  constructor(segments: readonly Buffer[]) {
    this.segments = segments
  }

  exhausted(): boolean {
    this.settle()
    return this.segment >= this.segments.length
  }

  remaining(): number {
    let total = 0
    for (let i = this.segment; i < this.segments.length; i++) {
      total += (this.segments[i]?.length ?? 0) - (i === this.segment ? this.offset : 0)
    }
    return total
  }

  readUInt8(): number {
    const value = this.current().readUInt8(this.offset)
    this.offset += 1
    return value
  }

  readUInt16(): number {
    return this.readInSegment(2, (buffer, at) => buffer.readUInt16LE(at))
  }

  readUInt32(): number {
    return this.readInSegment(4, (buffer, at) => buffer.readUInt32LE(at))
  }

  skip(count: number): void {
    let remaining = count
    while (remaining > 0) {
      const buffer = this.current()
      const take = Math.min(remaining, buffer.length - this.offset)
      this.offset += take
      remaining -= take
      if (remaining > 0) this.advance()
    }
  }

  readString(): string {
    const characterCount = this.readUInt16()
    const flags = this.readUInt8()
    const wide = (flags & 0x01) !== 0
    const hasExtended = (flags & 0x04) !== 0
    const hasRichRuns = (flags & 0x08) !== 0

    const runCount = hasRichRuns ? this.readUInt16() : 0
    const extendedSize = hasExtended ? this.readUInt32() : 0

    const text = this.readCharacters(characterCount, wide)

    // Định dạng theo run và dữ liệu phiên âm châu Á không mang thêm chữ nào — bỏ qua.
    if (runCount > 0) this.skip(runCount * 4)
    if (extendedSize > 0) this.skip(extendedSize)

    return text
  }

  private readCharacters(count: number, startWide: boolean): string {
    let remaining = count
    let wide = startWide
    let out = ''

    while (remaining > 0) {
      const buffer = this.current()
      const available = buffer.length - this.offset
      if (available <= 0) {
        this.advance()
        // Sang bản ghi CONTINUE: byte đầu khai lại cách mã hoá cho phần còn lại.
        wide = (this.readUInt8() & 0x01) !== 0
        continue
      }

      const charactersHere = wide ? Math.floor(available / 2) : available
      const take = Math.min(remaining, charactersHere)
      if (take <= 0) {
        this.advance()
        wide = (this.readUInt8() & 0x01) !== 0
        continue
      }

      const byteLength = wide ? take * 2 : take
      const slice = buffer.subarray(this.offset, this.offset + byteLength)
      out += wide ? decodeUtf16Le(slice) : decodeCp1252(slice)
      this.offset += byteLength
      remaining -= take
    }

    return out
  }

  private readInSegment(size: number, read: (buffer: Buffer, at: number) => number): number {
    const buffer = this.current()
    if (buffer.length - this.offset >= size) {
      const value = read(buffer, this.offset)
      this.offset += size
      return value
    }
    // Trường số nguyên vắt qua hai bản ghi: ghép byte lại rồi mới đọc.
    const bytes = Buffer.alloc(size)
    for (let i = 0; i < size; i++) bytes.writeUInt8(this.readUInt8(), i)
    return read(bytes, 0)
  }

  private current(): Buffer {
    this.settle()
    const buffer = this.segments[this.segment]
    if (buffer === undefined) throw failure('shared string table ended unexpectedly')
    return buffer
  }

  private advance(): void {
    this.segment++
    this.offset = 0
    if (this.segment >= this.segments.length) {
      throw failure('shared string table ended unexpectedly')
    }
  }

  private settle(): void {
    while (
      this.segment < this.segments.length &&
      this.offset >= (this.segments[this.segment]?.length ?? 0)
    ) {
      this.segment++
      this.offset = 0
    }
  }
}

/** XLUnicodeString của BIFF8: độ dài 16-bit, một byte cờ, rồi dữ liệu. */
function readUnicodeString(body: Buffer): string {
  if (body.length < 3) return ''
  const characterCount = body.readUInt16LE(0)
  const wide = (body.readUInt8(2) & 0x01) !== 0
  const byteLength = wide ? characterCount * 2 : characterCount
  const slice = body.subarray(3, Math.min(3 + byteLength, body.length))
  return wide ? decodeUtf16Le(slice) : decodeCp1252(slice)
}

/** Chuỗi ngắn của BIFF5/8 dùng cho tên sheet: độ dài 8-bit (hoặc 16-bit khi `lengthSize` = 2). */
function readShortString(body: Buffer, biffVersion: number, lengthSize: 1 | 2 = 1): string {
  if (body.length < lengthSize) return ''
  const characterCount = lengthSize === 1 ? body.readUInt8(0) : body.readUInt16LE(0)
  let at = lengthSize
  let wide = false

  if (biffVersion >= BIFF8) {
    if (body.length <= at) return ''
    wide = (body.readUInt8(at) & 0x01) !== 0
    at += 1
  }

  const byteLength = wide ? characterCount * 2 : characterCount
  const slice = body.subarray(at, Math.min(at + byteLength, body.length))
  return wide ? decodeUtf16Le(slice) : decodeCp1252(slice)
}

// ── Số ────────────────────────────────────────────────────────────────────

/**
 * RK là số thực nén vào 32 bit: hai bit thấp là cờ, 30 bit còn lại là số nguyên hoặc là 30 bit
 * CAO của một `double` (32 bit thấp coi như 0). Excel dùng nó để tiết kiệm chỗ cho các ô số
 * "tròn trịa" — chiếm đa số trong một bảng tính thật.
 */
function decodeRk(rk: number): number {
  const dividedBy100 = (rk & 0x01) !== 0
  const isInteger = (rk & 0x02) !== 0

  let value: number
  if (isInteger) {
    value = rk >> 2
  } else {
    const bytes = Buffer.alloc(8)
    bytes.writeInt32LE(rk & ~0x03, 4)
    value = bytes.readDoubleLE(0)
  }
  return dividedBy100 ? value / 100 : value
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return ''
  // Cắt đuôi nhiễu dấu phẩy động (0.1 + 0.2) mà không đụng tới số nguyên lớn.
  return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(15)))
}

function errorText(code: number): string {
  switch (code) {
    case 0x00:
      return '#NULL!'
    case 0x07:
      return '#DIV/0!'
    case 0x0f:
      return '#VALUE!'
    case 0x17:
      return '#REF!'
    case 0x1d:
      return '#NAME?'
    case 0x24:
      return '#NUM!'
    case 0x2a:
      return '#N/A'
    default:
      return '#ERR'
  }
}

function failure(detail: string): NexaError {
  return new NexaError(ERROR_CODES.DOCUMENT_EXTRACTION_FAILED, { safeDetail: detail })
}
