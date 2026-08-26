# Kế hoạch đánh giá lại thay đổi "lọc tool theo ngữ cảnh" (ADR 0009)

> Trạng thái đầu vào: `openspec/changes/loc-tool-theo-ngu-canh/tasks.md` đã tick 40/41 task;
> chỉ còn 7.4 bỏ trống và tự khai là bị chặn. Kế hoạch này **không** implement thêm tính năng —
> nó trả lời một câu: thay đổi này đã đủ tốt để commit/pilot chưa, và nếu chưa thì thiếu chỗ nào.

## 1. Mục tiêu và phạm vi

Mục tiêu:

1. Xác nhận thay đổi **chạy đúng** (verify + e2e xanh, không hồi quy).
2. Xác nhận thay đổi **đúng như tài liệu nói** (tasks/spec/ADR/OPEN-QUESTIONS khớp code thật, số đo trong ADR tái hiện được).
3. Tìm các lỗ hở **hành vi** mà test hiện tại chưa phủ, ưu tiên theo mức thiệt hại thật cho người dùng.
4. Chốt quyết định: commit như hiện tại / commit kèm sửa nhỏ / trả lại nhóm task nào.

Ngoài phạm vi:

- Đổi thiết kế preset (thêm/bớt/động hoá) — ADR 0009 đã chốt và ràng buộc lý do.
- Bật prompt caching trong `packages/llm-client` (ADR ghi rõ hiện chưa dùng).
- Đo tỉ lệ model thật gọi `nexa_mo_rong_tool` — cần LiteLLM thật, thuộc pilot (OPEN-QUESTIONS H1).

## 2. Bằng chứng hiện trạng đã thu

| Điểm | Bằng chứng | Ghi chú |
| --- | --- | --- |
| Lọc chạy sau `availableTools()`, chỉ thu hẹp cái model *thấy* | `packages/agent-runtime/src/agent-runtime.ts:604-620` | Cổng quyền `resolveCallable()` không đổi |
| Tool meta bị chặn trong `runTurn`, không vào registry | `packages/agent-runtime/src/agent-runtime.ts:189-212` | `continue` bỏ qua toàn bộ đường write |
| Bộ chọn là hàm thuần, nghiêng về read khi không chắc | `packages/agent-runtime/src/tool-preset-selector.ts:150-176` | 3 tín hiệu rời: jira / confluence / write |
| Bảng preset là hợp của 12 cờ hiện có | `packages/shared-types/src/tools.ts:118-140` | `tool-preset.test.ts` khẳng định `all` phủ trọn |
| Cờ `toolScoping` mặc định bật, khoá được qua `policy.json` | `packages/shared-types/src/settings.ts:77-92`; `packages/connection-config/src/connection-config.test.ts:459-472` | Đường rollback không cần build lại |
| Số đo ADR: 98 tool ≈ 10.661 token/vòng; `jira-read` 33 tool, `confluence-full` 35 tool | `docs/architecture/adr/0009-tool-preset-scoping.md:12-30` | Cộng cờ tay: 18+15=33 ✓, 19+1+9+6=35 ✓ |
| Test mới: 21 case trong `agent-runtime.test.ts`, 23 case selector, 10 case bảng preset, 1 e2e | `git diff --stat` | Phủ khá dày phần cơ chế |

## 3. Giả thuyết rủi ro cần kiểm chứng (xếp theo thiệt hại)

**R1 — System prompt quảng cáo một tool không tồn tại.** `DEFAULT_SYSTEM_PROMPT`
(`packages/agent-runtime/src/context-builder.ts:22`) **luôn** nói "hãy gọi `nexa_mo_rong_tool`",
nhưng `buildToolSpecs()` chỉ đưa tool đó vào khi `scoping && preset !== 'all'` **và**
`specs.length > 0`. Ba trạng thái prompt nói dối: cờ `toolScoping` tắt, preset = `all`, và MCP chưa
ready. Nếu model tin lời prompt và gọi ⇒ đi vào `executeToolCall` ⇒ `TOOL_NOT_ALLOWED`. Cần xác
minh mức thiệt hại: lỗi tool bình thường (model đọc rồi đi tiếp) hay `fatal` (cắt cả lượt).

**R2 — Mở rộng ở vòng cuối làm lượt chết bằng `MAX_TOOL_ITERATIONS`.** Lời gọi meta tính vào
`toolCallCount` và chiếm một vòng đầy đủ (task 4.7, có chủ ý). Nhưng nếu model gọi meta ở vòng cuối,
`runTurn` ném `MAX_TOOL_ITERATIONS` (`agent-runtime.ts:229`) — người dùng nhận lỗi thay vì câu trả
lời, đúng ở câu hỏi mà không lọc thì đã trả lời được. Test 4.12 chỉ khẳng định "gọi meta hai lần
không ném lỗi", chưa phủ ca cạn hạn mức. Đây là ca fail-**closed** duy nhất tìm được trong một cơ
chế tự nhận là fail-open.

**R3 — Từ khoá write khớp nhầm sau khi bỏ dấu.** Selector đã xử lý `dong`/`gan`/`trang thai`, nhưng
chưa thấy ca nào cho: `chuyen` ⊂ "chuyên môn", `them` ⊂ tiếng Anh "them", `tao` ⊂ "táo"/đại từ
"tao", `sua` ⊂ "sữa". Khớp nhầm write chỉ tốn token (gửi thừa ~30 tool write) chứ không sai kết quả
— nhưng nó ăn thẳng vào lợi ích của cả ADR, nên cần đo tỉ lệ, không chỉ đoán.

**R4 — Số trong tài liệu có tái hiện được không.** ADR ghi số token đo bằng tay. Cần một script đo
lại từ `buildToolRegistry()` cho cả 6 preset và đối chiếu bảng ở `ADR 0009:19-26`. Tài liệu đã tự
sửa một lần vì lấy sai nguồn số (`mcp-atlassian-tools.json` thay vì registry) — nên lần này phải là
số máy chạy ra, không phải số người gõ.

**R5 — Metric `expanded` có đo được điều nó hứa không.** OPEN-QUESTIONS H1 nói sẽ theo dõi tỉ lệ
`expanded`. Nhưng khi preset = `all` thì không log lần mở rộng (`agent-runtime.ts:200`), và rủi ro
thật (model **không** gọi meta, chỉ trả lời "không làm được") **không** sinh log nào. Cần kết luận
rõ: metric hiện tại đủ để phát hiện H1, hay chỉ đủ để đếm ca lành tính.

**R6 — Vệ sinh phạm vi commit.** `.omx/logs/`, `.omx/state/` đang bẩn trong `git status`; cần xác
định chúng có thuộc change này không (gần chắc là không) và có nên vào `.gitignore`.

## 4. Các bước đánh giá

### Giai đoạn A — Cổng chạy được (bắt buộc trước mọi bước khác)

- A1. `pnpm verify` (lint + typecheck + test). Ghi lại số test pass và thời gian.
- A2. `pnpm test:e2e` — riêng case ADR 0009 ở `tests/e2e/app.e2e.ts:374-421`.
- A3. `pnpm test:coverage`, đọc coverage của 3 file mới/đổi nhiều: `tool-preset-selector.ts`,
  `agent-runtime.ts`, `tools.ts`. Nhánh nào chưa chạm thì ghi ra, không tự bịt.

### Giai đoạn B — Đối chiếu tài liệu với code (không chạy gì, chỉ đọc)

- B1. Đi từng task đã tick trong `tasks.md`, chỉ tên file + dòng chứng minh. Task nào tick mà không
  chỉ được bằng chứng ⇒ untick lại.
- B2. Đối chiếu `specs/tool-scoping/spec.md` và `specs/tool-catalog-expansion/spec.md` với hành vi
  code thật; ghi mọi chỗ spec nói mạnh hơn code.
- B3. Kiểm tra ADR 0009 có thật sự ghi ràng buộc "preset phải cố định" như task 6.1 yêu cầu, và
  `docs/architecture/adr/README.md` đã có mục 0009.
- B4. Đọc `docs/security/threat-model.md`, đối chiếu trường của event `tool-preset`
  (`requestId`, `preset`, `toolCount`, `expanded`) — khẳng định không có trường bị cấm.

### Giai đoạn C — Kiểm chứng từng giả thuyết rủi ro

- C1 (R1). Đọc nhánh lỗi `executeToolCall` cho tên tool lạ, xác định `fatal` hay không. Viết một
  test tạm: `toolScoping: false` + model gọi meta ⇒ lượt kết thúc thế nào. Kết luận: sửa prompt cho
  có điều kiện, hay chấp nhận và ghi vào OPEN-QUESTIONS.
- C2 (R2). Test tạm: `maxToolIterations: 2`, model gọi meta ở vòng 1 rồi gọi tool thật ở vòng 2 ⇒
  còn vòng nào để trả lời không. Nếu ném `MAX_TOOL_ITERATIONS` ⇒ đề xuất tối thiểu (ví dụ không tính
  vòng meta vào trần, hoặc cấp thêm một vòng khi đã mở rộng) kèm cái giá của nó.
- C3 (R3). Dựng bộ 40–60 câu hỏi tiếng Việt thật (có/không dấu, trộn tiếng Anh, có/không issue key),
  gán preset kỳ vọng bằng tay, chạy `selectPreset` và lập ma trận nhầm. Chỉ tiêu: tỉ lệ khớp nhầm
  **write** ≤ 10%, tỉ lệ trượt hệ đích (chọn `all-read` khi thật ra là Jira/Confluence rõ ràng) ≤ 15%.
  Bộ câu hỏi này lưu thành fixture để lần sau đo lại được.
- C4 (R4). Script trong scratchpad: nạp `buildToolRegistry()`, với mỗi preset đếm tool + đếm ký tự
  khối `tools` sau `JSON.stringify` + chia 4 ra token. In bảng, so từng dòng với `ADR 0009:19-26`.
  Lệch >5% ⇒ sửa số trong ADR.
- C5 (R5). Truy đường log: một lượt bị model từ chối mà không gọi meta thì để lại dấu vết gì. Nếu
  không có gì ⇒ ghi thẳng hạn chế đó vào OPEN-QUESTIONS H1 (hiện H1 nói "dấu hiệu: tỉ lệ mở rộng gần
  0 trong khi người dùng vẫn báo lỗi" — cần khẳng định đó là dấu hiệu *duy nhất* có được).
- C6 (R6). `git check-ignore` cho `.omx/`; đề xuất `.gitignore` hoặc tách commit.

### Giai đoạn D — Chốt task 7.4

7.4 tự khai bị chặn bởi OPEN-QUESTIONS C2 (chưa có LiteLLM thật). Cần chốt một trong ba, **không để
lửng**:

1. Đổi 7.4 thành điều kiện pilot có chủ, ghi vào OPEN-QUESTIONS H1 làm mục kiểm tra sau pilot.
2. Hạ yêu cầu: mock LLM phát kịch bản "gọi meta rồi tạo issue" — đã có test 4.13, nên chỉ là ghi rõ
   phần nào *không* được chứng minh.
3. Chặn change đến khi có LiteLLM thật.

Đề xuất mặc định: (1), vì phần cơ chế đã phủ bằng test, phần chưa phủ là *xác suất quyết định của
model* — không kiểm được bằng bất kỳ test nào trong repo.

## 5. Tiêu chí chấp nhận

Đủ điều kiện commit khi **tất cả** đúng:

- A1, A2 xanh; không test nào bị skip thêm so với `main`.
- Mọi task đã tick chỉ được bằng chứng file:dòng (B1).
- Bảng số trong ADR 0009 tái hiện được, lệch ≤5% (C4).
- Không rủi ro nào ở mức "biến câu hỏi làm được thành lời từ chối / lỗi" còn để mở mà không có mục
  OPEN-QUESTIONS tương ứng (C1, C2, C5).
- Selector đạt chỉ tiêu C3, hoặc chỉ tiêu bị hạ **có ghi lý do**.
- `git status` sạch khỏi file không thuộc change (C6).

## 6. Đầu ra

1. Báo cáo đánh giá: từng giả thuyết R1–R6 → xác nhận / bác bỏ / kèm bằng chứng.
2. Danh sách sửa đề xuất, chia "phải sửa trước commit" và "ghi OPEN-QUESTIONS là đủ".
3. `tasks.md` được cập nhật trung thực (untick nếu cần) và 7.4 được chốt.
4. Fixture bộ câu hỏi + script đo token, để lần sau đo lại không phải dựng lại.
