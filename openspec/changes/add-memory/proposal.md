## Why

Nexa hiện không nhớ gì giữa các hội thoại: mỗi hội thoại mới bắt đầu từ số 0, và trong một hội thoại dài, message cũ bị âm thầm loại bỏ khỏi context (sliding window trong `context-builder.ts`) khi vượt token budget — không tóm tắt, không lưu lại. Đây là một hạn chế đã được ghi nhận có chủ đích ở `docs/OPEN-QUESTIONS.md` (mục B2) và `docs/architecture/adr/0006-tool-calling-loop.md`, để lại như "scope thêm" cho ai cần. Người dùng phải tự lặp lại thông tin cá nhân/sở thích (ví dụ ngôn ngữ lập trình hay dùng, cách xưng hô) ở mỗi hội thoại mới, và không có cách nào phục hồi ngữ cảnh đã bị cắt trong một hội thoại dài ngoài việc bắt đầu hội thoại mới hoặc đổi model có context window lớn hơn (theo `docs/RUNBOOK.md`).

Change này bổ sung một cơ chế memory gồm hai phần: **short-term memory** (formalize hành vi sliding-window hiện có, không đổi cách hoạt động) và **long-term memory** (mới — lưu các fact/preference do người dùng xác nhận rõ ràng, tồn tại xuyên suốt mọi hội thoại).

## What Changes

- Thêm bảng `memory_facts` mới trong `local-store` (migration v5) để lưu fact/preference dạng văn bản ngắn, mã hoá field-level như các bảng khác, gắn theo `profile_id`.
- Thêm `MemoryRepository` (hoặc mở rộng `local-store`) với các thao tác: tạo, liệt kê (theo profile, chỉ fact còn hiệu lực), lưu trữ (archive), xoá fact.
- Thêm `MemoryService` trong `apps/desktop/src/main/services.ts`, wired vào `NexaServices` giống các service hiện có.
- Thêm IPC channel mới: `memory:list`, `memory:create`, `memory:archive`, `memory:delete` — cặp đôi trong `shared-types/channels.ts` và `shared-types/ipc.ts` theo đúng convention hiện có (bắt buộc khớp key giữa hai file).
- Thêm `MemoryFact` type vào `shared-types/domain.ts`.
- Sửa `ChatController.runTurn` để load toàn bộ fact còn hiệu lực của profile hiện tại (qua `MemoryService`) trước khi gọi `AgentRuntime.runTurn`, và truyền vào như một input mới.
- Sửa `context-builder.ts` (`buildContext`/`BuildContextInput`) để nhận thêm danh sách memory facts, luôn giữ chúng trong context (ưu tiên như system prompt, không tính vào phần bị cắt bởi sliding window), và format thành một đoạn ngắn chèn ngay sau system prompt.
- Formalize hành vi hiện có của `context-builder.ts` (sliding window, giữ N message gần nhất theo token budget, bỏ message cũ không tóm tắt) như "short-term memory" trong spec — **không đổi hành vi**, chỉ đặc tả rõ ràng và đảm bảo nó phối hợp đúng với budget của long-term memory facts.
- Thêm UI trong `apps/desktop/src/renderer`: một khu vực (Settings hoặc màn hình riêng) để người dùng xem, thêm, sửa, xoá các fact đã lưu; và một luồng xác nhận khi agent đề xuất một fact mới phát hiện được trong hội thoại (agent không tự lưu ngầm — người dùng luôn phải xác nhận qua UI hoặc qua phản hồi tường minh trong chat).
- Đưa bảng `memory_facts` vào `RetentionService` (loại trừ khỏi xoá tự động theo `historyRetentionDays`, vì fact là long-term theo thiết kế) và vào cascade của `data:purge` IPC handler (bắt buộc bị xoá khi người dùng xoá toàn bộ dữ liệu).
- Không dùng embedding/vector store, không dùng tóm tắt tự động bằng LLM — cả hai bị loại khỏi scope này (xem `design.md`).

Không có thay đổi **BREAKING** — đây là bổ sung thuần tuý, không đổi API/schema hiện có (chỉ thêm bảng, thêm channel, thêm field mới trong `RunTurnInput`/`BuildContextInput` dạng optional).

## Capabilities

### New Capabilities
- `long-term-memory`: lưu trữ, quản lý (CRUD + xác nhận), và nạp các fact/preference do người dùng khai báo vào context của mọi hội thoại mới.
- `short-term-memory`: đặc tả chính thức hành vi sliding-window context hiện có của một hội thoại (giữ N message gần nhất theo token budget, không tóm tắt), và quy tắc phối hợp budget với long-term memory facts.

### Modified Capabilities
(không có — chưa có spec nào tồn tại trong `openspec/specs/` trước change này; hành vi sliding-window hiện tại chưa từng được đặc tả thành capability, nên đây là spec mới chứ không phải sửa spec cũ)

## Impact

- **Code**: `packages/local-store` (migration mới, repository mới), `packages/shared-types` (domain/channels/ipc), `packages/agent-runtime` (`context-builder.ts`, có thể `agent-runtime.ts` nếu `RunTurnInput` cần mở rộng), `apps/desktop/src/main` (`services.ts`, `ipc.ts`, `chat-controller.ts`), `apps/desktop/src/renderer` (UI mới).
- **Dữ liệu**: bảng SQLite mới (`memory_facts`), context string mã hoá mới (vĩnh viễn, không tái sử dụng context string cũ).
- **Retention/Purge**: `packages/local-store/src/retention.ts` và `data:purge` handler cần cập nhật để bao gồm bảng mới.
- **Không** ảnh hưởng `packages/llm-client` (client vẫn chỉ nói HTTP, không biết gì về memory).
- **Không** thêm dependency mới (không embedding model, không vector DB).
