## Context

Nexa là app chat desktop (Electron) chạy hoàn toàn local-first: `local-store` (SQLite qua `node:sqlite`) mã hoá field-level mọi nội dung nhạy cảm bằng AES-256-GCM (context string cố định dạng `table.column`, không bao giờ đổi), `agent-runtime` chạy vòng lặp tool-calling stateless giữa các lượt (`RunTurnInput.history` được truyền lại mỗi lần), và `context-builder.ts` cắt bớt history cũ theo sliding window khi vượt token budget — quyết định có chủ đích, không tóm tắt (xem `docs/OPEN-QUESTIONS.md` B2, ADR-0006), vì tóm tắt nghĩa là thêm một lần gọi LLM ⇒ thêm chi phí, độ trễ, và rủi ro nội dung nhạy cảm rời máy.

Change này thêm khả năng "nhớ" xuyên hội thoại (long-term memory) mà không vi phạm triết lý đó: không gọi thêm LLM để tự động tóm tắt/trích xuất, không thêm embedding hoặc vector store. Đồng thời formalize hành vi context hiện có thành "short-term memory" để hai khái niệm có ranh giới rõ ràng trong spec và trong UI.

Không có tokenizer thật trong hệ thống — chỉ có heuristic `estimateTokens()` (~4 ký tự/token, `packages/document-processor/src/pipeline.ts`), sai số ±25% với tiếng Việt đã được ghi nhận là rủi ro chấp nhận được ở B2. Thiết kế này tái dùng heuristic đó, không viết thêm.

## Goals / Non-Goals

**Goals:**
- Cho phép người dùng lưu lại fact/preference ngắn (ví dụ "dùng TypeScript", "gọi tôi là Hoàng") một lần, và có nó xuất hiện trong context của mọi hội thoại mới sau đó — không cần lặp lại.
- Mọi fact được lưu phải qua xác nhận rõ ràng của người dùng — không có ghi ngầm, không có suy luận tự động lưu thẳng vào DB.
- Người dùng xem được toàn bộ fact đang lưu, sửa/xoá/archive được, và có nút "xoá toàn bộ dữ liệu" (đã có, `data:purge`) xoá luôn cả fact.
- Formalize hành vi sliding-window hiện tại (short-term memory) thành spec chính thức, không đổi hành vi.
- Facts luôn được giữ trong context, không bị cắt bởi sliding window như history thường (chúng nhỏ và có giá trị cao hơn message cũ).

**Non-Goals:**
- Không tự động tóm tắt hội thoại bằng LLM (đã bị loại ở B2/ADR-0006; không mở lại quyết định này trong change này).
- Không dùng embedding/vector store hoặc semantic search — số fact kỳ vọng nhỏ (vài chục), nạp toàn bộ vào system prompt là đủ.
- Không đồng bộ memory giữa nhiều máy/thiết bị — mọi thứ vẫn local-first, theo `profile_id` (gắn OS account) như phần còn lại của hệ thống.
- Không tự động trích xuất fact bằng cách gọi LLM phân tích toàn bộ hội thoại; việc phát hiện fact "tiềm năng" (nếu có) chỉ dựa trên tường minh trong lượt hội thoại hiện tại, agent chỉ được **đề xuất**, không tự lưu.

## Decisions

### 1. Lưu trữ: bảng `memory_facts` mới, migration v5

Thêm bảng theo đúng convention của `migrations.ts`:

```
memory_facts (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id),
  content_ciphertext BLOB NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',   -- 'active' | 'archived'
  source_conversation_id TEXT NULL REFERENCES conversations(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)
```

- Context string mã hoá mới, vĩnh viễn: `memory_facts.content` — thêm vào `CTX` constants theo đúng pattern trong `conversation-repository.ts`. Không tái sử dụng `messages.content` hay bất kỳ context nào đã có.
- `source_conversation_id` là optional, chỉ để audit/UX ("fact này được đề xuất từ hội thoại nào") — không dùng cho logic retrieval. `ON DELETE SET NULL` để xoá hội thoại gốc không kéo theo mất fact (fact là long-term, độc lập khỏi hội thoại đã sinh ra nó).
- `status` dùng thay cho xoá cứng khi người dùng "archive" (tạm ẩn khỏi context nhưng không mất dữ liệu); "delete" là xoá cứng thật (row bị xoá, giống hành vi `deleteMessage` tombstone nhưng ở đây không cần giữ thứ tự nên xoá thẳng).

**Vì sao không gộp vào bảng `settings` hiện có?** `settings` là key-value đơn (một hàng per key), không phù hợp với danh sách nhiều fact có vòng đời riêng (tạo/archive/xoá độc lập từng cái). Bảng riêng cũng cho phép đánh index theo `profile_id` và tách rõ retention policy.

### 2. Retrieval: nạp toàn bộ fact `active` vào system prompt, không search

`ChatController.runTurn` gọi `memoryService.listActiveFacts(profileId)` trước khi gọi `AgentRuntime.runTurn`, truyền danh sách (đã decrypt) vào `RunTurnInput` như một field mới `memoryFacts?: string[]`. `context-builder.ts` nhận field này qua `BuildContextInput`, format thành một đoạn ngắn (ví dụ mỗi fact là một dòng gạch đầu dòng) và chèn ngay sau `DEFAULT_SYSTEM_PROMPT`, **trước khi** tính budget cho documents/history.

**Vì sao không search/embedding?** Với vài chục fact ngắn, tổng token cho toàn bộ danh sách nhỏ hơn nhiều so với budget dành cho system prompt. Semantic search chỉ có giá trị khi số lượng lớn (hàng trăm+) hoặc fact dài — không phải trường hợp này. Thêm search/embedding bây giờ là over-engineering và thêm dependency không cần thiết (rủi ro privacy nếu embedding phải gọi API ngoài).

**Giới hạn cứng:** đặt một trần số lượng fact hợp lý (ví dụ 50) và/hoặc trần token (ví dụ 10% của `available` budget trong `buildContext`) để tránh trường hợp bất thường (người dùng lưu quá nhiều fact) làm phình system prompt tới mức ăn hết budget của history. Nếu vượt trần, giữ N fact mới nhất theo `updated_at` và bỏ phần cũ hơn — tương tự nguyên lý sliding window của short-term memory, nhưng áp lên facts như một an toàn phụ, không phải hành vi chính.

### 3. Facts được ưu tiên giữ, không bị cắt như history

Trong `buildContext()`, thứ tự ưu tiên khi tính budget:
1. System prompt (cố định).
2. Memory facts (mới — ưu tiên cao thứ 2, gần như luôn giữ được vì nhỏ).
3. Documents đính kèm lượt hiện tại (60% budget còn lại, như hiện tại).
4. History hội thoại — sliding window, newest→oldest, phần cũ bị drop nếu hết budget (hành vi hiện tại, không đổi).

Nếu (hiếm) facts + system prompt đã vượt `available` budget (trần fact ở mục 2 giúp tránh việc này), ưu tiên vẫn là giữ facts, hy sinh thêm history — vì facts đại diện cho quyết định tường minh của người dùng, còn history cũ vốn đã được thiết kế để có thể mất (đã có UI báo "đã lược bỏ X tin nhắn cũ" qua `truncatedContextCount`).

### 4. Xác nhận fact mới: agent đề xuất, người dùng quyết — không tool tự động lưu

Không thêm một tool "save_memory" mà agent có thể tự gọi và ghi thẳng vào DB (điều này sẽ vi phạm nguyên tắc "không ghi ngầm"). Thay vào đó:
- UI có màn hình Settings (hoặc mục riêng) để người dùng **tự thêm/sửa/xoá** fact bất cứ lúc nào — đây là con đường chính, đơn giản, không phụ thuộc agent.
- (Tuỳ chọn mở rộng UX, không bắt buộc để apply-ready): khi agent phát hiện trong câu trả lời có thể đề xuất một fact (ví dụ người dùng vừa nói "tôi luôn dùng pnpm"), nó có thể trả lời kèm gợi ý bằng ngôn ngữ tự nhiên; người dùng xác nhận bằng cách vào Settings thêm fact đó. Không tự động parse/lưu ngầm trong bản đầu — giữ scope tối thiểu, tránh rủi ro lưu sai hoặc lưu nội dung nhạy cảm ngoài ý muốn.

### 5. IPC surface

Theo đúng pattern hiện có (`channels.ts` + `ipc.ts` phải khớp key, `services.ts` wiring, `ipc.ts` handler):
- `memory:list` — `{ profileId }` → `MemoryFact[]` (chỉ active theo mặc định, có thể có tham số `includeArchived`).
- `memory:create` — `{ profileId, content }` → `MemoryFact`.
- `memory:update` — `{ id, content }` → `MemoryFact` (sửa nội dung).
- `memory:archive` — `{ id }` → `void`.
- `memory:delete` — `{ id }` → `void` (xoá cứng).

Không thêm channel `memory:extractSuggestion` trong bản đầu (đã loại ở Decision 4) — giữ tối thiểu.

### 6. Retention & purge

- `RetentionService` (chạy khi khởi động + mỗi 6h): **loại trừ** `memory_facts` khỏi sweep theo `historyRetentionDays` — fact là long-term theo thiết kế, không tự xoá theo tuổi. Cần thêm dòng comment tường minh trong code giải thích lý do (khác với `messages`/`conversations`) để tránh nhầm lẫn về sau.
- `data:purge` IPC handler (`apps/desktop/src/main/ipc.ts`, `purgeProfile`): **bắt buộc** xoá toàn bộ `memory_facts` của profile — đây là guarantee "xoá toàn bộ dữ liệu" đã có, không được có ngoại lệ.

### 7. Encryption & redaction

- Field `content` của `memory_facts` mã hoá qua cơ chế `cipher.encrypt/decrypt` sẵn có của `LocalStore` (không phải secure-storage/secret vault — đó dành cho API key/PAT).
- Đặt tên field theo convention hiện có (`content`) để tự động khớp `CONTENT_FIELD_NAMES` trong `packages/observability/src/redaction.ts` — nội dung fact không bao giờ được log dạng plaintext.

## Risks / Trade-offs

- **[Risk]** Người dùng lưu nội dung nhạy cảm (ví dụ thông tin sức khoẻ, tài chính) vào fact tưởng là "ghi nhớ tiện lợi" nhưng nó sẽ xuất hiện trong MỌI hội thoại tương lai, kể cả hội thoại không liên quan → **Mitigation**: UI hiển thị rõ "fact này sẽ được gửi kèm trong mọi hội thoại mới" khi tạo/sửa; không có giới hạn nội dung (không kiểm duyệt) nhưng cảnh báo rõ trước khi lưu.
- **[Risk]** Số lượng fact tăng không kiểm soát làm phình system prompt, ăn budget của history/documents → **Mitigation**: trần số lượng/token (Decision 2), giữ N fact mới nhất khi vượt trần, UI hiển thị cảnh báo khi gần trần.
- **[Risk]** Fact cũ, sai, hoặc mâu thuẫn với hội thoại hiện tại (ví dụ người dùng đổi công việc, đổi công nghệ dùng) khiến agent trả lời dựa trên thông tin lỗi thời → **Mitigation**: UI cho sửa/xoá dễ dàng bất cứ lúc nào; không có auto-expiry vì không có cách an toàn để hệ thống tự biết fact nào đã lỗi thời mà không gọi thêm LLM (ngoài scope).
- **[Risk]** Việc thêm field mới vào `RunTurnInput`/`BuildContextInput` có thể phá vỡ test hiện có nếu không optional → **Mitigation**: field `memoryFacts` là optional, mặc định rỗng, không đổi hành vi khi không có fact nào (tương thích ngược với mọi test hiện có).
- **[Trade-off]** Không có semantic search nghĩa là nếu về sau số fact tăng lớn (hàng trăm), cách nạp toàn bộ sẽ không scale — được chấp nhận vì ngoài phạm vi kỳ vọng sử dụng thực tế (memory cá nhân, không phải knowledge base).

## Migration Plan

1. Thêm migration `v5` trong `packages/local-store/src/migrations.ts` tạo bảng `memory_facts` + index trên `profile_id`. Migration chỉ thêm bảng mới, không đổi bảng cũ — an toàn, không cần backfill.
2. Thêm `CTX.memoryFactContent = 'memory_facts.content'` vào constants mã hoá.
3. Thêm `MemoryRepository`, wiring vào `LocalStore`/`services.ts`.
4. Thêm types/channels/schemas trong `shared-types` (domain, channels, ipc) — build sẽ fail nếu quên cập nhật cả hai file (compile-time check hiện có).
5. Thêm handler IPC, wiring `MemoryService`.
6. Mở rộng `RunTurnInput`/`BuildContextInput` (optional field), cập nhật `context-builder.ts` và `ChatController`.
7. Cập nhật `RetentionService` và `data:purge` handler.
8. Thêm UI (Settings hoặc màn hình riêng) cho CRUD fact.
9. Test: repository CRUD, migration up, context-builder budget với facts, retention/purge bao gồm facts, IPC round-trip.

**Rollback**: vì migration chỉ thêm bảng mới (không đổi bảng cũ), rollback an toàn là bỏ qua bảng mới (không đọc/viết) nếu cần revert tính năng ở tầng ứng dụng; xoá bảng chỉ cần thiết nếu muốn dọn sạch hoàn toàn (không tự động, theo đúng nguyên tắc "down có thể mất dữ liệu, không tự chạy" đã ghi trong `migrations.ts`).

## Open Questions

- UI cụ thể đặt ở đâu (mục riêng trong Settings hay một tab mới ngang hàng với Conversations)? Để lại cho lúc implement UI, không ảnh hưởng thiết kế backend.
- Có cần giới hạn độ dài mỗi fact (ví dụ 200 ký tự) để tránh người dùng dán cả đoạn văn dài vào một "fact"? Đề xuất: có, giới hạn mềm ở UI (cảnh báo) chứ không cấm cứng ở schema — nhưng đây là quyết định UX có thể chốt lúc implement.
