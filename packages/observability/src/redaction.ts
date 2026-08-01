/**
 * Redaction — §11.1 "Redact log: token, prompt, content file, dữ liệu Jira/Confluence"
 * và §15.1 (bảng "Không được ghi").
 *
 * Ba lớp bảo vệ, cố ý chồng lên nhau vì mỗi lớp đều có thể bị qua mặt:
 *   1. Denylist theo TÊN TRƯỜNG   — bắt `{ apiKey: '...' }`
 *   2. Registry giá trị bí mật     — bắt secret bị nhét vào chuỗi tự do
 *   3. Pattern nhận dạng           — bắt secret chưa kịp đăng ký (Bearer, JWT, URL có credential)
 */

export const REDACTED = '[REDACTED]'
const REDACTED_CONTENT = '[CONTENT_REDACTED]'

/**
 * Tên trường bị cấm ghi giá trị. So khớp không phân biệt hoa/thường và bỏ qua `_`/`-`,
 * nên `api_key`, `apiKey`, `API-KEY` đều dính.
 */
const SECRET_FIELD_NAMES = new Set([
  'apikey',
  'api',
  'key',
  'secret',
  'token',
  'accesstoken',
  'refreshtoken',
  'personaltoken',
  'personalaccesstoken',
  'pat',
  'password',
  'passwd',
  'pwd',
  'authorization',
  'auth',
  'credential',
  'credentials',
  'cookie',
  'setcookie',
  'sessionid',
  'privatekey',
  'masterkey',
  'litellmapikey',
  'jirapat',
  'confluencepat',
])

/**
 * Trường chứa nội dung nghiệp vụ/người dùng. Không phải secret, nhưng §15.1 cấm ghi:
 * prompt, response đầy đủ, nội dung file, payload nghiệp vụ đầy đủ.
 */
const CONTENT_FIELD_NAMES = new Set([
  'content',
  'contents',
  'text',
  'body',
  'prompt',
  'prompts',
  'message',
  'messages',
  'delta',
  'completion',
  'choices',
  'extractedtext',
  'payload',
  'arguments',
  'rawarguments',
  'input',
  'output',
  'result',
  'description',
  'summary',
  'title',
  'comment',
  'fields',
  'query',
])

function normalizeKey(key: string): string {
  return key.replace(/[_\-\s]/g, '').toLowerCase()
}

/** URL có credential nhúng: https://user:pass@host (§11.2 chặn hẳn dạng này). */
const URL_CREDENTIAL_RE = /\b([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/gi
/** `Authorization: Bearer xxx` hoặc `Bearer xxx` trong text tự do. */
const BEARER_RE = /\b(bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi
/** JWT ba đoạn base64url. */
const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g
/** Key kiểu OpenAI/LiteLLM. */
const SK_KEY_RE = /\bsk-[A-Za-z0-9_-]{16,}\b/g
/** Atlassian PAT (Server/DC) thường là chuỗi base64-ish rất dài, không có khoảng trắng. */
const LONG_OPAQUE_RE = /\b[A-Za-z0-9+/=_-]{40,}\b/g

/** Độ dài tối thiểu để một secret đã đăng ký được thay thế trong chuỗi tự do. */
const MIN_REGISTERED_SECRET_LEN = 6

export class Redactor {
  /** Sắp xếp giảm dần theo độ dài để secret dài được thay trước, tránh thay từng phần. */
  private secrets: string[] = []

  /**
   * Đăng ký một giá trị bí mật đang sống trong bộ nhớ.
   * Gọi ngay sau khi giải mã credential, TRƯỚC khi dùng nó (§6 "Không lưu/không gửi secret").
   */
  registerSecret(value: string | null | undefined): void {
    if (typeof value !== 'string') return
    const v = value.trim()
    if (v.length < MIN_REGISTERED_SECRET_LEN) return
    if (this.secrets.includes(v)) return
    this.secrets.push(v)
    this.secrets.sort((a, b) => b.length - a.length)
  }

  unregisterSecret(value: string | null | undefined): void {
    if (typeof value !== 'string') return
    this.secrets = this.secrets.filter((s) => s !== value.trim())
  }

  clearSecrets(): void {
    this.secrets = []
  }

  /** Số secret đang theo dõi — dùng cho test, không log ra. */
  get registeredCount(): number {
    return this.secrets.length
  }

  redactString(input: string): string {
    let out = input
    for (const secret of this.secrets) {
      if (secret.length === 0) continue
      out = out.split(secret).join(REDACTED)
    }
    out = out.replace(URL_CREDENTIAL_RE, `$1${REDACTED}@`)
    out = out.replace(BEARER_RE, `$1${REDACTED}`)
    out = out.replace(JWT_RE, REDACTED)
    out = out.replace(SK_KEY_RE, REDACTED)
    out = out.replace(LONG_OPAQUE_RE, (m) => (looksLikeProse(m) ? m : REDACTED))
    return out
  }

  /**
   * Làm sạch một cấu trúc bất kỳ trước khi ghi log.
   * Trả về giá trị MỚI — không sửa input.
   */
  redact(value: unknown, depth = 0): unknown {
    if (depth > 8) return '[DEPTH_LIMIT]'
    if (value === null || value === undefined) return value

    switch (typeof value) {
      case 'string':
        return this.redactString(value)
      case 'number':
      case 'boolean':
      case 'bigint':
        return value
      case 'function':
      case 'symbol':
        return '[UNSERIALIZABLE]'
      default:
        break
    }

    if (value instanceof Error) {
      // Message của lỗi upstream hay echo lại URL/payload → phải đi qua redactString.
      return { name: value.name, message: this.redactString(value.message) }
    }
    if (value instanceof Date) return value.toISOString()
    if (Buffer.isBuffer(value)) return `[BUFFER:${value.byteLength}B]`
    if (Array.isArray(value)) {
      if (value.length > 50) {
        return [...value.slice(0, 50).map((v) => this.redact(v, depth + 1)), '[TRUNCATED]']
      }
      return value.map((v) => this.redact(v, depth + 1))
    }

    const out: Record<string, unknown> = {}
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      const nk = normalizeKey(key)
      if (SECRET_FIELD_NAMES.has(nk)) {
        out[key] = REDACTED
      } else if (CONTENT_FIELD_NAMES.has(nk)) {
        out[key] = typeof raw === 'string' ? `${REDACTED_CONTENT}:${raw.length}` : REDACTED_CONTENT
      } else {
        out[key] = this.redact(raw, depth + 1)
      }
    }
    return out
  }
}

/**
 * Chuỗi dài toàn chữ cái + có nguyên âm rải đều thì nhiều khả năng là văn xuôi (ví dụ một câu
 * tiếng Anh không dấu cách bị nối), không phải token. Tránh redact nhầm nội dung vô hại.
 */
function looksLikeProse(s: string): boolean {
  if (/[+/=_-]/.test(s)) return false
  const vowels = (s.match(/[aeiouAEIOU]/g) ?? []).length
  return vowels / s.length > 0.25
}

/** Redactor dùng chung cho cả tiến trình. */
export const globalRedactor = new Redactor()
