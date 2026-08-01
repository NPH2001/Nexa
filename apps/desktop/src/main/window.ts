import { BrowserWindow, session, shell } from 'electron'
import { matchesAllowlist } from '@nexa/security'
import type { Logger } from '@nexa/observability'

/**
 * §5.3 — nguyên tắc IPC/renderer:
 *   - tắt nodeIntegration, bật contextIsolation, bật sandbox
 *   - chỉ expose hàm IPC cụ thể qua preload
 *   - giới hạn danh sách domain được phép gọi từ desktop
 *
 * Ngoài ra §11.3 liệt kê "Renderer bị XSS và đọc token" là mối đe doạ riêng, nên CSP ở đây
 * cấm hẳn `connect-src` ra ngoài: renderer KHÔNG được tự gọi mạng. Mọi lời gọi ra ngoài đi
 * qua main process, nơi có API key.
 */

export interface WindowOptions {
  readonly preloadPath: string
  readonly rendererUrl?: string
  readonly rendererFile?: string
  readonly logger: Logger
  readonly allowedDomains: readonly string[]
  readonly isDevelopment: boolean
}

const CSP_PRODUCTION = [
  "default-src 'none'",
  "script-src 'self'",
  // Vite nhúng style inline cho component; không thể bỏ 'unsafe-inline' mà không đổi cách build.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  // Renderer không được mở kết nối nào. Không XHR, không WebSocket, không fetch.
  "connect-src 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'",
].join('; ')

/** Dev server của Vite cần websocket cho HMR và eval cho react-refresh. */
const CSP_DEVELOPMENT = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self' ws://localhost:* http://localhost:*",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ')

export function createMainWindow(opts: WindowOptions): BrowserWindow {
  applySessionHardening(opts)

  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 940,
    minHeight: 600,
    show: false,
    backgroundColor: '#0f1115',
    title: 'Nexa',
    webPreferences: {
      preload: opts.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webviewTag: false,
      // §11.3 chống XSS: tắt mọi cửa hậu chạy mã trong renderer.
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      spellcheck: false,
    },
  })

  // Hiện cửa sổ khi đã render xong để tránh nháy trắng — cũng là một phần của
  // mục tiêu "startup < 5 giây" cảm nhận được (§12.1).
  window.once('ready-to-show', () => window.show())

  // Không cho renderer tự điều hướng đi đâu khác: một trang bị chèn mã có thể thử
  // chuyển hướng để lấy context.
  window.webContents.on('will-navigate', (event, url) => {
    const allowed = opts.rendererUrl !== undefined && url.startsWith(opts.rendererUrl)
    if (!allowed) {
      event.preventDefault()
      opts.logger.warn('navigation-blocked', { scheme: safeScheme(url) })
    }
  })

  // Link ngoài mở bằng trình duyệt hệ thống, và chỉ khi thuộc allowlist (§11.2).
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrlAllowed(url, opts.allowedDomains)) {
      void shell.openExternal(url)
    } else {
      opts.logger.warn('external-open-blocked', { scheme: safeScheme(url) })
    }
    return { action: 'deny' }
  })

  if (opts.rendererUrl !== undefined) {
    void window.loadURL(opts.rendererUrl)
  } else if (opts.rendererFile !== undefined) {
    void window.loadFile(opts.rendererFile)
  }

  return window
}

function applySessionHardening(opts: WindowOptions): void {
  const defaultSession = session.defaultSession

  defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [opts.isDevelopment ? CSP_DEVELOPMENT : CSP_PRODUCTION],
        'X-Content-Type-Options': ['nosniff'],
      },
    })
  })

  // Nexa không cần bất kỳ quyền web nào: không camera, mic, thông báo, vị trí, clipboard đọc.
  defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    opts.logger.warn('web-permission-denied', { permission })
    callback(false)
  })
  defaultSession.setPermissionCheckHandler(() => false)

  // Chặn mọi request đi thẳng từ renderer ra ngoài. CSP đã cấm, đây là lớp thứ hai —
  // CSP có thể bị vô hiệu bởi một lỗi cấu hình, còn cái này thì không.
  defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url
    const isLocal =
      url.startsWith('file://') ||
      url.startsWith('devtools://') ||
      url.startsWith('blob:') ||
      url.startsWith('data:') ||
      (opts.isDevelopment && url.startsWith('http://localhost'))

    if (!isLocal) {
      opts.logger.warn('renderer-network-request-blocked', { scheme: safeScheme(url) })
    }
    callback({ cancel: !isLocal })
  })
}

export function isExternalUrlAllowed(url: string, allowedDomains: readonly string[]): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false
  if (parsed.username !== '' || parsed.password !== '') return false
  if (allowedDomains.length === 0) return true
  return matchesAllowlist(parsed.hostname, allowedDomains)
}

/** Chỉ lấy scheme để log — URL đầy đủ có thể chứa token trong query. */
function safeScheme(url: string): string {
  const colon = url.indexOf(':')
  return colon > 0 ? url.slice(0, colon) : 'unknown'
}
