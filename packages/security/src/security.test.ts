import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ERROR_CODES } from '@nexa/shared-types'
import { Logger, MemorySink, Redactor } from '@nexa/observability'
import {
  DevFileBackend,
  MemoryBackend,
  SafeStorageBackend,
  SecurityService,
  canonicalize,
  computePayloadHash,
  decryptField,
  encryptField,
  generateMasterKey,
  hashPath,
  joinUrl,
  matchesAllowlist,
  sanitizeExternalUrl,
  validateBaseUrl,
  type SafeStorageLike,
} from './index.js'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nexa-sec-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function makeLogger() {
  const sink = new MemorySink()
  const redactor = new Redactor()
  return { logger: new Logger({ sink, redactor, minLevel: 'debug' }), sink, redactor }
}

// ═══════════════════════════════════════════════════════════════════════════
// Mã hoá trường (§8.2)
// ═══════════════════════════════════════════════════════════════════════════

describe('AES-256-GCM per-field', () => {
  const key = generateMasterKey()

  it('mã hoá và giải mã đúng', () => {
    const plaintext = 'Nội dung tiếng Việt có dấu 🙂'
    expect(decryptField(key, 'messages.content', encryptField(key, 'messages.content', plaintext))).toBe(
      plaintext,
    )
  })

  it('sinh ciphertext khác nhau mỗi lần cho cùng plaintext (IV riêng)', () => {
    const a = encryptField(key, 'messages.content', 'giống hệt nhau')
    const b = encryptField(key, 'messages.content', 'giống hệt nhau')
    expect(a).not.toBe(b)
  })

  it('từ chối khi sai khoá', () => {
    const other = generateMasterKey()
    const cipher = encryptField(key, 'messages.content', 'x')
    expect(() => decryptField(other, 'messages.content', cipher)).toThrow(
      expect.objectContaining({ code: ERROR_CODES.LOCAL_DB_LOCKED }),
    )
  })

  it('từ chối khi ciphertext bị dùng sai context (AAD binding)', () => {
    const cipher = encryptField(key, 'messages.content', 'x')
    expect(() => decryptField(key, 'settings.value', cipher)).toThrow()
  })

  it('phát hiện ciphertext bị sửa (auth tag)', () => {
    const cipher = encryptField(key, 'messages.content', 'nội dung gốc')
    const bytes = Buffer.from(cipher, 'base64')
    const last = bytes.length - 1
    bytes[last] = (bytes[last] ?? 0) ^ 0xff
    expect(() => decryptField(key, 'messages.content', bytes.toString('base64'))).toThrow()
  })

  it('từ chối chuỗi rác thay vì ném lỗi lạ', () => {
    expect(() => decryptField(key, 'messages.content', 'không phải base64 hợp lệ!!!')).toThrow(
      expect.objectContaining({ code: ERROR_CODES.LOCAL_DB_LOCKED }),
    )
  })

  it('xử lý được chuỗi rỗng và chuỗi rất dài', () => {
    expect(decryptField(key, 'c', encryptField(key, 'c', ''))).toBe('')
    const long = 'a'.repeat(1_000_000)
    expect(decryptField(key, 'c', encryptField(key, 'c', long))).toBe(long)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// URL validation (§11.2) — giảm thiểu rủi ro SSRF / gửi PAT sai đích
// ═══════════════════════════════════════════════════════════════════════════

describe('validateBaseUrl', () => {
  it.each([
    ['https://jira.internal', 'https://jira.internal'],
    ['https://jira.internal/', 'https://jira.internal'],
    ['https://jira.internal/jira///', 'https://jira.internal/jira'],
    ['  https://JIRA.internal  ', 'https://jira.internal'],
  ])('chuẩn hoá %s', (input, expected) => {
    expect(validateBaseUrl(input)).toBe(expected)
  })

  it.each([
    ['http://jira.internal', 'http'],
    ['ftp://jira.internal', 'ftp lạ'],
    ['file:///etc/passwd', 'file'],
    ['javascript:alert(1)', 'javascript'],
    ['https://user:pass@jira.internal', 'credential nhúng'],
    ['https://jira.internal?a=1', 'query'],
    ['https://jira.internal#x', 'fragment'],
    ['', 'rỗng'],
    ['không phải url', 'rác'],
  ])('từ chối %s (%s)', (input) => {
    expect(() => validateBaseUrl(input)).toThrow()
  })

  it('KHÔNG đưa URL vào safeDetail khi URL chứa credential', () => {
    try {
      validateBaseUrl('https://user:matkhau@jira.internal')
      throw new Error('phải ném lỗi')
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain('matkhau')
      expect((error as { safeDetail?: string }).safeDetail).toBe('url embeds credentials')
    }
  })

  it('chỉ cho http tới loopback khi được bật rõ ràng (dùng cho test)', () => {
    expect(() => validateBaseUrl('http://localhost:8080')).toThrow()
    expect(validateBaseUrl('http://localhost:8080', { allowInsecureLoopback: true })).toBe(
      'http://localhost:8080',
    )
    // Cờ đó KHÔNG được nới lỏng cho host bên ngoài.
    expect(() =>
      validateBaseUrl('http://jira.internal', { allowInsecureLoopback: true }),
    ).toThrow()
  })
})

describe('matchesAllowlist', () => {
  it.each([
    ['jira.corp.local', ['*.corp.local'], true],
    ['corp.local', ['*.corp.local'], false],
    ['jira.corp.local.evil.com', ['*.corp.local'], false],
    ['jira.corp.local', ['jira.corp.local'], true],
    ['JIRA.CORP.LOCAL', ['jira.corp.local'], true],
    ['evil.com', ['*.corp.local', 'other.internal'], false],
  ])('%s với %j → %s', (host, patterns, expected) => {
    expect(matchesAllowlist(host, patterns)).toBe(expected)
  })
})

describe('joinUrl', () => {
  it('ghép path tương đối', () => {
    expect(joinUrl('https://a.internal/', '/v1/models')).toBe('https://a.internal/v1/models')
  })

  it('từ chối URL tuyệt đối — chặn việc gửi Bearer token sang host khác', () => {
    expect(() => joinUrl('https://a.internal', 'https://evil.com/steal')).toThrow(
      expect.objectContaining({ code: ERROR_CODES.INVALID_URL }),
    )
  })
})

describe('sanitizeExternalUrl', () => {
  it('chấp nhận link cùng host với hệ thống đã cấu hình', () => {
    expect(sanitizeExternalUrl('https://jira.internal/browse/A-1', 'https://jira.internal')).toBe(
      'https://jira.internal/browse/A-1',
    )
  })

  it('loại link trỏ sang host khác — chống MCP server trả link lừa đảo', () => {
    expect(sanitizeExternalUrl('https://evil.com/browse/A-1', 'https://jira.internal')).toBeNull()
  })

  it('loại giá trị không phải chuỗi hoặc không phải URL', () => {
    expect(sanitizeExternalUrl(42, 'https://jira.internal')).toBeNull()
    expect(sanitizeExternalUrl('không phải url', 'https://jira.internal')).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Payload hash (§10.3)
// ═══════════════════════════════════════════════════════════════════════════

describe('canonicalize / computePayloadHash', () => {
  it('không phụ thuộc thứ tự khoá, kể cả lồng nhau', () => {
    expect(canonicalize({ b: 1, a: { d: 1, c: 2 } })).toBe(canonicalize({ a: { c: 2, d: 1 }, b: 1 }))
  })

  it('bỏ qua undefined nhưng giữ null', () => {
    expect(canonicalize({ a: undefined, b: null })).toBe('{"b":null}')
  })

  it('giữ nguyên thứ tự mảng — mảng có ngữ nghĩa thứ tự', () => {
    expect(canonicalize([1, 2])).not.toBe(canonicalize([2, 1]))
  })

  it('KHÔNG chuẩn hoá Unicode: hai cách gõ tiếng Việt cho hash khác nhau', () => {
    // Chủ ý: nếu normalize, payload người dùng nhìn thấy và payload gửi đi có thể khác byte
    // mà hash vẫn khớp. Xem docs/OPEN-QUESTIONS.md B7.
    const composed = 'ế'
    const decomposed = 'ế'.normalize('NFD')
    expect(computePayloadHash('t', { s: composed })).not.toBe(
      computePayloadHash('t', { s: decomposed }),
    )
  })

  it('hash phụ thuộc cả tên tool', () => {
    expect(computePayloadHash('jira.create_issue', { a: 1 })).not.toBe(
      computePayloadHash('jira.add_comment', { a: 1 }),
    )
  })

  it('trả về hex 64 ký tự', () => {
    expect(computePayloadHash('t', {})).toMatch(/^[0-9a-f]{64}$/)
  })

  it('hashPath không đảo ngược được và không chứa đường dẫn gốc', () => {
    const path = '/home/nguyen.van.a/BaoCaoLuong.xlsx'
    const hash = hashPath(path)
    expect(hash).toHaveLength(64)
    expect(hash).not.toContain('nguyen')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Secure storage
// ═══════════════════════════════════════════════════════════════════════════

/** safeStorage giả — mô phỏng DPAPI bằng XOR, đủ để kiểm chứng luồng đọc/ghi/hỏng. */
function fakeSafeStorage(available = true, key = 0x5a): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (text) => Buffer.from([...Buffer.from(text, 'utf8')].map((b) => b ^ key)),
    decryptString: (buf) => {
      const text = Buffer.from([...buf].map((b) => b ^ key)).toString('utf8')
      // DPAPI thật ném lỗi khi giải mã bằng profile khác; ở đây giả lập bằng JSON không parse được.
      JSON.parse(text)
      return text
    },
  }
}

describe('SafeStorageBackend', () => {
  it('lưu và đọc lại được', () => {
    const backend = new SafeStorageBackend(fakeSafeStorage(), dir)
    backend.set('secure://jira/default', 'PAT-0123456789')
    expect(backend.get('secure://jira/default')).toBe('PAT-0123456789')
  })

  it('không ghi secret dạng rõ ra đĩa', () => {
    const backend = new SafeStorageBackend(fakeSafeStorage(), dir)
    backend.set('secure://jira/default', 'PAT-tuyet-mat-0123456789')
    const raw = readFileSync(join(dir, 'credentials.bin')).toString('latin1')
    expect(raw).not.toContain('PAT-tuyet-mat')
  })

  it('báo SECRET_UNAVAILABLE và KHÔNG xoá file khi không giải mã được', () => {
    const backend = new SafeStorageBackend(fakeSafeStorage(), dir)
    backend.set('k', 'v-0123456789')

    // Profile Windows khác ⇒ khoá khác ⇒ giải mã hỏng.
    const otherProfile = new SafeStorageBackend(fakeSafeStorage(true, 0x11), dir)
    expect(() => otherProfile.get('k')).toThrow(
      expect.objectContaining({ code: ERROR_CODES.SECRET_UNAVAILABLE }),
    )
    // Fail closed: dữ liệu vẫn còn để người dùng đăng nhập lại đúng tài khoản.
    expect(existsSync(join(dir, 'credentials.bin'))).toBe(true)
  })

  it('báo không khả dụng khi hệ điều hành không có kho bảo mật', () => {
    expect(new SafeStorageBackend(fakeSafeStorage(false), dir).isAvailable()).toBe(false)
  })

  it('coi backend basic_text của Linux là KHÔNG đạt chuẩn dù isEncryptionAvailable() trả true', () => {
    // Cái bẫy thật: không có keyring thì Electron vẫn báo "có mã hoá", nhưng đó là khoá cố định.
    const insecure = { ...fakeSafeStorage(), getSelectedStorageBackend: () => 'basic_text' }
    const backend = new SafeStorageBackend(insecure, dir)
    expect(backend.isAvailable()).toBe(true)
    expect(backend.productionGrade).toBe(false)
    expect(backend.name).toContain('basic_text')
  })

  it('chấp nhận keyring thật của Linux', () => {
    const secure = { ...fakeSafeStorage(), getSelectedStorageBackend: () => 'gnome_libsecret' }
    expect(new SafeStorageBackend(secure, dir).productionGrade).toBe(true)
  })

  it('coi là đạt chuẩn khi không có API chọn backend (Windows/macOS)', () => {
    expect(new SafeStorageBackend(fakeSafeStorage(), dir).productionGrade).toBe(true)
  })

  it('bản build phát hành từ chối khởi động trên backend basic_text', () => {
    const { logger } = makeLogger()
    const insecure = { ...fakeSafeStorage(), getSelectedStorageBackend: () => 'basic_text' }
    expect(
      () =>
        new SecurityService({
          backend: new SafeStorageBackend(insecure, dir),
          logger,
          requireProductionGrade: true,
        }),
    ).toThrow(expect.objectContaining({ code: ERROR_CODES.SECRET_UNAVAILABLE }))
  })

  it('xoá sạch được', () => {
    const backend = new SafeStorageBackend(fakeSafeStorage(), dir)
    backend.set('a', 'v-0123456789')
    backend.purge()
    expect(backend.listKeys()).toEqual([])
  })
})

describe('DevFileBackend', () => {
  it('tự nhận là KHÔNG dùng được cho môi trường thật', () => {
    const backend = new DevFileBackend(dir)
    expect(backend.productionGrade).toBe(false)
    expect(backend.name).toContain('KHÔNG AN TOÀN')
  })

  it('vẫn không để secret dạng rõ trên đĩa', () => {
    const backend = new DevFileBackend(dir)
    backend.set('k', 'PAT-dev-0123456789')
    expect(readFileSync(join(dir, 'credentials.dev.bin')).toString('latin1')).not.toContain(
      'PAT-dev',
    )
  })
})

describe('SecurityService', () => {
  it('từ chối khởi động với backend không đạt chuẩn khi bắt buộc (§3 fail closed)', () => {
    const { logger } = makeLogger()
    expect(
      () =>
        new SecurityService({
          backend: new MemoryBackend(),
          logger,
          requireProductionGrade: true,
        }),
    ).toThrow(expect.objectContaining({ code: ERROR_CODES.SECRET_UNAVAILABLE }))
  })

  it('tạo master key ở lần chạy đầu và giữ nguyên ở các lần sau', () => {
    const { logger } = makeLogger()
    const backend = new MemoryBackend()
    const first = new SecurityService({ backend, logger }).getMasterKey()
    const second = new SecurityService({ backend, logger }).getMasterKey()
    expect(first.toString('base64')).toBe(second.toString('base64'))
  })

  it('master key là ngẫu nhiên, không suy ra từ tài khoản (§8.2)', () => {
    const { logger } = makeLogger()
    const a = new SecurityService({ backend: new MemoryBackend(), logger }).getMasterKey()
    const b = new SecurityService({ backend: new MemoryBackend(), logger }).getMasterKey()
    expect(a.toString('base64')).not.toBe(b.toString('base64'))
    expect(a).toHaveLength(32)
  })

  it('đăng ký secret vào redactor ngay khi lưu', () => {
    const { logger, redactor } = makeLogger()
    const service = new SecurityService({ backend: new MemoryBackend(), logger, redactor })
    service.saveCredential('jira', 'PAT-vua-luu-0123456789')
    expect(redactor.redactString('log có PAT-vua-luu-0123456789')).not.toContain('PAT-vua-luu')
  })

  it('gỡ secret khỏi redactor khi xoá credential', () => {
    const { logger, redactor } = makeLogger()
    const service = new SecurityService({ backend: new MemoryBackend(), logger, redactor })
    service.saveCredential('jira', 'PAT-se-bi-xoa-0123456789')
    service.deleteCredential('jira')
    expect(redactor.registeredCount).toBe(0)
  })

  it('báo lỗi cấu hình đúng loại khi thiếu credential', () => {
    const { logger } = makeLogger()
    const service = new SecurityService({ backend: new MemoryBackend(), logger })
    expect(() => service.readCredential('litellm')).toThrow(
      expect.objectContaining({ code: ERROR_CODES.LITELLM_CONFIG_REQUIRED }),
    )
    expect(() => service.readCredential('jira')).toThrow(
      expect.objectContaining({ code: ERROR_CODES.ATLASSIAN_CONFIG_REQUIRED }),
    )
  })

  it('từ chối lưu credential rỗng', () => {
    const { logger } = makeLogger()
    const service = new SecurityService({ backend: new MemoryBackend(), logger })
    expect(() => service.saveCredential('jira', '   ')).toThrow(
      expect.objectContaining({ code: ERROR_CODES.VALIDATION_FAILED }),
    )
  })

  it('nạp sẵn redactor lúc khởi động để secret cũ không lọt log', () => {
    const { logger } = makeLogger()
    const backend = new MemoryBackend()
    new SecurityService({ backend, logger }).saveCredential('jira', 'PAT-tu-phien-truoc-0123456789')

    const { logger: logger2, redactor: redactor2 } = makeLogger()
    const service = new SecurityService({ backend, logger: logger2, redactor: redactor2 })
    expect(redactor2.registeredCount).toBe(0)
    service.primeRedactor()
    expect(redactor2.registeredCount).toBe(1)
  })

  it('purge xoá cả master key lẫn credential', () => {
    const { logger } = makeLogger()
    const backend = new MemoryBackend()
    const service = new SecurityService({ backend, logger })
    service.getMasterKey()
    service.saveCredential('jira', 'PAT-0123456789')

    service.purgeAllSecrets()
    expect(backend.listKeys()).toEqual([])
  })

  it('không ghi giá trị secret vào log bảo mật', () => {
    const { logger, sink } = makeLogger()
    const service = new SecurityService({ backend: new MemoryBackend(), logger })
    service.saveCredential('jira', 'PAT-khong-duoc-log-0123456789')
    expect(sink.asText()).not.toContain('PAT-khong-duoc-log')
  })
})
