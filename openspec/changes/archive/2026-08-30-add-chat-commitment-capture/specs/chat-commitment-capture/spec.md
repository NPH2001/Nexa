## ADDED Requirements

### Requirement: Agent chỉ đề xuất commitment, không tự ghi

Hệ thống SHALL cung cấp cho agent hai tool cục bộ `commitment_create` và `commitment_update` với
risk level `WRITE_LOW`. Hệ thống SHALL bắt buộc mọi lời gọi hai tool này đi qua Confirmation Guard
với preview, approval dùng một lần và payload hash như tool write ngoài. Hệ thống SHALL NOT ghi
commitment khi người dùng chưa xác nhận, kể cả khi model khẳng định người dùng đã đồng ý trong văn
bản hội thoại.

#### Scenario: Model đề xuất tạo cam kết

- **WHEN** người dùng nói trong chat rằng sẽ hoàn thành một việc trước một mốc thời gian và model gọi `commitment_create`
- **THEN** UI hiển thị preview của cam kết sắp tạo và không có record nào được ghi trước khi người dùng bấm Xác nhận

#### Scenario: Người dùng huỷ đề xuất

- **WHEN** người dùng bấm Huỷ trên preview commitment
- **THEN** không có commitment nào được tạo hoặc sửa và model nhận tool result nói rõ người dùng đã huỷ

#### Scenario: Payload đổi sau khi preview

- **WHEN** payload thực thi khác payload đã hiển thị trong preview
- **THEN** guard từ chối và không có mutation nào xảy ra

### Requirement: Tool commitment khả dụng độc lập với Atlassian

Hệ thống SHALL công bố tool commitment cho model ngay cả khi MCP Atlassian chưa cấu hình hoặc chưa
sẵn sàng. Hệ thống SHALL không định tuyến hai tool này qua MCP client.

#### Scenario: Chưa kết nối Jira/Confluence

- **WHEN** người dùng chat trong khi chưa cấu hình Atlassian và tính năng đã bật
- **THEN** khối tool gửi tới model vẫn chứa `commitment_create` và `commitment_update`

#### Scenario: Preset tool thu hẹp theo ngữ cảnh

- **WHEN** bộ chọn preset thu hẹp danh mục tool cho một câu hỏi
- **THEN** tool commitment vẫn nằm trong khối tool và không cần gọi tool mở rộng danh mục

### Requirement: Tính năng là opt-in theo profile

Hệ thống SHALL mặc định tắt `agentCommitmentToolsEnabled` cho mỗi profile và SHALL NOT công bố tool
commitment khi setting chưa bật.

#### Scenario: Profile chưa bật

- **WHEN** người dùng chưa bật cho agent quản lý cam kết
- **THEN** khối tool không chứa tool commitment và model không thể đề xuất ghi cam kết

### Requirement: Preview commitment mô tả đúng thao tác cục bộ

Hệ thống SHALL dựng preview với hệ thống đích là dữ liệu cục bộ trên máy người dùng, hành động bằng
tiếng Việt, outcome, next action, status, mốc due/check-in đã chuẩn hoá sang giờ máy, và với thao
tác cập nhật thì hiển thị giá trị trước và sau đọc từ record thật.

#### Scenario: Preview tạo mới

- **WHEN** model gọi `commitment_create` với outcome và hạn hoàn thành
- **THEN** preview hiện đích là dữ liệu cục bộ, outcome, hạn theo giờ máy và ghi rõ thao tác có thể hoàn tác

#### Scenario: Preview cập nhật

- **WHEN** model gọi `commitment_update` để đổi next action của một commitment đang có
- **THEN** preview hiện next action cũ và mới lấy từ record hiện tại trong DB

#### Scenario: Commitment không thuộc profile

- **WHEN** model gọi `commitment_update` với id không thuộc profile hiện tại
- **THEN** hệ thống từ chối trước khi dựng preview và trả lỗi lại cho model

### Requirement: Mốc thời gian tương đối được chuẩn hoá trong main process

Hệ thống SHALL chấp nhận mốc thời gian dạng ISO hoặc dạng mô tả tương đối tiếng Việt và SHALL
chuẩn hoá sang ISO trong main process theo giờ hệ thống. Hệ thống SHALL từ chối lời gọi khi không
chuẩn hoá được thay vì đoán một mốc thời gian.

#### Scenario: Mô tả tương đối hợp lệ

- **WHEN** model truyền hạn là "thứ 6 tuần sau"
- **THEN** preview hiển thị ngày giờ tuyệt đối tương ứng theo giờ máy

#### Scenario: Mô tả không hiểu được

- **WHEN** model truyền một chuỗi thời gian không phân giải được
- **THEN** hệ thống trả lỗi cho model kèm hướng dẫn hỏi lại người dùng và không mở confirmation

### Requirement: Phạm vi ghi của agent bị giới hạn

Hệ thống SHALL chỉ cho phép agent tạo commitment mới và cập nhật outcome, next action, due,
check-in cùng status trong tập `active`, `blocked`, `paused`. Hệ thống SHALL NOT cung cấp tool xoá
commitment và SHALL NOT cho phép agent chuyển commitment sang `completed`.

#### Scenario: Agent thử hoàn thành cam kết

- **WHEN** model gọi `commitment_update` với status `completed`
- **THEN** hệ thống từ chối lời gọi và trả lỗi giải thích rằng chỉ người dùng mới hoàn thành cam kết

#### Scenario: Không có tool xoá

- **WHEN** model duyệt danh mục tool khả dụng
- **THEN** không có tool nào cho phép xoá commitment

### Requirement: Mutation từ agent được ghi nhận có nguồn gốc

Hệ thống SHALL lưu nguồn tạo của commitment là người dùng hay agent và SHALL ghi activity
`commitment_mutation` với actor tương ứng. Hệ thống SHALL NOT lưu plaintext outcome hoặc next
action trong activity row.

#### Scenario: Tạo qua chat

- **WHEN** người dùng xác nhận một đề xuất commitment từ chat
- **THEN** commitment lưu nguồn tạo là agent, gắn conversation nguồn, và timeline Hoạt động hiện một mutation với actor agent

#### Scenario: Tạo tay trong Mục tiêu

- **WHEN** người dùng tạo commitment trong màn hình Mục tiêu
- **THEN** commitment lưu nguồn tạo là người dùng
