## ADDED Requirements

### Requirement: Thời gian sống của toast
Toast lỗi SHALL NOT tự tắt. Toast cảnh báo SHALL tự tắt sau 12 giây. Các toast khác SHALL tự tắt sau 6 giây.

#### Scenario: Toast lỗi
- **WHEN** một toast lỗi hiện ra
- **THEN** nó vẫn còn cho tới khi người dùng đóng

#### Scenario: Toast xác nhận
- **WHEN** một toast thông tin hiện ra
- **THEN** nó tự tắt sau 6 giây

### Requirement: Giới hạn và loại trùng toast
Hệ thống SHALL hiện tối đa 4 toast cùng lúc. Toast trùng loại, tiêu đề và chi tiết với toast đang hiện SHALL thay thế toast cũ và đứng cuối danh sách. Khi vượt giới hạn, hệ thống SHALL bỏ toast cũ nhất không phải lỗi trước; chỉ khi toàn bộ là lỗi mới bỏ toast lỗi cũ nhất.

#### Scenario: Lưu hai lần liên tiếp
- **WHEN** hai toast "Đã lưu" giống hệt nhau được thêm liên tiếp
- **THEN** chỉ còn một toast

#### Scenario: Vượt giới hạn
- **WHEN** có 4 toast gồm 1 lỗi và 3 thông tin, rồi thêm một toast mới
- **THEN** toast thông tin cũ nhất bị bỏ, toast lỗi được giữ

### Requirement: Lý do khi nút Gửi bị khoá
Hệ thống SHALL trả về một câu giải thích cụ thể bất cứ khi nào nút Gửi bị khoá, theo thứ tự ưu tiên: đang xử lý, chưa chọn model, tài liệu bị chính sách chặn, ảnh không được model hỗ trợ, nội dung trống. Khi gửi được, hệ thống SHALL không trả lý do nào.

#### Scenario: Đang xử lý câu trước
- **WHEN** hệ thống đang xử lý và nội dung trống
- **THEN** lý do trả về là lý do "đang xử lý", không phải "nội dung trống"

#### Scenario: Gửi được
- **WHEN** đã chọn model, không bị chặn và nội dung không rỗng
- **THEN** không có lý do khoá nào

### Requirement: Ba trạng thái chuẩn của khối dữ liệu
Mỗi khối dữ liệu SHALL có trạng thái đang tải, trống và lỗi dùng chung một thành phần giao diện. Khối đang tải SHALL có nhãn đọc được bởi trình đọc màn hình.

#### Scenario: Đang tải
- **WHEN** khối dữ liệu đang tải
- **THEN** hiện skeleton có `role="status"` và nhãn ẩn cho trình đọc màn hình
