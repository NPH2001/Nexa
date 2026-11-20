## 1. Kiểu dữ liệu và lưu trữ

- [x] 1.1 Thêm `redmine`, `xwiki` vào `CONNECTION_TYPES` (`domain.ts`); thêm test cho `requiresUsername` của hai loại mới (đều không cần username)
- [x] 1.2 Mở rộng `ToolDefinition.targetSystem` và `ToolPreview.targetSystem` thêm `redmine | xwiki`
- [x] 1.3 Thêm cờ `redmineRead`, `redmineWrite`, `redmineUpdate`, `xwikiRead`, `xwikiWrite` vào `featureFlagsSchema` (có `default`, kèm JSDoc tham chiếu G1/O1)
- [x] 1.4 Thêm preset `redmine-read`, `redmine-full`, `xwiki-read`, `xwiki-full`, mở rộng `all-read`/`all` trong `TOOL_PRESET_FLAGS`
- [x] 1.5 Thêm mã lỗi `REDMINE_AUTH_FAILED`, `XWIKI_AUTH_FAILED`, `REDMINE_GATEWAY_REQUIRED` kèm thông điệp tiếng Việt (`errors.ts`)
- [x] 1.6 Migration v12: dựng lại bảng `connections`, mở `CHECK` cho `'redmine','xwiki'`; test migrate từ v11 giữ nguyên dữ liệu

## 2. Router MCP

- [x] 2.1 Tách interface `McpToolSource` từ bề mặt `AgentRuntime` đang dùng; cho `AtlassianMcpManager` implement interface này mà không đổi hành vi (test cũ vẫn xanh)
- [x] 2.2 Viết `McpToolRouter`: map tên tool → source, ném lỗi khi trùng tên, `isReady` khi có ít nhất một source sẵn sàng, `MCP_SERVER_UNAVAILABLE` kèm tên hệ thống khi source chưa sẵn sàng
- [x] 2.3 Đổi `AgentRuntime.deps.mcp` sang `McpToolSource`; `buildPreview` lấy `targetSystemUrl` từ source thay vì nhánh jira/confluence viết cứng
- [x] 2.4 Test router: định tuyến đúng, cô lập lỗi (Redmine lỗi thì Jira vẫn chạy), danh mục rỗng khi không source nào sẵn sàng

## 3. Package `@nexa/work-mcp-servers`

- [x] 3.1 Tạo package, viết `RemoteMcpServer` dùng chung (dùng `McpHttpClient` và `resolveServerToolName`, có trạng thái và vòng đời riêng)
- [x] 3.2 `buildRedmineGatewayHeaders()` và bảng `REDMINE_GATEWAY_HEADER_KEYS`, `REDMINE_SECRET_HEADER_KEYS`; test header không lọt vào log
- [x] 3.3 Phân loại lỗi Redmine/XWiki: auth (401, "Invalid API key") tách khỏi 403 của tool chỉ dành cho admin
- [x] 3.4 Test HTTP client với phản hồi `application/json` không có `mcp-session-id` (kiểu XWiki), dùng mock server cục bộ

## 4. Registry Redmine

- [x] 4.1 Định nghĩa các tool đọc (zod khớp `mcp-redmine-tools.json`, bỏ `download_attachment`), kèm `summarizeResult` rút gọn
- [x] 4.2 Tool WRITE_LOW `create_issue`, `add_issue_comment`, `log_time`, `create_issue_relation`, `add_watcher` (bỏ `uploads`), có preview và `lookupResult`
- [x] 4.3 Tool WRITE_HIGH `update_issue`: preview diff trước/sau qua `get_issue`, chịu được trường hợp đọc thất bại
- [x] 4.4 Đối chiếu host của link trả về với URL web Redmine; chốt O2 (link tuyệt đối hay tự dựng `/issues/<id>`) bằng một lần gọi thật
- [x] 4.5 Test đối chiếu: tool READ ↔ `readOnlyHint: true`; mọi tham số Nexa có trong `inputSchema`; tool bị loại không có trong registry

## 5. Registry XWiki

- [x] 5.1 Định nghĩa 10 tool đọc với tiền tố `xwiki_`, giới hạn độ dài kết quả `get_document`/`get_attachment` trước khi đưa vào context
- [x] 5.2 `write_document` và `edit_document` (WRITE_HIGH): preview tạo mới hay ghi đè, diff các cặp tìm/thay, tự gắn `base_version` vào payload đã duyệt
- [x] 5.3 Test: payload thiếu hoặc đổi `base_version` thì trả `TOOL_PAYLOAD_MISMATCH`; lỗi xung đột phiên bản từ server được báo rõ
- [x] 5.4 Test đối chiếu tham số với `mcp-xwiki-tools.json`

## 6. Bảo mật và quan sát

- [x] 6.1 Sửa `BEARER_RE` để che được `Bearer xwiki:XWiki.<user>/<n>/<secret>`; test bằng token giả
- [x] 6.2 Đăng ký `x-mcp-redmine-x-redmine-api-key` là khoá nhạy cảm trong redactor
- [x] 6.3 Rà fixture và test: không có credential thật nào (grep tiền tố key trong CI hoặc test)

## 7. Main process và kiểm tra kết nối

- [x] 7.1 `services.ts`: dựng source Redmine (cần `mcpGateway` bật, nếu không thì `REDMINE_GATEWAY_REQUIRED`) và source XWiki, gộp vào router cùng Atlassian
- [x] 7.2 `ConnectionService` test: Redmine gọi `redmine_get_current_user` và trả login; XWiki gọi `xwiki_list_wikis`
- [x] 7.3 Khởi động lại đúng source tương ứng khi người dùng lưu hoặc bật/tắt kết nối, không restart Atlassian

## 8. Renderer

- [x] 8.1 SettingsView: hai thẻ kết nối Redmine (URL web + API key, cảnh báo phụ thuộc MCP Gateway) và XWiki (URL endpoint + token)
- [x] 8.2 SettingsView: nhóm cờ Redmine/XWiki trong phần quyền tool
- [x] 8.3 `ConfirmationDialog.targetSystemLabel` thêm Redmine/XWiki; trạng thái MCP hiển thị theo từng hệ thống

## 9. Preset selector

- [x] 9.1 `detectSignals` thêm tín hiệu Redmine/XWiki; câu hỏi có tín hiệu của nhiều hệ thống thì rơi về `all-read`/`all`
- [x] 9.2 Cập nhật `tool-preset.test.ts` (phủ cờ mới, tập preset hữu hạn = 10)

## 10. Tài liệu và nghiệm thu

- [x] 10.1 ADR-0010 "Nhiều MCP server HTTP qua router" (mở rộng ADR-0008/0009)
- [x] 10.2 Cập nhật `docs/OPEN-QUESTIONS.md` (O1–O3), `docs/integration/README.md` (cấu hình Redmine/XWiki, `allowedDomains`)
- [x] 10.3 `pnpm typecheck`, `pnpm test`, `pnpm lint` đều xanh — typecheck/lint sạch; 1352/1352 test qua với `--testTimeout=30000`. Với timeout mặc định 5 s, chạy cả bộ thỉnh thoảng có 2–6 test chạm timeout (mỗi lần một nhóm khác nhau, chủ yếu test spawn mock MCP stdio); chạy riêng từng file đều qua.
- [ ] 10.4 Chạy thử thật (PHẦN ĐỌC ĐÃ XONG 2026-11-17 ở tầng code: kết nối, get_current_user, search_issues, list_wikis, get_document, key/token sai ⇒ đúng mã lỗi; phần ghi và chạy qua UI còn chờ): kiểm tra kết nối hai hệ thống, một câu hỏi đọc mỗi hệ thống, một thao tác ghi có xác nhận trên issue/trang thử nghiệm
