## ADDED Requirements

### Requirement: Commitment đang hoạt động được nạp vào context

Hệ thống SHALL nạp commitment `active` và `blocked` của profile hiện tại vào context model dưới
dạng một khối system tách riêng khỏi khối memory. Khối này SHALL chứa outcome, next action, status
và mốc due/check-in, và SHALL nói rõ đây là dữ kiện tham chiếu chứ không phải chỉ dẫn hệ thống.

#### Scenario: Có cam kết đang treo

- **WHEN** người dùng gửi một tin nhắn trong khi profile có commitment active
- **THEN** context gửi tới model chứa khối cam kết riêng, đứng tách với khối thông tin đã xác nhận

#### Scenario: Không có cam kết phù hợp

- **WHEN** profile không có commitment `active` hoặc `blocked`
- **THEN** không có khối cam kết nào được thêm vào context

#### Scenario: Cam kết đã hoàn thành hoặc tạm dừng

- **WHEN** một commitment ở trạng thái `completed` hoặc `paused`
- **THEN** commitment đó không xuất hiện trong context

### Requirement: Khối cam kết có ngân sách riêng và thứ tự ưu tiên xác định

Hệ thống SHALL giới hạn số commitment và số token của khối cam kết bằng một ngân sách riêng, độc
lập với ngân sách memory. Hệ thống SHALL ưu tiên commitment có mốc due/check-in gần nhất hoặc đã
quá hạn, và SHALL NOT làm khối cam kết đẩy tài liệu đính kèm hoặc lượt hội thoại hiện tại ra khỏi
context.

#### Scenario: Vượt trần số lượng

- **WHEN** profile có nhiều commitment hơn trần cho phép
- **THEN** context chỉ chứa các commitment ưu tiên cao nhất và số bị bỏ được ghi vào log

#### Scenario: Ngân sách cạn

- **WHEN** ngân sách token còn lại không đủ cho khối cam kết
- **THEN** khối cam kết bị lược bớt hoặc bỏ hẳn trước khi lược tin nhắn của lượt hiện tại

### Requirement: Nội dung cam kết tuân thủ chính sách provider

Hệ thống SHALL áp dụng cùng nguyên tắc chia sẻ như memory khi model chạy trên provider ngoài và
SHALL cho phép người dùng tắt riêng việc nạp commitment vào context mà không tắt commitment engine.

#### Scenario: Provider ngoài

- **WHEN** người dùng chọn model chạy trên provider ngoài và chưa cho phép chia sẻ nội dung cam kết
- **THEN** khối cam kết không được gửi và model trả lời không dựa trên nội dung cam kết

#### Scenario: Tắt nạp context

- **WHEN** người dùng tắt việc nạp cam kết vào context
- **THEN** commitment vẫn hiển thị trong Mục tiêu và Today nhưng không xuất hiện trong bất kỳ request nào tới model

### Requirement: Commitment trong context không được coi là mệnh lệnh

Hệ thống SHALL trình bày khối cam kết như dữ kiện hỗ trợ và SHALL giữ nguyên tắc phát biểu mới của
người dùng trong hội thoại hiện tại được ưu tiên khi mâu thuẫn với nội dung cam kết.

#### Scenario: Cam kết mâu thuẫn với yêu cầu hiện tại

- **WHEN** người dùng yêu cầu một việc trái với next action đang lưu
- **THEN** model làm theo yêu cầu hiện tại và chỉ nhắc tới cam kết như một ghi chú, không tự đổi cam kết
