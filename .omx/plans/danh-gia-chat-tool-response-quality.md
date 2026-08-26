# Kế hoạch kiểm tra và đánh giá chất lượng câu trả lời từ tool

## 1. Mục tiêu và phạm vi

Mục tiêu là đo được, tái hiện được và ưu tiên được hai vấn đề người dùng đang gặp:

1. Câu trả lời của Nexa chưa đủ thân thiện, rõ ràng và hữu ích.
2. Khi tool trả nhiều dữ liệu, câu trả lời cuối bỏ sót thông tin quan trọng.

Kế hoạch này chỉ xây dựng baseline, bộ test/eval, báo cáo nguyên nhân và cổng quyết định cho vòng sửa tiếp theo. Không thay đổi prompt, runtime, summarizer, UI hoặc schema lưu trữ trong phạm vi hiện tại.

### Ngoài phạm vi

- Chọn giải pháp kỹ thuật cuối cùng để sửa truncation/summarization.
- Lưu raw tool output của người dùng thật hoặc nới chính sách logging dữ liệu nghiệp vụ.
- Tối ưu latency/token cost trước khi có baseline chất lượng.

## 2. Bằng chứng hiện trạng

### Evidence

| Phát hiện                                                                                                                                                                              | Bằng chứng                                                                                                                                    | Tác động cần đo                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| System prompt chỉ yêu cầu tiếng Việt, ngắn gọn và chính xác; chưa có tiêu chí cụ thể về giọng điệu thân thiện, cấu trúc, bảo toàn trường quan trọng hoặc thông báo khi dữ liệu bị cắt. | `packages/agent-runtime/src/context-builder.ts:16-24`                                                                                         | Độ thân thiện hiện phụ thuộc nhiều vào hành vi mặc định của model.                       |
| Raw MCP text được đổi thành `ToolResultSummary`, và runtime chỉ đưa `summary.forModel` về model.                                                                                       | `packages/atlassian-mcp-manager/src/manager.ts:387-423`; `packages/agent-runtime/src/agent-runtime.ts:356-371`                                | Eval phải so sánh raw fixture với nội dung model thực sự nhận và câu trả lời cuối.       |
| Kết quả generic bị cắt cứng ở 4.000 ký tự.                                                                                                                                             | `packages/atlassian-mcp-manager/src/tool-registry/shared.ts:8-27`; `:66-71`                                                                   | Dữ kiện nằm sau ký tự 4.000 có nguy cơ biến mất trước khi model tổng hợp.                |
| Tóm tắt một Jira issue chỉ giữ key, tiêu đề, trạng thái, assignee và mô tả dù payload mặc định có thêm priority, labels, reporter, created, updated, versions.                         | `packages/atlassian-mcp-manager/src/tool-registry/jira-shared.ts:19-48`                                                                       | Cần đo field recall theo câu hỏi, không chỉ kiểm tra câu trả lời có text.                |
| Jira search chỉ chuyển tối đa 20 issue và chỉ giữ key/summary/URL.                                                                                                                     | `packages/atlassian-mcp-manager/src/tool-registry/jira-shared.ts:51-71`                                                                       | Cần test tổng số, phân trang, phần tử sau top 20 và các field người dùng yêu cầu.        |
| MCP content không phải text bị bỏ khỏi chuỗi đưa về model.                                                                                                                             | `packages/mcp-client/src/protocol.ts:47-51`; `:100-107`                                                                                       | Cần contract test cho text/image/resource/unknown block và thông báo không hỗ trợ.       |
| Raw result không được giữ trong lịch sử hội thoại; context lượt sau chỉ nạp role/content của message.                                                                                  | `packages/atlassian-mcp-manager/src/manager.ts:79-83`; `packages/local-store/src/repositories/conversation-repository.ts:285-301`; `:405-412` | Nếu lượt đầu bỏ sót dữ kiện, follow-up có thể không lấy lại được nếu không gọi tool lại. |
| Runtime nhận biết `finish_reason='length'` ở parser/type nhưng không xử lý finish event khi chạy lượt.                                                                                 | `packages/llm-client/src/types.ts:40-47`; `packages/agent-runtime/src/agent-runtime.ts:237-275`                                               | Câu trả lời bị cắt có thể bị đánh dấu hoàn tất mà không cảnh báo.                        |
| Lỗi auth/config của read tool có thể trả fatal ngay trước lượt diễn đạt lại của model; controller vẫn có đường lưu message complete.                                                   | `packages/agent-runtime/src/agent-runtime.ts:382-389`; `:217-227`; `apps/desktop/src/main/chat-controller.ts:310-329`                         | Cần test “không có complete rỗng” và hint phục hồi thân thiện.                           |
| UI chỉ xử lý toast cho tool `uncertain` và `done`, không xử lý riêng `failed`; tool error code cũng không được render trong danh sách tool call.                                       | `apps/desktop/src/renderer/App.tsx:224-235`; `apps/desktop/src/renderer/components/ChatView.tsx:453-475`                                      | Người dùng có thể không biết tool nào hỏng, vì sao và cần làm gì tiếp.                   |
| Câu trả lời được render dưới dạng chuỗi thuần.                                                                                                                                         | `apps/desktop/src/renderer/components/ChatView.tsx:443-450`; `apps/desktop/src/renderer/styles.css:382-385`                                   | Markdown/bảng/link do model sinh có thể khó đọc hoặc không bấm được.                     |
| Test runtime hiện dùng câu trả lời được script sẵn, còn E2E chat chỉ kiểm tra câu chào cố định.                                                                                        | `packages/agent-runtime/src/agent-runtime.test.ts:440-454`; `tests/fixtures/mock-litellm-server.mjs:111-139`; `tests/e2e/app.e2e.ts:151-169`  | Test đang chứng minh wiring, chưa đo groundedness, completeness hoặc friendliness.       |

### Inference cần được kiểm chứng

- Độ tin cậy cao: chuỗi `raw result → summary tối đa 4.000 ký tự → model tổng hợp một lần` là nguồn chính của việc bỏ sót dữ kiện khi tool trả dài.
- Độ tin cậy cao: `finish_reason=length` và nhánh fatal tool error là hai lỗi UX độc lập, có thể tạo câu trả lời cụt hoặc rỗng mà vẫn trông như đã hoàn tất.
- Độ tin cậy trung bình: cảm giác “chưa thân thiện” đến từ cả prompt tối giản lẫn cách UI hiển thị text/tool status; phải tách hai yếu tố bằng eval model-output và usability test.

## 3. Tiêu chí chấp nhận

### 3.1. Bộ dữ liệu đánh giá

- Có tối thiểu 48 case tổng hợp/anonymized, không chứa dữ liệu nội bộ thật.
- Mỗi nhóm dưới đây có ít nhất 4 case và có cả happy path lẫn edge case:
  1. Jira issue đơn với payload nhiều field.
  2. Jira search với 0, 1, 20, 21 và 100+ kết quả.
  3. Confluence page ngắn/dài, dữ kiện mục tiêu nằm ở đầu, giữa và cuối payload.
  4. Hai hoặc nhiều tool result trong cùng lượt, có dữ kiện xung đột hoặc bổ sung nhau.
  5. Payload shape lạ và MCP content block không phải text.
  6. Tool error recoverable, fatal, uncertain và timeout.
  7. Câu trả lời bị `finish_reason=length`.
  8. Follow-up hỏi lại một dữ kiện đã có trong tool result ở lượt trước.
- Mỗi case khai báo machine-readable: user request, raw tool fixture, tool summary dự kiến, danh sách fact bắt buộc, fact cấm suy diễn, yêu cầu tone/format và severity nếu bị bỏ sót.

### 3.2. Metric “không miss thông tin”

- **Critical fact recall = 100%** cho key/id, trạng thái, tổng số, lỗi/blocker, URL đích và mọi field người dùng hỏi trực tiếp.
- **Overall required-fact recall >= 95%** trên toàn bộ corpus.
- **Grounded precision = 100%**: không có fact nghiệp vụ nào không được hỗ trợ bởi fixture/tool result.
- **Multi-tool coverage = 100%**: mọi tool result liên quan tới câu hỏi được dùng hoặc câu trả lời nói rõ vì sao chưa dùng được.
- **Truncation disclosure = 100%**: khi summary/pagination/output limit làm dữ liệu không đầy đủ, câu trả lời không được trình bày như kết luận toàn bộ.
- **Empty-success rate = 0%**: không có assistant message rỗng ở trạng thái `complete`.
- **Silent length-cut rate = 0%**: output kết thúc vì `length` phải được nhận diện là chưa đầy đủ và có hướng tiếp tục.

### 3.3. Metric “thân thiện với người dùng”

Chấm từng câu trả lời theo thang 1-5 trên năm chiều:

1. Trả lời trực tiếp đúng câu hỏi ngay phần đầu.
2. Ngôn ngữ tự nhiên, lịch sự, không máy móc hoặc đổ lỗi cho người dùng.
3. Cấu trúc dễ quét; chi tiết nhiều được nhóm hợp lý.
4. Minh bạch về giới hạn, nguồn/tool đã dùng và mức chắc chắn.
5. Khi lỗi/thiếu dữ liệu, có bước tiếp theo cụ thể và khả thi.

Ngưỡng đạt:

- Điểm trung bình mỗi chiều >= 4,2/5.
- Không case nào dưới 3/5 ở bất kỳ chiều nào.
- 100% lỗi fatal/recoverable có thông báo bằng ngôn ngữ người dùng và hành động tiếp theo; không chỉ hiện mã lỗi.
- Hai người chấm độc lập trên ít nhất 20% corpus; weighted Cohen's kappa >= 0,6. Nếu thấp hơn, sửa rubric và chấm lại trước khi dùng kết quả để quyết định.

### 3.4. Usability smoke test

- Tối thiểu 5 người dùng đại diện pilot, mỗi người làm 4 tác vụ: tra cứu issue, tổng hợp danh sách dài, đọc trang Confluence dài, xử lý một lỗi tool.
- Task success >= 90%; người dùng tìm đúng key fact mà không cần hỏi lại.
- Điểm “tôi hiểu câu trả lời và biết bước tiếp theo” trung vị >= 4/5.
- Không có blocker P0/P1 về câu trả lời trắng, kết luận sai do dữ liệu bị cắt hoặc trạng thái lỗi gây hiểu nhầm.

## 4. Kế hoạch thực hiện

### Bước 1 — Đóng băng baseline có thể tái lập

**Mục đích:** tách lỗi wiring khỏi lỗi chất lượng câu trả lời.

- Ghi commit SHA, model/provider, context window, app settings, tool preset và thời điểm chạy cho mỗi eval.
- Chạy baseline unit/contract hiện có trên:
  - `packages/agent-runtime/src/agent-runtime.test.ts`
  - `packages/atlassian-mcp-manager/src/mcp.test.ts`
  - `apps/desktop/src/main/chat-controller.test.ts`
- Chạy E2E hiện có từ `tests/e2e/app.e2e.ts` để xác nhận app, mock LiteLLM và mock MCP còn đi qua đúng đường production.
- Lưu baseline theo ba tầng: raw fixture → `forModel` → final answer. Raw fixture chỉ tồn tại trong test artifact tổng hợp, không lấy từ production log.

**Đầu ra:** báo cáo baseline kèm phiên bản và danh sách case fail; không gộp lỗi contract với lỗi model behavior.

### Bước 2 — Xây contract test cho bảo toàn dữ liệu trước model

**Mục đích:** chứng minh dữ kiện bị mất ở parser, summarizer hay sau khi model đã nhận đủ.

- Bổ sung fixture dài và field-rich quanh `tests/fixtures/mock-mcp-server.mjs`.
- Test từng content block tại `packages/mcp-client/src/protocol.ts:75-107`.
- Test raw-to-summary cho generic/Jira/Confluence tại:
  - `packages/atlassian-mcp-manager/src/tool-registry/shared.ts`
  - `packages/atlassian-mcp-manager/src/tool-registry/jira-shared.ts`
  - `packages/atlassian-mcp-manager/src/tool-registry/confluence-shared.ts`
- Với mỗi fixture, sinh diff machine-readable gồm: field raw, field `forModel`, field bị bỏ, vị trí ký tự bị cắt và dấu hiệu truncation có/không.
- Thêm case 3.999/4.000/4.001 ký tự, key fact ở đầu/giữa/cuối, 20/21 item và nhiều tool result cộng dồn.

**Cổng pass:** 100% case phân loại được điểm mất dữ liệu; không còn case “answer miss” mà không biết mất trước hay sau LLM.

### Bước 3 — Xây eval harness cho độ đầy đủ và groundedness

**Mục đích:** đo câu trả lời cuối thay vì chỉ kiểm tra runtime có chạy.

- Mở rộng `tests/support/fake-llm.ts` hoặc tạo eval harness riêng để lưu toàn bộ request từng vòng, đặc biệt message `role='tool'`.
- Tạo corpus machine-readable theo mục 3.1; expected facts dùng ID ổn định để chấm tự động.
- Chấm deterministic trước: exact/normalized match cho key, URL, trạng thái, tổng số, ngày, tên người và error state.
- Chấm semantic sau cho diễn đạt/paraphrase; mọi case semantic fail phải được người chấm xác nhận, không dùng LLM judge làm nguồn duy nhất.
- Với model thật, chạy mỗi case ít nhất 3 lần cho từng model pilot vì runtime không đặt temperature cố định (`packages/llm-client/src/types.ts:27-33`; `packages/agent-runtime/src/agent-runtime.ts:243-253`). Báo cả trung bình và worst run.
- Phân loại failure theo stage: parser, summarizer, tool-loop/context, model synthesis, finish handling, controller persistence, renderer.

**Cổng pass:** dashboard xuất được critical recall, overall recall, grounded precision, truncation disclosure, empty-success và silent-length-cut theo model và theo loại tool.

### Bước 4 — Đánh giá tone và khả năng hành động

**Mục đích:** biến “thân thiện” thành rubric lặp lại được.

- Dùng cùng corpus nhưng thêm intent/tone requirement cho các tình huống: thành công, không tìm thấy, thiếu input, lỗi quyền, timeout, dữ liệu mâu thuẫn, kết quả dài.
- Hai reviewer hiệu chỉnh rubric trên 8 case trước khi chấm chính thức.
- Chấm mù: reviewer không biết model/prompt variant để giảm thiên lệch.
- Ghi lỗi bằng tag cố định: `too-terse`, `robotic`, `blames-user`, `no-next-step`, `unclear-limit`, `poor-structure`, `raw-error-code`, `overclaim`.
- Tách điểm “nội dung model sinh” khỏi điểm “UI trình bày” vì renderer hiện hiển thị text thuần tại `apps/desktop/src/renderer/components/ChatView.tsx:443-450`.

**Cổng pass:** có scorecard theo năm chiều, inter-rater agreement đạt ngưỡng và top failure patterns có ví dụ tái lập.

### Bước 5 — Kiểm tra end-to-end và usability

**Mục đích:** xác nhận dữ liệu đúng vẫn hiển thị đúng và người dùng hiểu được.

- Mở rộng mock LiteLLM để phản hồi dựa trên tool result thay vì luôn trả câu chào cố định tại `tests/fixtures/mock-litellm-server.mjs:111-139`.
- Thêm E2E read-tool → answer với payload ngắn, payload dài, nhiều tool, fatal error và `finish_reason=length`.
- Assertion đồng thời trên final assistant text, tool status, error/hint, message status và nội dung sau reload conversation.
- Chạy usability smoke theo mục 3.4; ghi thời gian tìm key fact, số lần hỏi lại và mức tự tin.

**Cổng pass:** E2E tái hiện được toàn bộ lỗi P0/P1 đã phát hiện; usability đạt ngưỡng hoặc tạo backlog có severity rõ.

### Bước 6 — Báo cáo và cổng quyết định cho vòng sửa

**Mục đích:** ưu tiên sửa theo bằng chứng, không sửa prompt một cách cảm tính.

- Xuất ma trận `failure → stage → tần suất → severity → model/tool bị ảnh hưởng → hướng khắc phục khả dĩ`.
- Xếp P0: hallucination nghiệp vụ, critical fact bị mất, complete rỗng, silent truncation gây kết luận sai.
- Xếp P1: lỗi không có hướng phục hồi, multi-tool bỏ nguồn, follow-up không lấy lại dữ kiện.
- Xếp P2: tone máy móc, cấu trúc khó quét, Markdown/link không usable nhưng không làm sai nội dung.
- Chỉ mở vòng thiết kế/sửa khi đã biết ít nhất 80% failure thuộc stage nào và có baseline metric để so sánh trước/sau.

**Đầu ra cuối:** evaluation report, corpus/fixtures, automated scorecard, human/usability notes và backlog ưu tiên. Dừng ở đây; không tự triển khai remediation trong workflow kế hoạch này.

## 5. Ma trận test tối thiểu

| Tầng             | Case bắt buộc                                                                                | Bằng chứng pass                                                            |
| ---------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| MCP protocol     | text, nhiều text block, image/resource/unknown, error block                                  | Không có content type biến mất âm thầm; unsupported type được đánh dấu rõ. |
| Summarizer       | 4.000 boundary, field-rich issue, 20/21 search, long page, payload lạ                        | Diff raw→forModel xác định mọi field bị mất và truncation.                 |
| Runtime          | single tool, multi-tool, recoverable/fatal/uncertain, max iterations, `finish_reason=length` | Message state và final text đúng; không complete rỗng/cụt âm thầm.         |
| Controller/store | stream, reload, follow-up                                                                    | Câu trả lời và trạng thái không thay đổi sai sau lưu/reload.               |
| Renderer         | long answer, bullets/table/link, failed tool, hint                                           | Người dùng đọc được key fact, biết tool nào lỗi và bước tiếp theo.         |
| Model eval       | mỗi model pilot × 3 run/case                                                                 | Metric mục 3.2 và 3.3, báo worst run.                                      |
| Usability        | 5 người × 4 tác vụ                                                                           | Task success, confidence và issue severity đạt ngưỡng.                     |

## 6. Rủi ro và giảm thiểu

| Rủi ro                                                                  | Giảm thiểu                                                                                                                                                                              |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Eval chỉ tối ưu cho fixture giả, không phản ánh payload Atlassian thật. | Dùng payload đã anonymize theo nhiều shape được contract test hiện tại ghi nhận; bổ sung corpus từ staging/pilot chỉ sau khi qua review bảo mật.                                        |
| LLM judge thiên vị hoặc chấm không ổn định.                             | Metric fact-based là nguồn chính; human review cho semantic/tone; LLM judge chỉ hỗ trợ triage.                                                                                          |
| Logging để debug làm lộ dữ liệu Jira/Confluence.                        | Không log raw production payload; dùng fixture tổng hợp và chỉ log count/hash/flags đã được phép. Chính sách hiện tại cấm prompt/response đầy đủ tại `docs/design-doc-v1.1.md:560-568`. |
| Kết quả dao động theo model/provider.                                   | Ghi rõ version/config, chạy 3 lần, báo worst run và không gộp model khác nhau thành một điểm chung.                                                                                     |
| Trộn lỗi prompt với lỗi UI.                                             | Chấm model-output dạng raw riêng, sau đó chấm render/UI riêng trên cùng case.                                                                                                           |
| Thay đổi chưa commit trong worktree làm baseline khó lặp lại.           | Ghi commit SHA cộng `git diff --stat`/artifact hash ở mỗi lần chạy; không sửa hoặc reset thay đổi hiện có trong pha đánh giá.                                                           |

## 7. Lệnh xác minh dự kiến

```bash
pnpm exec vitest run packages/agent-runtime/src/agent-runtime.test.ts
pnpm exec vitest run packages/atlassian-mcp-manager/src/mcp.test.ts
pnpm exec vitest run apps/desktop/src/main/chat-controller.test.ts
pnpm test:e2e
pnpm lint
pnpm typecheck
```

Khi eval harness được tạo, thêm một script riêng (ví dụ `pnpm eval:responses`) có output JSON và summary Markdown; không trộn nó vào `pnpm test` cho tới khi model-dependent cases được tách khỏi deterministic CI.

## 8. Baseline tại thời điểm lập kế hoạch

- Targeted verification đã chạy: `packages/agent-runtime/src/agent-runtime.test.ts` và `apps/desktop/src/main/chat-controller.test.ts`.
- Kết quả: 2 test files passed, 61/61 tests passed.
- Diễn giải: wiring/runtime hiện có đang xanh; kết quả này không phủ các tiêu chí completeness, groundedness, friendliness, long-result truncation hoặc UI recovery nêu trên.

## 9. Stop condition

Workflow đánh giá hoàn tất khi:

1. Corpus đạt độ phủ mục 3.1.
2. Mọi case có trace raw fixture → model-visible summary → final answer → rendered UI.
3. Scorecard tự động và human rubric tạo được kết quả lặp lại.
4. P0/P1 được tái hiện bằng test hoặc được đóng với bằng chứng.
5. Báo cáo chỉ ra stage gây lỗi cho ít nhất 80% failure và cung cấp baseline để đo remediation.

Nếu chưa đạt một trong năm điều kiện, tiếp tục thu hẹp điểm mù; không kết luận chỉ bằng cảm nhận “prompt tốt hơn” hoặc “câu trả lời trông ổn hơn”.
