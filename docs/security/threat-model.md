# Threat model — Nexa MVP

Nguồn: §11.3 của tài liệu thiết kế. Mỗi mối đe doạ ở đây có **biện pháp cụ thể trong mã** và
**test khẳng định biện pháp đó còn hiệu lực**. Cột "Test" là hợp đồng: gỡ test đi là gỡ luôn
bằng chứng rằng biện pháp còn đúng.

Cập nhật: 2026-08-01 · Trạng thái: **chưa có pentest độc lập** (TASKLIST T-11-15)

## Ranh giới tin cậy

```
┌─ Renderer (React) ─────── KHÔNG tin ────────────────────────────┐
│  Không Node, không file system, không mạng, không secret.       │
│  Coi như có thể bị chèn mã bất cứ lúc nào.                      │
└──────────────────── preload bridge (2 KB, allowlist) ───────────┘
                                 │ IPC + Zod validation
┌─ Main process ─────────── tin cậy ──────────────────────────────┐
│  Secret sống ở đây. Mọi lời gọi mạng xuất phát từ đây.          │
└─────────┬───────────────────────────┬───────────────────────────┘
          │ HTTPS + Bearer            │ stdio + env
     ┌────▼─────┐                ┌────▼──────────────┐
     │ LiteLLM  │                │ MCP Atlassian     │ ── KHÔNG tin output
     └──────────┘                │ (process con)     │
                                 └───────────────────┘
```

Ba nguồn dữ liệu **không được tin**: đầu vào từ renderer, output của LLM, và kết quả trả về
từ MCP server.

## Bảng mối đe doạ (§11.3)

| # | Mối đe doạ | Biện pháp trong mã | Test |
|---|---|---|---|
| T1 | Người dùng khác đọc lịch sử trên cùng máy | AES-256-GCM từng trường; master key bọc DPAPI CurrentUser; AAD gắn cột | `local-store.test.ts` → đọc thẳng file `.db`, khẳng định không có plaintext |
| T2 | Renderer bị XSS và đọc token | `contextIsolation` + `sandbox` + `nodeIntegration:false`; CSP `connect-src 'none'`; preload chỉ expose 2 hàm với allowlist channel; secret không bao giờ đi ra renderer | `main.test.ts`; eslint chặn import; alias bundler chặn build |
| T3 | Tool call bị thay đổi sau xác nhận | Approval gắn `payload_hash`, kiểm tra lại tại `consume()` trên payload thật sắp gửi | `agent-runtime.test.ts` §17.2-3, 3b |
| T4 | Gọi tool vượt quyền | Allowlist ba tầng (registry Nexa ∧ feature flag ∧ server công bố); DESTRUCTIVE chặn bằng code; quyền cuối do PAT quyết định | `mcp.test.ts` → "tool allowlist" |
| T5 | Gửi file ngoài ý muốn | Chỉ qua file picker; đường dẫn không rời main; preview lượng nội dung; allowlist model | `main.test.ts` → FileBroker; `agent-runtime.test.ts` → document policy |
| T6 | Lộ dữ liệu qua log | Redactor ba lớp (tên trường, giá trị đã đăng ký, pattern); không có đường ghi sink bỏ qua redaction | `observability.test.ts` (44 test); `agent-runtime.test.ts` §17.2-7 |
| T7 | Bản cập nhật giả mạo | HTTPS + allowlist domain; xác minh SHA-256; **từ chối** khi manifest đòi chữ ký mà build chưa ký | `main.test.ts` → UpdateService |
| T8 | Double-submit tạo trùng Jira | Ba lớp: UI khoá nút, guard tiêu approval một lần, unique index `idx_tool_calls_operation` | `agent-runtime.test.ts` §17.2-4; `local-store.test.ts` |

## Mối đe doạ bổ sung — không có trong §11.3

| # | Mối đe doạ | Biện pháp | Test |
|---|---|---|---|
| T9 | URL độc hại làm PAT bay sang host của kẻ tấn công (SSRF) | `validateBaseUrl`: chỉ HTTPS, chặn credential nhúng, chặn query/fragment; `joinUrl` từ chối URL tuyệt đối | `security.test.ts` → validateBaseUrl, joinUrl |
| T10 | MCP server trả link lừa đảo, người dùng bấm vào | `sanitizeExternalUrl` chỉ nhận link cùng host với hệ thống đã cấu hình | `security.test.ts` → sanitizeExternalUrl |
| T11 | Tiến trình khác trên máy đọc PAT qua `ps` | Credential đi qua environment của process con, **không** qua argv | `mcp.test.ts` → credential handling |
| T12 | Prompt injection giấu trong tài liệu | `normalizeText` loại ký tự điều khiển và ký tự vô hình (zero-width, bidi override) trước khi đưa vào prompt | `document-processor.test.ts` → normalizeText |
| T13 | Electron rơi xuống backend mã hoá giả trên Linux | `SafeStorageBackend.productionGrade` trả false khi backend là `basic_text` | `security.test.ts` → basic_text guard |
| T14 | Cài đè bản Nexa cũ lên dữ liệu mới làm hỏng schema | Migration từ chối khi `schemaVersion` trên đĩa mới hơn app | `local-store.test.ts` → migration |
| T15 | Ciphertext bị chuyển từ cột này sang cột khác | AAD = `version:table.column` | `security.test.ts`, `local-store.test.ts` |

## Trường CẤM ghi log (T-03-2)

Danh sách này được thực thi bằng mã trong `packages/observability/src/redaction.ts`, không phải
bằng quy ước.

**Secret — thay bằng `[REDACTED]`**
`apiKey`, `api_key`, `key`, `secret`, `token`, `accessToken`, `refreshToken`, `personalToken`,
`personalAccessToken`, `pat`, `password`, `authorization`, `auth`, `credential`, `cookie`,
`sessionId`, `privateKey`, `masterKey`, `litellmApiKey`, `jiraPat`, `confluencePat`

**Nội dung nghiệp vụ — thay bằng `[CONTENT_REDACTED]:<độ dài>`**
`content`, `text`, `body`, `prompt`, `message(s)`, `delta`, `completion`, `choices`,
`extractedText`, `payload`, `arguments`, `input`, `output`, `result`, `description`, `summary`,
`title`, `comment`, `fields`, `query`

**Pattern nhận dạng ngay cả khi chưa đăng ký**
URL có credential nhúng · `Bearer <token>` · JWT · `sk-*` · chuỗi opaque ≥ 40 ký tự

**ĐƯỢC ghi** (§15.2 cần chúng để đối chiếu): `request_id`, `operation_id`, `error_code`,
tên tool, risk level, approval status, `durationMs`, số lượng và độ dài, tên host (không kèm
đường dẫn), mã phiên bản.

## Giả định bảo mật

Những điều dưới đây được **giả định đúng**. Nếu một giả định sai, mô hình này không còn giá trị.

1. **Tài khoản Windows của người dùng chưa bị chiếm.** DPAPI CurrentUser bảo vệ theo tài khoản;
   kẻ tấn công chạy được mã dưới tài khoản đó thì đọc được mọi thứ Nexa đọc được.
2. **Máy không bị cài keylogger / infostealer.** Nexa không chống được malware ở tầng OS.
3. **LiteLLM và Atlassian là hệ thống đáng tin.** Nexa gửi nội dung cho chúng theo đúng thiết kế.
4. **Người dùng đọc màn hình xác nhận.** Toàn bộ cơ chế user-in-the-loop dựa vào giả định này.
   Đây là mắt xích yếu nhất và không có biện pháp kỹ thuật nào thay thế được.

## Chưa được xử lý

| Vấn đề | Vì sao chưa | Tham chiếu |
|---|---|---|
| Chưa ký số bộ cài | Chưa có certificate | OPEN-QUESTIONS C3, TASKLIST T-02-5 |
| Chưa có pentest độc lập | Cần đội ATTT | TASKLIST T-11-15 |
| Metadata vẫn lộ dù nội dung đã mã hoá (số lượng, thời điểm, độ dài) | Hệ quả của per-field encryption | ADR 0002 |
| PAT Jira và Confluence chung một tiến trình MCP | Package MCP nhận cả hai cùng lúc | OPEN-QUESTIONS E3 |
| Chưa có app-level password | §8.2 chỉ yêu cầu DPAPI | OPEN-QUESTIONS B1 |
| Allowlist domain mặc định rỗng | Fail-open có chủ ý; đề nghị ATTT bắt buộc điền | OPEN-QUESTIONS D2 |
