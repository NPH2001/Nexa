import { describe, expect, it } from 'vitest'
import {
  MAX_FILE_BLOCKS_PER_MESSAGE,
  MAX_FILE_BLOCK_BYTES,
  normalizeFileName,
  parseFileBlocks,
  utf8ByteLength,
  type ContentSegment,
  type FileBlockSegment,
} from './file-blocks.js'

/** Backtick dựng bằng biến để chính file test này không bị chẻ fence khi ai đó đọc trong editor. */
const F = '```'

function fileSegments(segments: readonly ContentSegment[]): FileBlockSegment[] {
  return segments.filter((s): s is FileBlockSegment => s.kind === 'file')
}

describe('parseFileBlocks — nhận diện khối', () => {
  it('tách một khối drawio kèm văn xuôi trước và sau', () => {
    const source = [
      'Đây là sơ đồ luồng thanh toán:',
      `${F}drawio filename=luong-thanh-toan.drawio`,
      '<mxfile><diagram/></mxfile>',
      F,
      'Bạn mở bằng draw.io nhé.',
    ].join('\n')

    const segments = parseFileBlocks(source)

    expect(segments.map((s) => s.kind)).toEqual(['text', 'file', 'text'])
    const [block] = fileSegments(segments)
    expect(block?.format).toBe('drawio')
    expect(block?.fileName).toBe('luong-thanh-toan.drawio')
    expect(block?.content).toBe('<mxfile><diagram/></mxfile>')
    expect(block?.lineCount).toBe(1)
  })

  it('coi fence xml mở đầu bằng mxfile là drawio', () => {
    const segments = parseFileBlocks([`${F}xml`, '<mxfile><diagram/></mxfile>', F].join('\n'))

    expect(fileSegments(segments)[0]?.format).toBe('drawio')
  })

  it('giữ fence xml thường là xml', () => {
    const segments = parseFileBlocks([`${F}xml`, '<config><a/></config>', F].join('\n'))

    expect(fileSegments(segments)[0]?.format).toBe('xml')
  })

  it('đặt tên mặc định khi fence không có filename', () => {
    const segments = parseFileBlocks([`${F}csv`, 'a,b', '1,2', F].join('\n'))

    const [block] = fileSegments(segments)
    expect(block?.fileName).toBe('bang-du-lieu.csv')
    expect(block?.lineCount).toBe(2)
  })

  it('nhận nhiều khối trong một message, mỗi khối độc lập', () => {
    const source = [
      `${F}drawio filename=so-do.drawio`,
      '<mxfile/>',
      F,
      'Kèm ghi chú:',
      `${F}md filename=ghi-chu.md`,
      '# Ghi chú',
      F,
    ].join('\n')

    const blocks = fileSegments(parseFileBlocks(source))

    expect(blocks.map((b) => b.fileName)).toEqual(['so-do.drawio', 'ghi-chu.md'])
    expect(blocks.map((b) => b.format)).toEqual(['drawio', 'md'])
  })

  it('nhận tên file có dấu ngoặc kép và khoảng trắng', () => {
    const segments = parseFileBlocks(
      [`${F}txt filename="ghi chu cuoc hop.txt"`, 'nội dung', F].join('\n'),
    )

    expect(fileSegments(segments)[0]?.fileName).toBe('ghi chu cuoc hop.txt')
  })

  it('ánh xạ tên ngôn ngữ khác của cùng định dạng', () => {
    const segments = parseFileBlocks([`${F}markdown filename=a.md`, '# a', F].join('\n'))

    expect(fileSegments(segments)[0]?.format).toBe('md')
  })
})

describe('parseFileBlocks — không làm mất nội dung', () => {
  it('không có fence thì trả về đúng một khối văn bản', () => {
    const source = 'Chỉ là một câu trả lời thường.'

    expect(parseFileBlocks(source)).toEqual([{ kind: 'text', text: source }])
  })

  it('XML thô không nằm trong fence thì vẫn là văn bản', () => {
    const source = 'Nội dung: <mxfile><diagram/></mxfile> — bạn copy nhé.'

    expect(parseFileBlocks(source)).toEqual([{ kind: 'text', text: source }])
  })

  it('fence định dạng ngoài allowlist thì giữ nguyên văn', () => {
    const source = [`${F}python`, 'print(1)', F].join('\n')

    expect(parseFileBlocks(source)).toEqual([{ kind: 'text', text: source }])
  })

  it('phần mở rộng thực thi không tạo ra khối file', () => {
    const source = [`${F}exe filename=setup.exe`, 'MZ', F].join('\n')

    expect(fileSegments(parseFileBlocks(source))).toHaveLength(0)
    expect(parseFileBlocks(source)).toEqual([{ kind: 'text', text: source }])
  })

  it('không nhận html kể cả khi model tự tin đặt tên', () => {
    const source = [`${F}html filename=trang.html`, '<h1>a</h1>', F].join('\n')

    expect(fileSegments(parseFileBlocks(source))).toHaveLength(0)
  })

  it('chuỗi rỗng trả về mảng rỗng', () => {
    expect(parseFileBlocks('')).toEqual([])
  })
})

describe('parseFileBlocks — nội dung nguyên vẹn từng ký tự', () => {
  it('giữ CRLF trong nội dung và chỉ bỏ dấu ngắt dòng của fence đóng', () => {
    const source = `${F}csv filename=a.csv\r\na,b\r\n1,2\r\n${F}`

    expect(fileSegments(parseFileBlocks(source))[0]?.content).toBe('a,b\r\n1,2')
  })

  it('giữ dòng trống ở giữa nội dung', () => {
    const source = [`${F}txt`, 'dòng 1', '', 'dòng 3', F].join('\n')

    const [block] = fileSegments(parseFileBlocks(source))
    expect(block?.content).toBe('dòng 1\n\ndòng 3')
    expect(block?.lineCount).toBe(3)
  })

  it('nội dung rỗng vẫn là một khối file', () => {
    const source = [`${F}txt filename=trong.txt`, F].join('\n')

    const [block] = fileSegments(parseFileBlocks(source))
    expect(block?.content).toBe('')
    expect(block?.lineCount).toBe(0)
  })

  it('fence bốn backtick chứa được ba backtick bên trong', () => {
    const source = ['````md filename=huong-dan.md', '# Ví dụ', F, 'code', F, '````'].join('\n')

    const [block] = fileSegments(parseFileBlocks(source))
    expect(block?.fileName).toBe('huong-dan.md')
    expect(block?.content).toBe(['# Ví dụ', F, 'code', F].join('\n'))
  })

  it('fence ba backtick đóng ở dòng ba backtick đầu tiên', () => {
    const source = [`${F}sql filename=q.sql`, 'SELECT 1;', F, 'Xong.'].join('\n')

    const [block] = fileSegments(parseFileBlocks(source))
    expect(block?.content).toBe('SELECT 1;')
  })

  it('không thêm newline khi nội dung không kết thúc bằng newline trước fence đóng', () => {
    const source = `${F}txt\nmột dòng duy nhất\n${F}`

    expect(fileSegments(parseFileBlocks(source))[0]?.content).toBe('một dòng duy nhất')
  })
})

describe('parseFileBlocks — khối chưa hoàn tất', () => {
  it('fence chưa đóng thành segment partial, không mang nội dung dở dang', () => {
    const source = ['Đang dựng sơ đồ:', `${F}drawio filename=so-do.drawio`, '<mxfile>'].join('\n')

    const segments = parseFileBlocks(source)

    expect(segments.map((s) => s.kind)).toEqual(['text', 'partial'])
    expect(segments[1]).toEqual({
      kind: 'partial',
      format: 'drawio',
      fileName: 'so-do.drawio',
    })
    expect(JSON.stringify(segments)).not.toContain('<mxfile>')
  })

  it('fence chưa đóng và chưa có filename vẫn có tên mặc định', () => {
    const segments = parseFileBlocks([`${F}txt`, 'đang'].join('\n'))

    expect(segments[0]).toEqual({ kind: 'partial', format: 'txt', fileName: 'noi-dung.txt' })
  })

  it('chỉ mới có dòng mở fence cũng đã là partial', () => {
    expect(parseFileBlocks(`${F}drawio filename=a.drawio`)).toEqual([
      { kind: 'partial', format: 'drawio', fileName: 'a.drawio' },
    ])
  })
})

describe('parseFileBlocks — trần dung lượng và số khối', () => {
  it('khối vượt trần thành oversize, khối khác trong cùng message vẫn dùng được', () => {
    const huge = 'x'.repeat(MAX_FILE_BLOCK_BYTES + 1)
    const source = [`${F}txt filename=to.txt`, huge, F, `${F}txt filename=nho.txt`, 'nhỏ', F].join(
      '\n',
    )

    const segments = parseFileBlocks(source)

    expect(segments[0]).toEqual({
      kind: 'oversize',
      format: 'txt',
      fileName: 'to.txt',
      byteLength: MAX_FILE_BLOCK_BYTES + 1,
    })
    expect(fileSegments(segments).map((b) => b.fileName)).toEqual(['nho.txt'])
  })

  it('vượt trần số khối thì nêu rõ số khối bị bỏ', () => {
    const block = [`${F}txt`, 'a', F].join('\n')
    const source = Array.from({ length: MAX_FILE_BLOCKS_PER_MESSAGE + 3 }, () => block).join('\n')

    const segments = parseFileBlocks(source)

    expect(fileSegments(segments)).toHaveLength(MAX_FILE_BLOCKS_PER_MESSAGE)
    expect(segments.at(-1)).toEqual({ kind: 'omitted', count: 3 })
  })
})

describe('normalizeFileName', () => {
  it('lược mọi thành phần đường dẫn', () => {
    expect(normalizeFileName('../../Windows/System32/evil.txt', 'txt')).toBe('evil.txt')
    expect(normalizeFileName('C:\\Users\\hoang\\a.txt', 'txt')).toBe('a.txt')
  })

  it('không để lại tên trùng tên thiết bị Windows', () => {
    expect(normalizeFileName('CON.txt', 'txt')).toBe('_CON.txt')
    expect(normalizeFileName('com1', 'txt')).toBe('_com1.txt')
  })

  it('bỏ ký tự Windows cấm', () => {
    expect(normalizeFileName('a:b.txt', 'txt')).toBe('ab.txt')
    expect(normalizeFileName('bao*cao?<>|".txt', 'txt')).toBe('baocao.txt')
  })

  it('bỏ dấu chấm và khoảng trắng ở cuối', () => {
    expect(normalizeFileName('bao-cao...', 'txt')).toBe('bao-cao.txt')
    expect(normalizeFileName('bao-cao   ', 'txt')).toBe('bao-cao.txt')
  })

  it('tên rỗng sau chuẩn hoá thì dùng tên mặc định của định dạng', () => {
    expect(normalizeFileName('', 'drawio')).toBe('so-do.drawio')
    expect(normalizeFileName('...', 'txt')).toBe('noi-dung.txt')
    expect(normalizeFileName('<>:"|?*', 'csv')).toBe('bang-du-lieu.csv')
  })

  it('cắt tên quá dài nhưng vẫn giữ phần mở rộng', () => {
    const result = normalizeFileName('a'.repeat(300), 'txt')

    expect(result.endsWith('.txt')).toBe(true)
    expect(result.length).toBeLessThanOrEqual(120)
  })

  it('không nhân đôi phần mở rộng', () => {
    expect(normalizeFileName('so-do.drawio', 'drawio')).toBe('so-do.drawio')
    expect(normalizeFileName('so-do.DRAWIO', 'drawio')).toBe('so-do.drawio')
  })

  it('phần mở rộng lệch định dạng thì bị coi là phần của tên', () => {
    expect(normalizeFileName('so-do.xml', 'drawio')).toBe('so-do.xml.drawio')
  })

  it('giữ dấu tiếng Việt và khoảng trắng', () => {
    expect(normalizeFileName('Sơ đồ thanh toán.drawio', 'drawio')).toBe('Sơ đồ thanh toán.drawio')
  })

  it('gộp khoảng trắng liên tiếp', () => {
    expect(normalizeFileName('bao   cao.txt', 'txt')).toBe('bao cao.txt')
  })
})

describe('utf8ByteLength', () => {
  it('đếm đúng ASCII, tiếng Việt và emoji', () => {
    expect(utf8ByteLength('abc')).toBe(3)
    expect(utf8ByteLength('é')).toBe(2)
    // 'ơ' là U+01A1, vẫn nằm dưới U+0800 nên chỉ 2 byte; 'ề' (U+1EC1) mới là nhánh 3 byte.
    expect(utf8ByteLength('ơ')).toBe(2)
    expect(utf8ByteLength('ề')).toBe(3)
    expect(utf8ByteLength('🙂')).toBe(4)
  })

  it('khớp với Buffer.byteLength trên chuỗi trộn lẫn', () => {
    const sample = 'Sơ đồ 🙂 payment <mxfile/> café\ndòng 2'

    expect(utf8ByteLength(sample)).toBe(Buffer.byteLength(sample, 'utf8'))
  })
})
