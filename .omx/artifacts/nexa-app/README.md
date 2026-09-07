# Nexa — Giao diện đang triển khai trong ứng dụng

Các ảnh `nexa-chat-1513.png`, `nexa-chat-1280.png`, `nexa-chat-900.png`, `nexa-chat-760.png`, `nexa-chat-520.png` được chụp từ Electron thật, chạy bản build của mã nguồn hiện tại với dữ liệu kiểm thử cục bộ. Đây không phải ảnh SVG dựng độc lập.

## Thay đổi

- Theme sáng trên các CSS token đang có; nền xanh nhạt, panel trắng, hành động xanh.
- Sidebar với NexaMark/UiIcon tái sử dụng, tìm kiếm và mục hội thoại có trạng thái chọn.
- Tin nhắn hai phía, avatar Nexa, mốc ngày, nút sao chép, sửa và xoá.
- Ô nhập bo góc, đính kèm/gửi/dừng dùng luồng hiện có, giữ xử lý IME và cảnh báo dữ liệu.
- Header và layout thích ứng với cửa sổ nhỏ. Điều khiển cửa sổ do hệ điều hành quản lý.

## Chụp lại

```bash
pnpm build
NEXA_CAPTURE_VISUALS="$PWD/.omx/artifacts/nexa-app" pnpm exec playwright test tests/e2e/app.e2e.ts --grep 'giao diện sáng'
```

Electron cần display đang hoạt động. Test dùng profile tạm và mock ChatGPT; không dùng tài khoản thật hay thay đổi clipboard hệ điều hành.

## Giới hạn đối chiếu

Logo là bản vector dựng lại; font dự phòng phụ thuộc hệ điều hành. Tin nhắn trong ảnh test được sửa qua UI nên có nhãn “đã sửa”. Model, thời gian, số mục lịch sử và cảnh báo phản ánh dữ liệu thực tế của test. Không thêm nút phản hồi thích/không thích hoặc công cụ web giả khi ứng dụng chưa có chức năng đó.
