## Why

Đợt làm lại giao diện (theme sáng/tối, phím tắt, toast, composer, màn Cài đặt) đã được code và có test đơn vị, nhưng chưa có change OpenSpec nào mô tả. Hành vi đang chỉ tồn tại trong code và comment. Change này ghi lại đúng những gì đã làm để có hợp đồng kiểm thử được, theo quy trình trong `CONTRIBUTING.md`.

Đây là spec **ghi nhận** (retroactive): không thêm hành vi mới ngoài những gì code đang làm.

## What Changes

- **Theme**: ba lựa chọn `system | light | dark`, lưu trong `AppSettings.theme`, cache ở `localStorage` để cửa sổ không nháy sai màu lúc mở, màu nền cửa sổ native khớp theme.
- **Phím tắt toàn cục**: `Ctrl/Cmd` + `N`, `K`, `,`, `1`–`4`. Không bắt phím khi đang gõ IME hoặc khi có dialog modal.
- **Phản hồi giao diện**: toast (lỗi không tự tắt, trùng nội dung thì thay thế, tối đa 4), lý do cụ thể khi nút Gửi bị khoá, ba khối trạng thái chuẩn (tải, trống, lỗi).
- **Cài đặt**: 12 mục gom thành 4 nhóm, điều hướng bàn phím theo thứ tự hiển thị, chấm trạng thái kết nối cho từng mục.
- Không có thay đổi phá vỡ (**BREAKING**) nào.

## Capabilities

### New Capabilities
- `app-theme`: lựa chọn và áp dụng theme, cache chống nháy, màu nền cửa sổ.
- `global-shortcuts`: bảng phím tắt toàn cục và điều kiện không được kích hoạt.
- `ui-feedback`: toast, lý do khoá nút Gửi, khối trạng thái tải/trống/lỗi.
- `settings-navigation`: nhóm mục Cài đặt, phím mũi tên, trạng thái kết nối.

### Modified Capabilities
<!-- Không có: chưa có spec gốc nào trong openspec/specs/. -->

## Impact

- Renderer: `theme.ts`, `use-theme.ts`, `components/ThemeSwitch.tsx`, `shortcuts-ui.ts`, `use-global-shortcuts.ts`, `components/toast-ui.ts`, `components/composer-ui.ts`, `components/StateBlocks.tsx`, `components/settings-groups-ui.ts`, `components/SettingsView.tsx`, `styles.css`.
- Main: `window.ts` (`windowBackgroundColor`), `index.ts` (truyền theme khi tạo cửa sổ).
- Shared types: `ui-constants.ts` (`THEME_CHOICES`), `settings.ts` (`theme`).
- Không thêm dependency, không đổi IPC channel.
