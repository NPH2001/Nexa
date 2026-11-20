# Hợp đồng tích hợp

Nexa nói chuyện với năm thứ bên ngoài. Đây là hợp đồng cho từng cái: Nexa **gửi gì**, **mong đợi gì**,
và **hỏng thế nào**.

Nguồn: §9 của tài liệu thiết kế. Nơi triển khai được ghi kèm để đối chiếu code.

> Phần lớn hợp đồng vẫn **chưa được kiểm chứng đầu-cuối với hệ thống thật**. Nhánh MCP gateway
> đã chạy với một gateway thực tế nhưng chưa đại diện cho mọi môi trường — xem
> [`../OPEN-QUESTIONS.md`](../OPEN-QUESTIONS.md) mục C2 và A4.

---

## 1. LiteLLM

**Triển khai:** `packages/llm-client/src/openai-compatible-client.ts`
**Câu hỏi mở:** A1 🔴

### Gửi đi

| Thuộc tính      | Giá trị                                                                             |
| --------------- | ----------------------------------------------------------------------------------- |
| Giao thức       | HTTPS, tương thích OpenAI                                                           |
| Endpoint        | `POST /v1/chat/completions`, `GET /v1/models`                                       |
| Auth            | `Authorization: Bearer <API key>` — gắn ở **main process**, renderer không chạm tới |
| Header truy vết | `X-Request-ID: req_<32 hex>`                                                        |
| Streaming       | SSE, kèm `stream_options.include_usage`                                             |
| Timeout         | `settings.llmTimeoutMs`, mặc định 120 s                                             |

Body chỉ chứa: `model`, `messages`, `stream`, và `tools`/`tool_choice` khi có tool khả dụng.
Không có device id, không có user id — §9.3 cấm gửi định danh ra ngoài khi chưa có chính sách.

### Mong đợi nhận

SSE dạng `data: {json}\n\n`, kết thúc bằng `data: [DONE]`. Bộ ghép xử lý được: chunk bị cắt ngang,
CRLF, JSON hỏng lẻ tẻ (bỏ qua), `tool_calls` đến từng mảnh theo `index`, và lỗi báo trong thân stream.

### Ánh xạ lỗi

| HTTP     | Mã Nexa                            | Ghi chú                                                                  |
| -------- | ---------------------------------- | ------------------------------------------------------------------------ |
| 401, 403 | `LITELLM_AUTH_FAILED`              | Key sai hoặc bị thu hồi                                                  |
| 404, 405 | `UPSTREAM_UNAVAILABLE`             | Endpoint không bật — `testConnection` dùng mã này để quyết định fallback |
| 408, 504 | `LLM_TIMEOUT`                      |                                                                          |
| 429      | `LITELLM_RATE_LIMITED`             |                                                                          |
| 400, 422 | `MODEL_NOT_CONFIGURED`             | Nguyên nhân phổ biến nhất là model id sai                                |
| 5xx      | `UPSTREAM_UNAVAILABLE` (retryable) |                                                                          |

**Thân response lỗi KHÔNG bao giờ được đưa vào thông báo hay log** — gateway thường echo lại
nguyên request, tức là cả prompt.

### Kiểm tra kết nối

`GET /v1/models` trước. Nếu 404/405 (endpoint không bật) thì fallback sang một chat completion
`max_tokens: 1` — vì mục tiêu là xác thực **key**, và 404 không nói được key đúng hay sai.

---

## 1b. OpenAI (ChatGPT) — trực tiếp

**Triển khai:** cùng `OpenAiCompatibleClient` với LiteLLM · **Câu hỏi mở:** F1 🔴

Giao thức **giống hệt** LiteLLM — cùng `/v1/chat/completions`, `/v1/models`, `Authorization: Bearer`.
Chỉ khác `baseUrl` (mặc định `https://api.openai.com`) và mã lỗi (`OPENAI_*` thay vì `LITELLM_*`).

Đó chính là lý do client được đặt tên `OpenAiCompatibleClient`: nó chỉ nói giao thức, không biết
ai đứng sau.

### Khác biệt duy nhất đáng kể: đường dữ liệu

|                               | LiteLLM               | OpenAI trực tiếp                            |
| ----------------------------- | --------------------- | ------------------------------------------- |
| Đích                          | hạ tầng nội bộ        | cloud công cộng                             |
| Quota / usage log của tổ chức | có                    | **không**                                   |
| Tài liệu đính kèm             | fail-open (§11.2, A5) | **fail-closed** — phải allowlist từng model |
| Chốt chặn của IT              | luôn khả dụng         | `allowDirectOpenAi: false`                  |
| Cảnh báo trong UI             | không                 | có, ở ba chỗ                                |

Danh sách cho phép gửi tài liệu tới model ngoài nằm ở `settings.externalDocumentAllowedModels`,
ghi dạng `openai:gpt-4o`. **Tách khỏi** `documentAllowedModels` vì hai chính sách ngược chiều
nhau — dùng chung một danh sách thì mở cho model ngoài sẽ vô tình chặn model nội bộ.

### Điều tổ chức phải làm trước khi dùng

1. ATTT đặt `allowDirectOpenAi: true` sau khi duyệt việc dữ liệu ra ngoài; để `false` sẽ chặn cả
   cấu hình cũ ở execution boundary.
2. Thêm `api.openai.com` vào `allowedDomains` trong `policy.json` nếu allowlist đang được dùng.
3. Quyết định có allowlist model nào cho tài liệu hay không (mặc định: không cái nào).

---

## 2. MCP Atlassian

**Triển khai:** `packages/mcp-client/`, `packages/atlassian-mcp-manager/`
**Câu hỏi mở:** A4 🔴 (package stdio chưa chốt) · ADR 0004, bổ sung bởi ADR 0008

### Gửi đi

| Thuộc tính          | Giá trị                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------- |
| Transport           | stdio qua process con **hoặc** HTTPS client tới gateway; Nexa không mở cổng HTTP cục bộ   |
| Protocol            | JSON-RPC 2.0; newline-delimited ở stdio, request/response qua HTTP ở gateway              |
| Version             | `2024-11-05`                                                                              |
| Method dùng         | `initialize`, `notifications/initialized`, `tools/list`, `tools/call`                     |
| Capability khai báo | `{}` — cố ý **không** khai `sampling` hay `roots`                                         |
| Credential          | env của process con (stdio) hoặc header dựng trong main process (gateway), không qua argv |

Biến môi trường (quy ước của `mcp-atlassian`, chưa chốt):
`JIRA_URL`, `JIRA_USERNAME`, `JIRA_PERSONAL_TOKEN`, `CONFLUENCE_URL`, `CONFLUENCE_USERNAME`,
`CONFLUENCE_PERSONAL_TOKEN`

Process con **không** kế thừa environment của Nexa; chỉ nhận `PATH` cộng danh sách trên.

Với nhánh gateway, kết nối `mcpGateway` cung cấp URL HTTPS và bearer token. Main process dựng
các header Jira/Confluence ngay trước request, không đưa credential sang renderer và không
follow redirect. Hai transport dùng chung registry tool, confirmation guard và policy.

### Mong đợi nhận

`tools/list` trả mảng tool có `name`. Nexa chỉ dùng những tool có trong danh mục của mình —
tool lạ bị bỏ qua, tool trong danh mục mà server không công bố thì bị ẩn khỏi LLM.

`tools/call` trả `{ content: [{type:'text', text}], isError }`. Server được phép in log lẫn vào
stdout; dòng nào không parse được JSON thì bỏ qua.

### Danh mục tool

| Tên Nexa              | Tên MCP               | Risk       | Feature flag       |
| --------------------- | --------------------- | ---------- | ------------------ |
| `jira_get_issue`      | `jira_get_issue`      | READ       | `jiraRead`         |
| `jira_search`         | `jira_search`         | READ       | `jiraSearch`       |
| `jira_create_issue`   | `jira_create_issue`   | WRITE_LOW  | `jiraCreate`       |
| `jira_add_comment`    | `jira_add_comment`    | WRITE_LOW  | `jiraComment`      |
| `jira_update_issue`   | `jira_update_issue`   | WRITE_HIGH | `jiraUpdate`       |
| `confluence_get_page` | `confluence_get_page` | READ       | `confluenceRead`   |
| `confluence_search`   | `confluence_search`   | READ       | `confluenceSearch` |

Hai cột trùng giá trị vì registry hiện tại không có tiền tố namespace từ gateway; "Tên Nexa"
(gửi cho LLM) phải khớp `[a-zA-Z0-9_-]` — Bedrock Converse API từ chối dấu chấm trong
`toolUse.name` — nên không thể dùng `jira.get_issue` như trước.

Đổi package MCP ⇒ sửa cột "Tên MCP" trong `tool-registry.ts` và
`DEFAULT_ATLASSIAN_MCP_SPEC` trong `server-spec.ts`. Không phải sửa chỗ nào khác.

**Tên tham số cũng là quy ước của package, không phải chuẩn MCP** — đổi package thì phải soi lại
bảng này. `tools/list` của server công bố `inputSchema` đầy đủ; đó là nguồn sự thật.

| Tên MCP               | Tham số bắt buộc                                     | Tuỳ chọn      |
| --------------------- | ---------------------------------------------------- | ------------- |
| `jira_get_issue`      | `issue_key`                                          |               |
| `jira_search`         | `jql`                                                | `limit`       |
| `jira_create_issue`   | `project_key`, `summary`, `issue_type`               | `description` |
| `jira_add_comment`    | `issue_key`, `comment`                               |               |
| `jira_update_issue`   | `issue_key`, `fields`                                |               |
| `confluence_get_page` | `page_id`                                            |               |
| `confluence_search`   | `query` — text thường **hoặc** CQL, không phải `cql` | `limit`       |

Chỉ hai dòng `confluence_*` đã được đối chiếu với gateway thật (03/08/2026); phần còn lại vẫn là
quy ước chưa kiểm chứng — xem A4 trong [OPEN-QUESTIONS](../OPEN-QUESTIONS.md).

Sai tên tham số không hiện ra như lỗi cấu hình: server trả `isError` kèm
`Input validation error: '<tên>' is a required property`, rơi vào nhánh cuối của
`classifyToolError` và hiện thành `UPSTREAM_UNAVAILABLE` — trông y hệt hạ tầng đích chết. Dấu hiệu
phân biệt trong log: lỗi validate trả về sau vài chục ms (chưa rời gateway), còn lỗi hạ tầng thật
mất hàng trăm ms trở lên.

### Ánh xạ lỗi

Server báo lỗi nghiệp vụ bằng `isError: true` + text, không phải bằng mã. `classifyToolError`
suy ra mã Nexa từ text — **đây là heuristic dựa trên chuỗi** và sẽ cần hiệu chỉnh khi có server thật.

| Text chứa                                                                 | Mã Nexa                                        |
| ------------------------------------------------------------------------- | ---------------------------------------------- |
| `401`, `403`, `unauthorized`, `forbidden`, `permission`, `authentication` | `ATLASSIAN_AUTH_FAILED`                        |
| `missing` + `credential`                                                  | `ATLASSIAN_CONFIG_REQUIRED`                    |
| `timeout`, `timed out`                                                    | `MCP_SERVER_UNAVAILABLE`                       |
| còn lại (404, lỗi validate của Jira…)                                     | `UPSTREAM_UNAVAILABLE` — model có thể tự xử lý |

---

## 2b. Redmine và XWiki (ADR 0010)

Hai MCP server HTTP, mỗi server một `RemoteMcpServer` (`@nexa/work-mcp-servers`), gộp với
Atlassian qua `McpToolRouter`. Danh mục thật ở `mcp-redmine-tools.json` và `mcp-xwiki-tools.json`.

### Redmine — qua MCP Gateway

| Cấu hình | Lấy từ |
|---|---|
| URL endpoint, bearer token | Kết nối **MCP Gateway** (dùng chung với Atlassian) |
| API key Redmine | Kết nối **Redmine** → secure storage `secure://redmine/default` |
| URL web Redmine | Kết nối **Redmine** (`baseUrl`), chỉ dùng cho preview và để dựng link `/issues/<id>` |

Header mỗi request: `authorization: Bearer <gateway>`, `x-mcp-servers: redmine`,
`x-mcp-redmine-x-redmine-api-key: <api key>` (bảng `REDMINE_GATEWAY_HEADER_KEYS`). Gateway đặt tiền
tố cho tool (`redmine-get_issue`); `resolveServerToolName` khớp được cả tên có và không có tiền tố.

Khởi chạy gọi `get_current_user` để xác nhận API key và lấy login hiển thị trong preview.

| Text/trạng thái | Mã Nexa |
|---|---|
| HTTP 401/403 ở bước `initialize` (bearer gateway sai) | `MCP_GATEWAY_AUTH_FAILED` |
| `HTTP 401`, `invalid api key`, `unauthorized` | `REDMINE_AUTH_FAILED` |
| `HTTP 403`, `forbidden` (key đúng, thiếu quyền, ví dụ `list_users`) | `UPSTREAM_UNAVAILABLE` — **không** phải lỗi xác thực |
| `timeout` | `MCP_SERVER_UNAVAILABLE` |
| còn lại (404, 422…) | `UPSTREAM_UNAVAILABLE` |
| Gateway chưa bật hoặc chưa có token | `REDMINE_GATEWAY_REQUIRED` |

### XWiki — trực tiếp

`baseUrl` là URL endpoint MCP; credential là bearer token (`secure://xwiki/default`). Endpoint trả
`application/json` và **không** có `mcp-session-id`. Link trong kết quả (dòng `URL:`) chỉ được nhận
nếu cùng host với endpoint.

Ghi trang (`write_document`, `edit_document`) dùng `prepareWrite` để đọc dòng `Version:` của
`get_document` và gắn `base_version` vào payload đã duyệt. Model không thấy và không điền được tham
số này.

| Text | Mã Nexa |
|---|---|
| HTTP 401/403 ở bước `initialize`, hoặc `401`/`unauthorized` trong text | `XWIKI_AUTH_FAILED` |
| `Version conflict` | `XWIKI_VERSION_CONFLICT` (tính là `failed`, không phải `uncertain`) |
| `No such document` | `UPSTREAM_UNAVAILABLE`, `safeDetail` = `xwiki-document-not-found` |
| còn lại | `UPSTREAM_UNAVAILABLE` |

### Allowlist domain

Nếu `allowedDomains` trong `resources/policy.json` không rỗng, phải thêm domain XWiki (ví dụ
`wiki.abbank.vn`). Redmine không cần thêm gì, vì nó đi qua domain gateway đã có.

---

## 3. IPC renderer ↔ main

**Triển khai:** `packages/shared-types/src/ipc.ts`, `apps/desktop/src/main/ipc.ts`

35 channel, mỗi channel có schema Zod bắt buộc. Bảng handler có kiểu `Record<IpcChannel, …>` nên
thiếu một channel là lỗi biên dịch, và không channel nào vào được handler mà chưa qua `parse`.

Mọi phản hồi theo envelope §9.2:

```jsonc
// Thành công
{ "request_id": "req_…", "data": { }, "meta": { "source": "local" } }

// Lỗi — không bao giờ có stack trace hay cause
{ "request_id": "req_…", "error": { "code": "…", "message": "…", "retryable": false, "hint": "…" } }
```

Hai ràng buộc tuyệt đối:

- **Không channel nào nhận `path: string`.** File chỉ vào qua `file:pick` (main mở dialog) rồi
  được tham chiếu bằng UUID.
- **Không channel nào trả secret ra.** `Connection` chỉ có `hasCredential: boolean`.

## 4. Update server (tuỳ chọn)

**Triển khai:** `apps/desktop/src/main/update-service.ts` · **Câu hỏi mở:** A8, C3

Mặc định **tắt**. Chỉ chạy khi `policy.json` khai `updateManifestUrl` và bật `features.autoUpdate`.

```jsonc
{
  "channel": "stable",
  "version": "1.2.0",
  "url": "https://updates.corp.local/nexa-1.2.0.exe",
  "sha256": "<64 hex>",
  "releasedAt": "2026-08-01T00:00:00Z",
  "mandatory": false,
  "requireSignature": true,
  "minimumSupportedVersion": "1.0.0",
}
```

Xác minh trước khi cài: SHA-256 bắt buộc khớp. `requireSignature: true` hiện làm
`verifyPackage` **từ chối** — build chưa có cơ chế ký, và giả vờ đã kiểm tra thì nguy hiểm hơn
là từ chối. Không kết nối được máy chủ cập nhật **không** chặn việc sử dụng app.
