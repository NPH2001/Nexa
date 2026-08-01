# Nexa — Câu hỏi & thắc mắc cần bạn review

> File này ghi lại **mọi chỗ tôi phải tự quyết định** vì tài liệu chưa nói rõ, hoặc vì cần thông tin
> từ bên ngoài (admin LiteLLM, admin Atlassian, ATTT).
> Mỗi mục có: câu hỏi → **giả định tôi đã dùng để code** → chỗ cần sửa nếu bạn quyết khác.
>
> Cập nhật lần cuối: 2026-08-01 (lần 2 — sau khi chạy thử app thật)

## Cách đọc

| Nhãn | Ý nghĩa |
|---|---|
| 🔴 BLOCKER | Phải có câu trả lời trước khi chạy thật với hệ thống nội bộ |
| 🟠 QUAN TRỌNG | Code chạy được, nhưng quyết định khác sẽ phải sửa đáng kể |
| 🟡 NHỎ | Dễ đổi, chỉ cần chỉnh config |

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
- §8.2 yêu cầu *"mỗi bản ghi hoặc nhóm bản ghi cần nonce/IV riêng; lưu authentication tag"* —
  đây chính xác là mô tả của per-field AEAD, không phải của SQLCipher (SQLCipher mã hóa cả page).
- Per-field cho phép để `created_at`, `role`, `status` ở dạng rõ → vẫn index/sort/query được.

**Đánh đổi bạn cần biết:** metadata (tiêu đề hội thoại? tên file?) sẽ lộ nếu để plaintext.
Hiện tại tôi **mã hóa cả `conversations.title`** và tên file đính kèm. Xem A9 về hệ quả với search.

**Sửa ở đâu nếu khác:** `packages/security/src/crypto.ts` + interface `FieldCipher` trong `packages/local-store/src/store.ts`.

---

### A3. 🔴 Atlassian PAT: 1 hay 2? Scope nào? Cùng domain không?

**Câu hỏi:** Jira và Confluence có dùng chung tài khoản/PAT không? PAT cần scope gì tối thiểu?

**Giả định đã dùng: 2 connection tách biệt, 2 PAT riêng.**
- Theo khuyến nghị §22.3 *"Cấu hình Jira và Confluence tách biệt"*.
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

**Ba phương án thay thế nếu bạn muốn scale (cần bạn quyết):**
1. Bảng `messages_fts` FTS5 lưu **plaintext** → nhanh nhưng phá vỡ tiêu chí §21
   *"nội dung không đọc được bằng công cụ SQLite thông thường"*. **Tôi không chọn.**
2. Blind index: lưu `HMAC(master_key, token)` cho từng từ → search exact-word được, không
   search substring/tiếng Việt có dấu tốt. Lộ pattern tần suất từ.
3. Giữ decrypt-and-scan nhưng cache chỉ mục giải mã trong RAM khi app đang mở.

**Khuyến nghị của tôi:** giữ nguyên phương án hiện tại cho MVP, đo lại ở pilot.

---

### A10. 🟡 Đánh giá Tauri?

Không làm. Dùng Electron theo §22.3.

**Lưu ý:** tôi CHƯA đo được RAM thật vì chưa mở được cửa sổ Electron trong môi trường này
(xem C1). Con số để so với mục tiêu §12.1 phải lấy trên máy Windows thật.

---

## B. Chỗ tài liệu chưa đủ để code — tôi đã tự thiết kế

### B1. 🟠 Cơ chế unlock DB — có app-level password không?

§8.2 nói master key bọc bằng DPAPI (gắn tài khoản Windows). Nhưng §11.3 nhắc *"khóa ứng dụng"* và
§16 nhắc *"DB unlock failure"* — hai chỗ này ngụ ý có mật khẩu riêng.

**Giả định đã dùng: KHÔNG có app password.** Master key được `safeStorage` bảo vệ, mở tự động theo
tài khoản Windows đang đăng nhập. `DB unlock failure` = trường hợp safeStorage không giải mã được
(profile Windows đổi, key hỏng, DB copy sang máy khác) → vào chế độ chẩn đoán, **không ghi đè**.

Nếu bạn muốn thêm app password, chỗ sửa là `packages/security/src/master-key.ts` — cần thêm một lớp
KDF (Argon2id) bọc ngoài. Không nhỏ.

---

### B2. 🟠 Context window management — cắt hay tóm tắt?

§7.2 chỉ nói *"cắt đoạn hoặc rút gọn nội dung theo context limit"*, không định nghĩa chiến lược khi
**hội thoại** dài (khác với file dài).

**Giả định đã dùng:** sliding window — luôn giữ system prompt + N message gần nhất vừa trong budget
token, message cũ bị **bỏ** (không tóm tắt). UI hiện chỉ báo "đã lược bỏ X tin nhắn cũ".

Không tóm tắt vì tóm tắt = thêm một lần gọi LLM ⇒ thêm chi phí, thêm độ trễ, thêm rủi ro rò rỉ nội
dung sang model. Nếu bạn muốn có tóm tắt, đó là scope thêm.

**Ước lượng token:** dùng heuristic ~4 ký tự/token (không có tokenizer thật vì không biết model
nào phía sau LiteLLM). Sai số có thể ±25% với tiếng Việt. **Đây là rủi ro:** có thể bị lỗi
context-length-exceeded. Tôi để `contextSafetyMargin: 0.8` để bù.

---

### B3. 🟠 Agent Runtime tool-calling loop — chưa được đặc tả

§5.2 nói Agent Runtime *"quyết định gọi model/tool"* nhưng không nói: bao nhiêu vòng tối đa? tool
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

§10.2 yêu cầu preview hiện *"trường hoặc đối tượng sẽ bị thay đổi"*. Với `create_issue` thì dễ —
hiện payload. Nhưng với `update_issue` thì để hiện "giá trị cũ → giá trị mới" cần **đọc trước**
đối tượng đích.

**Giả định đã dùng:** với tool WRITE_HIGH có `previewFetcher`, Confirmation Guard gọi tool READ
tương ứng trước để lấy giá trị hiện tại và hiện diff. Với `jira.update_issue` tôi gọi
`jira.get_issue` trước.

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

§16 nói *"tra cứu object/result trước khi cho phép retry"* nhưng không nói ai tra.

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

### C1. 🟠 Đã chạy thử trên Linux — Windows vẫn chưa

**Cập nhật:** môi trường có sẵn X11, nên tôi ĐÃ chạy được app thật. Kết quả:

```
app-starting
master-key-created        (safeStorage thật: gnome_libsecret)
local-db-opened           driver=node:sqlite
migration-applied         version=1
profile-created
ipc-registered            channelCount=33
window-ready              durationMs=304
```

Nghĩa là đường đi qua `safeStorage` **đã được kiểm chứng** — nhưng trên keyring của Linux, không
phải DPAPI của Windows. Việc còn lại trên máy Windows:

1. Xác nhận `safeStorage` chọn đúng DPAPI và credential mở lại được sau khi khởi động lại máy.
2. Xác nhận credential KHÔNG mở được từ tài khoản Windows khác (đó là điểm mấu chốt của §8.2).
3. Đo RAM và thời gian khởi động thật để so với §12.1.
4. Kiểm thử giao diện bằng tay — tôi chưa tương tác được với UI, chỉ xác nhận nó render.

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

### C5. 🟡 Chưa có `nexa-icon.ico`

`electron-builder.yml` trỏ tới `apps/desktop/resources/icon.ico` nhưng tôi không tạo được file icon
nhị phân. Cần design cấp file. Build sẽ dùng icon mặc định của Electron cho tới lúc đó.

---

## D. Điểm tôi thấy nên xem lại trong chính tài liệu

### D1. §4.2 nói "MCP stdio **hoặc** localhost chỉ bind loopback"

Nên chốt **chỉ stdio**. Localhost HTTP mở thêm bề mặt tấn công (process khác trên cùng máy gọi được
MCP server đang giữ PAT của người dùng, không có auth). stdio không có vấn đề này. Tôi đã code
stdio-only và **cố tình không** implement transport HTTP.

### D2. §11.2 "allowlist domain tổ chức nếu có" — nên là bắt buộc

Rủi ro §22.1 *"Người dùng nhập URL giả/malicious → gửi PAT sai đích"* rất thật. Nếu allowlist là
tuỳ chọn thì biện pháp giảm thiểu gần như không có tác dụng. Tôi đã code allowlist và để nó
**bật được từ file policy** (`resources/policy.json`, IT ghi đè lúc phân phối), mặc định rỗng =
không giới hạn. Đề nghị ATTT bắt buộc điền.

### D3. §21 "Cài và gỡ trên Windows không cần quyền admin"

NSIS per-user install làm được. Nhưng MSI cho IT phân phối tập trung thì **cần** admin. Hai mục tiêu
này mâu thuẫn nhẹ — cần nói rõ: NSIS = self-service không admin, MSI = IT deploy có admin.

### D4. Tài liệu không nói gì về **xoá một tin nhắn lẻ** hay **sửa tin nhắn**

Chỉ có CRUD ở mức conversation. Tôi không làm sửa/xoá message lẻ. Nếu người dùng lỡ dán nội dung
nhạy cảm vào chat thì cách duy nhất là xoá cả hội thoại. Có thể là thiếu sót đáng kể về mặt
quyền riêng tư — đề nghị cân nhắc thêm.

### D5. Không có yêu cầu nào về **i18n**

Tài liệu tiếng Việt, người dùng là nhân viên Việt Nam. Tôi hard-code chuỗi UI tiếng Việt, không
dựng hệ thống i18n. Nếu sau này cần tiếng Anh thì phải refactor.

---

## E. Phát sinh trong lúc triển khai — cần bạn biết

Những mục dưới đây không có trong tài liệu và cũng không phải câu hỏi mở lúc lập kế hoạch.
Chúng xuất hiện khi viết code, và tôi đã tự quyết định.

### E1. 🟢 Hai driver SQLite — đã giải quyết bằng cách nâng Electron

`better-sqlite3` là native module, cần toolchain C++ hoặc prebuild khớp phiên bản. Máy phát
triển không có toolchain và Node 24 chưa có prebuild, nên **toàn bộ test tầng lưu trữ sẽ không
chạy được** — mất luôn khả năng kiểm chứng phần mã hoá và migration.

**Giải pháp ban đầu:** tách interface driver, production dùng `better-sqlite3`, test dùng
`node:sqlite`. Rủi ro: hai driver khác nhau giữa test và production.

**Cập nhật sau khi chạy thử:** Electron 43 mang Node 24.18, và Node 24 có sẵn `node:sqlite`
(đã bỏ cờ experimental). Vì vậy:

- nâng lên **Electron 43**
- `better-sqlite3` chuyển thành **optionalDependency** — app chạy đầy đủ khi không có nó
- bước rebuild native trong CI thành `continue-on-error`

Rủi ro "test driver A, chạy driver B" gần như biến mất, và bộ cài không còn phụ thuộc bắt buộc
vào native module. Chi tiết ở [ADR 0003](architecture/adr/0003-sqlite-driver-abstraction.md).

**Câu hỏi còn lại cho bạn:** có chấp nhận `node:sqlite` (Node đánh dấu experimental) làm driver
chính không, hay muốn bắt buộc build `better-sqlite3` trong pipeline phát hành?

### E2. 🟡 `jira.create_issue` được xếp mức WRITE_LOW

§10.1 chỉ nêu ví dụ `jira.add_comment` = WRITE_LOW và `jira.update_issue` = WRITE_HIGH.
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

### E4. 🟡 "Kiểm tra kết nối" Jira/Confluence khởi động lại MCP

Không có cách nào kiểm tra credential Atlassian mà không đưa nó cho MCP server, và server nhận
credential lúc spawn. Vì vậy `connection.test` cho Jira/Confluence sẽ **restart tiến trình MCP**
rồi gọi một tool read nhẹ.

Hệ quả: bấm "Kiểm tra kết nối" giữa lúc đang có tool chạy sẽ làm hỏng tool đó. Hiện chưa chặn.
Nên thêm khoá nếu thấy phiền ở pilot.

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

### E8. 🟡 Chưa có file icon

`electron-builder.yml` trỏ tới `apps/desktop/resources/icon.ico` nhưng file đó chưa tồn tại —
tôi không tạo được file nhị phân. Build sẽ dùng icon mặc định của Electron. Cần design cấp file.

### E9. 🟡 Repo chưa được khởi tạo git

Tôi không chạy `git init` hay tạo commit nào. `.gitignore` và `.github/workflows/ci.yml` đã sẵn
sàng. Việc khởi tạo repo, đặt branch protection và bật gitleaks là việc của bạn.
