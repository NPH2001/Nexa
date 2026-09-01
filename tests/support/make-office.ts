import { deflateRawSync } from 'node:zlib'

/**
 * Sinh gói OOXML (`.xlsx`, `.pptx`) tối thiểu nhưng HỢP LỆ.
 *
 * Cùng lập trường với `make-pdf.ts`: fixture phải đọc được và sửa được ngay trong repo, không
 * ai phải tin một blob nhị phân không rõ nguồn gốc. Bên cạnh đó, tự dựng ZIP cho phép test
 * những trường hợp mà một file Office thật không bao giờ tạo ra — entry nén và entry không
 * nén nằm cạnh nhau, hay một gói cố tình khai sai kích thước.
 */

export interface ZipEntry {
  readonly name: string
  readonly content: string | Buffer
  /** Mặc định nén (method 8). Đặt false để lưu nguyên (method 0). */
  readonly deflate?: boolean
}

export function makeZip(entries: readonly ZipEntry[]): Buffer {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const raw = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content, 'utf8')
    const deflate = entry.deflate ?? true
    const stored = deflate ? deflateRawSync(raw) : raw
    const crc = crc32(raw)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // phiên bản cần để giải nén
    local.writeUInt16LE(0x0800, 6) // bit 11: tên ở UTF-8
    local.writeUInt16LE(deflate ? 8 : 0, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(stored.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    localParts.push(local, name, stored)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(deflate ? 8 : 0, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(stored.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    centralParts.push(central, name)

    offset += 30 + name.length + stored.length
  }

  const central = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(central.length, 12)
  end.writeUInt32LE(offset, 16)

  return Buffer.concat([...localParts, central, end])
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`

/** Ô ngày: Excel lưu số serial, và CHỈ style nói rằng nó là ngày. */
export interface DateCell {
  readonly serial: number
  /** Bỏ trống ⇒ dùng định dạng ngày dựng sẵn (numFmtId 14). */
  readonly formatCode?: string
}

export type CellFixture = string | number | null | DateCell

export interface SheetFixture {
  readonly name: string
  /** Mỗi hàng là một mảng ô; `null` để bỏ trống ô đó và tạo hàng thưa. */
  readonly rows: readonly (readonly CellFixture[])[]
}

/** Dựng `.xlsx` dùng bảng chuỗi dùng chung cho ô chữ và giá trị trực tiếp cho ô số. */
export function makeXlsx(sheets: readonly SheetFixture[]): Buffer {
  const sharedStrings: string[] = []
  const indexOf = (value: string): number => {
    const found = sharedStrings.indexOf(value)
    if (found >= 0) return found
    sharedStrings.push(value)
    return sharedStrings.length - 1
  }

  const sheetEntries: ZipEntry[] = []
  const sheetTags: string[] = []
  const relationshipTags: string[] = []

  sheets.forEach((sheet, sheetIndex) => {
    const relationshipId = `rId${String(sheetIndex + 1)}`
    const part = `worksheets/sheet${String(sheetIndex + 1)}.xml`

    const rows = sheet.rows
      .map((cells, rowIndex) => {
        const rowNumber = rowIndex + 1
        const rendered = cells
          .map((value, columnIndex) => {
            if (value === null) return ''
            const reference = `${columnName(columnIndex)}${String(rowNumber)}`
            if (typeof value === 'number') {
              return `<c r="${reference}"><v>${String(value)}</v></c>`
            }
            if (typeof value === 'object') {
              // s="1" = định dạng dựng sẵn 14; s="2" = định dạng tuỳ biến khai trong styles.xml.
              const style = value.formatCode === undefined ? 1 : 2
              return `<c r="${reference}" s="${String(style)}"><v>${String(value.serial)}</v></c>`
            }
            return `<c r="${reference}" t="s"><v>${String(indexOf(value))}</v></c>`
          })
          .join('')
        return `<row r="${String(rowNumber)}">${rendered}</row>`
      })
      .join('')

    sheetEntries.push({
      name: `xl/${part}`,
      content: `<?xml version="1.0"?><worksheet><sheetData>${rows}</sheetData></worksheet>`,
    })
    sheetTags.push(
      `<sheet name="${escapeXml(sheet.name)}" sheetId="${String(sheetIndex + 1)}" r:id="${relationshipId}"/>`,
    )
    relationshipTags.push(
      `<Relationship Id="${relationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${part}"/>`,
    )
  })

  const sharedStringsXml = `<?xml version="1.0"?><sst count="${String(sharedStrings.length)}" uniqueCount="${String(sharedStrings.length)}">${sharedStrings
    .map((value) => `<si><t>${escapeXml(value)}</t></si>`)
    .join('')}</sst>`

  const customFormat = sheets
    .flatMap((sheet) => sheet.rows.flat())
    .find((cell): cell is DateCell => typeof cell === 'object' && cell !== null)?.formatCode

  // cellXfs: 0 = mặc định, 1 = ngày dựng sẵn, 2 = ngày theo formatCode tuỳ biến. `cellStyleXfs`
  // cũng chứa <xf> và cố ý có mặt ở đây — bộ đọc phải bỏ qua nó, nếu không chỉ số style lệch hết.
  const stylesXml =
    `<?xml version="1.0"?><styleSheet>` +
    (customFormat === undefined
      ? ''
      : `<numFmts count="1"><numFmt numFmtId="164" formatCode="${escapeXml(customFormat)}"/></numFmts>`) +
    `<cellStyleXfs count="1"><xf numFmtId="0"/></cellStyleXfs>` +
    `<cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/>` +
    `<xf numFmtId="164" applyNumberFormat="1"/></cellXfs></styleSheet>`

  return makeZip([
    { name: '[Content_Types].xml', content: CONTENT_TYPES },
    { name: 'xl/styles.xml', content: stylesXml },
    {
      name: 'xl/workbook.xml',
      content: `<?xml version="1.0"?><workbook><sheets>${sheetTags.join('')}</sheets></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      content: `<?xml version="1.0"?><Relationships>${relationshipTags.join('')}</Relationships>`,
    },
    { name: 'xl/sharedStrings.xml', content: sharedStringsXml },
    ...sheetEntries,
  ])
}

export interface SlideFixture {
  readonly paragraphs: readonly string[]
  readonly notes?: string
}

/** Dựng `.pptx`; thứ tự slide lấy từ `sldIdLst` chứ không từ tên file, đúng như file thật. */
export function makePptx(slides: readonly SlideFixture[]): Buffer {
  const entries: ZipEntry[] = [{ name: '[Content_Types].xml', content: CONTENT_TYPES }]
  const slideIdTags: string[] = []
  const presentationRelationships: string[] = []

  slides.forEach((slide, index) => {
    const number = index + 1
    const relationshipId = `rId${String(number)}`
    const part = `slides/slide${String(number)}.xml`

    const body = slide.paragraphs
      .map((line) => `<a:p><a:r><a:t>${escapeXml(line)}</a:t></a:r></a:p>`)
      .join('')
    entries.push({
      name: `ppt/${part}`,
      content: `<?xml version="1.0"?><p:sld><p:cSld><p:spTree>${body}</p:spTree></p:cSld></p:sld>`,
    })

    const slideRelationships: string[] = []
    if (slide.notes !== undefined) {
      const notesPart = `notesSlides/notesSlide${String(number)}.xml`
      entries.push({
        name: `ppt/${notesPart}`,
        content: `<?xml version="1.0"?><p:notes><a:p><a:r><a:t>${escapeXml(slide.notes)}</a:t></a:r></a:p></p:notes>`,
      })
      slideRelationships.push(
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../${notesPart}"/>`,
      )
    }
    entries.push({
      name: `ppt/slides/_rels/slide${String(number)}.xml.rels`,
      content: `<?xml version="1.0"?><Relationships>${slideRelationships.join('')}</Relationships>`,
    })

    slideIdTags.push(`<p:sldId id="${String(255 + number)}" r:id="${relationshipId}"/>`)
    presentationRelationships.push(
      `<Relationship Id="${relationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="${part}"/>`,
    )
  })

  entries.push(
    {
      name: 'ppt/presentation.xml',
      content: `<?xml version="1.0"?><p:presentation><p:sldIdLst>${slideIdTags.join('')}</p:sldIdLst></p:presentation>`,
    },
    {
      name: 'ppt/_rels/presentation.xml.rels',
      content: `<?xml version="1.0"?><Relationships>${presentationRelationships.join('')}</Relationships>`,
    },
  )

  return makeZip(entries)
}

function columnName(index: number): string {
  let name = ''
  let value = index + 1
  while (value > 0) {
    const remainder = (value - 1) % 26
    name = String.fromCharCode(65 + remainder) + name
    value = Math.floor((value - 1) / 26)
  }
  return name
}

function escapeXml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

let crcTable: Uint32Array | null = null

export function crc32(data: Buffer): number {
  if (crcTable === null) {
    crcTable = new Uint32Array(256)
    for (let i = 0; i < 256; i++) {
      let value = i
      for (let bit = 0; bit < 8; bit++) {
        value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
      }
      crcTable[i] = value >>> 0
    }
  }
  let crc = 0xffffffff
  for (const byte of data) {
    crc = (crcTable[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}
