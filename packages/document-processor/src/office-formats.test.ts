import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ERROR_CODES } from '@nexa/shared-types'
import { DocumentProcessor, InlineRunner } from './index.js'
import { ZipArchive } from './zip-reader.js'
import { testLogger } from '../../../tests/support/factories.js'
import { makePptx, makeXlsx, makeZip } from '../../../tests/support/make-office.js'
import { makeDoc, makePpt, makeXls } from '../../../tests/support/make-legacy-office.js'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nexa-office-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function makeProcessor() {
  const { logger } = testLogger()
  return new DocumentProcessor({
    runner: new InlineRunner(),
    logger,
    limits: { maxFileSizeMb: 30, maxFilesPerRequest: 5 },
  })
}

function write(
  name: string,
  content: Buffer,
): { path: string; fileName: string; sizeBytes: number } {
  const path = join(dir, name)
  writeFileSync(path, content)
  return { path, fileName: name, sizeBytes: content.length }
}

async function processOne(name: string, content: Buffer) {
  const [doc] = await makeProcessor().process([write(name, content)])
  if (doc === undefined) throw new Error('không có tài liệu nào được trả về')
  return doc
}

describe('ZipArchive (chống zip bomb)', () => {
  it('reads both stored and deflated entries', () => {
    const zip = ZipArchive.open(
      makeZip([
        { name: 'nen.txt', content: 'x'.repeat(5_000), deflate: true },
        { name: 'nguyen.txt', content: 'nguyên bản', deflate: false },
      ]),
    )
    expect(zip.read('nen.txt')?.length).toBe(5_000)
    expect(zip.readText('nguyen.txt')).toBe('nguyên bản')
    expect(zip.read('khong-co.txt')).toBeNull()
  })

  it('refuses to inflate past the per-entry budget', () => {
    // 4 MB số 0 nén lại còn vài KB — đúng hình dạng của một zip bomb.
    const zip = ZipArchive.open(
      makeZip([{ name: 'bom.bin', content: Buffer.alloc(4 * 1024 * 1024) }]),
      {
        maxEntryBytes: 64 * 1024,
        maxTotalBytes: 1024 * 1024,
        maxEntries: 10,
      },
    )
    expect(() => zip.read('bom.bin')).toThrowError(
      expect.objectContaining({ safeDetail: expect.stringMatching(/inflate/i) }),
    )
  })

  it('caps the total inflated across entries, not just each one', () => {
    const zip = ZipArchive.open(
      makeZip([
        { name: 'a.bin', content: Buffer.alloc(200_000) },
        { name: 'b.bin', content: Buffer.alloc(200_000) },
      ]),
      { maxEntryBytes: 300_000, maxTotalBytes: 300_000, maxEntries: 10 },
    )
    expect(zip.read('a.bin')?.length).toBe(200_000)
    expect(() => zip.read('b.bin')).toThrowError()
  })

  it('rejects a file with no end-of-central-directory record', () => {
    expect(() => ZipArchive.open(Buffer.from('không phải zip'))).toThrowError(
      expect.objectContaining({ safeDetail: expect.stringMatching(/zip/i) }),
    )
  })
})

describe('XLSX extraction', () => {
  it('keeps sheet order, sheet names and column alignment', async () => {
    const doc = await processOne(
      'bao-cao.xlsx',
      makeXlsx([
        {
          name: 'Doanh thu',
          rows: [
            ['Đơn vị', 'Quý 1', 'Quý 2'],
            ['Hà Nội', 120, 135],
            // Hàng thưa: hai ô đầu trống, giá trị phải rơi đúng cột thứ ba.
            [null, null, 99],
          ],
        },
        { name: 'Ghi chú', rows: [['Số liệu chưa kiểm toán']] },
      ]),
    )

    expect(doc.kind).toBe('xlsx')
    expect(doc.pageCount).toBe(2)
    expect(doc.text).toContain('## Bảng tính: Doanh thu')
    expect(doc.text).toContain('Đơn vị\tQuý 1\tQuý 2')
    expect(doc.text).toContain('Hà Nội\t120\t135')
    expect(doc.text).toContain('\t\t99')
    // Thứ tự sheet theo workbook.xml, không theo tên file bên trong gói.
    expect(doc.text.indexOf('Doanh thu')).toBeLessThan(doc.text.indexOf('Ghi chú'))
  })

  it('does not mistake part names appearing inside entry DATA for the package type', async () => {
    // Tên part chỉ được đọc từ local file header. Nếu đi tìm chuỗi trong toàn bộ phần đầu file
    // thì gói này bị kết luận nhầm là Word — và cùng lỗi đó sẽ thỉnh thoảng từ chối oan một
    // `.xlsx` thật, khi ba byte "word/" tình cờ rơi vào dữ liệu đã nén.
    const xlsxWithDecoyBytes = makeZip([
      {
        name: '[Content_Types].xml',
        content: 'word/document.xml ppt/presentation.xml',
        deflate: false,
      },
      {
        name: 'xl/workbook.xml',
        content:
          '<workbook><sheets><sheet name="Mot" sheetId="1" r:id="rId1"/></sheets></workbook>',
      },
      {
        name: 'xl/_rels/workbook.xml.rels',
        content:
          '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
      },
      {
        name: 'xl/worksheets/sheet1.xml',
        content:
          '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Giá trị</t></is></c></row></sheetData></worksheet>',
      },
    ])

    const doc = await processOne('that-la-excel.xlsx', xlsxWithDecoyBytes)
    expect(doc.kind).toBe('xlsx')
    expect(doc.text).toContain('Giá trị')
  })

  it('rejects a zip that is not an Office package', async () => {
    await expect(
      processOne('gia-mao.xlsx', makeZip([{ name: 'readme.txt', content: 'không phải office' }])),
    ).rejects.toMatchObject({ code: ERROR_CODES.DOCUMENT_EXTRACTION_FAILED })
  })

  it('rejects a docx wearing an .xlsx extension', async () => {
    const docxLike = makeZip([
      { name: '[Content_Types].xml', content: '<Types/>' },
      { name: 'word/document.xml', content: '<w:document/>' },
    ])
    await expect(processOne('that-ra-la-word.xlsx', docxLike)).rejects.toMatchObject({
      code: ERROR_CODES.FILE_UNSUPPORTED,
    })
  })
})

describe('PPTX extraction', () => {
  it('numbers slides in presentation order and keeps speaker notes', async () => {
    const doc = await processOne(
      'ke-hoach.pptx',
      makePptx([
        { paragraphs: ['Kế hoạch quý 3', 'Ba trọng tâm'], notes: 'Nhấn mạnh phần ngân sách' },
        { paragraphs: ['Rủi ro'] },
      ]),
    )

    expect(doc.kind).toBe('pptx')
    expect(doc.pageCount).toBe(2)
    expect(doc.text).toContain('## Slide 1')
    expect(doc.text).toContain('Kế hoạch quý 3')
    expect(doc.text).toContain('Ghi chú: Nhấn mạnh phần ngân sách')
    expect(doc.text.indexOf('## Slide 1')).toBeLessThan(doc.text.indexOf('## Slide 2'))
  })
})

describe('DOC extraction (Word 97)', () => {
  it('follows the piece table instead of reading the stream in byte order', async () => {
    // Fixture đặt các mảnh NGƯỢC trong file; đọc thẳng byte sẽ ra thứ tự đảo.
    const doc = await processOne(
      'hop-dong.doc',
      makeDoc([
        { text: 'Phan mot. ', compressed: true },
        { text: 'Phần hai có dấu. ', compressed: false },
        { text: 'Phan ba.', compressed: true },
      ]),
    )

    expect(doc.kind).toBe('doc')
    expect(doc.text).toBe('Phan mot. Phần hai có dấu. Phan ba.')
  })

  it('drops field instructions but keeps the field result', async () => {
    // U+0013 chỉ-dẫn, U+0014 phân cách, U+0015 kết thúc. Người dùng chỉ nhìn thấy kết quả.
    const withField = `Xem HYPERLINK "http://noi-bo/bi-mat"trang chu nhe`
    const doc = await processOne('lien-ket.doc', makeDoc([{ text: withField, compressed: true }]))

    expect(doc.text).toBe('Xem trang chu nhe')
    expect(doc.text).not.toContain('bi-mat')
  })

  it('turns table cell marks into tabs', async () => {
    const doc = await processOne('bang.doc', makeDoc([{ text: 'AB', compressed: true }]))
    expect(doc.text).toContain('A\tB')
  })

  it('reports a non-Word compound file as an extraction failure', async () => {
    await expect(
      processOne('gia.doc', makeXls([{ name: 'S', rows: [['x']] }])),
    ).rejects.toMatchObject({
      code: ERROR_CODES.DOCUMENT_EXTRACTION_FAILED,
    })
  })
})

describe('XLS extraction (BIFF8)', () => {
  it('resolves shared strings, numbers and sheet names', async () => {
    const doc = await processOne(
      'so-lieu.xls',
      makeXls([
        {
          name: 'Thang 7',
          rows: [
            ['Khoản mục', 'Số tiền'],
            ['Lương', 1500],
            ['Thưởng', 250.5],
          ],
        },
      ]),
    )

    expect(doc.kind).toBe('xls')
    expect(doc.text).toContain('## Bảng tính: Thang 7')
    expect(doc.text).toContain('Khoản mục\tSố tiền')
    expect(doc.text).toContain('Lương\t1500')
    expect(doc.text).toContain('Thưởng\t250.5')
  })
})

describe('PPT extraction (PowerPoint 97)', () => {
  it('groups text by slide across both text atom encodings', async () => {
    const doc = await processOne(
      'gioi-thieu.ppt',
      makePpt([
        { lines: ['Tổng quan hệ thống', 'Kiến trúc ba lớp'] },
        { lines: ['Ket luan'], bytes: true },
      ]),
    )

    expect(doc.kind).toBe('ppt')
    expect(doc.text).toContain('## Slide 1')
    expect(doc.text).toContain('Tổng quan hệ thống')
    expect(doc.text).toContain('## Slide 2')
    expect(doc.text).toContain('Ket luan')
  })
})
