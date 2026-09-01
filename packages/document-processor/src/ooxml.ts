import { ERROR_CODES, NexaError } from '@nexa/shared-types'
import { ZipArchive } from './zip-reader.js'
import { attribute, collectTagText, decodeXmlEntities, sliceBlocks } from './xml-text.js'
import { formatExcelSerial, isDateFormat, type NumberFormat } from './spreadsheet-dates.js'

/**
 * Trích văn bản từ hai định dạng OOXML còn lại ngoài DOCX: bảng tính `.xlsx` và trình chiếu
 * `.pptx`. (DOCX vẫn do mammoth đảm nhiệm — nó đã xử lý tốt paragraph và bảng.)
 *
 * Cả hai đều là ZIP chứa XML, nên đường đi giống nhau: mở archive qua `ZipArchive` (có trần
 * bung dữ liệu), lần theo quan hệ trong `_rels` để lấy ĐÚNG THỨ TỰ do tài liệu khai báo, rồi
 * gom chữ. Thứ tự quan trọng: sắp xếp theo tên file `slide1, slide2, …` là sai khi người dùng
 * đã kéo thả sắp lại slide.
 *
 * Điều KHÔNG làm: không đọc macro (`vbaProject.bin`), không theo external link, không đánh giá
 * công thức. Bảng tính chỉ đưa ra giá trị đã lưu sẵn trong file.
 */

export interface OfficeExtraction {
  readonly text: string
  /** Số sheet (bảng tính) hoặc số slide (trình chiếu) đã đọc. */
  readonly unitCount: number
  readonly truncated: boolean
}

/** Trần phòng thủ, độc lập với `maxChars`: chặn file dựng ngược khai hàng triệu ô/chuỗi. */
const MAX_SHARED_STRINGS = 500_000
const MAX_COLUMNS_PER_ROW = 512
const MAX_SHEETS = 200
const MAX_SLIDES = 1_000

export function extractXlsx(buffer: Buffer, maxChars: number): OfficeExtraction {
  const zip = openOoxml(buffer, 'xlsx')

  const workbookXml = zip.readText('xl/workbook.xml')
  if (workbookXml === null) {
    throw failure('xlsx is missing xl/workbook.xml (not a spreadsheet?)')
  }

  const relationships = readRelationships(zip, 'xl/workbook.xml')
  const sharedStrings = readSharedStrings(zip)
  const cellFormats = readCellFormats(zip)

  const out = new TextBudget(maxChars)
  let sheetCount = 0

  for (const sheet of readSheetList(workbookXml).slice(0, MAX_SHEETS)) {
    const target = sheet.relationshipId === null ? null : relationships.get(sheet.relationshipId)
    if (target === undefined || target === null) continue
    const sheetXml = zip.readText(target)
    if (sheetXml === null) continue

    sheetCount++
    out.push(`## Bảng tính: ${sheet.name}`)
    const rows = readSheetRows(sheetXml, sharedStrings, cellFormats)
    if (rows.length === 0) out.push('(trống)')
    for (const row of rows) {
      if (!out.push(row)) break
    }
    if (out.full) break
  }

  return { text: out.toString(), unitCount: sheetCount, truncated: out.truncated }
}

export function extractPptx(buffer: Buffer, maxChars: number): OfficeExtraction {
  const zip = openOoxml(buffer, 'pptx')

  const presentationXml = zip.readText('ppt/presentation.xml')
  if (presentationXml === null) {
    throw failure('pptx is missing ppt/presentation.xml (not a presentation?)')
  }

  const slideParts = readSlideOrder(zip, presentationXml).slice(0, MAX_SLIDES)
  const out = new TextBudget(maxChars)
  let slideNumber = 0

  for (const part of slideParts) {
    const slideXml = zip.readText(part)
    if (slideXml === null) continue

    slideNumber++
    out.push(`## Slide ${String(slideNumber)}`)

    const body = readDrawingText(slideXml)
    out.push(body === '' ? '(không có văn bản)' : body)

    // Ghi chú của người trình bày thường mang phần giải thích mà slide cố ý không viết ra.
    const notesPart = readRelationships(zip, part).get('__notesSlide__')
    if (notesPart !== undefined && notesPart !== null) {
      const notesXml = zip.readText(notesPart)
      if (notesXml !== null) {
        const notes = readDrawingText(notesXml)
        if (notes !== '') out.push(`Ghi chú: ${notes}`)
      }
    }
    if (out.full) break
  }

  return { text: out.toString(), unitCount: slideNumber, truncated: out.truncated }
}

// ── Bảng tính ─────────────────────────────────────────────────────────────

interface SheetRef {
  readonly name: string
  readonly relationshipId: string | null
}

function readSheetList(workbookXml: string): SheetRef[] {
  const sheets: SheetRef[] = []
  const pattern = /<sheet\b([^>]*)\/?>/g
  let found: RegExpExecArray | null
  while ((found = pattern.exec(workbookXml)) !== null) {
    const tag = found[1]
    if (tag === undefined) continue
    // Sheet bị ẩn vẫn đọc: người dùng đính kèm file là muốn Nexa nhìn thấy nội dung trong đó,
    // và "ẩn" trong Excel là thao tác trình bày chứ không phải nhãn bảo mật.
    sheets.push({
      name: attribute(tag, 'name') ?? `Sheet${String(sheets.length + 1)}`,
      relationshipId: attribute(tag, 'r:id') ?? attribute(tag, 'id'),
    })
  }
  return sheets
}

function readSharedStrings(zip: ZipArchive): string[] {
  const xml = zip.readText('xl/sharedStrings.xml')
  if (xml === null) return []
  const strings: string[] = []
  for (const block of sliceBlocks(xml, 'si')) {
    if (strings.length >= MAX_SHARED_STRINGS) break
    // Một `<si>` có thể gồm nhiều run `<r><t>…</t></r>` khi ô có định dạng lẫn lộn; nối
    // liền chúng lại thành đúng chuỗi người dùng nhìn thấy.
    strings.push(collectTagText(block, 't'))
  }
  return strings
}

/**
 * Đọc bảng định dạng số: `cellXfs` là danh sách style của ô, mỗi mục trỏ tới một `numFmtId`.
 *
 * Phải cắt đúng khối `<cellXfs>` trước khi quét `<xf>`: file nào cũng có thêm `<cellStyleXfs>`
 * chứa các `<xf>` khác, và trộn hai danh sách vào nhau sẽ làm lệch toàn bộ chỉ số style.
 */
function readCellFormats(zip: ZipArchive): NumberFormat[] {
  const xml = zip.readText('xl/styles.xml')
  if (xml === null) return []

  const customCodes = new Map<number, string>()
  const numberFormatsBlock = sliceBlocks(xml, 'numFmts')[0]
  if (numberFormatsBlock !== undefined) {
    const pattern = /<numFmt\b([^>]*)\/?>/g
    let found: RegExpExecArray | null
    while ((found = pattern.exec(numberFormatsBlock)) !== null) {
      const tag = found[1]
      if (tag === undefined) continue
      const id = Number.parseInt(attribute(tag, 'numFmtId') ?? '', 10)
      const code = attribute(tag, 'formatCode')
      if (Number.isInteger(id) && code !== null) customCodes.set(id, code)
    }
  }

  const cellXfsBlock = sliceBlocks(xml, 'cellXfs')[0]
  if (cellXfsBlock === undefined) return []

  const formats: NumberFormat[] = []
  const pattern = /<xf\b([^>]*?)(?:\/>|>)/g
  let found: RegExpExecArray | null
  while ((found = pattern.exec(cellXfsBlock)) !== null) {
    const tag = found[1]
    if (tag === undefined) continue
    const id = Number.parseInt(attribute(tag, 'numFmtId') ?? '0', 10)
    const code = customCodes.get(id)
    formats.push(code === undefined ? { id } : { id, code })
  }
  return formats
}

function readSheetRows(
  sheetXml: string,
  sharedStrings: readonly string[],
  cellFormats: readonly NumberFormat[],
): string[] {
  const rows: string[] = []
  const rowPattern = /<row\b[^>]*>([\s\S]*?)<\/row>/g
  let foundRow: RegExpExecArray | null

  while ((foundRow = rowPattern.exec(sheetXml)) !== null) {
    const rowXml = foundRow[1]
    if (rowXml === undefined) continue

    const cells: string[] = []
    const cellPattern = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g
    let foundCell: RegExpExecArray | null

    while ((foundCell = cellPattern.exec(rowXml)) !== null) {
      const tag = foundCell[1] ?? ''
      const body = foundCell[2] ?? ''
      const value = readCellValue(tag, body, sharedStrings, cellFormats)

      // Giữ đúng cột bằng cách chèn ô rỗng cho khoảng trống — nếu không, hàng thưa sẽ bị
      // dồn trái và model đọc nhầm cột nào ứng với tiêu đề nào.
      const column = columnIndex(attribute(tag, 'r'))
      if (column !== null && column < MAX_COLUMNS_PER_ROW) {
        while (cells.length < column) cells.push('')
      }
      if (cells.length < MAX_COLUMNS_PER_ROW) cells.push(value)
    }

    while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop()
    if (cells.length > 0) rows.push(cells.join('\t'))
  }

  return rows
}

function readCellValue(
  tag: string,
  body: string,
  sharedStrings: readonly string[],
  cellFormats: readonly NumberFormat[],
): string {
  const type = attribute(tag, 't') ?? 'n'

  switch (type) {
    case 's': {
      const index = Number.parseInt(collectTagText(body, 'v'), 10)
      if (!Number.isInteger(index) || index < 0 || index >= sharedStrings.length) return ''
      return sharedStrings[index] ?? ''
    }
    case 'inlineStr':
      return collectTagText(body, 't')
    case 'b': {
      const raw = collectTagText(body, 'v')
      return raw === '1' ? 'TRUE' : raw === '0' ? 'FALSE' : raw
    }
    // 'str' = kết quả công thức dạng chuỗi; 'e' = mã lỗi (#REF!, #N/A) — giữ nguyên để người
    // dùng thấy ô đang lỗi thay vì tưởng ô trống.
    case 'str':
    case 'e':
      return collectTagText(body, 'v')
    case 'n':
    default: {
      const raw = collectTagText(body, 'v')
      if (raw === '') return ''
      // Ô số mang style ngày: đổi serial thành ngày. Xem `spreadsheet-dates.ts`.
      const styleIndex = Number.parseInt(attribute(tag, 's') ?? '', 10)
      const format = Number.isInteger(styleIndex) ? cellFormats[styleIndex] : undefined
      if (isDateFormat(format) && format !== undefined) {
        const asDate = formatExcelSerial(Number(raw), format)
        if (asDate !== null) return asDate
      }
      return raw
    }
  }
}

/** `"BC12"` → 54 (0-based). Trả `null` nếu ô không khai địa chỉ. */
function columnIndex(reference: string | null): number | null {
  if (reference === null) return null
  const letters = /^([A-Za-z]+)/.exec(reference)?.[1]
  if (letters === undefined) return null
  let index = 0
  for (const character of letters.toUpperCase()) {
    index = index * 26 + (character.charCodeAt(0) - 64)
  }
  return index - 1
}

// ── Trình chiếu ───────────────────────────────────────────────────────────

function readSlideOrder(zip: ZipArchive, presentationXml: string): string[] {
  const listBlock = /<p:sldIdLst>([\s\S]*?)<\/p:sldIdLst>/.exec(presentationXml)?.[1]
  const relationships = readRelationships(zip, 'ppt/presentation.xml')

  if (listBlock !== undefined) {
    const ordered: string[] = []
    const pattern = /<p:sldId\b([^>]*)\/?>/g
    let found: RegExpExecArray | null
    while ((found = pattern.exec(listBlock)) !== null) {
      const tag = found[1]
      if (tag === undefined) continue
      const relationshipId = attribute(tag, 'r:id') ?? attribute(tag, 'id')
      const target = relationshipId === null ? undefined : relationships.get(relationshipId)
      if (target !== undefined && target !== null) ordered.push(target)
    }
    if (ordered.length > 0) return ordered
  }

  // Dự phòng cho file do công cụ khác sinh ra mà thiếu `sldIdLst`: sắp theo SỐ trong tên
  // (`slide2` phải đứng trước `slide10`, nên không dùng so sánh chuỗi).
  return zip
    .names()
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((left, right) => slideNumberOf(left) - slideNumberOf(right))
}

function slideNumberOf(name: string): number {
  return Number.parseInt(/slide(\d+)\.xml$/.exec(name)?.[1] ?? '0', 10)
}

/**
 * Gom chữ trong DrawingML: mỗi `<a:p>` là một đoạn, mỗi `<a:t>` là một run trong đoạn đó.
 * Nối run liền nhau, tách đoạn bằng xuống dòng — giữ lại được cấu trúc bullet của slide.
 */
function readDrawingText(xml: string): string {
  const paragraphs: string[] = []
  for (const block of sliceBlocks(xml, 'a:p')) {
    const line = collectTagText(block, 'a:t')
      .replace(/[ \t]+/g, ' ')
      .trim()
    if (line !== '') paragraphs.push(line)
  }
  return paragraphs.join('\n')
}

// ── Dùng chung ────────────────────────────────────────────────────────────

function openOoxml(buffer: Buffer, expected: 'xlsx' | 'pptx'): ZipArchive {
  let zip: ZipArchive
  try {
    zip = ZipArchive.open(buffer)
  } catch (cause) {
    throw failure(`${expected} could not be opened as a zip container`, cause)
  }
  if (!zip.has('[Content_Types].xml')) {
    throw failure(`${expected} is a zip but not an Office Open XML package`)
  }
  return zip
}

/**
 * Đọc `_rels` của một part và trả về map `rId → đường dẫn part đích` đã chuẩn hoá tuyệt đối.
 *
 * Khoá đặc biệt `__notesSlide__` gom quan hệ tới ghi chú của slide, vì rId của nó khác nhau
 * giữa các file nên không tra thẳng được.
 */
function readRelationships(zip: ZipArchive, partPath: string): Map<string, string | null> {
  const relationshipPath = partPath.replace(/([^/]+)$/, '_rels/$1.rels')
  const xml = zip.readText(relationshipPath)
  const map = new Map<string, string | null>()
  if (xml === null) return map

  const pattern = /<Relationship\b([^>]*)\/?>/g
  let found: RegExpExecArray | null
  while ((found = pattern.exec(xml)) !== null) {
    const tag = found[1]
    if (tag === undefined) continue
    const id = attribute(tag, 'Id')
    const target = attribute(tag, 'Target')
    const mode = attribute(tag, 'TargetMode')
    // Quan hệ "External" trỏ ra ngoài file (http://, file://). Bỏ hẳn: trích xuất tài liệu
    // không được phép mở tài nguyên bên ngoài (§11.2).
    if (id === null || target === null || mode === 'External') continue

    const resolved = resolvePartPath(partPath, decodeXmlEntities(target))
    map.set(id, resolved)
    if (attribute(tag, 'Type')?.endsWith('/notesSlide') === true) {
      map.set('__notesSlide__', resolved)
    }
  }
  return map
}

/** Ghép target tương đối vào thư mục của part gốc, rút gọn `.`/`..`. */
function resolvePartPath(basePart: string, target: string): string | null {
  if (target.startsWith('/')) return target.slice(1)

  const segments = basePart.split('/').slice(0, -1)
  for (const segment of target.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      // Thoát khỏi gốc package là dấu hiệu file dựng ngược — bỏ quan hệ đó.
      if (segments.length === 0) return null
      segments.pop()
      continue
    }
    segments.push(segment)
  }
  return segments.join('/')
}

/** Gom văn bản theo trần ký tự, để một file khổng lồ không nuốt hết ngân sách bộ nhớ. */
class TextBudget {
  private readonly parts: string[] = []
  private used = 0
  truncated = false

  constructor(private readonly maxChars: number) {}

  get full(): boolean {
    return this.used >= this.maxChars
  }

  /** Trả về false khi đã chạm trần — người gọi nên dừng vòng lặp. */
  push(line: string): boolean {
    if (this.full) {
      this.truncated = true
      return false
    }
    const remaining = this.maxChars - this.used
    if (line.length > remaining) {
      this.parts.push(line.slice(0, remaining))
      this.used = this.maxChars
      this.truncated = true
      return false
    }
    this.parts.push(line)
    this.used += line.length + 1
    return true
  }

  toString(): string {
    return this.parts.join('\n')
  }
}

function failure(detail: string, cause?: unknown): NexaError {
  return new NexaError(ERROR_CODES.DOCUMENT_EXTRACTION_FAILED, {
    safeDetail: detail,
    ...(cause !== undefined ? { cause } : {}),
  })
}
