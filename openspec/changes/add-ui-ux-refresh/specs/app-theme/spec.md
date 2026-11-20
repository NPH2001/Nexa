## ADDED Requirements

### Requirement: Lựa chọn theme
Hệ thống SHALL cho người dùng chọn một trong ba theme: `system`, `light`, `dark`. Giá trị mặc định SHALL là `system`. Lựa chọn SHALL được lưu trong `AppSettings.theme`.

#### Scenario: Chọn theme cố định
- **WHEN** người dùng chọn `dark`
- **THEN** giao diện được sơn theme tối bất kể cài đặt của hệ điều hành

#### Scenario: Theo hệ thống
- **WHEN** lựa chọn là `system` và hệ điều hành đổi sang chế độ sáng
- **THEN** giao diện chuyển sang theme sáng mà không cần tải lại

#### Scenario: Giá trị không hợp lệ
- **WHEN** giá trị đọc từ cache không thuộc `system | light | dark`
- **THEN** hệ thống bỏ qua giá trị đó và dùng mặc định `system`

### Requirement: Không nháy sai màu lúc mở
Hệ thống SHALL sơn theme đã cache trước khi React render. Cache SHALL chỉ chứa đúng một trong ba giá trị theme. Khi `localStorage` không truy cập được thì hệ thống SHALL tiếp tục chạy với mặc định, không báo lỗi.

#### Scenario: Có cache
- **WHEN** app mở lại và cache là `dark`
- **THEN** `<html>` mang theme tối trước khi render đầu tiên

#### Scenario: Storage bị chặn
- **WHEN** truy cập `localStorage` ném lỗi
- **THEN** hệ thống dùng `system` và không hiện lỗi cho người dùng

### Requirement: Màu nền cửa sổ khớp theme
Hệ thống SHALL đặt màu nền cửa sổ native theo theme đã lưu khi tạo cửa sổ, để không có khung sai màu trước khi renderer vẽ.

#### Scenario: Cửa sổ mở ở chế độ tối
- **WHEN** theme đã lưu là `dark`
- **THEN** `windowBackgroundColor` trả về màu nền tối
