import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DocumentProcessor, InlineRunner } from './index.js'
import { formatExcelSerial, isDateFormat } from './spreadsheet-dates.js'
import { testLogger } from '../../../tests/support/factories.js'
import { makeXlsx } from '../../../tests/support/make-office.js'
import { makeXls } from '../../../tests/support/make-legacy-office.js'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nexa-dates-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

async function extract(name: string, content: Buffer): Promise<string> {
  const path = join(dir, name)
  writeFileSync(path, content)
  const { logger } = testLogger()
  const processor = new DocumentProcessor({
    runner: new InlineRunner(),
    logger,
    limits: { maxFileSizeMb: 30, maxFilesPerRequest: 5 },
  })
  const [doc] = await processor.process([{ path, fileName: name, sizeBytes: content.length }])
  if (doc === undefined) throw new Error('không có tài liệu nào được trả về')
  return doc.text
}

describe('formatExcelSerial', () => {
  it('bù đúng lỗi năm nhuận 1900 mà Excel cố ý giữ lại', () => {
    // 45292 là mốc đối chiếu quen thuộc: 01/01/2024.
    expect(formatExcelSerial(45_292, { id: 14 })).toBe('2024-01-01')
    // 386 ngày sau, đi qua trọn một năm nhuận.
    expect(formatExcelSerial(45_678, { id: 14 })).toBe('2025-01-21')
  })

  it('thêm giờ khi serial có phần thập phân', () => {
    expect(formatExcelSerial(45_000.5, { id: 22 })).toBe('2023-03-15 12:00')
  })

  it('chỉ in giờ với định dạng chỉ có giờ', () => {
    expect(formatExcelSerial(0.75, { id: 18 })).toBe('18:00:00')
  })

  it('từ chối serial ngoài dải Excel biểu diễn được', () => {
    expect(formatExcelSerial(-1, { id: 14 })).toBeNull()
    expect(formatExcelSerial(9_999_999, { id: 14 })).toBeNull()
  })
})

describe('isDateFormat', () => {
  it('nhận các mã dựng sẵn mà file không hề khai formatCode', () => {
    expect(isDateFormat({ id: 14 })).toBe(true)
    expect(isDateFormat({ id: 22 })).toBe(true)
    // 0 = General, 2 = số hai chữ số thập phân.
    expect(isDateFormat({ id: 0 })).toBe(false)
    expect(isDateFormat({ id: 2 })).toBe(false)
  })

  it('không nhầm chữ trong phần văn bản của formatCode thành ngày', () => {
    // `"Ngày "0` là định dạng SỐ có tiền tố chữ. Chữ "y"/"d" nằm trong ngoặc kép không nói gì
    // về giá trị — đọc nhầm ở đây sẽ biến số tiền thành một ngày tháng vô nghĩa.
    expect(isDateFormat({ id: 164, code: '"Ngày "0' })).toBe(false)
    expect(isDateFormat({ id: 165, code: '#,##0.00' })).toBe(false)
    expect(isDateFormat({ id: 166, code: '[Red]#,##0' })).toBe(false)
    expect(isDateFormat({ id: 167, code: 'dd\\-mmm\\-yyyy' })).toBe(true)
  })
})

describe('ô ngày trong bảng tính thật', () => {
  it('XLSX: đổi serial thành ngày ISO thay vì để model đọc một con số', async () => {
    const text = await extract(
      'hop-dong.xlsx',
      makeXlsx([
        {
          name: 'Hop dong',
          rows: [
            ['Ngày ký', 'Số tiền'],
            [{ serial: 45_678 }, 1_500_000],
          ],
        },
      ]),
    )
    expect(text).toContain('2025-01-21\t1500000')
    expect(text).not.toContain('45678')
  })

  it('XLSX: tôn trọng formatCode tuỳ biến', async () => {
    const text = await extract(
      'tuy-bien.xlsx',
      makeXlsx([{ name: 'S', rows: [[{ serial: 45_292, formatCode: 'dd\\-mmm\\-yyyy' }]] }]),
    )
    expect(text).toContain('2024-01-01')
  })

  it('XLSX: ô số KHÔNG mang style ngày vẫn giữ nguyên là số', async () => {
    // Cùng giá trị 45678, khác style ⇒ khác nghĩa. Đây chính là chỗ dễ đổi nhầm cả hai chiều.
    const text = await extract('so.xlsx', makeXlsx([{ name: 'S', rows: [[45_678]] }]))
    expect(text).toContain('45678')
    expect(text).not.toContain('2025-01-21')
  })

  it('XLS (BIFF8): cũng đổi serial thành ngày, không để hai định dạng lệch nhau', async () => {
    const text = await extract(
      'hop-dong.xls',
      makeXls([
        {
          name: 'Hop dong',
          rows: [
            ['Ngày ký', 'Số tiền'],
            [{ serial: 45_678 }, 1_500_000],
          ],
        },
      ]),
    )
    expect(text).toContain('2025-01-21')
    expect(text).not.toContain('45678')
  })

  it('XLS: ô số thường không bị đổi', async () => {
    const text = await extract('so.xls', makeXls([{ name: 'S', rows: [[45_678]] }]))
    expect(text).toContain('45678')
  })
})
