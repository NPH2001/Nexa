## ADDED Requirements

### Requirement: Kết nối Redmine qua gateway MCP
Hệ thống SHALL cho phép cấu hình kết nối `redmine` gồm URL web Redmine và API key, lưu ở secure
storage. Hệ thống SHALL gọi Redmine qua URL và bearer token của kết nối `mcpGateway`, kèm header
`x-mcp-servers: redmine` và `x-mcp-redmine-x-redmine-api-key`.

#### Scenario: Bật Redmine khi chưa có gateway
- **WHEN** người dùng bật kết nối `redmine` trong khi `mcpGateway` chưa bật hoặc chưa có credential
- **THEN** Redmine không khởi chạy, và Settings hiện lỗi `REDMINE_GATEWAY_REQUIRED` kèm lối tới mục
  MCP Gateway

#### Scenario: Kiểm tra kết nối thành công
- **WHEN** người dùng bấm "Kiểm tra kết nối" với API key hợp lệ
- **THEN** hệ thống gọi `redmine_get_current_user` và hiện login của tài khoản đang hành động

#### Scenario: API key sai
- **WHEN** gateway trả lỗi xác thực cho API key Redmine
- **THEN** kết quả kiểm tra là `REDMINE_AUTH_FAILED`, không phải `MCP_GATEWAY_AUTH_FAILED`

### Requirement: Chỉ gọi tool Redmine có định nghĩa Nexa
Hệ thống SHALL chỉ gọi những tool Redmine có định nghĩa viết tay. Các tool `delete_*`,
`remove_watcher`, membership, tạo/sửa project, CRUD version/category, upload/update/download
attachment và `upsert_wiki_page` SHALL NOT có trong danh mục.

#### Scenario: Model gọi tool xoá
- **WHEN** model đề xuất `redmine_delete_issue`
- **THEN** runtime trả `TOOL_NOT_ALLOWED`, và không request nào được gửi tới gateway

#### Scenario: Tham số uploads bị loại
- **WHEN** model gọi `redmine_create_issue` có kèm `uploads`
- **THEN** validate input thất bại, hoặc trường đó bị loại trước khi gửi; payload tới server không
  chứa `uploads`

#### Scenario: Tool READ khớp annotation server
- **WHEN** test đối chiếu registry với `mcp-redmine-tools.json`
- **THEN** mọi tool Nexa xếp READ đều có `readOnlyHint: true` phía server, và mọi tham số Nexa khai
  báo đều tồn tại trong `inputSchema` của server

### Requirement: Ghi Redmine phải qua preview và xác nhận
`create_issue`, `add_issue_comment`, `log_time`, `create_issue_relation` và `add_watcher` SHALL là
WRITE_LOW thuộc cờ `redmineWrite`; `update_issue` SHALL là WRITE_HIGH thuộc cờ `redmineUpdate`.
Mọi lời gọi ghi SHALL qua Confirmation Guard.

#### Scenario: Cập nhật issue hiện diff
- **WHEN** model đề xuất `redmine_update_issue` đổi `status_id` của issue #123
- **THEN** preview hiện trạng thái hiện tại và trạng thái mới, và chỉ thực thi sau khi người dùng
  xác nhận trong thời hạn approval

#### Scenario: Tắt cờ redmineUpdate
- **WHEN** `redmineUpdate` tắt
- **THEN** `redmine_update_issue` không có trong khối `tools`, còn `redmine_create_issue` vẫn có
  nếu `redmineWrite` bật

#### Scenario: Tạo issue rơi vào uncertain
- **WHEN** `redmine_create_issue` timeout sau khi request đã gửi
- **THEN** hệ thống tra `search_issues` (`author_id=me`, khớp tiêu đề, tạo sau thời điểm bắt đầu)
  và báo issue tìm được, hoặc báo "chưa chắc chắn" nếu không kết luận được

### Requirement: Credential Redmine không lọt ra ngoài
API key Redmine và bearer token gateway SHALL NOT xuất hiện trong log, audit, lỗi trả cho renderer
hay fixture test.

#### Scenario: Log lỗi gateway
- **WHEN** gọi tool Redmine thất bại và lỗi được ghi log
- **THEN** log không chứa giá trị của header `x-mcp-redmine-x-redmine-api-key` hay `authorization`
