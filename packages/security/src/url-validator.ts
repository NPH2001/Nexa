import { ERROR_CODES, NexaError } from '@nexa/shared-types'

/**
 * §11.2: "Chỉ cho phép HTTPS; validate certificate/hostname và chặn URL có credential nhúng
 * hoặc scheme không an toàn."
 *
 * Đây là biện pháp giảm thiểu chính cho rủi ro §22.1 "Người dùng nhập URL giả/malicious →
 * SSRF hoặc gửi PAT sai đích". Mọi baseUrl đi vào hệ thống phải qua đây.
 */

export interface UrlPolicy {
  /**
   * Allowlist domain của tổ chức. Rỗng = không giới hạn.
   * Xem docs/OPEN-QUESTIONS.md D2 — tôi đề nghị ATTT bắt buộc điền.
   * Hỗ trợ wildcard một cấp con: `*.corp.local` khớp `jira.corp.local`, không khớp `corp.local`.
   */
  readonly allowedDomains?: readonly string[]
  /**
   * Cho phép http:// tới loopback. CHỈ dùng trong integration test với mock server.
   * Bản phát hành phải để false.
   */
  readonly allowInsecureLoopback?: boolean
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

/**
 * Trả về URL đã chuẩn hoá (bỏ dấu `/` thừa ở cuối, hạ hostname về chữ thường)
 * hoặc ném NexaError.
 */
export function validateBaseUrl(input: string, policy: UrlPolicy = {}): string {
  const raw = input.trim()
  if (raw.length === 0) {
    throw new NexaError(ERROR_CODES.INVALID_URL, { safeDetail: 'empty url' })
  }

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new NexaError(ERROR_CODES.INVALID_URL, { safeDetail: 'not a parseable url' })
  }

  // Credential nhúng: https://user:pass@host — chặn trước mọi thứ khác, và KHÔNG đưa URL
  // vào safeDetail vì chính nó chứa secret.
  if (url.username !== '' || url.password !== '') {
    throw new NexaError(ERROR_CODES.INVALID_URL, { safeDetail: 'url embeds credentials' })
  }

  const isLoopback = LOOPBACK_HOSTS.has(url.hostname.toLowerCase())
  const loopbackHttpAllowed = policy.allowInsecureLoopback === true && isLoopback

  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopbackHttpAllowed)) {
    throw new NexaError(ERROR_CODES.INVALID_URL, {
      safeDetail: `scheme "${url.protocol}" not allowed; https required`,
    })
  }

  if (url.hostname === '') {
    throw new NexaError(ERROR_CODES.INVALID_URL, { safeDetail: 'missing hostname' })
  }
  // `new URL` chấp nhận nhiều thứ lạ; siết thêm để không nhận hostname chứa ký tự điều khiển
  // hoặc dạng `http://evil.com#@good.com` sau khi parse.
  if (!/^[a-z0-9.\-[\]:]+$/i.test(url.hostname)) {
    throw new NexaError(ERROR_CODES.INVALID_URL, { safeDetail: 'hostname has invalid characters' })
  }

  if (url.search !== '' || url.hash !== '') {
    throw new NexaError(ERROR_CODES.INVALID_URL, {
      safeDetail: 'base url must not contain query or fragment',
    })
  }

  const allowed = policy.allowedDomains ?? []
  if (allowed.length > 0 && !isLoopback && !matchesAllowlist(url.hostname, allowed)) {
    throw new NexaError(ERROR_CODES.DOMAIN_NOT_ALLOWED, {
      safeDetail: `host "${url.hostname}" not in organisation allowlist`,
    })
  }

  const path = url.pathname.replace(/\/+$/, '')
  return `${url.protocol}//${url.host}${path}`
}

export function matchesAllowlist(hostname: string, allowed: readonly string[]): boolean {
  const host = hostname.toLowerCase()
  return allowed.some((patternRaw) => {
    const pattern = patternRaw.trim().toLowerCase()
    if (pattern === '') return false
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1) // ".corp.local"
      return host.endsWith(suffix) && host.length > suffix.length
    }
    return host === pattern
  })
}

/**
 * Ghép an toàn baseUrl với một path cố định của mình.
 *
 * Không dùng `new URL(path, base)` trực tiếp cho path do bên ngoài cung cấp: nếu path là URL
 * tuyệt đối thì nó thay luôn origin, và request kèm Bearer token sẽ bay sang host khác.
 */
export function joinUrl(baseUrl: string, path: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) {
    throw new NexaError(ERROR_CODES.INVALID_URL, {
      safeDetail: 'absolute url passed where a relative path was expected',
    })
  }
  const base = baseUrl.replace(/\/+$/, '')
  const rel = path.replace(/^\/+/, '')
  return `${base}/${rel}`
}

/**
 * Kiểm tra một URL trả về từ hệ thống đích (ví dụ link issue Jira) trước khi hiển thị hoặc mở.
 * Trả null nếu không an toàn — nơi gọi tự quyết định ẩn link đi.
 */
export function sanitizeExternalUrl(value: unknown, expectedBaseUrl: string): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null
  try {
    const url = new URL(value)
    const base = new URL(expectedBaseUrl)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    if (url.username !== '' || url.password !== '') return null
    // Chỉ nhận link cùng host với hệ thống đã cấu hình — chặn MCP server trả link lừa đảo.
    if (url.host !== base.host) return null
    return url.toString()
  } catch {
    return null
  }
}
