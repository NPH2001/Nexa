# Kế hoạch đánh giá diff đang chưa commit — remediation chất lượng câu trả lời

> Ngày lập: 2026-08-26 · Chế độ: **review-only**, không sửa source sản phẩm trong vòng này.
> Đầu vào: worktree bẩn trên `main` (`e0d2cdf`) — 20 file sửa + 1 file test mới,
> +496/−78 dòng. Diff này hiện thực các hạng mục mà
> `.omx/plans/danh-gia-chat-tool-response-quality.md` mới chỉ *chẩn đoán*.
> Kế hoạch này trả lời một câu: **diff này đã đủ tốt để commit chưa; nếu chưa thì thiếu chỗ nào.**

## 1. Mục tiêu và phạm vi

Mục tiêu:

1. Xác nhận diff **chạy đúng** — lint/typecheck/format/test/e2e xanh, không hồi quy 390 unit + 17 e2e.
2. Xác nhận diff **giải quyết đúng vấn đề đã chẩn đoán** — đối chiếu từng metric ở mục 3.2 của
   plan gốc với hành vi code thật, tách rõ "đã có cơ chế" và "đã được chứng minh bằng số đo".
3. Tìm **hồi quy mới do chính diff sinh ra**, ưu tiên theo thiệt hại thật cho người dùng.
4. Chốt quyết định: commit như hiện tại / commit kèm sửa nhỏ / tách diff / trả lại phần nào.

Ngoài phạm vi:

- Xây corpus 48 case và chấm tone bằng người (bước 3-4 của plan gốc) — cần vòng riêng.
- Đo với LiteLLM/Jira/Confluence thật — chặn bởi OPEN-QUESTIONS A1/C2 🔴.
- Đổi thiết kế preset (ADR 0009 đã chốt) và bật prompt caching.
- Không `git stash`, không reset, không commit hộ trong pha đánh giá.

## 2. Bản đồ thay đổi

| Trục | Thay đổi | Điểm neo |
| --- | --- | --- |
| A. Trần cắt kết quả tool | 4.000 → **12.000 ký tự**; `truncate()` (cắt đuôi) → `summarizeModelText()` (giữ 70% đầu + 30% cuối, trả cờ `incomplete` + số ký tự đã lược) | `tool-registry/shared.ts:16`, `:34-72` |
| B. Cờ chưa-đầy-đủ xuyên tầng | `ToolResultSummary.incomplete/completenessNote` mới; runtime bọc tool result bằng `[KẾT QUẢ CÔNG CỤ CHƯA ĐẦY ĐỦ]`; system prompt dạy model xử lý marker | `shared-types/src/tools.ts:62-69`, `agent-runtime.ts:736-746`, `context-builder.ts:19-26` |
| C. Giàu field hơn | Jira issue thêm block "Dữ liệu có cấu trúc" (full JSON đã sanitize URL); Jira search bỏ `slice(0,20)`, mỗi issue là JSON đầy đủ, header nói rõ trang hiện tại/tổng | `jira-shared.ts:43-51`, `:67-93` |
| D. MCP non-text block | `contentToText` không còn lọc bỏ block ảnh/resource/unknown mà chèn placeholder + marker | `mcp-client/src/protocol.ts:101-121` + test mới |
| E. Kết thúc lượt trung thực | Xử lý `finish_reason=length` / `content_filter`; chặn text rỗng ở trạng thái complete; lỗi fatal có `terminalText` bằng ngôn ngữ người dùng | `agent-runtime.ts:170-206`, `:250-266`, `:330-345`, `:451-459`, `:621-626` |
| F. Lỗi tới được người dùng | Controller không lưu message rỗng khi throw, `hint` vào `ChatErrorEvent`; toast lỗi cho tool `failed`; mã lỗi hiện trong bubble | `chat-controller.ts:334-369`, `ipc.ts:216-226`, `App.tsx:215-244`, `ChatView.tsx:465-469` |

## 3. Giả thuyết rủi ro cần kiểm chứng (xếp theo thiệt hại)

**R1 — Ngân sách ngữ cảnh không tính tool result (cao nhất).** Tool result được `messages.push()`
thẳng (`agent-runtime.ts:250`), không đi qua `buildContext()`/`ContextBudget`. Trần vừa tăng gấp 3
(4.000 → 12.000 ký tự) và mỗi lượt có thể nhiều tool call × `maxToolIterations` vòng, cộng ~10.661
token tool schema khi preset = `all` (ADR 0009). Comment ước lượng "12.000 ký tự ≈ 3.000-4.000
token" chưa được đo với **tiếng Việt có dấu** — nhiều tokenizer tách nặng hơn cho tiếng Việt.
Hệ quả xấu nhất: request vượt context window → `LLM_CONTEXT_EXCEEDED`, tức là biến "trả lời thiếu"
thành "không trả lời được". **Đây là rủi ro phải đo trước khi commit.**

**R2 — Mất phần text đã stream ở các vòng trước khi gặp lỗi fatal.** Trước diff, nhánh fatal trả
`text: finalText` thường rỗng ⇒ controller fallback sang biến `text` tích luỹ toàn bộ stream
(`chat-controller.ts:311`). Sau diff, text luôn khác rỗng ⇒ `result.text` thắng, mà `finalText` chỉ
giữ text của **vòng gần nhất** (`agent-runtime.ts:215`). Renderer reload message sau `chat-done`
(`App.tsx:200-203`), nên đoạn người dùng vừa đọc có thể biến mất. Tái hiện: vòng 1 text A + tool
call thành công → vòng 2 text B + tool call fatal.

**R3 — Message lỗi được lưu ở trạng thái `complete`.** Runtime nay tự sinh câu xin lỗi và **return**
(không throw) cho cả `length`, `content_filter`, text rỗng, tool fatal ⇒ controller đi nhánh
thành công: `finalizeMessage(..., 'complete')`, không `errorCode`, audit `chatCompleted` = ok
(`chat-controller.ts:310-320`). "Empty-success rate = 0%" đạt, nhưng đổi thành "complete sai trạng
thái", làm hỏng thống kê lỗi và nút retry của UI. Cần chốt: các nhánh này nên là `error`/`incomplete`?

**R4 — Nhánh `length` đặt trước cả nhánh tool call.** Nếu provider trả `finish_reason=length` trong
vòng model đang phát `tool_calls`, toàn bộ tool call bị bỏ im lặng; và khi `turn.text` rỗng,
message bắt đầu bằng hai dòng trống rồi tới câu thông báo. Cần quyết định hành vi mong muốn và test.

**R5 — Marker là hợp đồng chuỗi rải 3 nơi, chỉ 1 nơi strip.** Hằng số ở `protocol.ts:12`, được
`summarizeGeneric` nhận diện và cắt bỏ (`shared.ts:111-116`), rồi runtime **chèn lại** khi
`incomplete` (`agent-runtime.ts:736`). Đường Jira/Confluence không strip: payload vừa có non-text
block vừa parse được JSON sẽ mất marker, hoặc bị marker chồng marker. Cần contract test cho cả
ba đường đi và cân nhắc chuyển sang cờ có kiểu thay vì so khớp chuỗi.

**R6 — `summarizeModelText` có hai con số mâu thuẫn và cắt giữa JSON.** Marker giữa văn bản báo
`omitted` tính theo `contentBudget`, còn `completenessNote` báo theo `adjustedBudget` — hai số khác
nhau trong cùng một kết quả (`shared.ts:47-70`). Ngoài ra cắt theo code unit UTF-16 có thể vỡ ký tự,
và cắt giữa chuỗi JSON làm phần "Dữ liệu có cấu trúc" không còn parse được ⇒ model dễ đọc sai
đúng chỗ đang cố cứu. Cần property test: `forModel.length <= max`, không vỡ ký tự, có nói rõ JSON đã cắt.

**R7 — Data minimization: gửi nhiều dữ liệu nội bộ hơn ra ngoài.** Jira search bỏ giới hạn 20 và đổi
từ 3 field sang `JSON.stringify` nguyên issue; Jira issue thêm full JSON. Lượng dữ liệu nghiệp vụ
rời máy tăng đáng kể, trong khi **Nexa có đường nối OpenAI trực tiếp chưa được ATTT duyệt**
(README + OPEN-QUESTIONS F1 🔴). Phải đối chiếu `docs/security/threat-model.md` và chạy lại 44 test
redaction (mục 6 pre-pilot checklist đang ✅ — không được để tuột).

**R8 — Đổi chuỗi `forUser` là đổi dữ liệu đã lưu.** `Kết quả dài N ký tự` → `Đã nhận kết quả từ công
cụ (N ký tự)`, cộng hậu tố ` · kết quả chưa đầy đủ`, và số dùng `toLocaleString('vi-VN')` (phụ thuộc
ICU của Node/Electron). Chuỗi này ghi vào `result_summary_ciphertext` và hiện trong bubble. Rà mọi
test/e2e/snapshot phụ thuộc chuỗi cũ, và kiểm tra format số trên Windows build.

**R9 — Bề mặt IPC/UI.** `ChatErrorEvent` chuẩn hoá `request_id` snake_case trong khi mọi event khác
camelCase (`ipc.ts:214-226`) — nay đóng dấu vào shared-types. Toast lỗi nối `hint · Mã yêu cầu` có
thể tràn; `phase: 'failed'` được emit từ 4 chỗ trong runtime nên một lượt lỗi có thể bắn nhiều toast
đỏ liên tiếp. `.error-inline` có tồn tại (`styles.css:505`) nhưng nằm trong `<span>` inline —
cần xem hiển thị thật.

**R10 — Nhiễu format.** `ToolPreset` bị gộp về một dòng và một dòng trống trong `ipc.ts` bị xoá —
dấu hiệu chạy formatter khác cấu hình. `pnpm format:check` phải xanh, nếu không diff sẽ lẫn
thay đổi cơ học vào thay đổi hành vi.

## 4. Các vòng đánh giá

### G0 — Baseline tái lập được (~20 phút)

```bash
git rev-parse HEAD && git diff --stat | tail -1 && git diff | sha256sum
pnpm lint && pnpm typecheck && pnpm format:check
pnpm test 2>&1 | tail -30
pnpm test:e2e 2>&1 | tail -30
```

**Cổng pass:** 4 lệnh xanh; số test ≥ 390 unit + 17 e2e; ghi lại SHA + hash diff cho mọi số đo sau.
Fail ở đây thì dừng, không đánh giá tiếp — không trộn lỗi wiring với lỗi thiết kế.

**Kết quả chạy 2026-08-26** (SHA `e0d2cdf`, diff-hash `fe69b6d7d736ab4b`, Node 22.22.2, pnpm 9.15.0):

| Cổng | Kết quả |
| --- | --- |
| `pnpm lint` | ✅ sạch |
| `pnpm typecheck` | ✅ sạch |
| `pnpm format:check` | ❌ 84 file bẩn — **nhưng không file source nào thuộc diff**; chỉ 2 file `.omx/state/*.json` (state của tooling). Nợ có sẵn trên `e0d2cdf`, và CI **không** chạy format:check (chỉ `verify` = lint+typecheck+test, cộng e2e). ⇒ **R10 đóng: diff sạch prettier.** |
| `pnpm test` | ✅ 24 file / **456 test** pass, 8,6 s |
| `pnpm test:e2e` | ✅ **17 pass**, 2 skip (Windows-only), 1,4 phút — gồm case mới `finish_reason=length` |

Ghi chú cho G5: README đang nói "390 unit + 17 E2E (15 Linux + 2 Windows)" — số thật nay là
456 unit và 19 E2E (17 Linux + 2 Windows). README bị lệch, phải cập nhật khi commit.

**Kết luận G0: xanh, đủ điều kiện đánh giá tiếp.** Không có lỗi wiring che lấp lỗi thiết kế.


### G1 — Rà hợp đồng tĩnh (~1 giờ, không chạy gì)

- Grep toàn bộ consumer của `ToolResultSummary` (6 file) xem có chỗ nào bỏ qua `incomplete`.
- Truy vết marker qua 3 đường: generic / Jira / Confluence — lập bảng "vào bằng gì, ra bằng gì".
- Đối chiếu `ChatErrorEvent` với preload/bridge/IPC allowlist (35 channel) — không được có kênh mồ côi.
- Kiểm tra mọi chuỗi hằng người dùng thấy có bị test cũ khoá cứng không.

**Cổng pass:** mỗi rủi ro R2, R3, R5, R8, R9 được kết luận **đúng / sai / cần chạy thử**, có `file:line`.

### G2 — Test hành vi cho hồi quy mới (~2-3 giờ, viết test đỏ trước)

Bảng test tối thiểu phải bổ sung:

| Rủi ro | Test | Nơi đặt |
| --- | --- | --- |
| R2 | 2 vòng tool, vòng 2 fatal → message lưu phải chứa cả text vòng 1 | `agent-runtime.test.ts` |
| R3 | mỗi nhánh tự-sinh-text → khẳng định `status`/`errorCode` mong muốn | `chat-controller.test.ts` |
| R4 | `finish_reason='length'` kèm tool call; `length` với text rỗng | `agent-runtime.test.ts` + `fake-llm.ts` |
| R5 | payload Jira/Confluence có non-text block → marker xuất hiện đúng 1 lần | `mcp.test.ts` |
| R6 | property test: độ dài ≤ max, hai con số trùng nhau, JSON bị cắt được báo | `shared.ts` test mới |
| R6 | biên 11.999 / 12.000 / 12.001 ký tự; fact ở đầu / giữa / cuối | như trên |
| R7 | payload chứa email/PAT-lookalike → không rò vào log/DB | test redaction hiện có |
| R8 | reload hội thoại sau lượt incomplete → text và `resultSummary` không đổi | e2e |
| R9 | một lượt nhiều tool fail → số toast mong muốn | `App` test / e2e |

**Cổng pass:** mọi rủi ro G1 xếp "cần chạy thử" đều có test kết luận được, không còn "có vẻ".

### G3 — Đo ngân sách token thật (bắt buộc, ~1-2 giờ)

Đây là vòng quyết định số 12.000 đúng hay sai.

- Sinh fixture tiếng Việt có dấu 12.000 ký tự; đo token bằng cách `buildContext` đang ước lượng
  **và** bằng usage thật của mock/LiteLLM — báo cả hai, không lấy một con số.
- Ma trận: context window {8k, 32k, 128k} × số tool call {1, 3, 8} × preset {`jira-read`, `all`}.
- Ghi: token schema tool, token tool result, token còn lại cho câu trả lời, có vượt window không.

**Cổng pass:** với mọi ô của ma trận, hoặc request không vượt window, hoặc có cơ chế cắt/cảnh báo
đã được test. Nếu có ô đỏ ⇒ R1 là **P0 chặn commit**, phải hạ trần hoặc đưa tool result vào ngân sách.

### G4 — E2E và UX (~1-2 giờ)

- Mở rộng mock LiteLLM để trả lời dựa trên tool result (plan gốc bước 5) — hiện đã có mầm trong diff.
- E2E: read tool payload dài → câu trả lời có nói rõ chưa đầy đủ; tool fatal → toast + mã lỗi trong
  bubble; `finish_reason=length` → có câu hướng dẫn "tiếp tục"; reload không đổi nội dung.
- Xem thật màn hình: câu thông báo dài có làm vỡ layout bubble/toast không.

**Cổng pass:** mọi P0/P1 phát hiện ở G1-G3 đều tái hiện được bằng test tự động, không chỉ bằng lập luận.

### G5 — Đối chiếu tài liệu (~45 phút)

- Với từng metric mục 3.2 plan gốc, đánh dấu: *đã có cơ chế trong code* / *đã có test* / *cần corpus*.
- Trần 12.000 và cơ chế `incomplete` là quyết định kiến trúc mới ⇒ cần một ADR (0010) hoặc mục
  bổ sung, vì ADR 0009 vừa lấy ngân sách token làm lý do chính.
- Cập nhật `docs/OPEN-QUESTIONS.md` (mục mới: gửi full JSON issue ra provider — chờ ATTT) và
  `docs/operations/pre-pilot-checklist.md` mục 6 nếu bề mặt dữ liệu đổi.
- Diff chạm system prompt ⇒ ghi lại phiên bản prompt để so sánh trước/sau ở vòng eval sau.

### G6 — ATTT và tối thiểu hoá dữ liệu (~30 phút, cần người quyết)

Lập một trang: trước diff Nexa gửi field gì ra LiteLLM/OpenAI, sau diff gửi thêm gì, ước lượng số
issue/trang mỗi lượt. Đây là câu hỏi cho ATTT, không phải quyết định của người viết code — gắn vào
OPEN-QUESTIONS F1.

## 5. Số đo phải có trong báo cáo

| Số đo | Nguồn |
| --- | --- |
| lint / typecheck / format / unit / e2e | G0 |
| token tool result theo ma trận, tỉ lệ ô vượt window | G3 |
| số hồi quy mới theo severity P0-P3, kèm test tái hiện | G2, G4 |
| metric plan gốc 3.2: cái nào đã được code bảo đảm, cái nào chỉ mới "có cơ chế" | G5 |
| delta dữ liệu gửi ra ngoài (field/issue mỗi lượt) | G6 |

## 6. Cổng quyết định

- **Commit như hiện tại** — G0 xanh, G3 không có ô đỏ, không có P0/P1 mới.
- **Commit kèm sửa nhỏ** — chỉ còn P2/P3 (ví dụ R6 hai con số lệch, R4 hai dòng trống, R9 toast).
- **Tách diff** — trục A+B+D (an toàn dữ liệu) commit trước; trục C (full JSON) chờ ATTT ở G6.
- **Trả lại** — G3 có ô đỏ, hoặc R2/R3 xác nhận làm mất/ghi sai message của người dùng.

## 7. Điều vòng này **không** kết luận được

- Model thật có tuân thủ marker `[KẾT QUẢ CÔNG CỤ CHƯA ĐẦY ĐỦ]` không — cần LiteLLM thật (A1/C2 🔴).
- Recall/tone theo mục 3.2-3.3 plan gốc — cần corpus 48 case và 2 người chấm.
- Hành vi `toLocaleString('vi-VN')` và DPAPI trên Windows — cần máy Windows (C1 🔴).

Ba mục này phải được ghi rõ là **chưa kiểm chứng** trong báo cáo, không được suy ra từ test mock.
