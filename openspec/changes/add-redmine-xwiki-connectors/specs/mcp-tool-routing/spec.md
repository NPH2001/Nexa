## ADDED Requirements

### Requirement: Nhiều MCP server cùng tồn tại qua một router
Hệ thống SHALL định tuyến mỗi lời gọi tool tới đúng MCP server sở hữu tool đó, dựa trên tên tool
Nexa. Router SHALL được dùng ở mọi chỗ `AgentRuntime` hiện đang dùng một `AtlassianMcpManager`.

#### Scenario: Gọi tool Redmine khi đã có cả Atlassian và Redmine
- **WHEN** model gọi `redmine_get_issue` trong khi cả Atlassian và Redmine đều sẵn sàng
- **THEN** lời gọi đi tới server Redmine, và server Atlassian không nhận request nào

#### Scenario: Tên tool trùng giữa hai registry
- **WHEN** hai registry khai báo cùng một tên tool Nexa
- **THEN** router ném lỗi lập trình khi dựng, và không source nào được khởi chạy với danh mục mơ hồ

### Requirement: Lỗi của một server được cô lập
Một MCP server lỗi, thiếu cấu hình hoặc đang khởi động lại SHALL NOT làm các server khác ngừng
phục vụ.

#### Scenario: Redmine không khởi chạy được
- **WHEN** server Redmine trả lỗi xác thực lúc khởi chạy, trong khi Jira đang sẵn sàng
- **THEN** tool Jira vẫn gọi được, còn tool Redmine trả `REDMINE_AUTH_FAILED` kèm tên hệ thống
  Redmine

#### Scenario: Không server nào sẵn sàng
- **WHEN** không có source nào ở trạng thái ready
- **THEN** router báo `isReady = false`, và danh mục tool gửi model không chứa tool MCP nào

### Requirement: Preview ghi hiện đúng hệ thống đích
`ToolPreview.targetSystem` SHALL nhận các giá trị `jira`, `confluence`, `redmine`, `xwiki` và
`local`. `targetSystemUrl` SHALL lấy từ chính source sở hữu tool, không dựa vào nhánh
`jira`/`confluence` viết cứng.

#### Scenario: Xác nhận ghi trang XWiki
- **WHEN** model đề xuất `xwiki_edit_document`
- **THEN** hộp thoại xác nhận ghi hệ thống đích "XWiki" kèm host `wiki.abbank.vn`

### Requirement: Preset tool bao phủ cờ mới
Danh sách preset đóng SHALL có thêm `redmine-read`, `redmine-full`, `xwiki-read` và `xwiki-full`.
Preset `all-read` và `all` SHALL chứa các cờ tương ứng.

#### Scenario: Cờ tool không thuộc preset nào
- **WHEN** registry dùng một cờ tool không có trong preset `all`
- **THEN** test bao phủ preset thất bại

#### Scenario: Câu hỏi chỉ nhắc tới Redmine
- **WHEN** người dùng hỏi "liệt kê issue Redmine đang giao cho tôi"
- **THEN** selector chọn preset `redmine-read`
