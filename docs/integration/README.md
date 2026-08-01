# Hợp đồng tích hợp

Nexa nói chuyện với bốn thứ bên ngoài. Đây là hợp đồng cho từng cái: Nexa **gửi gì**, **mong đợi gì**,
và **hỏng thế nào**.

Nguồn: §9 của tài liệu thiết kế. Nơi triển khai được ghi kèm để đối chiếu code.

> Cả bốn hợp đồng đều **chưa được kiểm chứng với hệ thống thật** — xem
> [`../OPEN-QUESTIONS.md`](../OPEN-QUESTIONS.md) mục C2.

---

## 1. LiteLLM

**Triển khai:** `packages/llm-client/src/litellm-client.ts`
**Câu hỏi mở:** A1 🔴

### Gửi đi

| Thuộc tính | Giá trị |
|---|---|
| Giao thức | HTTPS, tương thích OpenAI |
| Endpoint | `POST /v1/chat/completions`, `GET /v1/models` |
| Auth | `Authorization: Bearer <API key>` — gắn ở **main process**, renderer không chạm tới |
| Header truy vết | `X-Request-ID: req_<32 hex>` |
| Streaming | SSE, kèm `stream_options.include_usage` |
| Timeout | `settings.llmTimeoutMs`, mặc định 120 s |

Body chỉ chứa: `model`, `messages`, `stream`, và `tools`/`tool_choice` khi có tool khả dụng.
Không có device id, không có user id — §9.3 cấm gửi định danh ra ngoài khi chưa có chính sách.

### Mong đợi nhận

SSE dạng `data: {json}\n\n`, kết thúc bằng `data: [DONE]`. Bộ ghép xử lý được: chunk bị cắt ngang,
CRLF, JSON hỏng lẻ tẻ (bỏ qua), `tool_calls` đến từng mảnh theo `index`, và lỗi báo trong thân stream.

### Ánh xạ lỗi

| HTTP | Mã Nexa | Ghi chú |
|---|---|---|
| 401, 403 | `LITELLM_AUTH_FAILED` | Key sai hoặc bị thu hồi |
| 404, 405 | `UPSTREAM_UNAVAILABLE` | Endpoint không bật — `testConnection` dùng mã này để quyết định fallback |
| 408, 504 | `LLM_TIMEOUT` | |
| 429 | `LITELLM_RATE_LIMITED` | |
| 400, 422 | `MODEL_NOT_CONFIGURED` | Nguyên nhân phổ biến nhất là model id sai |
| 5xx | `UPSTREAM_UNAVAILABLE` (retryable) | |

**Thân response lỗi KHÔNG bao giờ được đưa vào thông báo hay log** — gateway thường echo lại
nguyên request, tức là cả prompt.

### Kiểm tra kết nối

`GET /v1/models` trước. Nếu 404/405 (endpoint không bật) thì fallback sang một chat completion
`max_tokens: 1` — vì mục tiêu là xác thực **key**, và 404 không nói được key đúng hay sai.

---

## 2. MCP Atlassian

**Triển khai:** `packages/mcp-client/`, `packages/atlassian-mcp-manager/`
**Câu hỏi mở:** A4 🔴 (package chưa chốt) · ADR 0004

### Gửi đi

| Thuộc tính | Giá trị |
|---|---|
| Transport | **stdio only** — không có HTTP, kể cả loopback |
| Protocol | JSON-RPC 2.0, newline-delimited |
| Version | `2024-11-05` |
| Method dùng | `initialize`, `notifications/initialized`, `tools/list`, `tools/call` |
| Capability khai báo | `{}` — cố ý **không** khai `sampling` hay `roots` |
| Credential | biến môi trường của process con, **không phải argv** |

Biến môi trường (quy ước của `mcp-atlassian`, chưa chốt):
`JIRA_URL`, `JIRA_USERNAME`, `JIRA_PERSONAL_TOKEN`, `CONFLUENCE_URL`, `CONFLUENCE_USERNAME`,
`CONFLUENCE_PERSONAL_TOKEN`

Process con **không** kế thừa environment của Nexa; chỉ nhận `PATH` cộng danh sách trên.

### Mong đợi nhận

`tools/list` trả mảng tool có `name`. Nexa chỉ dùng những tool có trong danh mục của mình —
tool lạ bị bỏ qua, tool trong danh mục mà server không công bố thì bị ẩn khỏi LLM.

`tools/call` trả `{ content: [{type:'text', text}], isError }`. Server được phép in log lẫn vào
stdout; dòng nào không parse được JSON thì bỏ qua.

### Danh mục tool

| Tên Nexa | Tên MCP | Risk | Feature flag |
|---|---|---|---|
| `jira.get_issue` | `jira_get_issue` | READ | `jiraRead` |
| `jira.search` | `jira_search` | READ | `jiraSearch` |
| `jira.create_issue` | `jira_create_issue` | WRITE_LOW | `jiraCreate` |
| `jira.add_comment` | `jira_add_comment` | WRITE_LOW | `jiraComment` |
| `jira.update_issue` | `jira_update_issue` | WRITE_HIGH | `jiraUpdate` |
| `confluence.get_page` | `confluence_get_page` | READ | `confluenceRead` |
| `confluence.search` | `confluence_search` | READ | `confluenceSearch` |

Đổi package MCP ⇒ sửa cột "Tên MCP" trong `tool-registry.ts` và
`DEFAULT_ATLASSIAN_MCP_SPEC` trong `server-spec.ts`. Không phải sửa chỗ nào khác.

### Ánh xạ lỗi

Server báo lỗi nghiệp vụ bằng `isError: true` + text, không phải bằng mã. `classifyToolError`
suy ra mã Nexa từ text — **đây là heuristic dựa trên chuỗi** và sẽ cần hiệu chỉnh khi có server thật.

| Text chứa | Mã Nexa |
|---|---|
| `401`, `403`, `unauthorized`, `forbidden`, `permission`, `authentication` | `ATLASSIAN_AUTH_FAILED` |
| `missing` + `credential` | `ATLASSIAN_CONFIG_REQUIRED` |
| `timeout`, `timed out` | `MCP_SERVER_UNAVAILABLE` |
| còn lại (404, lỗi validate của Jira…) | `UPSTREAM_UNAVAILABLE` — model có thể tự xử lý |

---

## 3. IPC renderer ↔ main

**Triển khai:** `packages/shared-types/src/ipc.ts`, `apps/desktop/src/main/ipc.ts`

33 channel, mỗi channel có schema Zod bắt buộc. Bảng handler có kiểu `Record<IpcChannel, …>` nên
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
  "minimumSupportedVersion": "1.0.0"
}
```

Xác minh trước khi cài: SHA-256 bắt buộc khớp. `requireSignature: true` hiện làm
`verifyPackage` **từ chối** — build chưa có cơ chế ký, và giả vờ đã kiểm tra thì nguy hiểm hơn
là từ chối. Không kết nối được máy chủ cập nhật **không** chặn việc sử dụng app.
