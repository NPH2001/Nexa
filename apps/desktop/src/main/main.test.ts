import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Logger, MemorySink } from '@nexa/observability'

// FileBroker và window.ts import `electron` ở mức module. Trong vitest không có Electron,
// nên ta thay bằng một bản giả tối thiểu — phần logic cần kiểm chứng (mô hình token, allowlist)
// không phụ thuộc vào Electron thật.
const showOpenDialog = vi.fn()
vi.mock('electron', () => ({
  dialog: { showOpenDialog: (...args: unknown[]) => showOpenDialog(...args) as unknown },
  BrowserWindow: class {},
  session: { defaultSession: {} },
  shell: { openExternal: vi.fn(), openPath: vi.fn() },
  app: { getVersion: () => '0.1.0', getPath: () => '/tmp', getAppPath: () => '/tmp' },
  safeStorage: {},
  ipcMain: { handle: vi.fn() },
}))

const { FileBroker } = await import('./file-broker.js')
const { isExternalUrlAllowed } = await import('./window.js')
const { UpdateService, compareVersions } = await import('./update-service.js')

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nexa-main-'))
  showOpenDialog.mockReset()
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function logger(): Logger {
  return new Logger({ sink: new MemorySink(), minLevel: 'debug' })
}

// ═══════════════════════════════════════════════════════════════════════════
// FileBroker — §5.3 "chỉ sử dụng handle từ file picker"
// ═══════════════════════════════════════════════════════════════════════════

describe('FileBroker', () => {
  it('trả về token, KHÔNG trả về đường dẫn', async () => {
    const path = join(dir, 'tai-lieu.txt')
    writeFileSync(path, 'nội dung')
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [path] })

    const broker = new FileBroker(logger(), { maxFilesPerRequest: 5, maxFileSizeMb: 30 })
    const picked = await broker.pick({} as never)

    expect(picked).toHaveLength(1)
    expect(picked[0]?.fileName).toBe('tai-lieu.txt')
    // Đây là bất biến quan trọng nhất của lớp này: renderer không bao giờ thấy đường dẫn.
    expect(JSON.stringify(picked)).not.toContain(dir)
  })

  it('đổi token thành đường dẫn thật — chỉ ở main process', async () => {
    const path = join(dir, 'a.txt')
    writeFileSync(path, 'x')
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [path] })

    const broker = new FileBroker(logger(), { maxFilesPerRequest: 5, maxFileSizeMb: 30 })
    const [picked] = await broker.pick({} as never)
    expect(broker.resolve([picked!.token])[0]?.path).toBe(path)
  })

  it('từ chối token bịa ra — renderer không thể yêu cầu đọc file tuỳ ý', () => {
    const broker = new FileBroker(logger(), { maxFilesPerRequest: 5, maxFileSizeMb: 30 })
    expect(() => broker.resolve(['00000000-0000-4000-8000-000000000000'])).toThrow()
  })

  it('từ chối token đã được giải phóng', async () => {
    const path = join(dir, 'a.txt')
    writeFileSync(path, 'x')
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [path] })

    const broker = new FileBroker(logger(), { maxFilesPerRequest: 5, maxFileSizeMb: 30 })
    const [picked] = await broker.pick({} as never)
    broker.release(picked!.token)
    expect(() => broker.resolve([picked!.token])).toThrow()
  })

  it('trả mảng rỗng khi người dùng huỷ hộp thoại', async () => {
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    const broker = new FileBroker(logger(), { maxFilesPerRequest: 5, maxFileSizeMb: 30 })
    expect(await broker.pick({} as never)).toEqual([])
    expect(broker.activeCount).toBe(0)
  })

  it('chặn khi chọn quá số file cho phép', async () => {
    const paths = Array.from({ length: 6 }, (_, i) => {
      const p = join(dir, `f${String(i)}.txt`)
      writeFileSync(p, 'x')
      return p
    })
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: paths })

    const broker = new FileBroker(logger(), { maxFilesPerRequest: 5, maxFileSizeMb: 30 })
    await expect(broker.pick({} as never)).rejects.toMatchObject({ code: 'TOO_MANY_FILES' })
  })

  it('không ghi tên file vào log — tên file thường tiết lộ nội dung', async () => {
    const path = join(dir, 'BaoCaoLuong_ThangBay.txt')
    writeFileSync(path, 'x')
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [path] })

    const sink = new MemorySink()
    const broker = new FileBroker(new Logger({ sink, minLevel: 'debug' }), {
      maxFilesPerRequest: 5,
      maxFileSizeMb: 30,
    })
    await broker.pick({} as never)
    expect(sink.asText()).not.toContain('BaoCaoLuong')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Allowlist mở link ra ngoài (§11.2)
// ═══════════════════════════════════════════════════════════════════════════

describe('isExternalUrlAllowed', () => {
  it.each([
    ['https://jira.corp.local/browse/A-1', ['*.corp.local'], true],
    ['https://evil.example/steal', ['*.corp.local'], false],
    ['http://jira.corp.local', ['*.corp.local'], false],
    ['https://user:pw@jira.corp.local', ['*.corp.local'], false],
    ['javascript:alert(1)', [], false],
    ['https://bat-ky-dau.example', [], true],
  ])('%s với allowlist %j → %s', (url, allowlist, expected) => {
    expect(isExternalUrlAllowed(url, allowlist)).toBe(expected)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// UpdateService (§18.2)
// ═══════════════════════════════════════════════════════════════════════════

describe('compareVersions', () => {
  it.each([
    ['1.0.0', '1.0.1', -1],
    ['1.2.0', '1.10.0', -1],
    ['2.0.0', '1.9.9', 1],
    ['1.0.0', '1.0.0', 0],
  ])('%s vs %s', (a, b, expected) => {
    expect(Math.sign(compareVersions(a, b))).toBe(expected)
  })
})

describe('UpdateService', () => {
  const manifest = {
    channel: 'stable',
    version: '1.2.0',
    url: 'https://updates.corp.local/nexa-1.2.0.exe',
    sha256: 'a'.repeat(64),
    releasedAt: '2026-08-01T00:00:00Z',
    mandatory: false,
  }

  const fetchOk = (body: unknown): typeof fetch =>
    (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch

  it('phát hiện có bản mới', async () => {
    const service = new UpdateService(logger(), '1.1.0', fetchOk(manifest))
    const result = await service.check('https://updates.corp.local/manifest.json', [])
    expect(result.status).toBe('available')
    expect(result.manifest?.version).toBe('1.2.0')
  })

  it('báo up-to-date khi đã mới nhất', async () => {
    const service = new UpdateService(logger(), '1.2.0', fetchOk(manifest))
    expect((await service.check('https://updates.corp.local/m.json', [])).status).toBe('up-to-date')
  })

  it('chặn client quá cũ (§16)', async () => {
    const service = new UpdateService(
      logger(),
      '0.9.0',
      fetchOk({ ...manifest, minimumSupportedVersion: '1.0.0' }),
    )
    expect((await service.check('https://updates.corp.local/m.json', [])).status).toBe(
      'unsupported-client',
    )
  })

  it('từ chối URL manifest không thuộc allowlist', async () => {
    const service = new UpdateService(logger(), '1.0.0', fetchOk(manifest))
    const result = await service.check('https://evil.example/m.json', ['*.corp.local'])
    expect(result.status).toBe('unavailable')
  })

  it('không chặn sử dụng khi máy chủ cập nhật không truy cập được', async () => {
    const service = new UpdateService(
      logger(),
      '1.0.0',
      (async () => {
        throw new Error('mạng hỏng')
      }) as unknown as typeof fetch,
    )
    expect((await service.check('https://updates.corp.local/m.json', [])).status).toBe('unavailable')
  })

  it('từ chối manifest thiếu trường hoặc sai định dạng', async () => {
    const service = new UpdateService(logger(), '1.0.0', fetchOk({ version: 'không phải semver' }))
    expect((await service.check('https://updates.corp.local/m.json', [])).status).toBe('unavailable')
  })

  it('từ chối gói cài sai checksum', () => {
    const service = new UpdateService(logger(), '1.0.0')
    expect(() => service.verifyPackage(Buffer.from('nội dung giả'), manifest as never)).toThrow()
  })

  it('chấp nhận gói cài đúng checksum', async () => {
    const bytes = Buffer.from('bo cai that')
    const { createHash } = await import('node:crypto')
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const service = new UpdateService(logger(), '1.0.0')
    expect(() => service.verifyPackage(bytes, { ...manifest, sha256 } as never)).not.toThrow()
  })

  it('TỪ CHỐI khi manifest yêu cầu chữ ký — chưa có certificate thì không được giả vờ đã kiểm tra', async () => {
    const bytes = Buffer.from('bo cai that')
    const { createHash } = await import('node:crypto')
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const service = new UpdateService(logger(), '1.0.0')

    expect(() =>
      service.verifyPackage(bytes, { ...manifest, sha256, requireSignature: true } as never),
    ).toThrow()
  })
})
