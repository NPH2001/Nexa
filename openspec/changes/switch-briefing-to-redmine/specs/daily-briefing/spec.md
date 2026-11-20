## MODIFIED Requirements

### Requirement: Khối Redmine là read-only và có trần rõ ràng

Hệ thống SHALL lấy issue bằng tool Redmine READ đã có trong registry (`redmine_search_issues`), với bộ lọc do code dựng từ danh tính người dùng hiện tại: issue được giao cho `me`, chỉ trạng thái mở, sắp theo hạn tăng dần. Hệ thống SHALL NOT nhận bộ lọc từ model hay từ renderer, SHALL giới hạn số issue trả về, và SHALL NOT gọi bất kỳ tool ghi nào trong luồng bản tin. Hệ thống SHALL NOT lấy issue từ Jira cho bản tin.

#### Scenario: Renderer gửi bộ lọc tuỳ ý
- **WHEN** renderer gọi IPC bản tin kèm một chuỗi truy vấn hay tham số lọc
- **THEN** main process bỏ qua chúng và dùng truy vấn đã dựng sẵn

#### Scenario: Issue đã đóng
- **WHEN** một issue được giao cho người dùng đã ở trạng thái đóng
- **THEN** issue đó không xuất hiện trên bản tin

#### Scenario: Vượt trần số issue
- **WHEN** Redmine báo `total_count` lớn hơn số issue trong trang trả về
- **THEN** hệ thống chỉ giữ số mục trong trang và nêu rõ còn issue chưa hiển thị

#### Scenario: Jira không còn là nguồn
- **WHEN** người dùng có kết nối Jira đang hoạt động và mở Today
- **THEN** bản tin không gọi `jira_search` và không có mục nào mang nguồn Jira

#### Scenario: Mã tham chiếu và liên kết
- **WHEN** một issue Redmine có id 123 và kết nối Redmine có địa chỉ gốc
- **THEN** mục hiện mã `#123` và liên kết tới `<địa chỉ gốc>/issues/123`

#### Scenario: Thứ tự trong nhóm đang làm
- **WHEN** hai issue cùng nằm nhóm `in_progress`, một có hạn và một không
- **THEN** issue có hạn đứng trước, và không có tín hiệu sprint nào ảnh hưởng thứ tự

### Requirement: Thiếu một nguồn không làm hỏng bản tin

Hệ thống SHALL dựng bản tin từng nguồn độc lập. Khi Redmine chưa kết nối (thiếu kết nối `redmine` hoặc MCP Gateway), cờ `redmineRead` đang tắt, API key bị từ chối, hoặc lời gọi tool lỗi/timeout, hệ thống SHALL vẫn trả về phần commitment và SHALL đánh dấu nguồn Redmine là không lấy được kèm lý do và một hành động khôi phục. Hệ thống SHALL NOT trình bày một nguồn lỗi như là "không có việc nào".

#### Scenario: Redmine chưa kết nối
- **WHEN** người dùng mở Today mà Redmine chưa cấu hình
- **THEN** bản tin hiện phần commitment bình thường và nói rõ chưa kết nối Redmine nên chưa có việc từ Redmine

#### Scenario: Cờ redmineRead tắt
- **WHEN** cờ `redmineRead` bị tắt bởi chính sách
- **THEN** nguồn Redmine ở trạng thái bị chính sách tắt và phần commitment không bị ảnh hưởng

#### Scenario: Lời gọi Redmine timeout
- **WHEN** tool Redmine vượt `toolTimeoutMs`
- **THEN** khối Redmine ở trạng thái lỗi có nút thử lại, và phần commitment không bị ảnh hưởng

#### Scenario: Payload không đọc được
- **WHEN** Redmine trả về nội dung không phải JSON hoặc không có danh sách issue
- **THEN** nguồn Redmine ở trạng thái lỗi, không phải "trống"

### Requirement: Bản tin nói rõ nó không biết lịch họp

Bản tin SHALL nêu rõ phạm vi của nó gồm cam kết và Redmine, và chưa gồm lịch họp.

#### Scenario: Chú thích phạm vi
- **WHEN** bản tin hiển thị
- **THEN** nó nêu rõ phạm vi gồm cam kết và Redmine, và chưa gồm lịch họp
