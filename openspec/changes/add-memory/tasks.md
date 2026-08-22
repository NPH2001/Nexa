## 1. Local-store: schema & repository

- [ ] 1.1 Thêm migration v5 trong `packages/local-store/src/migrations.ts`: tạo bảng `memory_facts` (id, profile_id, content_ciphertext, status, source_conversation_id, created_at, updated_at) + index trên `profile_id`; cập nhật `LATEST_SCHEMA_VERSION`.
- [ ] 1.2 Thêm context string mã hoá mới `memory_facts.content` vào `CTX` constants (theo pattern trong `conversation-repository.ts`), không tái sử dụng context cũ.
- [ ] 1.3 Tạo `MemoryRepository` mới trong `packages/local-store/src/repositories/` với: `create(profileId, content, sourceConversationId?)`, `listActive(profileId)`, `update(id, content)`, `archive(id)`, `delete(id)`.
- [ ] 1.4 Wire `MemoryRepository` vào `LocalStore` (cipher callbacks giống các repository khác).
- [ ] 1.5 Viết test cho migration v5 (schema đúng, cột đúng) và test CRUD của `MemoryRepository` (create/listActive/update/archive/delete, mã hoá/giải mã round-trip).

## 2. Shared types & IPC contract

- [ ] 2.1 Thêm type `MemoryFact` vào `packages/shared-types/src/domain.ts` (id, profileId, content, status, sourceConversationId, createdAt, updatedAt).
- [ ] 2.2 Thêm channel `memory:list`, `memory:create`, `memory:update`, `memory:archive`, `memory:delete` vào `IPC_CHANNEL_NAMES` trong `packages/shared-types/src/channels.ts`.
- [ ] 2.3 Thêm zod schema tương ứng cho từng channel trong `IPC_SCHEMAS` (`packages/shared-types/src/ipc.ts`); đảm bảo compile-time check (channels ↔ schemas khớp key) pass.
- [ ] 2.4 Chạy typecheck để xác nhận không còn channel nào thiếu schema hoặc thiếu tên.

## 3. Main process: service & IPC wiring

- [ ] 3.1 Tạo `MemoryService` trong `apps/desktop/src/main` (hoặc trong package phù hợp) bọc `MemoryRepository`, expose các method tương ứng IPC.
- [ ] 3.2 Thêm `memory` vào `NexaServices` interface và wiring trong `bootstrapServices()` (`apps/desktop/src/main/services.ts`).
- [ ] 3.3 Thêm handler cho 5 channel `memory:*` trong `buildHandlers()` (`apps/desktop/src/main/ipc.ts`), theo đúng pattern validate + `Envelope` hiện có.
- [ ] 3.4 Cập nhật preload/`bridge.ts` để expose các API `memory.*` mới cho renderer.

## 4. Agent runtime: nạp memory fact vào context

- [ ] 4.1 Thêm field optional `memoryFacts?: string[]` vào `RunTurnInput` (`packages/agent-runtime/src/agent-runtime.ts`) và `BuildContextInput` (`packages/agent-runtime/src/context-builder.ts`).
- [ ] 4.2 Cập nhật `buildContext()`: format `memoryFacts` thành một đoạn ngắn chèn ngay sau `DEFAULT_SYSTEM_PROMPT`; tính token của đoạn này bằng `estimateTokens()` (tái dùng heuristic có sẵn từ `document-processor`, không viết heuristic mới); trừ vào `available` budget trước khi fit documents/history.
- [ ] 4.3 Áp trần số lượng/token cho `memoryFacts` (ví dụ tối đa 50 fact hoặc X% budget); nếu vượt, chỉ giữ các fact mới nhất theo thứ tự đầu vào (caller đã sort theo `updated_at` giảm dần).
- [ ] 4.4 Đảm bảo khi `memoryFacts` rỗng hoặc không truyền, hành vi `buildContext()` không đổi so với hiện tại (kiểm tra bằng test hồi quy).
- [ ] 4.5 Viết test cho `context-builder.ts`: có fact + history dài vượt budget → fact được giữ, history bị cắt trước; fact vượt trần → chỉ giữ N fact mới nhất.

## 5. Chat controller: load fact trước khi gọi runtime

- [ ] 5.1 Trong `ChatController.runTurn` (`apps/desktop/src/main/chat-controller.ts`), gọi `services.memory.listActive(profileId)` trước khi gọi `AgentRuntime.runTurn`, decrypt và map thành `string[]` nội dung, sort theo `updated_at` giảm dần.
- [ ] 5.2 Truyền kết quả vào `RunTurnInput.memoryFacts`.
- [ ] 5.3 Viết/cập nhật test cho `chat-controller` xác nhận memory fact được load và truyền đúng vào runtime khi có, và không ảnh hưởng khi không có.

## 6. Retention & purge

- [ ] 6.1 Xác nhận `RetentionService` (`packages/local-store/src/retention.ts`) KHÔNG đưa `memory_facts` vào sweep theo `historyRetentionDays`; thêm comment giải thích lý do (fact là long-term, khác `messages`/`conversations`).
- [ ] 6.2 Cập nhật cascade xoá của `data:purge` handler / `LocalStore.purgeProfile` để xoá toàn bộ `memory_facts` của profile khi purge toàn bộ dữ liệu.
- [ ] 6.3 Viết test: purge profile xoá hết fact; retention sweep theo tuổi hội thoại không xoá fact; xoá một hội thoại nguồn không xoá fact liên quan (chỉ gỡ `source_conversation_id`).

## 7. Renderer UI

- [ ] 7.1 Thêm màn hình/mục quản lý memory trong `apps/desktop/src/renderer` (ví dụ trong `SettingsView.tsx` hoặc component mới): danh sách fact active, form thêm fact mới, sửa, archive, xoá.
- [ ] 7.2 Hiển thị cảnh báo khi tạo/sửa fact: nội dung sẽ được gửi kèm trong mọi hội thoại mới.
- [ ] 7.3 Hiển thị cảnh báo/trạng thái khi số fact gần hoặc vượt trần đã định nghĩa ở task 4.3.
- [ ] 7.4 Nối UI với API `memory.*` qua `bridge.ts`.

## 8. Kiểm thử tổng hợp & tài liệu

- [ ] 8.1 Chạy `pnpm verify` (lint + typecheck + test) toàn repo, đảm bảo không phá vỡ test hiện có.
- [ ] 8.2 Thêm/cập nhật test e2e (`tests/e2e/app.e2e.ts`) cho luồng: thêm fact → mở hội thoại mới → xác nhận fact xuất hiện trong context gửi đi (qua mock LLM server nếu có thể quan sát request).
- [ ] 8.3 Cập nhật `docs/RUNBOOK.md` và/hoặc `docs/OPEN-QUESTIONS.md` (đánh dấu B2 đã có giải pháp long-term memory, ghi rõ short-term vẫn giữ nguyên sliding-window không tóm tắt).
- [ ] 8.4 Sau khi merge và deploy ổn định, archive change này qua quy trình `openspec-archive-change`.
