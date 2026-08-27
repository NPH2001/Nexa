## ADDED Requirements

### Requirement: Người dùng quản lý commitment bằng hành động rõ ràng

Hệ thống SHALL chỉ tạo hoặc thay đổi commitment sau một thao tác xác nhận của người dùng và SHALL
NOT tự động chuyển chat hoặc memory thành commitment.

#### Scenario: Tạo commitment
- **WHEN** người dùng nhập outcome hợp lệ và bấm lưu
- **THEN** hệ thống tạo commitment `active` thuộc profile hiện tại và hiển thị nó trong Goals/Today

### Requirement: Commitment có vòng đời và bước tiếp theo

Hệ thống SHALL lưu outcome, next action tuỳ chọn, status, due/check-in tuỳ chọn và source conversation
tuỳ chọn. Hệ thống SHALL cho phép chuyển qua `active`, `blocked`, `paused`, `completed` và mở lại
commitment đã hoàn thành.

#### Scenario: Hoàn thành rồi mở lại
- **WHEN** người dùng hoàn thành một commitment rồi chuyển nó về active
- **THEN** record giữ nguyên id, cập nhật status và xoá completed timestamp

### Requirement: Today ưu tiên commitment cần chú ý

Hệ thống SHALL hiển thị active/blocked commitments trên Today và ưu tiên timestamp check-in/due đã
quá hạn trước commitment không có mốc thời gian.

#### Scenario: Check-in đã quá hạn
- **WHEN** một commitment có `check_in_at` trước thời điểm hiện tại
- **THEN** Today hiển thị commitment đó trong nhóm cần chú ý với lý do thời gian rõ ràng

### Requirement: Dữ liệu commitment được mã hoá và phân tách profile

Hệ thống SHALL mã hoá title/next action trước khi lưu, bind IPC vào profile hiện tại và xoá toàn bộ
commitment khi purge profile.

#### Scenario: Renderer gửi id không thuộc profile hiện tại
- **WHEN** renderer yêu cầu update/delete commitment của profile khác
- **THEN** main process từ chối trước mutation
