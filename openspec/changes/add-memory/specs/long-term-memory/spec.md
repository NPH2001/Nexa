## ADDED Requirements

### Requirement: Người dùng lưu fact bằng hành động xác nhận rõ ràng
Hệ thống SHALL chỉ tạo một memory fact mới khi người dùng thực hiện một hành động xác nhận rõ ràng (ví dụ: nhập nội dung và bấm "Lưu" trong UI). Hệ thống SHALL NOT tự động tạo, suy luận, hoặc lưu một fact vào cơ sở dữ liệu mà không có hành động xác nhận này.

#### Scenario: Người dùng thêm fact mới qua UI
- **WHEN** người dùng nhập nội dung fact và xác nhận lưu
- **THEN** hệ thống tạo một memory fact mới với `status = active`, gắn với `profile_id` hiện tại, và hiển thị ngay trong danh sách fact

#### Scenario: Agent không tự lưu fact ngầm
- **WHEN** người dùng nhắc đến một thông tin cá nhân trong một lượt hội thoại (ví dụ "tôi dùng TypeScript")
- **THEN** hệ thống SHALL NOT tự động tạo một memory fact từ nội dung đó mà không có hành động xác nhận riêng của người dùng

### Requirement: Quản lý fact (xem, sửa, archive, xoá)
Hệ thống SHALL cho phép người dùng xem toàn bộ fact đang active của profile hiện tại, sửa nội dung một fact, archive (ẩn khỏi context nhưng giữ dữ liệu), và xoá cứng (loại bỏ hoàn toàn).

#### Scenario: Xem danh sách fact
- **WHEN** người dùng mở màn hình quản lý memory
- **THEN** hệ thống hiển thị toàn bộ fact có `status = active` của profile hiện tại

#### Scenario: Sửa nội dung fact
- **WHEN** người dùng sửa nội dung của một fact đã lưu và xác nhận
- **THEN** hệ thống cập nhật `content` và `updated_at` của fact đó, giữ nguyên `id`

#### Scenario: Archive một fact
- **WHEN** người dùng chọn archive một fact
- **THEN** hệ thống đặt `status = archived` cho fact đó và loại nó khỏi context của các hội thoại mới, nhưng không xoá dữ liệu

#### Scenario: Xoá cứng một fact
- **WHEN** người dùng chọn xoá một fact
- **THEN** hệ thống xoá vĩnh viễn row tương ứng khỏi bảng memory facts

### Requirement: Mọi fact active được nạp vào context của hội thoại mới
Hệ thống SHALL nạp toàn bộ memory fact có `status = active` của profile hiện tại vào context trước khi gửi yêu cầu tới model, cho mọi hội thoại (mới hoặc đang tiếp diễn).

#### Scenario: Bắt đầu hội thoại mới với fact đã lưu
- **WHEN** người dùng đã lưu ít nhất một fact active và bắt đầu một hội thoại mới
- **THEN** nội dung của toàn bộ fact active được đưa vào context gửi tới model, ngay sau system prompt

#### Scenario: Không có fact nào
- **WHEN** profile hiện tại không có fact active nào
- **THEN** hệ thống xây context như bình thường, không thêm đoạn memory fact nào, và không đổi hành vi hiện có

### Requirement: Fact được ưu tiên giữ trong budget context, không bị cắt bởi sliding window
Hệ thống SHALL giữ toàn bộ memory fact active trong context (trong giới hạn trần đã định nghĩa) với độ ưu tiên cao hơn history hội thoại; nếu cần cắt bớt do vượt token budget, hệ thống SHALL cắt history hội thoại trước khi cắt memory fact.

#### Scenario: Hội thoại dài vượt token budget
- **WHEN** một hội thoại có history dài vượt token budget của model VÀ có fact active đã lưu
- **THEN** hệ thống ưu tiên giữ toàn bộ fact active trong context và cắt bớt message cũ trong history trước

### Requirement: Giới hạn số lượng/kích thước fact được nạp vào context
Hệ thống SHALL áp một trần (số lượng fact và/hoặc tổng token) cho tập fact được nạp vào context; khi vượt trần, hệ thống SHALL giữ các fact có `updated_at` gần nhất và loại các fact cũ hơn khỏi context.

#### Scenario: Số fact vượt trần cho phép
- **WHEN** tổng số fact active hoặc tổng token của chúng vượt trần đã định nghĩa
- **THEN** hệ thống chỉ nạp vào context các fact có `updated_at` gần nhất trong giới hạn trần, các fact còn lại vẫn được lưu trong cơ sở dữ liệu nhưng không xuất hiện trong context

### Requirement: Fact bị mã hoá tại chỗ và không bị log dạng plaintext
Hệ thống SHALL mã hoá nội dung của mỗi memory fact bằng cơ chế mã hoá field-level hiện có trước khi lưu vào cơ sở dữ liệu, sử dụng một context string mã hoá riêng, cố định, không tái sử dụng cho cột khác. Hệ thống SHALL NOT ghi nội dung fact dạng plaintext vào log.

#### Scenario: Lưu fact vào cơ sở dữ liệu
- **WHEN** một fact mới được tạo hoặc sửa
- **THEN** nội dung được mã hoá trước khi lưu, và bản rõ (plaintext) không xuất hiện trong bất kỳ log nào của hệ thống

### Requirement: Fact bị xoá khi purge toàn bộ dữ liệu, không bị xoá tự động theo tuổi hội thoại
Khi người dùng thực hiện xoá toàn bộ dữ liệu của profile, hệ thống SHALL xoá toàn bộ memory fact của profile đó. Hệ thống SHALL NOT tự động xoá memory fact theo chính sách giữ lại lịch sử hội thoại (retention theo tuổi), vì fact được thiết kế để tồn tại lâu dài, độc lập với vòng đời của từng hội thoại.

#### Scenario: Người dùng xoá toàn bộ dữ liệu
- **WHEN** người dùng xác nhận xoá toàn bộ dữ liệu của profile
- **THEN** toàn bộ memory fact của profile đó bị xoá cùng với các dữ liệu khác

#### Scenario: Retention theo tuổi hội thoại chạy tự động
- **WHEN** tiến trình dọn dẹp dữ liệu định kỳ theo `historyRetentionDays` chạy
- **THEN** memory fact SHALL NOT bị xoá bởi tiến trình này, kể cả khi hội thoại nguồn (`source_conversation_id`) của fact đã bị xoá

### Requirement: Xoá hội thoại nguồn không làm mất fact liên quan
Nếu một fact được gắn với một hội thoại nguồn (`source_conversation_id`) và hội thoại đó bị xoá, hệ thống SHALL giữ lại fact, chỉ gỡ liên kết tới hội thoại đã xoá.

#### Scenario: Hội thoại nguồn của một fact bị xoá
- **WHEN** một hội thoại có liên kết với một hoặc nhiều memory fact bị xoá
- **THEN** các fact đó vẫn còn trong cơ sở dữ liệu và tiếp tục được nạp vào context như bình thường, chỉ có `source_conversation_id` được gỡ liên kết
