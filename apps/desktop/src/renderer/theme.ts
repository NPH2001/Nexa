import { THEME_CHOICES, type ThemePreference } from '@nexa/shared-types/renderer'

/** Màu thật sự được sơn. `system` đã được phân giải xong ở bước này. */
type ResolvedTheme = 'light' | 'dark'

const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system'

export const THEME_LABELS: Record<ThemePreference, string> = {
  system: 'Theo hệ thống',
  light: 'Sáng',
  dark: 'Tối',
}

/**
 * Cache lựa chọn theme trong localStorage.
 *
 * Nguồn sự thật vẫn là `AppSettings` trong SQLite đã mã hoá, nhưng nó chỉ về tới renderer sau
 * một vòng IPC async. Không có cache thì mỗi lần mở app đều loé sáng một nhịp rồi mới chuyển
 * sang tối. Ở đây chỉ lưu đúng một chuỗi trong ba giá trị của `THEME_CHOICES` — không có gì
 * nhạy cảm, và cache mất thì cùng lắm là nháy sáng lại một nhịp.
 */
const CACHE_KEY = 'nexa.theme.v1'

export function parseThemePreference(raw: unknown): ThemePreference | null {
  if (typeof raw !== 'string') return null
  return (THEME_CHOICES as readonly string[]).includes(raw) ? (raw as ThemePreference) : null
}

export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference !== 'system') return preference
  return systemPrefersDark ? 'dark' : 'light'
}

/** Sơn lựa chọn lên `<html>`; toàn bộ token màu trong `styles.css` treo vào `data-theme`. */
export function applyResolvedTheme(root: HTMLElement, resolved: ResolvedTheme): void {
  root.dataset.theme = resolved
}

export function readCachedTheme(storage: Pick<Storage, 'getItem'> | null): ThemePreference | null {
  try {
    return parseThemePreference(storage?.getItem(CACHE_KEY) ?? null)
  } catch {
    // Storage bị chặn bởi chính sách hoặc profile hỏng — coi như chưa có cache.
    return null
  }
}

export function writeCachedTheme(
  storage: Pick<Storage, 'setItem'> | null,
  preference: ThemePreference,
): void {
  try {
    storage?.setItem(CACHE_KEY, preference)
  } catch {
    // Không ghi được cache chỉ khiến lần mở sau nháy sáng một nhịp; không phải lỗi để báo.
  }
}

/** Truy cập `window.localStorage` có thể tự ném lỗi, nên không đọc trực tiếp ở nơi khác. */
export function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function darkMediaQuery(): MediaQueryList | null {
  return typeof window === 'undefined' || typeof window.matchMedia !== 'function'
    ? null
    : window.matchMedia('(prefers-color-scheme: dark)')
}

export function systemPrefersDark(): boolean {
  return darkMediaQuery()?.matches === true
}

/** Theo dõi cài đặt sáng/tối của hệ điều hành; chỉ cần khi người dùng chọn `system`. */
export function watchSystemTheme(onChange: (prefersDark: boolean) => void): () => void {
  const query = darkMediaQuery()
  if (query === null) return () => undefined
  const listener = (event: MediaQueryListEvent): void => onChange(event.matches)
  query.addEventListener('change', listener)
  return () => query.removeEventListener('change', listener)
}

/** Chạy trước khi React render: sơn theme đã cache để cửa sổ không mở ra sai màu. */
export function bootstrapTheme(): void {
  const preference = readCachedTheme(safeLocalStorage()) ?? DEFAULT_THEME_PREFERENCE
  applyResolvedTheme(document.documentElement, resolveTheme(preference, systemPrefersDark()))
}
