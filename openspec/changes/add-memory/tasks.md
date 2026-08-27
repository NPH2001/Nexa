## 1. Local-store: schema & repository

- [x] 1.1 Thêm migration v5 tạo `memory_facts` với kind, scope, sharing policy, status, provenance, expiry và index theo profile/status.
- [x] 1.2 Dùng context mã hoá bất biến `memory_facts.content`; xác nhận plaintext không xuất hiện trong SQLite hoặc log.
- [x] 1.3 Tạo `MemoryRepository` với CRUD, archive/restore và retrieval theo profile, conversation, expiry và provider.
- [x] 1.4 Giữ fact khi xoá hội thoại nguồn bằng `ON DELETE SET NULL`; cascade khi purge profile.
- [x] 1.5 Test migration, encryption round-trip, CRUD, scoping, provider filtering, expiry, source deletion và purge.

## 2. Shared types & IPC contract

- [x] 2.1 Thêm `MemoryFact` và vocabulary: kind, scope, sharing policy, status.
- [x] 2.2 Thêm `memory:list/create/update/archive/restore/delete` vào channel registry.
- [x] 2.3 Thêm Zod schema: content 1–500, UUID/datetime, default internal-only, conversation scope cần source, update không rỗng.
- [x] 2.4 Không nhận `profileId` từ renderer; typecheck channels ↔ schemas và wiring pass.

## 3. Main process & renderer bridge

- [x] 3.1 Wire `MemoryRepository` vào `NexaServices` và bootstrap.
- [x] 3.2 Thêm handler IPC bind cứng vào profile hiện tại; mutation kiểm tra ownership trước khi chạy.
- [x] 3.3 Đóng dấu `lastConfirmedAt` trong main process khi người dùng tạo/sửa.
- [x] 3.4 Expose typed `api.memory.*` qua renderer bridge/preload allowlist.

## 4. Agent runtime & privacy boundary

- [x] 4.1 Mở rộng `RunTurnInput`/`BuildContextInput` bằng memory facts có kind và sharing policy.
- [x] 4.2 Chèn memory sau base system prompt, ghi rõ đây là dữ liệu cá nhân hoá chứ không phải instruction.
- [x] 4.3 Giới hạn 50 fact mới nhất và 10% available token budget; history/documents hiện tại tiếp tục dùng budget còn lại.
- [x] 4.4 Lọc `internal_only` khỏi external provider tại repository và lặp lại ngay trước model invocation.
- [x] 4.5 Log chỉ provider/count; test cap, budget, ordering và provider filtering.

## 5. Chat controller

- [x] 5.1 Load memory theo profile + conversation + provider trước mỗi lượt.
- [x] 5.2 Truyền fact đủ điều kiện vào runtime, không truyền khi rỗng.
- [x] 5.3 Test controller xác nhận query scope/provider và payload truyền vào runtime.

## 6. Retention & purge

- [x] 6.1 Ghi rõ retention history không sweep long-term memory.
- [x] 6.2 Dựa vào profile cascade để `data:purge` xoá toàn bộ memory.
- [x] 6.3 Test retention, purge và xoá hội thoại nguồn.

## 7. Renderer UI

- [x] 7.1 Thêm tab **Nexa nhớ** với loading/error/empty states và danh sách active/archived.
- [x] 7.2 Cho phép thêm, sửa, archive, khôi phục và xoá có xác nhận.
- [x] 7.3 Cho chọn kind, global/conversation scope, provenance và external sharing rõ ràng; mặc định internal-only.
- [x] 7.4 Hiển thị last-confirmed/provenance/expiry và cảnh báo gần ngưỡng 50 fact; nói rõ không auto-save.

## 8. Kiểm thử tổng hợp & tài liệu

- [x] 8.1 Chạy `pnpm verify` toàn repo và xử lý mọi regression liên quan.
- [x] 8.2 E2E tạo memory trong Settings rồi kiểm chứng mock LLM nhận fact; integration test runtime xác nhận external provider không nhận `internal_only`.
- [x] 8.3 Cập nhật `DESIGN.md`, `docs/RUNBOOK.md` và `docs/OPEN-QUESTIONS.md` với contract privacy/scoping thực tế.
- [ ] 8.4 Sau khi merge/deploy ổn định, archive change qua `openspec-archive-change`.
