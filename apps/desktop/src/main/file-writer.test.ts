import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ERROR_CODES, NexaError } from '@nexa/shared-types'
import { Logger, MemorySink } from '@nexa/observability'
import type { BrowserWindow } from 'electron'

const electronMock = vi.hoisted(() => ({
  downloads: '/tmp',
  showSaveDialog: vi.fn(),
}))

vi.mock('electron', () => ({
  app: { getPath: () => electronMock.downloads },
  dialog: { showSaveDialog: electronMock.showSaveDialog },
}))

const { FileWriter } = await import('./file-writer.js')

/** Hộp thoại là thứ duy nhất quyết định đường dẫn, nên mọi test đều đi qua nó. */
const window = {} as BrowserWindow

let dir: string
let sink: MemorySink

function makeWriter(): InstanceType<typeof FileWriter> {
  sink = new MemorySink()
  return new FileWriter(new Logger({ sink, minLevel: 'debug' }))
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nexa-file-writer-test-'))
  electronMock.downloads = dir
  electronMock.showSaveDialog.mockReset()
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('FileWriter.save — lưu thành công', () => {
  it('ghi đúng nội dung và trả về tên file, không trả đường dẫn', async () => {
    const target = join(dir, 'so-do.drawio')
    electronMock.showSaveDialog.mockResolvedValue({ canceled: false, filePath: target })

    const result = await makeWriter().save(window, {
      fileName: 'so-do.drawio',
      format: 'drawio',
      content: '<mxfile><diagram/></mxfile>',
    })

    expect(result).toEqual({ saved: true, fileName: 'so-do.drawio' })
    expect(readFileSync(target, 'utf8')).toBe('<mxfile><diagram/></mxfile>')
    expect(JSON.stringify(result)).not.toContain(dir)
  })

  it('gợi ý tên đã chuẩn hoá trong thư mục Downloads', async () => {
    electronMock.showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: join(dir, 'evil.txt'),
    })

    await makeWriter().save(window, {
      fileName: '../../Windows/System32/evil.txt',
      format: 'txt',
      content: 'x',
    })

    const options = electronMock.showSaveDialog.mock.calls[0]?.[1] as { defaultPath: string }
    expect(options.defaultPath).toBe(join(dir, 'evil.txt'))
    expect(options.defaultPath).not.toContain('System32')
  })

  it('giữ nội dung nguyên vẹn từng ký tự, kể cả CRLF và dấu tiếng Việt', async () => {
    const target = join(dir, 'a.csv')
    const content = 'mã,tên\r\n1,Sơ đồ thanh toán\r\n2,café'
    electronMock.showSaveDialog.mockResolvedValue({ canceled: false, filePath: target })

    await makeWriter().save(window, { fileName: 'a.csv', format: 'csv', content })

    expect(readFileSync(target, 'utf8')).toBe(content)
  })
})

describe('FileWriter.save — huỷ và từ chối', () => {
  it('huỷ hộp thoại thì không ghi gì và không ném lỗi', async () => {
    electronMock.showSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined })

    const result = await makeWriter().save(window, {
      fileName: 'a.txt',
      format: 'txt',
      content: 'x',
    })

    expect(result).toEqual({ saved: false, canceled: true })
    expect(readdirSync(dir)).toEqual([])
  })

  it('filePath rỗng cũng được coi là huỷ', async () => {
    electronMock.showSaveDialog.mockResolvedValue({ canceled: false, filePath: '' })

    const result = await makeWriter().save(window, {
      fileName: 'a.txt',
      format: 'txt',
      content: 'x',
    })

    expect(result).toEqual({ saved: false, canceled: true })
    expect(readdirSync(dir)).toEqual([])
  })

  it('định dạng ngoài allowlist bị từ chối TRƯỚC khi hộp thoại mở', async () => {
    await expect(
      makeWriter().save(window, { fileName: 'setup.exe', format: 'exe', content: 'MZ' }),
    ).rejects.toMatchObject({ code: ERROR_CODES.FILE_UNSUPPORTED })

    expect(electronMock.showSaveDialog).not.toHaveBeenCalled()
  })

  it('html không được ghi dù trông như văn bản', async () => {
    await expect(
      makeWriter().save(window, { fileName: 'trang.html', format: 'html', content: '<h1>a</h1>' }),
    ).rejects.toMatchObject({ code: ERROR_CODES.FILE_UNSUPPORTED })

    expect(electronMock.showSaveDialog).not.toHaveBeenCalled()
  })

  it('nội dung vượt trần bị từ chối trước khi hộp thoại mở', async () => {
    await expect(
      makeWriter().save(window, {
        fileName: 'to.txt',
        format: 'txt',
        content: 'x'.repeat(1_000_001),
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.FILE_TOO_LARGE })

    expect(electronMock.showSaveDialog).not.toHaveBeenCalled()
  })
})

describe('FileWriter.save — lỗi ổ đĩa', () => {
  it('ổ đĩa từ chối ghi thành FILE_WRITE_FAILED', async () => {
    // Ghi vào một đường dẫn có thư mục cha không tồn tại: fs trả ENOENT, không phải crash.
    electronMock.showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: join(dir, 'khong-ton-tai', 'a.txt'),
    })

    const error = await makeWriter()
      .save(window, { fileName: 'a.txt', format: 'txt', content: 'x' })
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(NexaError)
    expect(error).toMatchObject({ code: ERROR_CODES.FILE_WRITE_FAILED })
    expect(existsSync(join(dir, 'khong-ton-tai', 'a.txt'))).toBe(false)
  })
})

describe('FileWriter.save — log', () => {
  it('không log tên file lẫn đường dẫn khi lưu thành công', async () => {
    const target = join(dir, 'luong-thang-12-nhan-su.csv')
    electronMock.showSaveDialog.mockResolvedValue({ canceled: false, filePath: target })

    const writer = makeWriter()
    await writer.save(window, {
      fileName: 'luong-thang-12-nhan-su.csv',
      format: 'csv',
      content: 'ho-ten,luong\nA,1',
    })

    const dump = JSON.stringify(sink.records)
    expect(dump).toContain('file-saved')
    expect(dump).toContain('csv')
    expect(dump).not.toContain('luong-thang-12-nhan-su')
    expect(dump).not.toContain(dir)
    expect(dump).not.toContain('ho-ten')
  })

  it('không log tên file khi người dùng huỷ', async () => {
    electronMock.showSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined })

    const writer = makeWriter()
    await writer.save(window, { fileName: 'bao-mat.txt', format: 'txt', content: 'x' })

    const dump = JSON.stringify(sink.records)
    expect(dump).toContain('file-save-canceled')
    expect(dump).not.toContain('bao-mat')
  })
})
