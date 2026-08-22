# ADR 0008 — Thêm transport HTTP remote cho MCP Atlassian, có kiểm soát

**Trạng thái:** Đề xuất (bổ sung cho ADR-0004, xem OPEN-QUESTIONS A4)
**Ngày:** 2026-08-03

## Bối cảnh

ADR-0004 chốt "chỉ stdio": Nexa tự spawn `uvx mcp-atlassian` làm process con, truyền credential
qua biến môi trường. Giả định nền là gói MCP Atlassian được cài **cục bộ** trên máy chạy Nexa.

Thực tế một tổ chức đã xác nhận hạ tầng ngược lại: họ **không** cài `mcp-atlassian` cục bộ, mà có
sẵn một **gateway MCP remote** (endpoint HTTP đứng sau LiteLLM), nhận:
- `Authorization: Bearer <api-key-litellm>` để xác thực với chính gateway
- các header `x-mcp-servers`, `x-mcp-atlassian-x-atlassian-{jira,confluence}-{url,username,
  personal-token,ssl-verify}` để gateway biết gọi Jira/Confluence nào bằng credential nào

Cấu hình này đã được xác nhận hoạt động thật (dùng trong Kilo Code). Với kiến trúc stdio-only,
Nexa không có cách nào nói chuyện với nó: `uvx` không tồn tại trên máy → mọi lần bấm "Kiểm tra
kết nối" đều trả `MCP_SERVER_UNAVAILABLE`, bất kể username/PAT nhập đúng hay sai — vì lỗi xảy ra
ở bước spawn process con, trước khi credential kịp được dùng.

ADR-0004 đã lường trước tình huống này (mục "Hệ quả", dòng cuối):

> Nếu package MCP được chốt chỉ hỗ trợ HTTP, quyết định này phải xem lại — cùng với biện pháp bù.

Đây chính là lúc đó.

## Quyết định

**Thêm** transport HTTP remote (`McpHttpClient` trong `@nexa/mcp-client`) như một lựa chọn **bổ
sung**, song song với stdio — không thay thế. `AtlassianMcpManager` nhận đúng một trong hai cấu
hình transport (`spec` cho stdio, `gateway` cho HTTP) và chọn client tương ứng; phần còn lại của
hệ thống (tool registry, ConfirmationGuard, phân loại lỗi) không biết và không cần biết bên dưới
là transport nào.

Người dùng bật transport HTTP bằng cách cấu hình một kết nối mới, loại `mcpGateway` (URL gateway +
bearer token), y hệt cách cấu hình LiteLLM/OpenAI. Có kết nối này và đang bật ⇒ Nexa gọi gateway;
không có ⇒ hành vi cũ (stdio) không đổi.

## Vì sao mối lo của ADR-0004 không áp dụng nguyên vẹn ở đây

ADR-0004 lo về việc **Nexa mở một cổng HTTP đang nghe** (localhost bind): mọi tiến trình khác
trên máy, chạy dưới cùng tài khoản người dùng, gọi được cổng đó và mượn PAT của Nexa để đọc/ghi
Jira — không có cơ chế nào phân biệt request hợp lệ với request từ phần mềm độc hại.

`McpHttpClient` **không mở cổng nào**. Nó là một HTTP **client** gọi RA NGOÀI tới một URL cấu
hình sẵn (giống hệt cách `OpenAiCompatibleClient` gọi ra LiteLLM/OpenAI, thứ Nexa đã làm từ đầu).
Không có socket nào để một tiến trình khác trên máy kết nối vào. Vì vậy nguyên văn rủi ro "tiến
trình khác gọi được cổng của Nexa" không tồn tại ở thiết kế này.

Rủi ro còn lại là khác: **rò rỉ bearer token/PAT ra khỏi tiến trình Nexa** (đĩa, log, mạng). Bốn
biện pháp bù nhắm thẳng vào đó:

1. **HTTPS bắt buộc, xác thực chứng chỉ mặc định của Node — không có cờ nào tắt được.**
   `McpHttpClient` từ chối mọi scheme khác `https:` ngay ở constructor (ngoại lệ `http://`
   loopback chỉ bật được qua `allowInsecureLoopback`, và chỉ dùng trong test — services.ts không
   bao giờ truyền cờ này, giống hệt quy ước đã có ở `ConnectionService`/`validateBaseUrl`).
   URL gateway còn đi qua `validateBaseUrl` + allowlist domain tổ chức (§11.2) trước khi tới đây,
   như mọi kết nối khác.

2. **Không bao giờ follow redirect.** `fetch(..., { redirect: 'manual' })`, và bất kỳ response
   3xx/`opaqueredirect` nào đều bị coi là lỗi, không có nhánh nào gửi lại Authorization header
   sang host khác. Một gateway bị chiếm quyền hoặc DNS bị đầu độc không thể điều hướng bearer
   token/PAT ra ngoài bằng redirect.

3. **Header dựng lại từ closure ngay trước mỗi request, không cache thành field.** Bearer token
   và PAT chỉ tồn tại trong bộ nhớ đúng khoảnh khắc gọi `fetch`. Không có child process nào giữ
   bản sao — thực ra đây là bề mặt **nhỏ hơn** stdio: transport cũ phải copy PAT vào biến môi
   trường của một process con sống suốt vòng đời phiên; transport này không có process con nào.

4. **Không log header hay body — chỉ log host/method/status/thời gian.** Registry redactor
   (`@nexa/observability`) vẫn là lớp bù thứ hai nếu một giá trị lọt vào chuỗi log tự do.

Ngoài ra: **`ssl-verify` mặc định `true`** ở chặng gateway → Jira/Confluence thật
(`buildGatewayHeaders`, `@nexa/atlassian-mcp-manager`). Cấu hình mẫu đã xác nhận hoạt động (Kilo
Code) đặt giá trị này là `false` — Nexa **không** lấy đó làm mặc định: tắt xác thực TLS ở chặng đó
mở đường cho MITM trên mạng nội bộ đọc trộm PAT.

### Sửa đổi 2026-08-03 — thêm một đường thoát opt-in, mặc định tắt

Bản đầu của ADR này nói `ssl-verify` **LUÔN** là `true`, "không có cách nào tắt". Lần chạy thật
đầu tiên cho thấy lập trường đó biến Nexa thành không dùng được ở đúng hạ tầng nó nhắm tới, nên
đoạn trên đã được sửa. Diễn biến:

Jira/Confluence của tổ chức (`itpm.abbank.vn`, `tdcconfluence.abbank.vn`) dùng chứng chỉ ký bởi CA
nội bộ mà container `mcp-atlassian` phía gateway không tin cậy. TLS handshake ở chặng gateway →
Jira thất bại ⇒ `mcp-atlassian` không gọi được `/rest/api/2/myself` ⇒ nó báo về:

> `Invalid header-based Jira token or configuration: Unable to get current user account ID:`

Câu này **không hề nói tới chứng chỉ** — nó nói về token. Hệ quả: mọi tool Jira/Confluence đều lỗi
(lỗi phát sinh ở bước dựng client từ header, trước khi tool chạy), và `classifyToolError` xếp nó
vào `UPSTREAM_UNAVAILABLE` → UI khuyên người dùng "kiểm tra kết nối mạng nội bộ", sai hướng hoàn
toàn. Cả hai điều đó đã được sửa: heuristic giờ nhận ra mẫu này là `ATLASSIAN_AUTH_FAILED`, và
`mcp-tool-error-detail` ghi lại nguyên văn text lỗi (qua Redactor) để lần sau không phải mò.

**Quyết định:** thêm `mcpGatewaySkipAtlassianTlsVerify` vào `appSettingsSchema` — mặc định
`false`, chỉ bật được bằng cách người dùng tự tích vào Settings → MCP Gateway. Không biến môi
trường, không policy file. Mỗi lần MCP khởi chạy với cờ bật ghi một security event
`atlassian-tls-verify-skipped` kèm host, để ATTT grep ra được máy nào đang chạy như vậy.

**Vì sao đảo lập trường.** Lập luận ban đầu ngầm cho rằng Nexa sẽ *tạo ra* một rủi ro mới. Thực tế
không phải: mọi người ở tổ chức đó đang dùng Kilo Code với `ssl-verify: false` trên đúng chặng đó,
nên rủi ro đã tồn tại sẵn trong hiện trạng. Bốn biện pháp bù ở trên vẫn nguyên vẹn, và cờ này
**không** chạm tới chặng Nexa → gateway — chặng đó vẫn HTTPS xác thực chứng chỉ, vẫn không có cờ
nào tắt được (`McpHttpClient`). Cái ADR này giữ lại là điều thực sự quan trọng: mặc định an toàn,
và việc hạ chuẩn phải tường minh, có người bấm, và có dấu vết trong log.

**Cách sửa đúng vẫn không đổi:** cài CA nội bộ vào container gateway
(`REQUESTS_CA_BUNDLE`/`SSL_CERT_FILE`) rồi tắt cờ này. Cờ này là cách để dùng được trong lúc chờ,
không phải đích đến.

## Hệ quả

- Data model: thêm `ConnectionType = 'mcpGateway'`, migration v3 (`packages/local-store`) mở
  `CHECK` constraint của bảng `connections`. Không cần username (xác thực bằng một bearer token
  duy nhất, giống LLM provider) — `requiresUsername()` tách riêng khỏi `isLlmConnection()` để
  không vô tình bắt nhập username cho loại kết nối này.
- `AtlassianMcpManagerOptions.spec` (stdio) trở thành optional; thêm `gateway` optional. Đúng một
  trong hai phải có — thiếu cả hai ném `MCP_SERVER_UNAVAILABLE` ngay lần `start()` đầu, không
  phải lỗi mơ hồ lúc dựng object.
- `packages/atlassian-mcp-manager/src/server-spec.ts` có thêm bảng `GATEWAY_HEADER_KEYS` —
  **chưa chốt chung**, y hệt tình trạng `CREDENTIAL_ENV_KEYS` cho stdio: đây là quy ước của MỘT
  gateway cụ thể đã xác nhận hoạt động, không phải chuẩn MCP. Gateway tổ chức khác dùng tên
  header khác thì sửa đúng bảng này.
- ADR-0004 vẫn đúng cho trường hợp mặc định (package cài cục bộ) — ADR này bổ sung, không thay
  thế nó. Nếu sau này tổ chức chốt CHỈ dùng gateway remote, có thể cân nhắc bỏ hẳn nhánh stdio;
  hiện giữ cả hai vì cả hai đều có tổ chức thật đang cần.
