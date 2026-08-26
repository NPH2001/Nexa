## ADDED Requirements

### Requirement: Mọi preset hẹp cung cấp một tool meta để yêu cầu danh mục đầy đủ
Hệ thống SHALL đưa một tool meta không tham số vào khối `tools` của mọi preset hẹp hơn toàn bộ danh mục. Hệ thống SHALL NOT đưa tool meta này vào khi khối `tools` đã chứa toàn bộ tool khả dụng.

#### Scenario: Preset hẹp có tool meta
- **WHEN** một lượt được xếp vào preset hẹp hơn toàn bộ danh mục
- **THEN** khối `tools` chứa tool meta mở rộng danh mục, không có tham số bắt buộc nào

#### Scenario: Preset đầy đủ không có tool meta
- **WHEN** một lượt được xếp vào preset chứa toàn bộ tool khả dụng
- **THEN** khối `tools` không chứa tool meta

#### Scenario: Cơ chế lọc bị tắt
- **WHEN** feature flag của cơ chế lọc bị tắt
- **THEN** khối `tools` không chứa tool meta

### Requirement: Lời gọi tool meta không bao giờ đi tới MCP server
Hệ thống SHALL xử lý lời gọi tool meta trong vòng lặp tool-calling, trước khi lời gọi đó tới lớp thực thi tool. Hệ thống SHALL NOT gửi bất kỳ yêu cầu nào tới MCP server cho lời gọi này, và SHALL NOT thêm một định nghĩa tool tương ứng vào danh mục tool.

#### Scenario: Không có lưu lượng tới MCP server
- **WHEN** model gọi tool meta
- **THEN** không có lời gọi `tools/call` nào được gửi tới MCP server cho lời gọi đó

#### Scenario: Tool meta không nằm trong danh mục
- **WHEN** tra cứu tên tool meta trong danh mục tool của hệ thống
- **THEN** không tìm thấy định nghĩa nào, và cổng kiểm tra quyền thực thi vẫn từ chối tên đó nếu được hỏi

### Requirement: Lời gọi tool meta không phải một thao tác lên hệ thống đích
Hệ thống SHALL NOT coi lời gọi tool meta là thao tác write: không sinh preview, không yêu cầu người dùng xác nhận, không tạo operation id, và không ghi vào nơi lưu lifecycle tool call.

#### Scenario: Không hiện hộp thoại xác nhận
- **WHEN** model gọi tool meta
- **THEN** không có yêu cầu xác nhận nào được đẩy lên UI

#### Scenario: Không tạo bản ghi thao tác
- **WHEN** model gọi tool meta
- **THEN** không có bản ghi tool call hay operation nào được tạo cho lời gọi đó

#### Scenario: Không tính vào hạn mức một tool write mỗi lượt
- **WHEN** model gọi tool meta rồi sau đó gọi một tool write trong cùng lượt
- **THEN** tool write đó vẫn được phép chạy (sau xác nhận), vì lời gọi meta không chiếm hạn mức write của lượt

### Requirement: Sau khi mở rộng, các vòng còn lại của lượt dùng danh mục đầy đủ
Hệ thống SHALL, ngay sau khi xử lý lời gọi tool meta, gửi toàn bộ tool khả dụng trong khối `tools` của mọi vòng còn lại thuộc lượt đó.

#### Scenario: Vòng kế tiếp nhận danh mục đầy đủ
- **WHEN** model gọi tool meta ở vòng đầu của một lượt
- **THEN** request của vòng tiếp theo trong cùng lượt chứa toàn bộ tool khả dụng

#### Scenario: Model gọi được tool vừa xuất hiện
- **WHEN** sau khi mở rộng, model gọi một tool không thuộc preset ban đầu nhưng đang khả dụng
- **THEN** tool đó được thực thi theo đúng luồng thường lệ, gồm preview và xác nhận nếu là tool write

### Requirement: Kết quả trả về cho model là danh mục tool khả dụng
Hệ thống SHALL trả về, như tool result của lời gọi meta, danh sách tên và mô tả ngắn của các tool đang khả dụng. Hệ thống SHALL NOT liệt kê tool bị feature flag tắt hoặc tool mà MCP server không công bố.

#### Scenario: Danh mục phản ánh đúng tool khả dụng
- **WHEN** model gọi tool meta trong lúc một số feature flag đang tắt
- **THEN** tool result không chứa tên của bất kỳ tool bị tắt nào

#### Scenario: MCP chưa sẵn sàng
- **WHEN** model gọi tool meta trong lúc MCP server chưa sẵn sàng
- **THEN** hệ thống trả về một tool result nói rõ hiện không có tool nào khả dụng, và lượt vẫn tiếp tục mà không lỗi

### Requirement: Mở rộng chỉ có hiệu lực trong một lượt
Hệ thống SHALL đặt lại việc chọn preset ở mỗi lượt mới. Việc đã mở rộng ở một lượt SHALL NOT làm lượt sau bỏ qua bộ chọn preset.

#### Scenario: Lượt sau quay về preset theo câu hỏi mới
- **WHEN** một lượt đã mở rộng lên danh mục đầy đủ, rồi người dùng gửi một câu hỏi mới chỉ chứa dấu hiệu Jira và không có ý định write
- **THEN** khối `tools` của lượt mới chỉ chứa các tool read của Jira, cộng tool meta

### Requirement: Gọi lặp lại tool meta không gây lỗi
Hệ thống SHALL xử lý lời gọi tool meta một cách idempotent trong phạm vi một lượt: lời gọi thứ hai và các lời gọi sau đó SHALL trả về kết quả bình thường mà không ném lỗi và không làm dừng lượt.

#### Scenario: Gọi hai lần trong cùng lượt
- **WHEN** model gọi tool meta hai lần trong cùng một lượt
- **THEN** cả hai lời gọi đều nhận tool result, và lượt tiếp tục bình thường

#### Scenario: Mở rộng không làm mất hạn mức vòng lặp một cách bất thường
- **WHEN** model gọi tool meta
- **THEN** lời gọi đó được tính như một vòng tool-calling bình thường theo hạn mức số vòng tối đa hiện có, không được miễn trừ
