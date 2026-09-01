# Nexa — Câu hỏi & thắc mắc cần bạn review

> File này ghi lại **mọi chỗ tôi phải tự quyết định** vì tài liệu chưa nói rõ, hoặc vì cần thông tin
> từ bên ngoài (admin LiteLLM, admin Atlassian, ATTT).
> Mỗi mục có: câu hỏi → **giả định tôi đã dùng để code** → chỗ cần sửa nếu bạn quyết khác.
>
> Cập nhật lần cuối: 2026-08-30 (bộ luật kiểm tài liệu BA và hợp đồng ảnh nội bộ — mục I)

## Cách đọc

| Nhãn          | Ý nghĩa                                                     |
| ------------- | ----------------------------------------------------------- |
| 🔴 BLOCKER    | Phải có câu trả lời trước khi chạy thật với hệ thống nội bộ |
| 🟠 QUAN TRỌNG | Code chạy được, nhưng quyết định khác sẽ phải sửa đáng kể   |
| 🟡 NHỎ        | Dễ đổi, chỉ cần chỉnh config                                |

---

## A. Quyết định §22.2 — tôi đã tự chốt để code tiếp

### A1. 🔴 LiteLLM: base URL, định dạng key, endpoint kiểm tra key

**Câu hỏi:** Base URL nội bộ là gì? Key có prefix cố định (`sk-...`) không? `GET /v1/models` có
được bật không? Quy trình rotate/revoke ra sao?

**Giả định đã dùng:**

- Giao thức OpenAI-compatible: `POST /v1/chat/completions`, `GET /v1/models`.
- Auth: header `Authorization: Bearer <key>`.
- Không validate format key ở client (chỉ kiểm tra không rỗng) — vì chưa biết quy ước.
- Test kết nối gọi `GET /v1/models`; nếu trả 404/405 thì fallback sang một
  `chat/completions` với `max_tokens: 1` để xác thực key.

**Sửa ở đâu nếu khác:** `packages/llm-client/src/litellm-client.ts` (hàm `testConnection`).

---

### A2. 🔴 Local encryption: SQLCipher hay AES-GCM per-field?

**Câu hỏi:** ATTT chọn phương án nào?

**Giả định đã dùng: AES-256-GCM mã hóa từng trường.**

Lý do tôi chọn phương án này:

- SQLCipher cần build native riêng cho ABI của Electron → tăng rủi ro CI/CD và packaging đáng kể.
- §8.2 yêu cầu _"mỗi bản ghi hoặc nhóm bản ghi cần nonce/IV riêng; lưu authentication tag"_ —
  đây chính xác là mô tả của per-field AEAD, không phải của SQLCipher (SQLCipher mã hóa cả page).
- Per-field cho phép để `created_at`, `role`, `status` ở dạng rõ → vẫn index/sort/query được.

**Đánh đổi bạn cần biết:** metadata (tiêu đề hội thoại? tên file?) sẽ lộ nếu để plaintext.
Hiện tại tôi **mã hóa cả `conversations.title`** và tên file đính kèm. Xem A9 về hệ quả với search.

**Sửa ở đâu nếu khác:** `packages/security/src/crypto.ts` + interface `FieldCipher` trong `packages/local-store/src/store.ts`.

---

### A3. 🔴 Atlassian PAT: 1 hay 2? Scope nào? Cùng domain không?

**Câu hỏi:** Jira và Confluence có dùng chung tài khoản/PAT không? PAT cần scope gì tối thiểu?

**Giả định đã dùng: 2 connection tách biệt, 2 PAT riêng.**

- Theo khuyến nghị §22.3 _"Cấu hình Jira và Confluence tách biệt"_.
- Nếu tổ chức dùng chung 1 PAT thì người dùng chỉ cần nhập cùng giá trị 2 lần — không sai, chỉ hơi
  bất tiện. Nếu muốn gộp, cần thêm UI "dùng chung credential với Jira".

**Chưa làm được:** không validate scope của PAT vì Atlassian Server/DC PAT **không expose scope**
qua API. Nexa chỉ phát hiện thiếu quyền khi hệ thống đích trả 403 → map thành `ATLASSIAN_AUTH_FAILED`.

---

### A4. 🔴 MCP Atlassian package nào? Đóng gói kèm hay yêu cầu cài sẵn?

**Đây là câu hỏi tôi KHÔNG trả lời được và nó ảnh hưởng lớn nhất tới EPIC-07.**

Tài liệu §4.2 nói "MCP stdio hoặc localhost bind loopback", §6 nói "chạy cục bộ hoặc do Nexa quản lý".
Nhưng không nêu tên package cụ thể, cũng không nói MCP server đó **nhận credential bằng cách nào**
(env var? CLI arg? file config? initialize params?).

**Giả định đã dùng:**

- Transport: **stdio** (an toàn hơn localhost HTTP — không mở port nào).
- Credential truyền qua **environment variable** của child process
  (`JIRA_URL`, `JIRA_USERNAME`, `JIRA_PERSONAL_TOKEN`, `CONFLUENCE_*`) — đây là quy ước của
  `mcp-atlassian` (package Python phổ biến nhất) và cũng là cách kín nhất: không nằm trên
  command line nên không hiện trong `ps`.
- Command mặc định cấu hình được, mặc định `uvx mcp-atlassian` — **chưa cài, chưa test thật**.
- Tôi đã viết `packages/atlassian-mcp-manager` với một `McpServerSpec` có thể thay hoàn toàn bằng
  config, để đổi package không phải sửa code.

**Cập nhật 2026-08-03:** một tổ chức đã xác nhận hạ tầng THẬT của họ đi ngược hoàn toàn giả định
trên — không cài `mcp-atlassian` cục bộ, mà có sẵn một **gateway MCP remote** (HTTP, đứng sau
LiteLLM) nhận bearer token + header `x-mcp-atlassian-x-atlassian-*`. Với kiến trúc lúc đó chỉ có stdio,
mọi lần "Kiểm tra kết nối" đều báo `MCP_SERVER_UNAVAILABLE` vì Nexa cố spawn `uvx` — thứ không hề
tồn tại trên máy — trước khi credential kịp được dùng.

Đã thêm [ADR-0008](architecture/adr/0008-controlled-http-mcp-transport.md): một transport HTTP
remote bổ sung (`McpHttpClient`), chọn bằng cách cấu hình kết nối `mcpGateway` (URL + bearer
token). Không thay thế stdio — cả hai cùng tồn tại, chọn theo cấu hình đang có. Câu hỏi A4 vẫn
còn 🔴 cho nhánh stdio (package Python cụ thể vẫn chưa cài/test thật); nhánh HTTP thì quy ước
header (`GATEWAY_HEADER_KEYS`) cũng chưa chốt chung — chỉ xác nhận đúng với MỘT gateway cụ thể.

**Cập nhật 2026-08-03 (lần chạy thật đầu tiên qua gateway) — ba điều đã được XÁC NHẬN, không còn
là phỏng đoán:**

1. **Quy ước `GATEWAY_HEADER_KEYS` là đúng.** Gateway trả lỗi `"Invalid header-based Jira token or
configuration"` — chính chữ "header-based" chứng minh `mcp-atlassian` đã NHẬN được bộ header
   credential Nexa gửi. Trước đây đây chỉ là quy ước sao chép từ một cấu hình Kilo Code.
2. **Gateway đặt lại tên tool bằng tiền tố `atlassian-`.** Log ghi
   `serverToolName: "atlassian-jira_search"`. Cơ chế khớp hậu tố trong `resolveServerToolName`
   (ADR-0005) hoạt động đúng với server thật.
3. **`initialize` / `tools/list` / `tools/call` đều 200.** Gateway công bố 98 tool. Chặng Nexa →
   gateway không còn là ẩn số; phần chưa xong là chặng gateway → Jira.

**Nguyên nhân đã tìm ra: TLS, không phải credential.** Nguyên văn lỗi là
`Invalid header-based Jira token or configuration: Unable to get current user account ID:`
(dấu hai chấm cuối không có gì theo sau — exception bên trong có message rỗng). Câu này nói về
_token_, nhưng thủ phạm là chứng chỉ: `itpm.abbank.vn` dùng chứng chỉ ký bởi CA nội bộ mà container
`mcp-atlassian` phía gateway không tin ⇒ TLS handshake ở chặng gateway → Jira thất bại ⇒ không gọi
được `/rest/api/2/myself` ⇒ `mcp-atlassian` gói lại thành một câu về token.

Chốt được nhờ so với cấu hình Kilo Code đang chạy thật trên cùng gateway: **khác đúng một giá trị**
là `ssl-verify` (`false` bên Kilo, Nexa ép `true`). Hai suy đoán ban đầu đều SAI và đã bị loại —
username không phải nguyên nhân (Kilo cũng gửi header username), và "account ID" không có nghĩa là
nó đang gọi Cloud API (`mcp-atlassian` dùng `/rest/api/2/myself` cho cả Cloud lẫn Server/DC).

**Ba thứ đã sửa:**

1. `classifyToolError` xếp text này vào `ATLASSIAN_AUTH_FAILED` thay vì `UPSTREAM_UNAVAILABLE`.
   Text không chứa mã HTTP nào cũng không chứa từ "authentication", nên cả 5 mẫu heuristic ban đầu
   đều bỏ sót và UI hiện "Kiểm tra kết nối mạng nội bộ" — sai hướng, vì mạng vẫn tốt.
2. Log `mcp-tool-error-detail` (text đã qua Redactor, cắt 300 ký tự). Thiếu nó là lý do sự cố này
   mất nhiều lượt mới chẩn đoán được: đúng trường hợp §22.1 lường trước, và chỉ lộ ra với server
   thật.
3. `mcpGatewaySkipAtlassianTlsVerify` — opt-in, mặc định TẮT, chỉ bật được trong Settings → MCP
   Gateway, kèm security event `atlassian-tls-verify-skipped`. Xem phần "Sửa đổi 2026-08-03" trong
   [ADR-0008](architecture/adr/0008-controlled-http-mcp-transport.md).

**Cách sửa đúng (vẫn cần làm):** đội hạ tầng cài CA nội bộ ABBANK vào container `mcp-atlassian`
(`REQUESTS_CA_BUNDLE`/`SSL_CERT_FILE`) rồi tắt cờ ở mục 3. Cờ đó là cách dùng được trong lúc chờ,
không phải đích đến.

**Việc cần bạn làm:** chốt package → tôi (hoặc dev) chỉnh `DEFAULT_ATLASSIAN_MCP_SPEC` và chạy
contract test thật. Hiện contract test đang chạy với **mock MCP server tự viết**
(`tests/fixtures/mock-mcp-server.mjs`), đúng protocol JSON-RPC nhưng không phải server thật.

---

### A5. 🟠 Model data policy — model nào được nhận tài liệu nội bộ?

**Giả định đã dùng:** cơ chế allowlist đã code sẵn (`settings.documentAllowedModels`), **mặc định
rỗng = cho phép tất cả model đã cấu hình**, và UI hiện cảnh báo trước khi gửi file.

Đây là **fail-open**, ngược với nguyên tắc §3 "Fail closed". Tôi chọn fail-open vì nếu để rỗng =
cấm hết thì tính năng file sẽ chết ngay khi cài mà chưa ai cấu hình. **ATTT cần chốt:** có muốn
đổi thành fail-closed (bắt buộc admin khai báo model trước khi dùng file) không?

**Sửa ở đâu:** `packages/agent-runtime/src/document-policy.ts`.

---

### A6. 🟡 Confluence write có trong MVP không?

**Giả định:** **không** — theo đúng khuyến nghị §22.3 và Phụ lục A (`confluenceWrite: false`).
Code đã có feature flag, bật lên là chạy, nhưng chưa có tool write nào cho Confluence được đăng ký.

---

### A7. 🟡 Retention mặc định?

**Giả định:** `historyRetentionDays: 180`, `logRetentionDays: 14` theo Phụ lục A.
Có UI cho người dùng đổi 30/90/180/không giới hạn, và có toggle "không lưu lịch sử".

**Câu hỏi còn lại:** người dùng có được phép **tắt lưu lịch sử** không, hay ATTT muốn ép lưu để
truy vết? Hiện tôi cho phép tắt.

---

### A8. 🟠 Update channel: auto-update hay IT phân phối?

**Giả định:** code cả hai. `electron-builder` sinh NSIS + MSI; có `UpdateService` kiểm tra version
manifest, xác minh chữ ký/checksum trước khi cài; **mặc định tắt** (`features.autoUpdate: false`)
để IT phân phối tập trung.

**Chưa làm được:** chưa có update server thật, chưa có certificate ký số → phần verify signature
hiện chỉ kiểm tra SHA-256 checksum. Xem C3.

---

### A9. 🔴 Search hội thoại khi nội dung đã mã hóa — **đây là vấn đề thiết kế thật**

Tài liệu yêu cầu search (§2.1, EPIC-05) nhưng §8.1 lưu `content_ciphertext`. Không thể `LIKE` trên
ciphertext.

**Giả định đã dùng: giải mã + quét trong bộ nhớ (decrypt-and-scan), có giới hạn.**

- Search chạy trong main process, đọc theo từng lô (batch 200 message), giải mã, so khớp, huỷ buffer.
- Có giới hạn cứng: dừng sau 2000 message hoặc 3 giây, trả về cờ `truncated: true` để UI báo
  "kết quả chưa đầy đủ".

**Đo được:** với 100 hội thoại × ~40 message (~4.000 message) mất ~180 ms trên máy dev.
Chấp nhận được ở quy mô MVP, **sẽ không scale** nếu người dùng tích luỹ 50.000+ message.

**Ba phương án thay thế nếu bạn muốn scale:**

1. Bảng `messages_fts` FTS5 lưu **plaintext** → nhanh nhưng phá vỡ tiêu chí §21
   _"nội dung không đọc được bằng công cụ SQLite thông thường"_. **Tôi không chọn.**
2. Blind index: lưu `HMAC(master_key, token)` cho từng từ → search exact-word được, không
   search substring/tiếng Việt có dấu tốt. Lộ pattern tần suất từ.
3. Giữ decrypt-and-scan nhưng cache chỉ mục giải mã trong RAM khi app đang mở. **✅ Đã làm
   2026-08-30**, bạn chọn phương án này.

**✅ ĐÃ LÀM 2026-08-30: RAM cache cho decrypt-and-scan (phương án 3).**
`ConversationSearch` (`packages/local-store/src/search.ts`) giờ giữ một `Map<messageId,
{ciphertext, plaintext}>` trong bộ nhớ tiến trình. Mỗi lần quét một message: nếu đã có trong
cache **và** ciphertext trùng khớp với bản ghi hiện tại thì dùng thẳng plaintext, bỏ qua AES
decrypt; ngược lại giải mã rồi lưu lại. So sánh ciphertext (thay vì hook vào `editMessage`/
`deleteMessage`) khiến cache **tự phát hiện** message đã sửa/xoá — ciphertext đổi ⇒ cache miss ⇒
giải mã lại giá trị mới, không cần đồng bộ hai nơi. Trần `MAX_CACHE_ENTRIES = 50_000` entry để
không phình vô hạn qua một phiên làm việc dài; chạm trần thì xoá sạch cache và dựng lại dần (chỉ
ảnh hưởng hiệu năng, không ảnh hưởng tính đúng đắn). `ConversationSearch.clear()` được gọi trong
`data:purge` (`apps/desktop/src/main/ipc.ts`) để không giữ plaintext của dữ liệu vừa xoá trong RAM
lâu hơn cần thiết.

**Chưa giải quyết tận gốc:** đây chỉ là cache hiệu năng cho các lần search *lặp lại* trên cùng
lịch sử — lần search đầu tiên trên một tập message chưa từng quét vẫn phải giải mã toàn bộ, nên
**không thay đổi trần `maxMessagesScanned`/`budgetMs`** và không giúp gì cho lần search đầu tiên
sau khi mở app. Nếu cần scale thật sự cho lần search đầu (ví dụ >50.000 message ngay từ đầu),
vẫn cần phương án 1 hoặc 2 ở trên.

Test: `packages/local-store/src/local-store.test.ts` (`describe('search on encrypted content')`)
— khẳng định cache hit bỏ qua decrypt, cache tự vô hiệu khi sửa/xoá message, và `clear()` dọn sạch.

---

### A10. 🟡 Đánh giá Tauri?

Không làm. Dùng Electron theo §22.3.

**Lưu ý:** app và E2E Electron đã chạy thật trên Linux, nhưng RAM theo mục tiêu §12.1 vẫn phải đo
trên máy Windows pilot vì backend secure storage và đặc tính đóng gói khác môi trường dev.

---

## B. Chỗ tài liệu chưa đủ để code — tôi đã tự thiết kế

### B1. 🟠 Cơ chế unlock DB — có app-level password không?

§8.2 nói master key bọc bằng DPAPI (gắn tài khoản Windows). Nhưng §11.3 nhắc _"khóa ứng dụng"_ và
§16 nhắc _"DB unlock failure"_ — hai chỗ này ngụ ý có mật khẩu riêng.

**Giả định đã dùng: KHÔNG có app password.** Master key được `safeStorage` bảo vệ, mở tự động theo
tài khoản Windows đang đăng nhập. `DB unlock failure` = trường hợp safeStorage không giải mã được
(profile Windows đổi, key hỏng, DB copy sang máy khác) → vào chế độ chẩn đoán, **không ghi đè**.

Nếu bạn muốn thêm app password, chỗ sửa là `packages/security/src/master-key.ts` — cần thêm một lớp
KDF (Argon2id) bọc ngoài. Không nhỏ.

---

### B2. 🟠 Context window management — cắt hay tóm tắt?

§7.2 chỉ nói _"cắt đoạn hoặc rút gọn nội dung theo context limit"_, không định nghĩa chiến lược khi
**hội thoại** dài (khác với file dài).

**Giả định đã dùng:** sliding window — luôn giữ system prompt + N message gần nhất vừa trong budget
token, message cũ bị **bỏ** (không tóm tắt). UI hiện chỉ báo "đã lược bỏ X tin nhắn cũ".

**Cập nhật 2026-08-26:** đã có long-term memory do người dùng tự xác nhận. Memory không thay thế
sliding window và không tóm tắt hội thoại: tối đa 50 fact mới nhất, dùng tối đa 10% budget context,
được chèn sau system prompt. Fact có scope `conversation` chỉ đi vào đúng hội thoại; fact hết hạn
hoặc archived không được dùng. Mặc định fact là `internal_only`; chỉ fact được đánh dấu
`allow_external` mới được gửi khi dùng provider ngoài tổ chức. Người dùng quản lý toàn bộ tại
**Cài đặt → Nexa nhớ**; Nexa không tự động lưu fact từ hội thoại.

Không tóm tắt vì tóm tắt = thêm một lần gọi LLM ⇒ thêm chi phí, thêm độ trễ, thêm rủi ro rò rỉ nội
dung sang model. Nếu bạn muốn có tóm tắt, đó là scope thêm.

**Ước lượng token:** dùng heuristic ~4 ký tự/token (không có tokenizer thật vì không biết model
nào phía sau LiteLLM). Sai số có thể ±25% với tiếng Việt. **Đây là rủi ro:** có thể bị lỗi
context-length-exceeded. Tôi để `contextSafetyMargin: 0.8` để bù.

---

### B3. 🟠 Agent Runtime tool-calling loop — chưa được đặc tả

§5.2 nói Agent Runtime _"quyết định gọi model/tool"_ nhưng không nói: bao nhiêu vòng tối đa? tool
call song song? xử lý lỗi tool ra sao?

**Giả định đã dùng:**

- Tối đa **5 vòng** tool-calling mỗi lượt (`maxToolIterations`). Vượt → dừng, báo lỗi rõ.
- Tool call **tuần tự**, không song song — để confirmation dialog không chồng nhau.
- Tool lỗi → trả nội dung lỗi lại cho model như một tool result (model có thể tự xử lý), **trừ**
  lỗi auth/config → dừng hẳn (fail closed §3).
- Trong một lượt, tối đa **1 tool write**. Nhiều write trong một lượt bị chặn — người dùng phải
  xác nhận từng cái ở lượt riêng. Đây là quyết định thiên về an toàn, có thể gây khó chịu.

---

### B4. 🟠 "Preview" của tool write hiển thị gì khi chưa gọi API?

§10.2 yêu cầu preview hiện _"trường hoặc đối tượng sẽ bị thay đổi"_. Với `create_issue` thì dễ —
hiện payload. Nhưng với `update_issue` thì để hiện "giá trị cũ → giá trị mới" cần **đọc trước**
đối tượng đích.

**Giả định đã dùng:** với tool WRITE_HIGH có `previewFetcher`, Confirmation Guard gọi tool READ
tương ứng trước để lấy giá trị hiện tại và hiện diff. Với `jira_update_issue` tôi gọi
`jira_get_issue` trước.

**Hệ quả bạn cần biết:** preview tốn thêm 1 API call, và giá trị có thể đổi giữa lúc preview và lúc
execute (TOCTOU). Tôi **không** khoá đối tượng — chỉ hiện cảnh báo. Nếu nghiệp vụ cần chặt hơn thì
phải dùng optimistic locking bằng version field của Jira, mà Jira Server không expose nhất quán.

---

### B5. 🟡 `profiles.windows_sid` trên môi trường không phải Windows

§8.1 định nghĩa `windows_sid`. Dev trên Linux/macOS không có SID.

**Giả định:** trường đổi tên thành `os_account_id`, trên Windows lưu SID, nơi khác lưu
`${platform}:${uid}`. Vẫn giữ ý nghĩa "một profile theo tài khoản OS".

---

### B6. 🟡 `local_audit` vs `tool_calls` chồng nhau

§8.1 có cả hai. Tôi dùng: `tool_calls` = lifecycle nghiệp vụ của tool (preview, approval, result),
`local_audit` = sự kiện hệ thống (credential save/delete, connection test, DB unlock fail, update).
Không ghi trùng.

---

### B7. 🟠 Chuẩn hoá payload để tính `payload_hash` — cần deterministic tuyệt đối

§10.3 nói `payload_hash = sha256(tool_name + normalized_payload)` nhưng không định nghĩa
"normalized".

**Giả định đã dùng:** JSON canonical form — sort key đệ quy, không khoảng trắng, `undefined` bị
loại, số theo `JSON.stringify` mặc định, chuỗi giữ nguyên (**không** normalize Unicode — nếu
normalize NFC thì "xác nhận payload y hệt" sẽ bị hiểu khác đi khi người dùng gõ tiếng Việt tổ hợp).

Đã có unit test khẳng định thứ tự key không ảnh hưởng hash.

---

### B8. 🟡 Approval TTL bao lâu?

§10.2 chỉ nói "thời hạn ngắn". **Giả định: 120 giây.** Đủ để người dùng đọc preview, đủ ngắn để
không bị lợi dụng. Cấu hình được qua `settings.approvalTtlSeconds`.

---

### B9. 🟠 `TOOL_EXECUTION_UNCERTAIN` — Nexa tra cứu hộ hay để người dùng tự tra?

§16 nói _"tra cứu object/result trước khi cho phép retry"_ nhưng không nói ai tra.

**Giả định đã dùng:** Nexa tra hộ. Khi write timeout, `OperationTracker` giữ trạng thái `uncertain`
và cung cấp nút "Kiểm tra kết quả" → gọi tool READ với tiêu chí khớp (ví dụ JQL tìm issue có
summary + reporter + created trong 5 phút). Nếu tìm thấy → đánh dấu `success` và hiện link. Nếu
không → cho phép retry.

**Điểm yếu:** heuristic khớp theo summary có thể sai nếu người dùng tạo 2 issue giống hệt nhau.
Tôi yêu cầu xác nhận thủ công khi tìm được nhiều hơn 1 kết quả.

---

### B10. 🟡 Streaming: LiteLLM có hỗ trợ tool call trong stream không?

Chưa test được với LiteLLM thật. Code đã xử lý cả hai: tool call trong SSE delta (ghép dần
`tool_calls[].function.arguments`) và tool call trong response non-stream. Nếu LiteLLM behave khác,
chỗ sửa là `packages/llm-client/src/sse-parser.ts`.

---

## C. Việc tôi KHÔNG làm được trong môi trường này

### C1. 🟠 Đã chạy thử trên Linux + có E2E; xác minh DPAPI chuyển sang CI Windows

**Cập nhật:** môi trường có sẵn X11, nên tôi ĐÃ chạy được app thật. Kết quả:

```
app-starting
master-key-created        (safeStorage thật: gnome_libsecret)
local-db-opened           driver=node:sqlite
migration-applied         version=1
profile-created
ipc-registered            channelCount=35
window-ready              durationMs=304
```

Nghĩa là đường đi qua `safeStorage` **đã được kiểm chứng** — nhưng trên keyring của Linux, không
phải DPAPI của Windows.

**Cập nhật lần 2:** đã bổ sung 17 test E2E bằng Playwright: 15 ca chạy Electron thật trên Linux
và 2 ca Windows-only — bao phủ cấu hình LiteLLM, chat streaming, trạng thái request chậm theo đúng
hội thoại, xác nhận tool write, lịch sử qua khởi động lại, điều hướng bàn phím, credential và CSP.

Và `tests/e2e/windows-secure-storage.e2e.ts` xác minh DPAPI, chạy trong job CI `verify-windows`
trên `windows-latest` — **không cần máy Windows vật lý** cho phần lớn việc này.

Việc còn lại **bắt buộc phải làm bằng tay trên Windows**:

1. Xác nhận credential **KHÔNG** mở được từ tài khoản Windows khác. CI chỉ có một tài khoản nên
   không kiểm chứng được — mà đây chính là điểm mấu chốt của §8.2.
2. Đo RAM thật so với §12.1 (idle < 500 MB, chat < 800 MB).
3. Duyệt giao diện bằng mắt — E2E khẳng định hành vi, không khẳng định nó _trông_ đúng.

**Ba lỗi thật được tìm ra nhờ lần chạy này** (đều đã sửa):

- `showFatalError` hiện dialog mà không ghi log → app không mở được thì không có dấu vết nào.
- Redactor nuốt cả đường dẫn file → log chẩn đoán thành dãy `[REDACTED]` vô dụng.
- Master key được tạo lười → secure storage hỏng chỉ lộ ra khi người dùng gửi tin nhắn đầu tiên.

### C2. 🔴 Chưa test với LiteLLM / Jira / Confluence thật

Toàn bộ integration test chạy với mock server tự viết (`tests/fixtures/`). Contract test đúng theo
đặc tả trong tài liệu, nhưng đặc tả có thể lệch thực tế.

### C3. 🔴 Chưa có code-signing certificate

`electron-builder.yml` đã cấu hình sẵn chỗ cắm cert (`win.certificateSubjectName`), nhưng chưa ký
được. Bước 6 của pipeline §18.1 hiện đang skip. **Đây là việc cần khởi động thủ tục ngay** — xem
TASKLIST T-02-5.

### C4. 🟠 PDF: chưa test với PDF scan thật

Đã code phát hiện heuristic (trang có < 20 ký tự text ⇒ nghi là scan) và cảnh báo. Chưa có mẫu PDF
scan nội bộ để hiệu chỉnh ngưỡng.

### C5. ✅ ĐÃ LÀM: icon đóng gói

`apps/desktop/resources/icon.ico` đã tồn tại và được dùng trong `electron-builder.yml`.

---

## D. Điểm tôi thấy nên xem lại trong chính tài liệu

### D1. ✅ ĐÃ LÀM: stdio cục bộ + HTTPS gateway remote, không mở localhost server

Nexa hỗ trợ stdio khi tự quản lý MCP và HTTPS client khi tổ chức cung cấp gateway remote
(ADR-0008). App không bind localhost và renderer không gọi mạng; cả hai transport đều nằm trong
main process. Cấu hình HTTP loopback chỉ tồn tại trong mock test, bản đóng gói luôn yêu cầu HTTPS.

### D2. §11.2 "allowlist domain tổ chức nếu có" — nên là bắt buộc

Rủi ro §22.1 _"Người dùng nhập URL giả/malicious → gửi PAT sai đích"_ rất thật. Nếu allowlist là
tuỳ chọn thì biện pháp giảm thiểu gần như không có tác dụng. Tôi đã code allowlist và để nó
**bật được từ file policy** (`resources/policy.json`, IT ghi đè lúc phân phối), mặc định rỗng =
không giới hạn. Đề nghị ATTT bắt buộc điền.

### D3. §21 "Cài và gỡ trên Windows không cần quyền admin"

NSIS per-user install làm được. Nhưng MSI cho IT phân phối tập trung thì **cần** admin. Hai mục tiêu
này mâu thuẫn nhẹ — cần nói rõ: NSIS = self-service không admin, MSI = IT deploy có admin.

### D4. ✅ ĐÃ LÀM 2026-08-22: sửa/xoá một tin nhắn lẻ

Trước đây chỉ có CRUD ở mức conversation — nếu người dùng lỡ dán nội dung nhạy cảm vào chat thì
cách duy nhất là xoá cả hội thoại. Đã bổ sung `editMessage`/`deleteMessage` ở cả 4 lớp:

- Schema: migration `version: 4` (`packages/local-store/src/migrations.ts`) thêm `edited_at`,
  `deleted_at` vào `messages`. Không cần dựng lại bảng vì `messages` không có CHECK constraint.
- Repository: `ConversationRepository.editMessage`/`deleteMessage`
  (`packages/local-store/src/repositories/conversation-repository.ts`). **Xoá là xoá nội dung
  thật** — ghi đè `content_ciphertext` bằng ciphertext của chuỗi rỗng, không phải soft-delete giữ
  nguyên ciphertext cũ, đúng mục đích ban đầu của mục này. Row vẫn giữ lại (id/seq/role) để không
  phá thứ tự hội thoại; `loadForContext` (dùng để dựng ngữ cảnh gửi model) đã lọc bỏ
  `deleted_at IS NOT NULL`.
- IPC: `message:edit`, `message:delete` (`packages/shared-types/src/{channels,ipc}.ts`,
  `apps/desktop/src/main/ipc.ts`).
- UI: nút sửa/xoá xuất hiện khi hover trên tin nhắn của `user`/`assistant` đã lưu xong
  (`apps/desktop/src/renderer/components/ChatView.tsx`, `MessageBubble`); sửa dùng textarea tại
  chỗ, còn xoá đi qua destructive dialog thống nhất với xoá hội thoại/kết nối/model.

**Không làm:** không cho "sửa rồi gửi lại cho model" (regenerate) — sửa chỉ cập nhật nội dung đã
lưu, giữ phạm vi tối thiểu đúng nhu cầu quyền riêng tư nêu ra ở đây. Nếu sau này cần regenerate,
đó là tính năng khác, cần thiết kế riêng (đặc biệt là ảnh hưởng tới các message/tool-call phía sau
trong cùng hội thoại).

### D5. Không có yêu cầu nào về **i18n**

Tài liệu tiếng Việt, người dùng là nhân viên Việt Nam. Tôi hard-code chuỗi UI tiếng Việt, không
dựng hệ thống i18n. Nếu sau này cần tiếng Anh thì phải refactor.

---

## E. Phát sinh trong lúc triển khai — cần bạn biết

Những mục dưới đây không có trong tài liệu và cũng không phải câu hỏi mở lúc lập kế hoạch.
Chúng xuất hiện khi viết code, và tôi đã tự quyết định.

### E1. ✅ Driver SQLite — ĐÃ CHỐT: dùng `node:sqlite`

`better-sqlite3` là native module, cần toolchain C++ hoặc prebuild khớp phiên bản. Máy phát
triển không có toolchain và Node 24 chưa có prebuild, nên **toàn bộ test tầng lưu trữ sẽ không
chạy được** — mất luôn khả năng kiểm chứng phần mã hoá và migration.

**Giải pháp ban đầu:** tách interface driver, production dùng `better-sqlite3`, test dùng
`node:sqlite`. Rủi ro: hai driver khác nhau giữa test và production.

**Cập nhật sau khi chạy thử:** Electron 43 mang Node 24.18, và Node 24 có sẵn `node:sqlite`
(đã bỏ cờ experimental).

Rồi khi thử đóng gói, `better-sqlite3` chặn hẳn đường: node-gyp **không cross-compile được**
native module, nên không thể build bộ cài Windows từ bất kỳ máy nào không phải Windows, và cả
CI cũng phải thêm bước rebuild.

Vì vậy tôi **bỏ hẳn `better-sqlite3` khỏi bộ cài**:

- Electron 43, driver là `node:sqlite` — chỉ định rõ trong `services.ts`, không dựa vào mặc định
- không còn native module nào ⇒ `npmRebuild: false`, không cần `asarUnpack`, không cần
  `@electron/rebuild` trong CI
- **test và production chạy CÙNG một driver** — rủi ro "test driver A, chạy driver B" biến mất
- `pnpm install` không còn phun lỗi node-gyp

Lớp trừu tượng driver vẫn còn (~60 dòng) làm đường lui: cài lại `better-sqlite3` và đổi một
tham số là quay về được. Chi tiết ở [ADR 0003](architecture/adr/0003-sqlite-driver-abstraction.md).

**✅ ĐÃ CHỐT 2026-08-01:** dùng `node:sqlite`. Chủ sở hữu sản phẩm đã xác nhận sau khi biết rõ
API này được Node đánh dấu _experimental_.

Rủi ro còn lại và cách theo dõi: khi nâng Electron (xem E10), phải đọc ghi chú phát hành của
Node/Electron về `node:sqlite` **trước** khi nâng. Nếu API đổi hoặc bị bỏ, lối thoát là cài lại
`better-sqlite3` và đổi một tham số trong `services.ts` — dữ liệu là file SQLite chuẩn nên không
cần chuyển đổi. [ADR 0003](architecture/adr/0003-sqlite-driver-abstraction.md) đã ở trạng thái
_Đã chấp nhận_.

### E2. 🟡 `jira_create_issue` được xếp mức WRITE_LOW

§10.1 chỉ nêu ví dụ `jira_add_comment` = WRITE_LOW và `jira_update_issue` = WRITE_HIGH.
`create_issue` không được xếp hạng.

Tôi xếp WRITE_LOW vì tạo mới không phá dữ liệu đang có. Mọi tool write đều phải preview và xác
nhận như nhau, nên mức chỉ ảnh hưởng độ chi tiết preview và khả năng tắt bằng cờ.

Nếu bạn thấy tạo issue đáng ở mức HIGH thì đổi một dòng trong
`packages/atlassian-mcp-manager/src/tool-registry.ts`.

### E3. 🟠 Một tiến trình MCP phục vụ cả Jira lẫn Confluence

Package MCP Atlassian thông dụng nhận cả hai bộ credential cùng lúc, nên tôi dựng một tiến trình
duy nhất.

**Hệ quả:** PAT của Jira và của Confluence nằm chung trong bộ nhớ một tiến trình. Nếu tiến trình
đó bị khai thác, cả hai cùng lộ. Tách thành hai tiến trình sẽ cô lập tốt hơn nhưng tốn gấp đôi
tài nguyên và làm phức tạp lifecycle.

Nếu ATTT muốn tách, chỗ sửa là `AtlassianMcpManager` (tách thành hai client), không phải danh
mục tool.

### E4. ✅ ĐÃ LÀM 2026-08-23: không restart MCP khi tool đang chạy

Không có cách nào kiểm tra credential Atlassian mà không đưa nó cho MCP server, và server nhận
credential lúc spawn. Vì vậy `connection.test` cho Jira/Confluence sẽ **restart tiến trình MCP**
rồi gọi một tool read nhẹ.

`AtlassianMcpManager` theo dõi tool call đang hoạt động và từ chối restart bằng
`OPERATION_ALREADY_RUNNING`. IPC cũng kiểm tra trước khi ghi thay đổi kết nối Jira/Confluence/MCP
Gateway, nên không có trường hợp lưu thành công rồi mới phát hiện không thể rebuild manager.

### E5. 🟡 Model chọn ở dropdown chỉ áp cho lượt gửi kế tiếp

Không đổi hồi tố các lượt đã xong. Tôi cho là đúng — nhưng UI hiện chỉ báo bằng một toast, có
thể chưa đủ rõ.

### E6. 🟠 CSP chặn hoàn toàn `connect-src` của renderer

Renderer **không** gọi mạng được, kể cả tới localhost. Mọi thứ đi qua IPC. Có hai lớp: CSP
header và một `onBeforeRequest` chặn ở tầng session.

Hệ quả cần biết: nếu sau này ai đó muốn nhúng ảnh từ Confluence hay preview đính kèm bằng URL
trực tiếp, việc đó **sẽ không chạy** và phải đi đường IPC. Đây là chủ ý (§11.3 "Renderer bị XSS
và đọc token"), nhưng nó là một ràng buộc thật lên các tính năng sau này.

### E7. 🟢 Màn hình quản lý thao tác `uncertain` — đã bổ sung

Đã thêm channel `tool:listUncertain` và banner ở đầu màn hình chính, liệt kê mọi thao tác write
còn treo. Danh sách đọc thẳng từ bảng `tool_calls` nên sống sót qua các lần khởi động lại —
`OperationTracker` chỉ sống trong RAM.

### E10. 🟠 Electron 43 là bản rất mới

Nâng từ 33 lên 43 để có `node:sqlite`. Electron chỉ hỗ trợ 3 major gần nhất, nên bản mới là
lựa chọn đúng về vòng đời bảo mật — nhưng nó cũng nghĩa là ta đang ở sát mép, và bản major mới
ra khoảng 8 tuần một lần.

Cần một chính sách nâng cấp Electron (ai theo dõi, bao lâu nâng một lần). Chưa có.

### E8. ✅ ĐÃ LÀM: đã có file icon

`apps/desktop/resources/icon.ico` tồn tại và được `electron-builder.yml` dùng khi đóng gói.

### E9. 🟡 Git đã có; branch protection và secret scanning vẫn cần cấu hình remote

Repo hiện đã là Git working tree. Các thay đổi remediation chưa được commit; branch protection,
required checks và secret scanning vẫn là việc cấu hình trên Git hosting của tổ chức.

---

## F. Kết nối OpenAI trực tiếp — sai lệch có chủ ý so với thiết kế

### F1. 🔴 Nexa gọi thẳng api.openai.com, bỏ qua LiteLLM

**Yêu cầu:** chủ sở hữu sản phẩm yêu cầu thêm kết nối ChatGPT/OpenAI, ngày 2026-08-01.
Tôi đã nêu rõ hệ quả trước khi làm; quyết định được giữ nguyên.

**Điều này trái với tài liệu thiết kế.** §6 ghi: _"Model Provider — Cung cấp LLM phía sau
LiteLLM; **Nexa không kết nối trực tiếp provider**"_. §4.1 đặt LiteLLM làm chỗ duy nhất áp
quota, usage log và quyết định key nào gọi được model nào.

**Hệ quả cần ATTG duyệt trước khi phát hành:**

| Vấn đề                                                      | Trạng thái                                                 |
| ----------------------------------------------------------- | ---------------------------------------------------------- |
| Dữ liệu hội thoại rời hạ tầng nội bộ, ra cloud công cộng    | Người dùng **được cảnh báo trong UI**, nhưng không bị chặn |
| Không còn usage log / quota của tổ chức cho các lời gọi này | Không có biện pháp bù. LiteLLM không thấy chúng            |
| §6.1 "Dữ liệu có thể phát sinh ngoài laptop" không còn đủ   | **Cần cập nhật tài liệu thiết kế**                         |
| `allowedDomains` phải mở `api.openai.com`                   | Nếu tổ chức đã dùng allowlist thì phải thêm tay            |
| Tài liệu nội bộ gửi ra ngoài                                | **Fail-closed** — xem dưới                                 |

**Biện pháp tôi đã dựng để việc rò rỉ không xảy ra do vô tình:**

1. **Chính sách tài liệu fail-closed cho provider ngoài.** Model nội bộ giữ hành vi fail-open
   (rỗng = cho phép, theo A5). Model ngoài thì **rỗng = TỪ CHỐI** — phải khai từng model vào
   `externalDocumentAllowedModels` dạng `openai:gpt-4o`.
2. **Hai danh sách allowlist riêng biệt.** Ban đầu tôi dùng chung một danh sách và test bắt được
   lỗi thiết kế: admin thêm một model ngoài vào đó sẽ **vô tình chặn mọi model nội bộ khác**.
   Hai chính sách ngược chiều nhau không dùng chung một danh sách được.
3. **Cảnh báo trong UI** ở ba chỗ: tab Cài đặt → OpenAI, nhãn "ngoài tổ chức" cạnh model đang
   chọn, và một dòng cảnh báo trong khung soạn tin khi model ngoài được chọn.
4. **Mã lỗi riêng** (`OPENAI_*`) để thông báo dẫn người dùng tới đúng màn hình cài đặt.

**Câu hỏi cần bạn/ATTT trả lời:**

- Có chấp nhận việc **chat** (không kèm tài liệu) đi ra OpenAI mà không có kiểm soát nội dung
  không? Hiện Nexa chỉ cảnh báo, không chặn. Chặn được nếu cần — nhưng chặn chat thì tính năng
  gần như vô dụng.
- ✅ **Đã làm 2026-08-23:** `policy.json` có `allowDirectOpenAi`. Khi đặt `false`, main process
  từ chối lưu/test kết nối, thêm/chọn model và dựng client OpenAI, kể cả với cấu hình đã tồn tại;
  UI ẩn model khỏi chat, khoá form nhưng vẫn cho phép xoá credential cũ.
- Tài liệu thiết kế §6 và §6.1 **cần được cập nhật** để phản ánh thực tế mới. Ai làm?

### F2. 🟠 Không có usage log cho lời gọi OpenAI

§15.2 dựa vào usage log của LiteLLM để đối chiếu `request_id`. Với provider ngoài, nguồn đó
không tồn tại.

Nexa vẫn ghi `request_id` và độ trễ vào log cục bộ, nên vẫn truy vết được **trên máy người
dùng**. Nhưng không có cái nhìn tập trung ở phía tổ chức: không ai biết tổng cộng bao nhiêu
request đã ra OpenAI, tốn bao nhiêu token, hay ai gọi nhiều nhất.

Nếu tổ chức cần con số đó thì phải có telemetry tập trung — điều §11.2 hiện cấm theo mặc định.
Đây là hai yêu cầu xung đột và cần một quyết định.

### F3. 🟡 Endpoint OpenAI cố định, không cấu hình proxy

Mặc định `https://api.openai.com`, người dùng sửa được trong Cài đặt. Chưa hỗ trợ khai báo
proxy công ty riêng (biến môi trường `HTTPS_PROXY` chưa được đọc).

Nếu mạng nội bộ chặn ra ngoài trừ qua proxy thì kết nối này sẽ không chạy, và lỗi hiện ra sẽ là
`UPSTREAM_UNAVAILABLE` chung chung.

---

## G. Mở toàn bộ 98 tool MCP Atlassian — sai lệch có chủ ý so với thiết kế (2026-08-22)

### G1. 🔴 Bật mặc định mọi feature flag Jira/Confluence write + mở khoá tool DESTRUCTIVE

**Yêu cầu:** chủ sở hữu sản phẩm yêu cầu "full quyền sử dụng 98 tool" của gateway MCP Atlassian,
ngày 2026-08-22. Đã hỏi rõ phạm vi trước khi làm — người yêu cầu chọn phương án rộng nhất: đổi
mặc định trong code (không chỉ hướng dẫn bật tay trong Settings) VÀ mở luôn tool mức DESTRUCTIVE.

**Điều này trái với tài liệu thiết kế và với chính comment trong code trước đây.** §22.3 khuyến
nghị "MVP bật Jira read/create + Confluence read only, mọi write cần xác nhận"; §10.1 nói
DESTRUCTIVE "không bật trong MVP". Toàn bộ 98 tool của gateway đã được đăng ký sẵn trong
`tool-registry.ts` từ trước (chia 4 nhóm) — việc "mở khoá" ở đây thuần tuý là gỡ các lớp chặn cấu
hình/code, không phải viết thêm tool nào.

**Đã đổi:**

1. `packages/shared-types/src/settings.ts` — `featureFlagsSchema`: `jiraServiceDesk`,
   `jiraComment`, `jiraLink`, `jiraUpdate`, `jiraWorkflow`, `confluenceWrite`,
   `confluenceWriteHigh` đổi mặc định từ `false` sang `true`. Áp dụng cho **mọi cài đặt mới**,
   không chỉ máy đã yêu cầu — vì đây là default trong code, không phải policy riêng cho một máy.
2. `packages/atlassian-mcp-manager/src/manager.ts` — gỡ hai chốt chặn cứng cho `riskLevel ===
'DESTRUCTIVE'` (trong `availableTools()` và `resolveCallable()`). Ba tool DESTRUCTIVE duy nhất
   hiện có (`jira_delete_issue`, `confluence_delete_page`, `confluence_delete_attachment`, đều xoá
   vĩnh viễn, không thể hoàn tác) giờ chỉ còn bị kiểm soát bằng `requiredFeature`
   (`jiraWorkflow`/`confluenceWriteHigh`) — **giống hệt mọi tool WRITE_HIGH khác, không có lớp
   bảo vệ nào cao hơn.**
3. Cập nhật mô tả tool và nhãn UI (`SettingsView.tsx`) để không còn nói "hiện KHÔNG khả dụng".

**Điều KHÔNG đổi (vẫn còn nguyên vẹn):**

- Confirmation Guard: mọi tool WRITE/DESTRUCTIVE vẫn bắt buộc preview + xác nhận người dùng
  trước khi gọi thật (§10.2). Không có tool nào tự chạy.
- `payload_hash` + `operation_id` chống double-submit (§10.3) vẫn áp dụng cho DESTRUCTIVE như
  WRITE_HIGH.
- `forcedFeatures`/`lockedFeatures` trong `policy.json` (§ORG_POLICY) vẫn có thể được IT dùng để
  ghi đè cứng, tắt lại các flag này cho một tổ chức cụ thể nếu cần — xem `settings.ts`.

**Cập nhật 2026-08-22 (lần 2) — `apps/desktop/resources/policy.json` thật ra ĐÃ khoá
`confluenceWrite`:** đổi default ở mục 1 không đủ, vì `resources/policy.json` sẵn có
`forcedFeatures: { "confluenceWrite": false }` — theo đúng thứ tự ưu tiên ở
`settings-service.ts` ("`forcedFeatures` của tổ chức — thắng tất cả"), giá trị này ghi đè cả
default mới lẫn lựa chọn của người dùng, và UI hiện tag "bị khoá bởi chính sách tổ chức" cạnh
"Ghi Confluence". Đã gỡ entry đó khỏi `forcedFeatures` (nay là `{}`) để `confluenceWrite` theo
đúng default `true` ở mục 1 và người dùng tự tắt được nếu muốn — không còn bị khoá cứng.
**Bài học:** khi một feature vừa có default trong `settings.ts` vừa có thể bị `policy.json` ghi
đè, phải kiểm tra CẢ HAI chỗ mới biết hành vi thật — chỉ đổi default không đảm bảo mở được tính
năng nếu tổ chức có policy riêng.

**Rủi ro thật cần bạn/ATTT biết:**

- `jira_delete_issue`/`confluence_delete_page`/`confluence_delete_attachment` xoá **vĩnh viễn**
  (comment, worklog, attachment, trang con đều mất theo) và **không có gì ngăn model đề xuất gọi
  chúng** ngoài việc người dùng phải bấm xác nhận trên preview — không có bước xác nhận thứ hai
  hay cảnh báo nào mạnh hơn WRITE_HIGH thông thường dù đây là thao tác không thể hoàn tác.
- Vì đây là **default trong code**, mọi bản cài mới của Nexa (kể cả không phải máy đã yêu cầu)
  sẽ có toàn bộ 98 tool sẵn sàng ngay khi kết nối Jira/Confluence, không cần người dùng tự bật —
  khác hẳn nguyên tắc "least privilege" ghi ở §3 tài liệu gốc.
- `jiraServiceDesk` (JSM) mặc định bật nghĩa là request/queue có thể chứa dữ liệu khách hàng nhạy
  cảm hơn issue nội bộ thường giờ được đọc mặc định — trước đây tắt chính vì lý do này.

**Việc cần bạn/ATTT quyết định tiếp:** có cần đặt `forcedFeatures` trong `policy.json` để giữ các
tổ chức chưa sẵn sàng ở mức mặc định cũ (an toàn hơn) không, và §10.1/§22.3 của tài liệu thiết kế
gốc có cần cập nhật để phản ánh thực tế mới này không.

---

## H. Thu hẹp danh mục tool theo ngữ cảnh (2026-08-26, ADR 0009)

Bối cảnh: `buildToolSpecs()` gửi cả 98 tool ở **mỗi vòng** của vòng lặp tool-calling. Đo trên
`buildToolRegistry()` — đúng những gì Nexa gửi — là **~10.661 token mỗi vòng**, nhân với
`maxToolIterations` (mặc định 5). ADR 0009 chốt thu hẹp thành sáu preset cố định, chọn bằng một
hàm thuần xác định, kèm tool meta `nexa_mo_rong_tool` để model tự xin danh mục đầy đủ.

Đã có: `toolScoping` trong `featureFlagsSchema` (mặc định **bật**), khoá được bằng
`forcedFeatures` trong `resources/policy.json`.

### H1. 🟠 Ngưỡng nào coi là bộ chọn preset hỏng?

**Câu hỏi:** Tỉ lệ mở rộng (`tool-preset` với `expanded: true` / tổng số lượt) bao nhiêu phần trăm
thì kết luận bộ chọn sai nhiều hơn giá trị nó mang lại, và tắt `toolScoping`?

**Giả định đã dùng:** không có ngưỡng nào được cài trong code. Log ghi đủ số liệu để tính, nhưng
việc đọc và quyết định là thủ công. Chưa có cơ sở để chốt trước pilot — cần phân bố preset trên
câu hỏi thật.

**Rủi ro thật cần để mắt:** rủi ro lớn nhất **không** phải mở rộng quá nhiều mà là model **không**
gọi tool meta, chỉ trả lời "tôi không có công cụ phù hợp". Nó biến một câu hỏi làm được thành một
lời từ chối, âm thầm, và **không để lại dấu vết lỗi nào trong log**. Dấu hiệu: preset hẹp có tỉ lệ
mở rộng gần 0 trong khi người dùng vẫn báo trợ lý nói không làm được. Nếu gặp, tắt `toolScoping`
trước, điều tra sau.

**Sửa ở đâu nếu khác:** `packages/agent-runtime/src/tool-preset-selector.ts` (quy tắc chọn),
`packages/agent-runtime/src/agent-runtime.ts` (mô tả `EXPAND_TOOLS_SPEC`),
`packages/agent-runtime/src/context-builder.ts` (dòng trong `DEFAULT_SYSTEM_PROMPT`).

---

### H2. 🟡 Mở rộng có nên nhớ theo hội thoại?

**Câu hỏi:** Khi một lượt đã phải mở rộng, lượt sau trong cùng hội thoại có nên bỏ qua bộ chọn?

**Giả định đã dùng:** **không**. Mở rộng chỉ có phạm vi một lượt; lượt sau lại bắt đầu từ bộ chọn.
Lý do: `AgentRuntime` hiện không giữ trạng thái nào giữa các lượt, và thêm trạng thái đầu tiên vào
đó cần lý do mạnh hơn "tiết kiệm một round-trip đôi khi".

**Sửa ở đâu nếu khác:** `runTurn` trong `packages/agent-runtime/src/agent-runtime.ts` — cần một
map theo `conversationId`, và cần quyết định khi nào xoá nó.

---

### H3. 🟡 `jiraServiceDesk` có nên là preset riêng?

**Câu hỏi:** JSM (5 tool) là miền nghiệp vụ khác hẳn, hiện bị gộp vào `jira-full`. Có nên tách?

**Giả định đã dùng:** **không tách**. 5 tool ≈ 300 token, chưa đáng thêm một preset (mỗi preset là
thêm một prefix mà prompt cache phải giữ). Tổ chức không dùng JSM thì cách đúng là **tắt cờ
`jiraServiceDesk`**, không phải thêm preset.

**Sửa ở đâu nếu khác:** `TOOL_PRESET_FLAGS` trong `packages/shared-types/src/tools.ts`, và cập
nhật số 6 trong `tool-preset.test.ts`.

---

### H4. 🟡 Hai bẫy bỏ dấu tiếng Việt — danh sách hiện tại đã đủ chưa?

**Bối cảnh:** bộ chọn bỏ dấu trước khi khớp từ khoá, và việc đó sinh ra trùng lặp thật:

| Cụm          | Bỏ dấu thành | Trùng với                       | Đã xử lý                     |
| ------------ | ------------ | ------------------------------- | ---------------------------- |
| "trạng thái" | `trang thai` | `trang` (dấu hiệu Confluence)   | gỡ cụm trước khi khớp        |
| "hoạt động"  | `hoat dong`  | `dong` ("đóng" — động từ write) | **bỏ** `dong` khỏi danh sách |
| "gần đây"    | `gan day`    | `gan` ("gán" — động từ write)   | **bỏ** `gan` khỏi danh sách  |

**Câu hỏi:** còn cụm nào tương tự trong câu hỏi thật của người dùng? Danh sách này được xây từ suy
luận, không từ dữ liệu.

**Giả định đã dùng:** ba trường hợp trên là đủ cho pilot, và mọi trường hợp trượt đều được đường
mở rộng che. Sau pilot nên rà lại bằng chính câu hỏi thật — nhưng **log không ghi câu hỏi** (đúng
`threat-model.md`), nên việc rà này cần người dùng cung cấp ví dụ, không lấy được từ log.

**Sửa ở đâu nếu khác:** `WRITE_WORDS`, `CONFLUENCE_WORDS`, `CONFLUENCE_FALSE_FRIENDS` trong
`packages/agent-runtime/src/tool-preset-selector.ts` — mỗi thay đổi cần một ca test tương ứng
trong `tool-preset-selector.test.ts`.

---

## I. Business Analyst workbench (2026-08-30, openspec `add-ba-workbench`)

### I1. 🔴 Ảnh nội bộ: hợp đồng consent và transport chưa có ai duyệt

**Đây là câu hỏi đang CHẶN mục 13 của change `add-ba-workbench`.** Giai đoạn 1–3 của tính năng BA
đã xong và dùng được mà không cần ảnh; riêng phần "ảnh → danh sách trường" thì chưa bắt đầu và
**sẽ không bắt đầu** cho tới khi có kết luận.

**Câu hỏi:** điều kiện gì để Nexa được phép nhận một ảnh chụp màn hình sản phẩm nội bộ và gửi nó
tới một model?

**Cập nhật 2026-09-01 — đường nạp ảnh trong Chat đã được mở theo yêu cầu của chủ sở hữu sản
phẩm** (openspec `add-multi-format-file-upload`, xem mục J1). Điều đó **không** trả lời câu hỏi
dưới đây và **không** mở khoá mục 13 của `add-ba-workbench`: ảnh → danh sách trường trong Không
gian Nghiệp vụ vẫn dừng cho tới khi hợp đồng consent được duyệt.

Việc "vẫn dừng" đó là một chốt chặn có thật trong mã, không phải một lời hứa: `ba:document:extract`
và `ba:checklist:ingest` từ chối ảnh bằng `DOCUMENT_REQUIRES_TEXT` ngay ở main process, và hộp
thoại chọn file của hai luồng đó không mời chọn ảnh. Chặn ở main mới là chốt, vì renderer có thể
gọi thẳng channel (§5.3).

**Vì sao nó không phải một dòng code:**

- ~~Hiện **không đường nào** trong Nexa nhận ảnh~~ — từ 2026-09-01, `document-processor` nhận
  PNG/JPEG/WebP/GIF cho **Chat**. Phần nghiệp vụ thì vẫn chưa.
- `DESIGN.md` đang ghi rõ file và ảnh còn tắt cho lựa chọn `chatgpt` **cho tới khi** có một hợp
  đồng consent và media transport đã được duyệt. Việc này đụng thẳng F1.
- Một ảnh chụp màn hình mang theo nhiều hơn thứ người gửi định gửi: dữ liệu khách hàng trên
  staging, URL nội bộ, danh tính người chụp. Không có phép che tự động nào đáng tin cho việc đó.

**Đề xuất đã soạn sẵn để duyệt:** `docs/security/ba-vision-consent-contract.md` — bảy điều khoản
duyệt/bác được riêng lẻ (ảnh không rời hạ tầng nội bộ; consent từng ảnh một, không nhớ; ảnh không
nằm lại trên đĩa; chỉ lưu danh sách tên trường; trường từ ảnh mặc định `needs_review`; log chỉ số
đếm; cờ `baVision` riêng, mặc định tắt và IT khoá được).

**Bốn câu hỏi cần ATTT trả lời dứt khoát** (chi tiết trong tài liệu trên): backend phía sau LiteLLM
chạy ở đâu; môi trường nào được phép chụp; có cần dấu vết kiểm toán không (mâu thuẫn trực tiếp với
điều khoản "không lưu ảnh"); và ranh giới trách nhiệm khi một ảnh chứa dữ liệu thật được gửi đi.

**Nếu bị bác toàn bộ:** tính năng BA không mất phần có giá trị — rulebook và `R-FLD-02` đã trả lời
được "trường này còn thiếu validate nào" cho trường đến từ văn xuôi và bảng DOCX. Khi đó nên đóng
D7 với kết luận "không làm" và ghi lý do vào ADR 0010.

**Sửa ở đâu nếu quyết định khác:** `openspec/changes/add-ba-workbench/tasks.md` mục 13,
`docs/security/ba-vision-consent-contract.md`, và `DESIGN.md` (dòng Codex attachment contract).

### I2. 🟠 Bộ luật review có thể bị đọc thành "tài liệu đã đúng"

**Bối cảnh:** báo cáo review chạy 15 luật và nói "đã kiểm 15/15 luật, 15 luật đạt". Đó là một câu
đúng và cũng là một câu rất dễ bị đọc thành "tài liệu không còn thiếu gì" — đúng thứ mà người đặt
yêu cầu ban đầu than phiền về các công cụ AI review khác.

**Biện pháp đã dựng:** chữ "đầy đủ" không bao giờ xuất hiện cho toàn tài liệu (có test ở cả helper
giao diện, output tool và E2E); mọi báo cáo hiển thị kèm một câu nói thẳng bộ luật kiểm cái gì và
không kiểm cái gì; luật chưa chạy được vì thiếu mẫu/rulebook/tri thức được báo là **chưa kiểm**
chứ không tính là đã đạt.

**Câu hỏi cần Design owner:** câu chữ và bố cục hiện tại đã đủ để không bị đọc sai chưa? Đây là
open question cuối còn mở của change, và giờ đã có bản chạy thật để soi thay vì soi trên mô tả.

**Sửa ở đâu nếu khác:** `REVIEW_SCOPE_NOTE` và `summarizeReview` trong
`apps/desktop/src/renderer/components/ba-ui.ts`, kèm test tương ứng trong `ba-ui.test.ts`.

## J. Mở rộng định dạng file đính kèm (2026-09-01, openspec `add-multi-format-file-upload`)

### J1. 🔴 Ảnh trong Chat đã bật trước khi hợp đồng consent được duyệt

**Yêu cầu:** chủ sở hữu sản phẩm yêu cầu cho phép đính kèm ảnh và bộ Office đầy đủ, ngày
2026-09-01. Tôi đã nêu rằng việc này chạm thẳng vào I1 — câu hỏi consent/transport cho ảnh vẫn
đang mở — và quyết định được giữ nguyên. Ghi lại ở đây để không ai phải suy ra từ lịch sử git.

**Điều này đi trước một mục đang chờ duyệt.** I1 nói phần ảnh "sẽ không bắt đầu cho tới khi có kết
luận"; phạm vi câu đó là mục 13 của `add-ba-workbench` (ảnh → trường nghiệp vụ), và mục đó **vẫn
dừng**. Nhưng lập luận nền của I1 — một ảnh chụp màn hình mang theo nhiều hơn thứ người gửi định
gửi — áp cho cả đường Chat, nên nó cần ATTT xem lại chứ không tự hết hiệu lực.

**Hệ quả cần ATTT duyệt trước khi phát hành:**

| Vấn đề                                                        | Trạng thái                                                            |
| ------------------------------------------------------------- | --------------------------------------------------------------------- |
| Ảnh nội bộ có thể tới provider **ngoài** tổ chức              | Áp cùng cổng fail-closed như tài liệu (F1) — phải allowlist tường minh |
| Ảnh mang EXIF/GPS/số sê-ri máy                                | **Đã gỡ** trước khi mã hoá base64; gỡ thất bại thì không gửi          |
| Ảnh chụp màn hình mang dữ liệu ngoài chủ ý người gửi          | **Không có biện pháp tự động.** Vẫn là rủi ro còn lại                  |
| LiteLLM có ghi usage cho nội dung ảnh không                   | Chưa xác minh với hạ tầng thật (cùng nhóm với C2)                     |
| Ảnh nằm lại trên đĩa                                          | Không. `§8.1` được giữ: base64 cũng là bản sao, và không có chỗ lưu   |

**Biện pháp đã dựng để việc rò rỉ không xảy ra do vô tình:**

1. **Gỡ metadata bắt buộc.** EXIF/XMP/comment bị loại khỏi JPEG/PNG/WebP/GIF trước khi ảnh rời
   máy. Không có nhánh dự phòng "gỡ lỗi thì gửi ảnh gốc" — gỡ thất bại là lỗi trích xuất.
2. **Ảnh dùng chung cổng chính sách với tài liệu.** Ảnh là một `DocumentKind`, nên
   `assertModelMayReceiveDocuments` áp cho ảnh y như cho `.docx` — provider ngoài vẫn fail-closed.
3. **Model phải được khai là đọc được ảnh**, mặc định tắt cho mọi model kể cả model đã cấu hình
   từ trước. Đây là kiểm tra năng lực tách khỏi kiểm tra quyền, để thông báo cho người dùng không
   sai một nửa.
4. **Ảnh không vừa context là lỗi**, không phải cắt bớt im lặng — người dùng không bao giờ nhận
   một câu trả lời trôi chảy về tấm ảnh model chưa từng thấy.
5. **Ảnh gửi bằng data URL**, không bằng URL mạng, để provider không tự đi tải file qua một đường
   mà `allowedDomains` không nhìn thấy.

**Câu hỏi cần ATTT trả lời:** cổng allowlist + gỡ metadata đã đủ cho ảnh trong Chat chưa, hay ảnh
cần một cờ riêng (kiểu `baVision`) để IT khoá được toàn tổ chức độc lập với tài liệu văn bản?

**Sửa ở đâu nếu quyết định khác:** `packages/document-processor/src/image.ts` (gỡ metadata),
`packages/agent-runtime/src/document-policy.ts` (cổng chính sách), và bảng `EXTENSION_MAP` trong
`pipeline.ts` — bỏ năm phần mở rộng ảnh ở đó là đóng hẳn đường nạp.

### J2. 🟠 Bộ đọc Office tự viết chưa gặp file thật của người dùng

**Bối cảnh:** năm định dạng Office được đọc bằng mã viết trong repo, không dùng thư viện. Lý do
nằm ở `openspec/changes/add-multi-format-file-upload/design.md` D1: dữ liệu đến từ file không tin
cậy, và tự viết là cách duy nhất đặt được trần bung dữ liệu vào đúng chỗ cần.

**Cái giá:** chất lượng trích xuất ở mức "đủ dùng". Fixture trong `tests/support` dựng đúng những
chi tiết khó (mảnh văn bản đảo thứ tự, chuỗi SST cắt qua CONTINUE, mini stream, ô thưa), nhưng
fixture do tôi sinh ra thì chỉ chứng minh được bộ đọc khớp với hiểu biết của tôi về định dạng.

**Cập nhật 2026-09-01 — đã chạy với 8 tài liệu thật** (2 `.xlsx`, 3 `.docx` gồm một file 9,4 MB,
2 `.pptx` gồm một file 12 MB, 1 `.doc` Word 97). Cả 8 đọc được, không file nào lỗi, file lớn nhất
mất 824 ms. Đo chất lượng mã tiếng Việt bằng thống kê ký tự thay vì đọc nội dung: 0 ký tự thay thế
và 0 rác Latin-1 ở cả 8 file. Vài ký tự Latin-1 xuất hiện (`± ° µ × ½ ÷` trong một đồ án cơ khí,
`·` làm dấu phân cách trong một slide) là ký tự hợp lệ, không phải lỗi giải mã.

**Một lỗi thật do lần chạy đó phát hiện, đã sửa:** ô ngày trong bảng tính ra số serial. Một cột
tiêu đề "Ngày ký" tới model dưới dạng `45678`; model không có cách nào biết đó là ngày nên sẽ trả
lời tự tin về một con số — đúng kiểu sai âm thầm mà cả change này đang tránh. Nay `.xlsx` và `.xls`
đều đọc tầng style (numFmt/XF) và xuất ngày dạng ISO. Đáng nói là **không file `.xlsx` nào của
người dùng có ô ngày**, nên lỗi này chỉ lộ ra khi dựng thêm một file thăm dò — bài học cho việc
"chạy với file thật" không tự động nghĩa là "đã phủ hết".

**Giới hạn còn lại, không sửa được từ phía đọc:** `.doc` tiếng Việt mã TCVN3/VNI ra sai dấu, vì
file không mang thông tin code page. File `.doc` đã thử nằm ở dạng Unicode nên không dính; điều đó
KHÔNG chứng minh được là file TCVN3 sẽ ổn.

**Việc còn lại trước pilot:** thử thêm `.xls` cũ (chưa có mẫu thật nào trên máy) và một `.doc` mã
TCVN3 nếu tổ chức còn lưu. Cùng nhóm với C2.
