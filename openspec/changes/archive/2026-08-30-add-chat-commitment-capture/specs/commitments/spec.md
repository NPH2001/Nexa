## MODIFIED Requirements

### Requirement: Người dùng quản lý commitment bằng hành động rõ ràng

Hệ thống SHALL chỉ tạo hoặc thay đổi commitment sau một thao tác xác nhận tường minh của người
dùng. Đề xuất SHALL được phép bắt nguồn từ hội thoại, nhưng hệ thống SHALL NOT chuyển chat, memory
hay tool result thành commitment nếu người dùng chưa xác nhận. Hệ thống SHALL lưu nguồn tạo của
mỗi commitment để phân biệt thao tác tay của người dùng với đề xuất do agent khởi xướng.

#### Scenario: Tạo commitment
- **WHEN** người dùng nhập outcome hợp lệ và bấm lưu
- **THEN** hệ thống tạo commitment `active` thuộc profile hiện tại, đánh dấu nguồn tạo là người dùng và hiển thị nó trong Goals/Today

#### Scenario: Tạo commitment từ đề xuất trong chat
- **WHEN** agent đề xuất một commitment và người dùng bấm Xác nhận trên preview
- **THEN** hệ thống tạo commitment `active` với nguồn tạo là agent và gắn conversation nguồn

#### Scenario: Đề xuất chưa được xác nhận
- **WHEN** agent đề xuất một commitment và người dùng không xác nhận
- **THEN** không có commitment nào tồn tại sau lượt chat đó
