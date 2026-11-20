## Context

Hiện trạng:
- `AgentRuntime` nhận đúng một `mcp: AtlassianMcpManager | null`, nối ở các chỗ
  [agent-runtime.ts:101](../../../packages/agent-runtime/src/agent-runtime.ts#L101),
  `executeToolCall`, `buildPreview` và `listTools`. Preview chọn `targetSystemUrl` theo hai nhánh
  `jira`/`confluence`.
- `ToolDefinition.targetSystem` là `'jira' | 'confluence'`, còn `ToolPreview.targetSystem` có thêm
  `'local'`.
- Có hai transport: `McpHttpClient` (HTTPS, không redirect, header dựng lại cho mỗi request;
  ADR-0008) và stdio. `McpHttpClient` xử lý được cả phản hồi `application/json` không có
  `mcp-session-id` (kiểu XWiki) lẫn SSE có session (kiểu LiteLLM). Cả hai kiểu đã được xác nhận
  bằng probe 2026-11-17.
- `resolveServerToolName` đã khớp được tiền tố do gateway thêm (`redmine-get_issue` ↔
  `get_issue`).
- Preset tool là danh sách đóng (ADR 0009), có test khẳng định preset `all` phủ trọn mọi cờ tool.

Ràng buộc: §11.3 không tin schema từ server; §10.2 mọi thao tác ghi phải qua preview và xác nhận
có thời hạn; §8.2 credential chỉ nằm trong secure storage; ADR-0008 về biện pháp bù cho transport
HTTP.

## Goals / Non-Goals

**Goals:**
- Redmine và XWiki dùng được trong chat với cùng mức an toàn như Jira/Confluence.
- Lỗi hoặc thiếu cấu hình của một server không ảnh hưởng tới các server khác.
- Thêm một server MCP HTTP thứ tư sau này chỉ cần thêm registry và một mục cấu hình, không phải sửa
  `AgentRuntime`.

**Non-Goals:**
- Kết nối MCP generic "tự khám phá tool". Đã cân nhắc và loại; xem quyết định D2.
- Đưa Redmine vào Daily Briefing hay proactive check-in. Việc đó để một change sau.
- Các tool xoá, quản trị (membership, project, version, category) và attachment.
- Stdio cho Redmine/XWiki. Cả hai chỉ có endpoint HTTP.

## Decisions

### D1. Router `McpToolRouter` thay cho manager đơn

Tách interface `McpToolSource` từ đúng bề mặt mà `AgentRuntime` đang dùng: `isReady`,
`resolveCallable`, `validateInput`, `callTool`, `canCallReadTool`, `listAvailable`, `targetUrl()`
và `start`/`stop`/`restart`. `AtlassianMcpManager` implement interface này mà không đổi hành vi.

Thêm `RemoteMcpServer` (package `@nexa/work-mcp-servers`), một manager HTTP dùng chung cho một
endpoint và một registry. Nó tái dùng `McpHttpClient`, `resolveServerToolName` và cách phân loại
lỗi. Atlassian giữ class riêng vì nó có nhánh stdio và hai bộ credential trên cùng một server.

`McpToolRouter` giữ một map `toolName → source`:
- Map được dựng khi start và **ném lỗi khi có tên trùng**. Tên Nexa luôn có tiền tố
  (`redmine_*`, `xwiki_*`), nên trùng tên là lỗi lập trình.
- `isReady` của router đúng khi **ít nhất một** source sẵn sàng. Gọi một tool có source chưa sẵn
  sàng trả `MCP_SERVER_UNAVAILABLE` kèm tên hệ thống, không phải lỗi chung.
- `AgentRuntime.deps.mcp` đổi kiểu sang `McpToolSource`, và router chính là một `McpToolSource`.
  Nhờ vậy test hiện có chỉ cần đổi kiểu, không phải viết lại.

*Phương án bị loại:* nhồi Redmine/XWiki vào `AtlassianMcpManager`. Hai endpoint khác nhau, hai bộ
credential khác nhau và vòng đời khác nhau; gộp lại thì Redmine sập kéo Jira sập theo.

### D2. Định nghĩa tool viết tay, không dùng tool từ `tools/list`

Giữ nguyên §11.3. Annotation `readOnlyHint` của Redmine chỉ dùng làm **dữ liệu đối chiếu trong
test**: một test khẳng định mọi tool Nexa xếp `READ` đều có `readOnlyHint: true` trong
`mcp-redmine-tools.json`. Annotation không bao giờ quyết định mức rủi ro lúc chạy. XWiki không có
annotation nào, càng là lý do không dựa vào chúng.

Zod schema khớp đúng tên tham số trong file JSON (bài học `cql` vs `query`). Một test đọc file JSON
để khẳng định mọi tham số Nexa khai báo đều tồn tại phía server.

### D3. Bảng mức rủi ro và cờ tính năng

| Tool (tên Nexa) | Mức | Cờ |
|---|---|---|
| `redmine_*` đọc (list/get/search, `get_current_user`, `get_attachment` metadata) | READ | `redmineRead` |
| `redmine_create_issue`, `add_issue_comment`, `log_time`, `create_issue_relation`, `add_watcher` | WRITE_LOW | `redmineWrite` |
| `redmine_update_issue` (đổi status, assignee, hạn…) | WRITE_HIGH | `redmineUpdate` |
| `xwiki_*` đọc (`list_wikis`, `get_*`, `query_*`, `man`) | READ | `xwikiRead` |
| `xwiki_write_document`, `xwiki_edit_document` | WRITE_HIGH | `xwikiWrite` |

- `redmine_download_attachment` bị loại. Nó trả base64 tới ngưỡng `MAX_ATTACHMENT_BYTES`, đổ
  thẳng vào context model và có thể chở nội dung nhị phân.
- `xwiki_write_document` là WRITE_HIGH dù trang chưa tồn tại: mức rủi ro là thuộc tính tĩnh của
  tool, và tool này *có thể* ghi đè. Preview nói rõ là đang tạo mới hay ghi đè.
- Mặc định: các cờ đọc **bật**; `redmineWrite` và `xwikiWrite` **bật** để thống nhất với
  OPEN-QUESTIONS G1; `redmineUpdate` **bật**. Mọi thao tác ghi vẫn phải xác nhận. Xem câu hỏi mở O1.

### D4. Preset tool

Thêm `redmine-read`, `redmine-full`, `xwiki-read` và `xwiki-full`. Tổng số preset lên 10 nhưng vẫn
là tập đóng đã biết trước (ADR 0009 vẫn đúng). `detectSignals` thêm tín hiệu từ khoá: "redmine",
"log time", "#<số>" khi không có project key Jira; "wiki", "xwiki", "trang tài liệu". Câu hỏi có
tín hiệu của từ hai hệ thống trở lên thì rơi về `all-read`/`all` như hiện nay.

### D5. Redmine phụ thuộc `mcpGateway`

Redmine không có URL MCP riêng: nó dùng URL và bearer token của kết nối `mcpGateway`.

- Kết nối `redmine` lưu `baseUrl` là **URL web Redmine**. URL này dùng cho dòng "hệ thống đích"
  trong preview và để đối chiếu host của link mà tool trả về (chống link lừa đảo, giống
  Atlassian).
- Credential của kết nối `redmine` là API key Redmine.
- Header dựng trong `buildRedmineGatewayHeaders()` gồm `authorization`, `x-mcp-servers: redmine` và
  `x-mcp-redmine-x-redmine-api-key`. Tên header nằm trong bảng `REDMINE_GATEWAY_HEADER_KEYS`, cùng
  ghi chú "quy ước của một gateway, chưa chốt chung" như `GATEWAY_HEADER_KEYS`.
- Bật `redmine` khi `mcpGateway` chưa bật hoặc chưa có credential thì trả
  `REDMINE_GATEWAY_REQUIRED`, và Settings hiện liên kết tới mục MCP Gateway.

Gateway LiteLLM là **một session riêng** cho Redmine, tách khỏi session Atlassian, vì `x-mcp-servers`
khác nhau.

### D6. XWiki gọi trực tiếp

- `baseUrl` là URL endpoint MCP, ví dụ `https://wiki.abbank.vn/rest/wikis/xwiki/aiLLM/mcp`.
- Host của link trả về được đối chiếu với `origin` của URL đó.
- Credential là bearer token. Định dạng `xwiki:XWiki.<user>/0/<secret>` được coi là opaque.
- Không cần username: cập nhật `requiresUsername` (danh sách hiện có không chứa `xwiki` nên hành vi
  đúng sẵn, chỉ cần thêm test).

### D7. Preview và lookup khi kết quả ghi `uncertain`

- **`redmine_create_issue`**: preview hiện project, tracker, tiêu đề, người được giao và hạn. Khi
  `uncertain`, lookup gọi `search_issues` với `author_id=me`, `subject~<tiêu đề>` và
  `created_on>=<startedAt>`.
- **`redmine_update_issue`**: preview đọc `get_issue` để hiện diff trước/sau từng field. Nếu đọc
  thất bại thì preview vẫn hiện giá trị mới và ghi "không lấy được giá trị hiện tại" (cùng cách
  làm của B4).
- **`redmine_log_time`**: preview hiện số giờ, ngày, issue/project và activity. Lookup dùng
  `list_time_entries` với `user_id=me`, `spent_on=<ngày>`.
- **`redmine_add_issue_comment`**: lookup dùng `get_issue include=journals`, lọc ghi chú của tôi
  sau thời điểm `startedAt`.
- **`xwiki_write_document`**: preview gọi `get_document` để biết trang đã tồn tại chưa và lấy
  version hiện tại. Nexa **tự gắn `base_version`** vào payload đã được duyệt. Nếu có ai sửa trang
  giữa lúc xem preview và lúc chạy, XWiki từ chối thay vì ghi đè lặng lẽ. Payload đã gắn
  `base_version` là payload được ràng buộc với approval (ADR-0007), nên model không thể bỏ nó đi.
- **`xwiki_edit_document`**: preview hiện từng cặp tìm/thay kèm ngữ cảnh quanh vị trí khớp (lấy từ
  `get_document`), và cũng gắn `base_version`.

### D8. Phân loại lỗi và redaction

- Thêm `REDMINE_AUTH_FAILED` (401/403 trên `get_current_user` hoặc text "Invalid API key") và
  `XWIKI_AUTH_FAILED` (HTTP 401 trên endpoint).
- Lỗi 403 của các tool chỉ dành cho admin (`list_users`, `list_custom_fields`) **không** phải lỗi
  xác thực. Chúng được xếp `TOOL_NOT_PERMITTED_UPSTREAM` (hoặc mã tương đương đã có), để UI không
  bảo người dùng nhập lại key.
- Redactor: tên header `x-mcp-redmine-x-redmine-api-key` được thêm vào danh sách khoá nhạy cảm.
  `BEARER_RE` hiện **không** che được `Bearer xwiki:XWiki.user/0/...`, vì lớp ký tự không có `:`
  và phần đầu chỉ dài 5 ký tự. Phải sửa regex và thêm test bằng một token giả cùng định dạng. Lớp
  `LONG_OPAQUE_RE` và lớp "giá trị đã đăng ký" vẫn che được phần secret, nhưng không được dựa vào
  một lớp duy nhất.

### D9. Kiểm tra kết nối

- Redmine: `restart()` source Redmine rồi gọi `redmine_get_current_user`. Detail trả về có login
  (không phải secret), giúp người dùng biết mình đang hành động dưới tài khoản nào.
- XWiki: gọi `xwiki_list_wikis`.

## Risks / Trade-offs

- [Gateway đổi tiền tố hoặc tên tool] → `resolveServerToolName` xử lý cả hai kiểu. Một tool có
  định nghĩa nhưng không thấy trên server sẽ bị ẩn khỏi danh mục, kèm log cảnh báo, chứ không làm
  hỏng toàn bộ.
- [XWiki `listChanged: true`, danh mục có thể thay đổi khi đang chạy] → Nexa không nghe
  `notifications/tools/list_changed`, vì danh mục đã viết tay sẵn. Tool mới phía server bị bỏ qua
  cho tới khi có người thêm định nghĩa.
- [Số preset tăng từ 6 lên 10, thêm prefix cho prompt cache] → vẫn là tập hữu hạn. Ước tính số
  token của `redmine-full` vào khoảng 1/3 preset `jira-full`.
- [Redmine API key cấp quyền theo người dùng; key admin mở được nhiều hơn] → Nexa không biết quyền
  của key. Mọi thao tác ghi vẫn phải qua preview, và preview luôn ghi "hành động dưới tài khoản X"
  lấy từ `get_current_user`.
- [`write_document` ghi đè cả trang] → WRITE_HIGH, cộng `base_version`, cộng preview nói rõ
  "ghi đè N dòng hiện có". Cờ `xwikiWrite` có thể bị khoá bằng `forcedFeatures`.
- [Credential đã từng bị dán vào hội thoại hoặc công cụ khác] → nằm ngoài phạm vi code. Khuyến nghị
  người dùng xoay vòng (rotate) key sau khi cấu hình xong Nexa.

## Migration Plan

1. Migration v12 dựng lại bảng `connections`, mở `CHECK` thêm `'redmine','xwiki'`, theo đúng mẫu
   v2 và v3.
2. Thêm cờ mới vào `featureFlagsSchema` có `default`, nên settings cũ vẫn parse được.
3. Rollback: tắt cờ, hoặc IT dùng `forcedFeatures: { redmineRead: false, ... }`. Migration không cần
   đảo ngược, vì CHECK rộng hơn không ảnh hưởng dữ liệu cũ.

## Open Questions

- **O1.** Mặc định của `xwikiWrite`/`redmineUpdate` nên là bật (thống nhất với G1) hay tắt (thận
  trọng, vì đây là bề mặt mới)? Design đang chọn **bật**; cần người dùng xác nhận.
- **O2.** Chưa biết URL web Redmine. Tool có trả link tuyệt đối không, hay Nexa phải tự dựng
  `<baseUrl>/issues/<id>`? Cần gọi thử `get_issue` một lần lúc implement.
- **O3.** Có cần preset kết hợp (ví dụ Redmine + XWiki cho câu "tạo issue từ trang wiki này")
  không, hay để rơi về `all`?

## Ghi chú triển khai (2026-11-17)

Những điểm thay đổi hoặc bổ sung so với bản design ở trên, phát hiện trong lúc implement:

- **O2 đã có câu trả lời.** Tool Redmine không trả URL nào (đã kiểm `search_issues` với server
  thật). Nexa tự dựng link `<baseUrl>/issues/<id>` (`redmineIssueUrl`). Phần còn mở chuyển sang
  OPEN-QUESTIONS M2.
- **D7: cơ chế gắn `base_version` là hook `ToolDefinition.prepareWrite`.** Hook chạy trước preview,
  thay vì để `buildPreview` ngầm sửa payload. Payload nó trả về được validate lại, rồi chính payload
  đó được xem trước, băm và thực thi. `base_version` có trong zod nhưng không có trong JSON Schema
  gửi model; giá trị model tự điền luôn bị thay. Đọc trang lỗi (trừ "No such document") thì dừng
  trước preview.
- **D4: bộ chọn preset nhận danh sách hệ thống khả dụng.** Không có nó, người chỉ cấu hình Redmine
  hỏi "tạo task" sẽ ra `jira-full` rỗng tool. Từ chung ("task", "trang") chỉ trỏ tới hệ thống khả
  dụng; từ riêng luôn được tính; không truyền danh sách thì hành vi y như cũ.
- **D8: thêm mã lỗi** `REDMINE_CONFIG_REQUIRED`, `XWIKI_CONFIG_REQUIRED` (bảng tra loại kết nối bắt
  buộc có) và `XWIKI_VERSION_CONFLICT` (nếu không có, xung đột sẽ hiện thành "kiểm tra mạng"). Lỗi
  403 của Redmine dùng `UPSTREAM_UNAVAILABLE` (không thêm mã mới). Các mã auth/config/conflict mới
  được tính là `failed` trong `isUncertainOutcome`, không phải `uncertain`.
- **Bảo mật: `get_current_user` của server Redmine trả về cả `api_key`.** `summarizeRedmine` gỡ
  `api_key`/`password` trước khi kết quả tới model.
- **Badge sidebar** chỉ nhận sự kiện trạng thái Jira/Confluence. Trạng thái Redmine/XWiki xem ở Cài
  đặt (kết quả kiểm tra kết nối) và trong file chẩn đoán.
