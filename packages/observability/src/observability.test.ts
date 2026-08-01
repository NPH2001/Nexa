import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  FileSink,
  Logger,
  MemorySink,
  MultiSink,
  REDACTED,
  Redactor,
  SECURITY_EVENTS,
  isRequestId,
  newOperationId,
  newRequestId,
} from './index.js'

// ═══════════════════════════════════════════════════════════════════════════
// Redaction — §11.1, §15.1. Đây là lớp phòng vệ cuối chống rò rỉ qua log.
// ═══════════════════════════════════════════════════════════════════════════

describe('Redactor — theo tên trường', () => {
  const r = new Redactor()

  it.each([
    'apiKey',
    'api_key',
    'API-KEY',
    'token',
    'accessToken',
    'personalAccessToken',
    'pat',
    'password',
    'authorization',
    'credential',
    'privateKey',
  ])('che giá trị của trường "%s"', (field) => {
    const output = r.redact({ [field]: 'gia-tri-bi-mat-123456' }) as Record<string, unknown>
    expect(output[field]).toBe(REDACTED)
  })

  it('che nội dung nghiệp vụ nhưng vẫn giữ độ dài để gỡ lỗi', () => {
    const output = r.redact({ content: 'Nội dung hội thoại nhạy cảm' }) as Record<string, string>
    expect(output['content']).not.toContain('nhạy cảm')
    expect(output['content']).toMatch(/^\[CONTENT_REDACTED\]:\d+$/)
  })

  it('che sâu trong object lồng nhau', () => {
    const output = r.redact({
      connection: { jira: { baseUrl: 'https://jira.internal', pat: 'PAT-123456' } },
    }) as { connection: { jira: Record<string, string> } }
    expect(output.connection.jira['pat']).toBe(REDACTED)
    expect(output.connection.jira['baseUrl']).toBe('https://jira.internal')
  })

  it('không sửa object gốc', () => {
    const original = { apiKey: 'sk-abcdefghijklmnop' }
    r.redact(original)
    expect(original.apiKey).toBe('sk-abcdefghijklmnop')
  })
})

describe('Redactor — theo giá trị đã đăng ký', () => {
  it('thay secret nằm lẫn trong chuỗi tự do', () => {
    const r = new Redactor()
    r.registerSecret('PAT-bi-mat-0123456789')
    expect(r.redactString('Gọi Jira với PAT-bi-mat-0123456789 thất bại')).not.toContain('PAT-bi-mat')
  })

  it('thay secret dài trước, không cắt vụn secret ngắn trùng tiền tố', () => {
    const r = new Redactor()
    r.registerSecret('abc123456')
    r.registerSecret('abc123456789xyz')
    expect(r.redactString('abc123456789xyz')).toBe(REDACTED)
  })

  it('bỏ qua giá trị quá ngắn để không che nhầm mọi thứ', () => {
    const r = new Redactor()
    r.registerSecret('abc')
    expect(r.registeredCount).toBe(0)
    expect(r.redactString('abc def')).toBe('abc def')
  })

  it('gỡ đăng ký khi credential bị xoá', () => {
    const r = new Redactor()
    r.registerSecret('secret-can-xoa-123')
    r.unregisterSecret('secret-can-xoa-123')
    expect(r.registeredCount).toBe(0)
  })
})

describe('Redactor — theo pattern (secret chưa kịp đăng ký)', () => {
  const r = new Redactor()

  it('che Bearer token', () => {
    expect(r.redactString('Authorization: Bearer sk-abcdef1234567890')).not.toContain('abcdef')
  })

  it('che JWT', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r'
    expect(r.redactString(`token=${jwt}`)).not.toContain('eyJhbGci')
  })

  it('che key kiểu sk-', () => {
    expect(r.redactString('key sk-0123456789abcdefghij hết hạn')).toContain(REDACTED)
  })

  it('che credential nhúng trong URL', () => {
    const output = r.redactString('https://user:matkhau@jira.internal/browse/PRJ-1')
    expect(output).not.toContain('matkhau')
    expect(output).toContain('jira.internal')
  })

  it('che chuỗi opaque dài trông như token', () => {
    expect(r.redactString('x'.repeat(50))).toBe(REDACTED)
  })

  it('KHÔNG che văn xuôi dài — tránh dương tính giả làm log vô dụng', () => {
    const prose = 'dayLaMotCauTiengVietKhongDauRatDaiNhungVanLaVanXuoiBinhThuong'
    expect(r.redactString(prose)).toBe(prose)
  })
})

describe('Redactor — biên', () => {
  const r = new Redactor()

  it('xử lý Error mà không lộ nội dung message', () => {
    r.registerSecret('PAT-trong-loi-0123456789')
    const output = r.redact(new Error('Gọi thất bại với PAT-trong-loi-0123456789')) as {
      message: string
    }
    expect(output.message).not.toContain('PAT-trong-loi')
  })

  it('không đệ quy vô hạn với object tự tham chiếu', () => {
    const cyclic: Record<string, unknown> = { name: 'a' }
    cyclic['self'] = cyclic
    expect(() => r.redact(cyclic)).not.toThrow()
  })

  it('cắt mảng rất dài', () => {
    const output = r.redact(Array.from({ length: 200 }, (_, i) => i)) as unknown[]
    expect(output).toHaveLength(51)
    expect(output[50]).toBe('[TRUNCATED]')
  })

  it('không dump nội dung Buffer', () => {
    expect(r.redact(Buffer.from('bí mật'))).toMatch(/^\[BUFFER:\d+B\]$/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Logger
// ═══════════════════════════════════════════════════════════════════════════

describe('Logger', () => {
  it('không có đường nào ghi ra sink mà bỏ qua redaction', () => {
    const sink = new MemorySink()
    const redactor = new Redactor()
    redactor.registerSecret('PAT-khong-duoc-lot-0123456789')
    const logger = new Logger({ sink, redactor, minLevel: 'debug' })

    logger.info('test', { note: 'dùng PAT-khong-duoc-lot-0123456789' })
    logger.error('loi', { apiKey: 'sk-0123456789abcdefgh' })
    logger.tool('tool', { toolName: 'jira.create_issue', phase: 'done', payload: { a: 1 } })

    const text = sink.asText()
    expect(text).not.toContain('PAT-khong-duoc-lot')
    expect(text).not.toContain('sk-0123456789')
  })

  it('giữ requestId và operationId ở top level để grep chéo (§15.2)', () => {
    const sink = new MemorySink()
    new Logger({ sink, minLevel: 'debug' }).info('x', {
      requestId: 'req_abc',
      operationId: 'op-1',
      other: 1,
    })
    expect(sink.records[0]?.requestId).toBe('req_abc')
    expect(sink.records[0]?.operationId).toBe('op-1')
  })

  it('phân loại đúng bốn loại log của §15.1', () => {
    const sink = new MemorySink()
    const logger = new Logger({ sink, minLevel: 'debug' })
    logger.info('a')
    logger.perf('b', { durationMs: 1 })
    logger.security(SECURITY_EVENTS.credentialSaved)
    logger.tool('c', { toolName: 't', phase: 'done' })

    expect(sink.records.map((r) => r.category)).toEqual([
      'application',
      'performance',
      'security',
      'tool',
    ])
  })

  it('sự kiện bảo mật luôn ở mức warn trở lên để không bị lọc mất', () => {
    const sink = new MemorySink()
    new Logger({ sink, minLevel: 'error' }).security(SECURITY_EVENTS.dbUnlockFailed, {}, 'error')
    expect(sink.records).toHaveLength(1)
  })

  it('lọc theo minLevel', () => {
    const sink = new MemorySink()
    const logger = new Logger({ sink, minLevel: 'warn' })
    logger.debug('bỏ')
    logger.info('bỏ')
    logger.warn('giữ')
    expect(sink.records).toHaveLength(1)
  })

  it('child logger kế thừa bindings', () => {
    const sink = new MemorySink()
    new Logger({ sink, minLevel: 'debug', bindings: { appVersion: '1.0.0' } })
      .child({ module: 'x' })
      .info('e')
    expect(sink.records[0]?.fields).toMatchObject({ appVersion: '1.0.0', module: 'x' })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// FileSink — §8.3 giới hạn dung lượng và tuổi
// ═══════════════════════════════════════════════════════════════════════════

describe('FileSink', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'nexa-log-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('ghi JSON-lines', () => {
    const sink = new FileSink({ dir })
    sink.write({ ts: '2026-08-01T00:00:00Z', level: 'info', category: 'application', event: 'e' })
    const lines = readFileSync(sink.path, 'utf8').trim().split('\n')
    expect(JSON.parse(lines[0]!)).toMatchObject({ event: 'e' })
  })

  it('xoay vòng khi vượt ngưỡng dung lượng', () => {
    const sink = new FileSink({ dir, maxBytes: 300, maxFiles: 3 })
    for (let i = 0; i < 40; i++) {
      sink.write({
        ts: '2026-08-01T00:00:00Z',
        level: 'info',
        category: 'application',
        event: `event-${String(i)}`,
      })
    }
    const files = readdirSync(dir).filter((f) => f.endsWith('.log'))
    expect(files.length).toBeGreaterThan(1)
    expect(files.length).toBeLessThanOrEqual(4)
  })

  it('dọn log quá hạn lúc khởi tạo', () => {
    const stale = join(dir, 'nexa.9.log')
    writeFileSync(stale, 'cũ')
    const longAgo = Date.now() / 1000 - 30 * 24 * 3600
    utimesSync(stale, longAgo, longAgo)

    new FileSink({ dir, retentionDays: 14 })
    expect(readdirSync(dir)).not.toContain('nexa.9.log')
  })

  it('tự tắt thay vì làm sập app khi không ghi được', () => {
    const sink = new FileSink({ dir: '/khong/the/tao/duoc/thu/muc/nay' })
    expect(sink.active).toBe(false)
    expect(() =>
      sink.write({ ts: 'x', level: 'info', category: 'application', event: 'e' }),
    ).not.toThrow()
  })
})

describe('MultiSink', () => {
  it('ghi ra mọi sink', () => {
    const a = new MemorySink()
    const b = new MemorySink()
    new MultiSink([a, b]).write({
      ts: 'x',
      level: 'info',
      category: 'application',
      event: 'e',
    })
    expect(a.records).toHaveLength(1)
    expect(b.records).toHaveLength(1)
  })
})

describe('request id', () => {
  it('sinh id có tiền tố nhận diện được', () => {
    const id = newRequestId()
    expect(isRequestId(id)).toBe(true)
    expect(id.startsWith('req_')).toBe(true)
  })

  it('operation id là UUID hợp lệ cho schema IPC', () => {
    expect(newOperationId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-/)
  })

  it('không trùng nhau', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newRequestId()))
    expect(ids.size).toBe(500)
  })
})

describe('Redactor — hồi quy từ sự cố thật', () => {
  const r = new Redactor()

  it('KHÔNG che đường dẫn file — log chẩn đoán phải đọc được', () => {
    // Lỗi đã gặp: pattern token dài có `/` trong lớp ký tự nên nuốt trọn cả đường dẫn,
    // biến thông báo "không tìm thấy binding" thành một dãy [REDACTED] vô nghĩa.
    const message =
      'Could not locate the bindings file. Tried: /home/meow/Project/Nexa/node_modules/better-sqlite3/build/better_sqlite3.node'
    const output = r.redactString(message)
    expect(output).toContain('better_sqlite3.node')
    expect(output).toContain('/home/meow/Project/Nexa/node_modules')
    expect(output).not.toContain(REDACTED)
  })

  it('vẫn che token dài không có dấu gạch chéo', () => {
    expect(r.redactString(`token=${'A1b2C3d4E5'.repeat(5)}`)).toContain(REDACTED)
  })
})
