## ADDED Requirements

### Requirement: Kết nối XWiki trực tiếp qua MCP HTTP
Hệ thống SHALL cho phép cấu hình kết nối `xwiki` gồm URL endpoint MCP (bắt buộc HTTPS) và bearer
token lưu ở secure storage, không cần username. Transport SHALL áp dụng các biện pháp bù của
ADR-0008: không follow redirect và không log header hay body.

#### Scenario: Kiểm tra kết nối
- **WHEN** người dùng bấm "Kiểm tra kết nối" với token hợp lệ
- **THEN** hệ thống gọi `xwiki_list_wikis` và báo thành công

#### Scenario: Token sai
- **WHEN** endpoint trả HTTP 401
- **THEN** kết quả là `XWIKI_AUTH_FAILED`

#### Scenario: URL không phải HTTPS
- **WHEN** người dùng nhập `http://wiki.abbank.vn/...` trong bản đã đóng gói
- **THEN** kết nối bị từ chối ở bước validate URL

#### Scenario: Endpoint trả JSON không có session id
- **WHEN** XWiki trả `application/json` mà không có header `mcp-session-id`
- **THEN** client vẫn hoàn tất `initialize` và `tools/list` mà không gửi session id

### Requirement: Danh mục tool XWiki
Hệ thống SHALL công bố các tool đọc `list_wikis`, `get_schema`, `get_tree`, `get_links`,
`get_history`, `get_attachment`, `query_objects`, `query_documents`, `get_document` và `man` với
mức READ thuộc cờ `xwikiRead`; `write_document` và `edit_document` với mức WRITE_HIGH thuộc cờ
`xwikiWrite`. Tên Nexa SHALL có tiền tố `xwiki_`.

#### Scenario: Tắt xwikiWrite
- **WHEN** `xwikiWrite` tắt
- **THEN** model chỉ thấy tool đọc XWiki, và lời gọi `xwiki_write_document` trả `TOOL_NOT_ALLOWED`

### Requirement: Ghi tài liệu XWiki có kiểm tra phiên bản
Preview của `write_document`/`edit_document` SHALL đọc tài liệu hiện tại để hiện việc đang tạo mới
hay ghi đè, và các thay đổi dự kiến. Hệ thống SHALL gắn `base_version` của bản vừa đọc vào payload
được ràng buộc với approval.

#### Scenario: Ghi đè trang đã tồn tại
- **WHEN** model đề xuất `xwiki_write_document` cho một trang đã có
- **THEN** preview ghi rõ "ghi đè" kèm phiên bản hiện tại, và payload thực thi chứa `base_version`
  đúng phiên bản đó

#### Scenario: Trang bị sửa giữa preview và thực thi
- **WHEN** người khác lưu trang sau khi preview đã hiện, rồi người dùng mới xác nhận
- **THEN** XWiki từ chối vì lệch `base_version`, và Nexa báo xung đột phiên bản thay vì ghi đè

#### Scenario: Model cố bỏ base_version
- **WHEN** payload lúc thực thi khác payload đã duyệt (thiếu hoặc đổi `base_version`)
- **THEN** runtime trả `TOOL_PAYLOAD_MISMATCH`

### Requirement: Token XWiki được che trong log
Redactor SHALL che bearer token có định dạng `xwiki:XWiki.<user>/<n>/<secret>`.

#### Scenario: Chuỗi lỗi chứa header Authorization
- **WHEN** một chuỗi log chứa `Bearer xwiki:XWiki.tester/0/AbCdEf...`
- **THEN** sau khi qua redactor, phần token không còn xuất hiện
