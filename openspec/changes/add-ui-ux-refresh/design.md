## Context

Các module UI đã được viết theo mẫu "luật thuần tách khỏi React" để test không cần DOM: `theme.ts`, `shortcuts-ui.ts`, `toast-ui.ts`, `composer-ui.ts`, `settings-groups-ui.ts`. Component và hook chỉ nối luật đó vào React. DESIGN.md là nguồn sự thật về giọng văn, trạng thái và a11y.

## Goals / Non-Goals

**Goals:**
- Ghi lại hành vi đang có để mỗi scenario là một test case.
- Giữ cấu trúc "luật thuần + glue mỏng" để thay đổi sau này có test.

**Non-Goals:**
- Không thiết kế lại giao diện, không thêm theme hoặc phím tắt mới.
- Không chuẩn hoá toàn bộ định dạng ngày giờ trong app.
- Không giữ từ điển thuật ngữ dạng code: `copy.ts` và `tests/renderer-copy.test.ts` đã bị xoá (Y-2, 2026-11-19) vì không có code production nào dùng. Thuật ngữ nằm ở DESIGN.md "Content voice".

## Decisions

- **Theme có hai nơi lưu, một nguồn sự thật.** `AppSettings.theme` (SQLite mã hoá) là nguồn sự thật; `localStorage` chỉ là cache để sơn đúng màu trước khi React render và trước khi IPC về. Cache mất hoặc bị chặn thì chỉ nháy sáng một nhịp, không phải lỗi. Phương án "chỉ SQLite" bị loại vì cửa sổ luôn nháy sáng khi mở ở chế độ tối.
- **Phím tắt chỉ dùng tổ hợp `Ctrl/Cmd`.** Người dùng gõ tiếng Việt bằng Telex/VNI; phím đơn bị bắt toàn cục sẽ nuốt chữ. Khi `isComposing` hoặc có modal thì không kích hoạt.
- **Lỗi không tự tắt.** Toast lỗi mang mã yêu cầu cần chép lại khi báo lỗi; tự tắt sau vài giây coi như chưa báo (DESIGN.md "Error").
- **Điều kiện khoá nút Gửi và câu giải thích đi cùng một hàm** (`sendBlockedReason`), để không có điều kiện nào khoá nút mà thiếu lý do.
- **Cài đặt gom nhóm thay vì 12 tab ngang hàng**, giữ danh sách phẳng `SETTINGS_TAB_ORDER` cho phím mũi tên đi đúng thứ tự nhìn thấy.
- **"Đã lưu, chưa kiểm tra" là trạng thái riêng** (`untested`): lưu cấu hình không gọi server nên không được coi là "đã kết nối".

## Risks / Trade-offs

- [Hook và component glue (`use-theme`, `use-global-shortcuts`, `ThemeSwitch`, `StateBlocks`) chưa có test riêng] → logic nằm ở module thuần đã có test; thêm test glue chỉ khi glue có nhánh riêng.
- [Phím tắt `Ctrl+K`, `Ctrl+N` có thể trùng phím mặc định của Chromium/Electron] → đã bắt ở cấp cửa sổ; kiểm bằng E2E (task 2.3).
- [Ba lựa chọn theme lặp ở `THEME_CHOICES`, `THEME_LABELS`, `THEME_ICONS`] → chấp nhận: nhãn và icon là dữ liệu hiển thị, `THEME_CHOICES` là hợp đồng dữ liệu.

## Open Questions

- Không còn. (`copy.ts`: đã quyết định xoá, xem Non-Goals.)
