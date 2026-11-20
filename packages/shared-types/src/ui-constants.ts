/** Các lựa chọn retention dùng chung giữa schema cấu hình và renderer. 0 = không tự xoá. */
export const RETENTION_CHOICES = [30, 90, 180, 0] as const

/**
 * Màu giao diện. `system` đi theo cài đặt sáng/tối của hệ điều hành.
 *
 * Hằng số này nằm ở đây chứ không ở `settings.ts` vì renderer cần nó lúc chạy để dựng bộ chọn,
 * và `settings.ts` import zod — `renderer.ts` chỉ tái xuất được các module không kéo zod vào
 * bundle của tiến trình không tin cậy.
 */
export const THEME_CHOICES = ['system', 'light', 'dark'] as const
export type ThemePreference = (typeof THEME_CHOICES)[number]
