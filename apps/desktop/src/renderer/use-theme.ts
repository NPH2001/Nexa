import { useEffect } from 'react'
import type { ThemePreference } from '@nexa/shared-types/renderer'
import {
  applyResolvedTheme,
  resolveTheme,
  safeLocalStorage,
  systemPrefersDark,
  watchSystemTheme,
  writeCachedTheme,
} from './theme.js'

/**
 * Sơn theme theo cấu hình và giữ nó khớp với hệ điều hành khi người dùng chọn `system`.
 *
 * `preference === null` nghĩa là settings chưa về từ main: giữ nguyên thứ `bootstrapTheme` đã sơn
 * từ cache thay vì nhảy về mặc định rồi nhảy lại — người dùng sẽ thấy màn hình đổi màu hai lần.
 */
export function useTheme(preference: ThemePreference | null): void {
  useEffect(() => {
    if (preference === null) return
    const paint = (prefersDark: boolean): void =>
      applyResolvedTheme(document.documentElement, resolveTheme(preference, prefersDark))

    paint(systemPrefersDark())
    writeCachedTheme(safeLocalStorage(), preference)
    return preference === 'system' ? watchSystemTheme(paint) : undefined
  }, [preference])
}
