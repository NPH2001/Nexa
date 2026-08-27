## Why

Nexa đang lưu lịch sử hội thoại nhưng chưa có trí nhớ dài hạn: hội thoại mới bắt đầu từ số 0,
còn message cũ bị sliding-window loại khỏi context khi vượt token budget. Người dùng vì thế phải
lặp lại cách xưng hô, sở thích, mục tiêu và ràng buộc ổn định. Một companion cần continuity, nhưng
continuity không được đánh đổi bằng việc tự thu thập hoặc gửi dữ liệu cá nhân ra ngoài.

Change này bổ sung long-term memory được người dùng quản lý rõ ràng, mã hoá local-first và lọc
theo phạm vi/provider. Short-term memory vẫn là sliding window hiện tại, không thêm một lượt LLM,
embedding hoặc auto-summary.

## What Changes

- Thêm migration v5 và `MemoryRepository` cho fact đã mã hoá, gắn `profile_id`.
- Mỗi fact có `kind`, `scope`, `sharingPolicy`, `status`, provenance, thời điểm xác nhận và expiry.
- Thêm IPC `memory:list/create/update/archive/restore/delete`; renderer không được chọn profile.
- Thêm tab **Nexa nhớ** để người dùng tự thêm/sửa/archive/khôi phục/xoá và quyết định fact nào có
  thể đi tới provider ngoài tổ chức.
- Trước mỗi lượt chat, main process lấy các fact active, chưa hết hạn, đúng profile/scope/provider;
  runtime lọc lại một lần nữa ngay trước model invocation.
- Context builder chèn tối đa 50 fact mới nhất, dùng tối đa 10% budget, sau base system prompt và
  ghi rõ fact là dữ liệu cá nhân hoá chứ không phải instruction.
- Retention history không tự xoá memory; purge profile vẫn xoá toàn bộ bằng foreign-key cascade.
- Không tự động trích xuất hoặc lưu memory từ hội thoại. Tạo/sửa trong UI là consent rõ ràng.

Không có thay đổi breaking: các input runtime mới là optional và migration chỉ thêm bảng.

## Capabilities

### New Capabilities

- `long-term-memory`: CRUD, archive/restore, scoping, expiry, provider-aware sharing và context
  injection cho fact do người dùng xác nhận.
- `short-term-memory`: đặc tả sliding-window hiện có và cách nó chia budget với long-term memory.

### Modified Capabilities

Không có capability cũ nào bị đổi contract.

## Impact

- **Code:** `packages/local-store`, `packages/shared-types`, `packages/agent-runtime`, Electron main,
  preload/bridge và renderer Settings.
- **Dữ liệu:** bảng SQLite `memory_facts`; nội dung dùng encryption context bất biến
  `memory_facts.content`.
- **Privacy:** mặc định `internal_only`; external provider chỉ nhận fact `allow_external`.
- **Operations:** diagnostics chỉ log provider và số lượng fact, không log plaintext.
- **Dependencies:** không thêm package, vector DB, embedding model hoặc LLM call phụ.
