## ADDED Requirements

### Requirement: Nhóm mục Cài đặt
Màn Cài đặt SHALL gom 12 mục vào 4 nhóm: Kết nối AI (LiteLLM, OpenAI, Model), Công cụ làm việc (Jira, Confluence, Redmine, XWiki, MCP Gateway), Nexa nhớ & quyền riêng tư (Nexa nhớ, Dữ liệu & quyền riêng tư), Ứng dụng (Giao diện, Chẩn đoán). Mỗi mục SHALL thuộc đúng một nhóm.

#### Scenario: Tra nhóm của một mục
- **WHEN** hệ thống tra nhóm của mục `redmine`
- **THEN** kết quả là nhóm "Công cụ làm việc"

### Requirement: Điều hướng bằng phím mũi tên
Phím điều hướng SHALL đi theo thứ tự hiển thị phẳng của các nhóm. `Lên` hoặc `Trái` đi về mục trước, `Xuống` hoặc `Phải` đi tới mục sau, `Home` về mục đầu, `End` tới mục cuối. Hệ thống SHALL quay vòng ở hai đầu danh sách. Phím khác SHALL không đổi mục.

#### Scenario: Quay vòng ở cuối
- **WHEN** mục hiện tại là mục cuối và người dùng nhấn `Xuống`
- **THEN** mục đầu tiên được chọn

#### Scenario: Phím không liên quan
- **WHEN** người dùng nhấn `a`
- **THEN** không có mục nào được chọn

### Requirement: Trạng thái kết nối của từng mục
Mỗi mục là một loại kết nối SHALL hiện trạng thái: `Chưa cấu hình` khi chưa có kết nối hoặc chưa có credential, `Đã lưu, chưa kiểm tra` khi chưa chạy kiểm tra nào, `Đã kết nối` khi lần kiểm tra gần nhất thành công, `Kiểm tra gần nhất bị lỗi` khi thất bại. Mục không phải kết nối SHALL không có trạng thái.

#### Scenario: Đã lưu nhưng chưa kiểm tra
- **WHEN** kết nối có credential và `lastTest` chưa tồn tại
- **THEN** trạng thái là `untested`, không phải `ok`

#### Scenario: Mục không phải kết nối
- **WHEN** hệ thống tính trạng thái của mục `appearance`
- **THEN** kết quả là `null`
