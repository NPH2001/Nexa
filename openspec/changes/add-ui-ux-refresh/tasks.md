## 1. Theme

- [x] 1.1 `theme.ts`: `parseThemePreference`, `resolveTheme`, cache an toàn, `bootstrapTheme` (test: `theme.test.ts`)
- [x] 1.2 `THEME_CHOICES` và `AppSettings.theme` mặc định `system` trong `shared-types`
- [x] 1.3 `windowBackgroundColor` trong `window.ts` và truyền theme từ `index.ts`
- [x] 1.4 Test `windowBackgroundColor` theo từng preference (test: `apps/desktop/src/main/window.test.ts`, kèm khớp `--bg` trong `styles.css`)
- [x] 1.5 Test hook `use-theme` nếu có nhánh riêng ngoài `theme.ts` — đã xét, không viết test riêng: nhánh riêng chỉ là chờ settings (`null`) và đăng ký theo dõi hệ thống khi chọn `system`; test hook cần thêm môi trường DOM (dependency mới). Đường sơn + lưu + mở lại được E2E 4.2 phủ.

## 2. Phím tắt

- [x] 2.1 `shortcuts-ui.ts`: `matchShortcut`, `SHORTCUT_HINTS` (test: `shortcuts-ui.test.ts`)
- [x] 2.2 `use-global-shortcuts.ts` nối vào `App.tsx`
- [x] 2.3 E2E: `Ctrl+K` focus tìm kiếm, `Ctrl+N` tạo hội thoại, phím tắt không chạy khi dialog mở

## 3. Phản hồi giao diện

- [x] 3.1 `toast-ui.ts`: thời gian sống, loại trùng, giới hạn 4 (test: `toast-ui.test.ts`)
- [x] 3.2 `composer-ui.ts`: `sendBlockedReason` (test: `composer-ui.test.ts`)
- [x] 3.3 `StateBlocks.tsx` được dùng ở các màn Hôm nay, Mục tiêu, Hoạt động, Nghiệp vụ, Cài đặt, Ghi nhớ

## 4. Cài đặt

- [x] 4.1 `settings-groups-ui.ts`: nhóm, `nextSettingsTab`, `connectionStatusOf` (test: `settings-groups-ui.test.ts`)
- [x] 4.2 E2E: điều hướng bàn phím trong Cài đặt; đổi theme ở mục Giao diện còn giữ sau khi mở lại app

## 5. Đối soát

- [x] 5.1 Quyết định về `copy.ts` (giữ làm lint giọng văn hay xoá) và cập nhật design.md — xoá cả file và test
- [x] 5.2 Chạy `pnpm verify` và `pnpm test:e2e` (2026-11-19: 101 file / 1408 test; E2E 39/39)
