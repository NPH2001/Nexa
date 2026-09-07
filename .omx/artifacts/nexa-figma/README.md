# Nexa — Bản dựng theo ảnh

- `nexa-chat.svg`: màn hình desktop 1513 × 1040, vector và text.
- `nexa-foundations.svg`: bảng màu, chữ, khoảng cách và mẫu thành phần.
- `preview.html`: bản xem trước hai bảng.
- `nexa-chat.png`, `nexa-foundations.png`: bản render đã kiểm tra.
- `tokens.json`: thông số thiết kế theo ảnh, giá trị màu ước lượng bằng mắt.

Figma: https://www.figma.com/design/OeeWZAlMe9WmI951OtStxl

## Trạng thái Figma

Đã tạo ba trang (Màn hình, Nền tảng, Thành phần), 56 biến và một effect style. Chưa tạo màn hình, text styles, component hoặc variants trong Figma: tài khoản Starter đã hết lượt MCP trong phiên. Bản SVG dự phòng chưa được nhập vào file Figma và không tương đương thư viện component native.

## Kiểm tra

Hai SVG parse XML thành công, ID duy nhất. Playwright Chromium render thành công; 98 nhãn nằm trong biên canvas. Kiểm tra trực quan đã sửa chữ tràn ở hai tin nhắn và khoảng cách giữa tác giả với thời gian.

## Giới hạn

Font ưu tiên Segoe UI; ảnh xem trước dùng font dự phòng của Linux. Logo và icon được dựng lại theo ảnh, không phải tài sản gốc. Chưa kiểm tra quá trình import SVG vào Figma do giới hạn MCP. Không thay đổi mã nguồn ứng dụng.
