## Why

Tổ chức đang dùng song song Jira/Confluence với **Redmine** (quản lý issue, log time) và **XWiki**
(tài liệu nội bộ). Cả hai đã có sẵn endpoint MCP chạy thật: Redmine đứng sau chính gateway LiteLLM
mà Nexa đang dùng cho Atlassian (`x-mcp-servers: redmine`), còn XWiki công bố một endpoint MCP HTTP
riêng. Người dùng đang cấu hình chúng trong các công cụ khác, nhưng Nexa chưa nói chuyện được với
server nào ngoài Atlassian. Lý do là kiến trúc hiện tại gắn chặt **một** `AtlassianMcpManager` và
hai hệ thống đích `jira | confluence`.

Ngày 2026-11-17 đã gọi thử `initialize` + `tools/list` lên cả hai endpoint bằng credential thật và
đều thành công: Redmine công bố 58 tool (có `readOnlyHint`/`destructiveHint`), XWiki công bố 12
tool (không có annotation). Danh mục này được lưu ở `mcp-redmine-tools.json` và
`mcp-xwiki-tools.json`, chỉ gồm schema, không chứa credential.

## What Changes

- Thêm hai loại kết nối mới `redmine` và `xwiki` vào Settings → Kết nối. Credential (Redmine API
  key, XWiki bearer token) được lưu ở secure storage như các kết nối khác. Credential không bao giờ
  nằm trong repo, fixture hay log.
- **Redmine đi qua kết nối `mcpGateway` sẵn có.** Nexa dùng lại URL và bearer token LiteLLM của
  gateway, rồi thêm header `x-mcp-servers: redmine` và `x-mcp-redmine-x-redmine-api-key`. Chưa bật
  `mcpGateway` thì Redmine không khởi chạy và UI nói rõ lý do.
- **XWiki gọi thẳng endpoint MCP HTTP** bằng `Authorization: Bearer <token>`. Áp dụng đủ các biện
  pháp bù của ADR-0008: chỉ HTTPS, không follow redirect, không log header.
- Thêm **router tool MCP** cho phép nhiều server MCP cùng tồn tại. Mỗi server có vòng đời và
  trạng thái riêng, nên Redmine lỗi không làm Jira tắt theo. `AgentRuntime` gọi qua router thay vì
  gọi thẳng một `AtlassianMcpManager`.
- Thêm **định nghĩa tool viết tay** (zod schema khớp `inputSchema` thật, mức rủi ro, cờ tính năng,
  preview, summarize). Nguyên tắc "tool không có định nghĩa thì không được gọi" giữ nguyên:
  - Redmine: toàn bộ tool đọc (trừ `download_attachment`), cộng thêm `create_issue`,
    `add_issue_comment`, `log_time`, `create_issue_relation` và `add_watcher` (WRITE_LOW), và
    `update_issue` (WRITE_HIGH).
  - XWiki: toàn bộ tool đọc (kể cả `man`), cộng thêm `write_document` và `edit_document`
    (WRITE_HIGH).
- **KHÔNG** mở trong change này: mọi tool `delete_*`, `remove_watcher`, membership, tạo hoặc sửa
  project, CRUD version/category, upload/update/download attachment và `upsert_wiki_page`. Tham số
  `uploads` bị bỏ khỏi schema `create_issue`/`update_issue`, vì không có tool upload đi kèm.
- Thêm cờ tính năng `redmineRead`, `redmineWrite`, `redmineUpdate`, `xwikiRead` và `xwikiWrite`.
  Thêm preset tool `redmine-read`, `redmine-full`, `xwiki-read` và `xwiki-full` vào danh sách đóng
  của ADR 0009. `all-read`/`all` được mở rộng tương ứng.
- Mở rộng `ToolPreview.targetSystem` thêm `redmine | xwiki`, và hộp thoại xác nhận hiển thị đúng
  hệ thống đích.
- Thêm mã lỗi `REDMINE_AUTH_FAILED`, `XWIKI_AUTH_FAILED` và `REDMINE_GATEWAY_REQUIRED`.
- Thêm migration v12 để mở `CHECK` constraint của bảng `connections`.

## Capabilities

### New Capabilities
- `mcp-tool-routing`: nhiều MCP server cùng tồn tại. Gồm định tuyến theo tên tool, cô lập lỗi và
  vòng đời từng server, tên tool duy nhất toàn cục, và hệ thống đích trong preview.
- `redmine-integration`: kết nối Redmine qua gateway. Gồm danh mục tool được phép, mức rủi ro,
  preview, tra cứu khi ghi rơi vào trạng thái `uncertain`, và kiểm tra kết nối.
- `xwiki-integration`: kết nối XWiki trực tiếp. Gồm danh mục tool được phép, preview ghi tài liệu
  có kiểm tra phiên bản (`base_version`), và kiểm tra kết nối.

### Modified Capabilities
<!-- Chưa có spec gốc nào trong openspec/specs/. Hành vi Atlassian không đổi. -->

## Impact

- **Code:** package mới `packages/work-mcp-servers` (manager HTTP dùng chung, registry Redmine và
  XWiki). Các chỗ khác phải sửa:
  - `packages/shared-types`: `domain.ts`, `settings.ts`, `tools.ts`, `errors.ts`, `ipc.ts`
  - `packages/agent-runtime`: chuyển sang router, preset selector
  - `packages/atlassian-mcp-manager`: tách interface `McpToolSource`
  - `packages/local-store`: migration v12
  - `packages/connection-config`: kiểm tra kết nối
  - `packages/observability`: redactor
  - `apps/desktop/src/main` (`services.ts`) và `apps/desktop/src/renderer` (`SettingsView.tsx`,
    `ConfirmationDialog.tsx`)
- **Hạ tầng:** endpoint `litellm.abbank.vn/mcp/` (đã dùng sẵn) và `wiki.abbank.vn`. Nếu
  `allowedDomains` của tổ chức có liệt kê domain thì phải thêm `wiki.abbank.vn`.
- **Tài liệu:** ADR-0010 (nhiều MCP server, mở rộng ADR-0008), `docs/OPEN-QUESTIONS.md`,
  `docs/integration/README.md`.
