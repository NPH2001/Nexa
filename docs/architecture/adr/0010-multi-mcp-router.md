# ADR 0010 — Nhiều MCP server HTTP qua một router: Redmine và XWiki

**Trạng thái:** Đề xuất (mở rộng ADR-0008 và ADR-0009; openspec `add-redmine-xwiki-connectors`)
**Ngày:** 2026-11-17

## Bối cảnh

Đến ADR-0009, Nexa nói chuyện với đúng **một** MCP server: `AtlassianMcpManager`, phục vụ Jira và
Confluence. `AgentRuntime` nhận một `AtlassianMcpManager | null`, và preview chọn URL đích theo hai
nhánh `jira`/`confluence` viết cứng.

Tổ chức còn dùng Redmine (issue, log time) và XWiki (tài liệu). Cả hai đã có endpoint MCP chạy
thật. Ngày 2026-11-17 đã kiểm chứng bằng `initialize` + `tools/list` với credential thật:

| Hệ thống | Endpoint | Xác thực | Danh mục |
|---|---|---|---|
| Redmine | Gateway LiteLLM sẵn có (cùng URL với `mcpGateway`) | `Authorization: Bearer <litellm>` + `x-mcp-servers: redmine` + `x-mcp-redmine-x-redmine-api-key` | 58 tool, có `readOnlyHint`/`destructiveHint` |
| XWiki | `https://<wiki>/rest/wikis/xwiki/<space>/mcp` | `Authorization: Bearer <token>` | 12 tool, không có annotation |

Danh mục thật được lưu ở `mcp-redmine-tools.json` và `mcp-xwiki-tools.json` (chỉ schema).

## Quyết định

1. **`McpToolSource`**: bề mặt mà runtime cần từ một MCP server (`resolveCallable`, `validateInput`,
   `callTool`, `availableTools`, `canCallReadTool`, `targetSystemUrl`, `actingAccount`).
   `AtlassianMcpManager` implement interface này mà không đổi hành vi.
2. **`RemoteMcpServer`** (`@nexa/work-mcp-servers`): manager HTTP dùng chung cho một endpoint và một
   registry viết tay. Nó dùng lại `McpHttpClient`, nên kế thừa nguyên bốn biện pháp bù của ADR-0008
   (HTTPS bắt buộc, không redirect, header dựng lại cho mỗi request, không log header).
3. **`McpToolRouter`**: định tuyến theo tên tool tới đúng source. Router cũng là một
   `McpToolSource`, nên runtime chỉ đổi kiểu, không đổi luồng. Tên trùng giữa các registry ném lỗi
   lúc khởi động (`assertDisjointToolNames`) và cả lúc tra cứu.
4. **Cô lập lỗi**: một source chưa sẵn sàng chỉ làm tool của nó không gọi được. Router trả mã lỗi
   khởi chạy gần nhất của source đó (ví dụ `REDMINE_AUTH_FAILED`), không trả một mã chung.
5. **Danh mục viết tay, không tin `tools/list`** (§11.3, giữ nguyên). Annotation của Redmine chỉ là
   dữ liệu đối chiếu trong test: tool nào Nexa xếp READ thì server phải đánh dấu `readOnlyHint`, và
   không tool `destructiveHint` nào được lọt vào danh mục.
6. **Preset (ADR 0009)**: từ 6 lên 10 preset (`redmine-read/full`, `xwiki-read/full`). Đây vẫn là
   một tập đóng. Bộ chọn nhận thêm danh sách hệ thống đang khả dụng: từ chung ("task", "trang")
   chỉ trỏ tới hệ thống khả dụng thuộc nhóm đó; từ riêng (tên hệ thống, `PRJ-1`, `#123`) luôn được
   tính. Không truyền danh sách thì hành vi giữ y như trước ADR này.
7. **`ToolDefinition.prepareWrite`**: hook mới chạy **trước** preview, dùng để chốt payload ghi
   cuối cùng. XWiki dùng nó để gắn `base_version` của trang vừa đọc. Payload trả về được validate
   lại, rồi chính nó được xem trước, băm vào approval (ADR-0007) và thực thi.

## Vì sao không làm "MCP generic tự khám phá tool"

Phương án này đã được cân nhắc và loại. Nó cho phép thêm server mà không phải sửa code, nhưng mức
rủi ro khi đó sẽ do server tự khai (`readOnlyHint`). Trong khi đó XWiki không khai gì, và một server
bị chiếm quyền có thể khai `readOnlyHint: true` cho một tool xoá. Nexa sẽ mất cổng "tool nào không
có định nghĩa thì không được gọi", cũng là cổng mà Confirmation Guard dựa vào.

## Hệ quả về bảo mật

- **Redmine đi qua gateway**: không có chặng mạng mới nào ngoài chặng đã có của ADR-0008. Bearer
  token gateway và API key Redmine được đọc từ secure storage ngay trước mỗi request.
- **`get_current_user` của server Redmine trả về cả `api_key`** (quan sát thật). Hàm `summarize`
  gỡ các trường `api_key`/`password` trước khi kết quả tới model. Redactor vẫn che giá trị này
  trong log, nhưng `forModel` đi thẳng tới LLM nên không thể chỉ dựa vào redactor.
- **Token XWiki có dạng `xwiki:XWiki.<user>/<n>/<secret>`**: `BEARER_RE` cũ dừng ở dấu `:` nên bỏ
  qua cả token. Đã sửa regex và thêm test.
- **Không mở**: mọi `delete_*`, `remove_watcher`, membership, tạo/sửa project, CRUD
  version/category, upload/update/download attachment, `upsert_wiki_page`. `download_attachment`
  bị loại cả ở nhóm đọc, vì nó đổ base64 vào context model.
- **Ghi XWiki có khoá lạc quan**: đọc được phiên bản thì gắn `base_version`; trang chưa tồn tại thì
  tạo mới (XWiki bắt buộc có `base_version` mới cho ghi đè); mọi lỗi đọc khác thì dừng trước
  preview. Xung đột phiên bản có mã riêng `XWIKI_VERSION_CONFLICT` và được tính là `failed`, không
  phải `uncertain`.

## Hệ quả khác

- `services.mcp` vẫn là manager Atlassian (Daily Briefing dùng thẳng nó). Thêm `services.redmine`,
  `services.xwiki` và `services.mcpRouter`. Chat và `tool:*` IPC đi qua router.
- Lưu hoặc xoá kết nối chỉ dựng lại đúng source của nó; đổi `mcpGateway` thì dựng lại cả Atlassian
  lẫn Redmine.
- Migration v12 mở `CHECK` của `connections` cho `redmine` và `xwiki`.
- Badge ở sidebar vẫn là trạng thái Jira/Confluence. Trạng thái Redmine/XWiki xem ở Cài đặt (kết
  quả "Kiểm tra kết nối") và trong file chẩn đoán.
