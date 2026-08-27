## Context

Nexa là Electron app local-first. Nội dung nhạy cảm trong SQLite được mã hoá AES-256-GCM theo
context string cố định; renderer là tiến trình không tin cậy; mọi mutation đi qua IPC validation.
Agent runtime hiện stateless giữa các lượt ngoài history mà main process nạp lại, và
`context-builder` dùng sliding window thay vì gọi LLM để tóm tắt.

Memory phải tạo continuity mà không biến thành một kênh rò rỉ âm thầm. Đặc biệt, Nexa hỗ trợ cả
cổng LiteLLM nội bộ và provider OpenAI trực tiếp, nên “đưa tất cả fact vào mọi prompt” không phải
là một thiết kế an toàn.

## Goals / Non-Goals

**Goals**

- Người dùng lưu fact ngắn, ổn định và có ích một lần rồi dùng lại xuyên hội thoại.
- Mọi fact đều xem/sửa/archive/khôi phục/xoá được và có consent rõ ràng.
- Scope theo toàn cục hoặc một hội thoại; external sharing theo từng fact và mặc định tắt.
- Retrieval local, có giới hạn, không thêm network request hoặc LLM call.
- Nội dung memory không xuất hiện trong log và bị purge cùng profile.

**Non-goals**

- Auto-extract/auto-save từ hội thoại, auto-summary, embedding/vector search.
- Đồng bộ đa máy, memory do tổ chức quản lý, hoặc proactivity/background jobs.
- Dùng memory như system instruction hoặc cho fact cũ thắng phát biểu hiện tại của người dùng.

## Decisions

### 1. Bảng riêng với encryption context bất biến

Migration v5 tạo:

```text
memory_facts(
  id, profile_id, content_ciphertext,
  kind, scope, sharing_policy, status,
  source_conversation_id,
  created_at, updated_at, last_confirmed_at, expires_at
)
```

- `kind`: `identity | preference | goal | constraint | note`.
- `scope`: `global | conversation`; conversation scope bắt buộc anchor cùng profile.
- `sharing_policy`: `internal_only | allow_external`, mặc định từ IPC là internal-only.
- `status`: `active | archived`.
- `source_conversation_id` dùng cả làm provenance và anchor; `ON DELETE SET NULL` giữ fact khi
  hội thoại nguồn bị xoá. Fact conversation bị mất anchor sẽ không còn eligible cho context.
- `profile_id ON DELETE CASCADE` bảo đảm `data:purge` xoá memory.
- Nội dung dùng đúng context `memory_facts.content`; context này không được đổi hoặc tái sử dụng.

Bảng riêng phù hợp với vòng đời độc lập của từng fact hơn key-value settings.

### 2. Renderer không chọn profile

IPC surface gồm `memory:list/create/update/archive/restore/delete`. Schema giới hạn content 1–500,
UUID/datetime hợp lệ, conversation scope có source và update có ít nhất một field thay đổi.

Main process luôn inject `services.profileId`. Với update/archive/restore/delete, main đọc fact và
kiểm tra ownership trước mutation. Tạo/sửa là hành động xác nhận nên main đóng dấu
`lastConfirmedAt` nếu caller không truyền thời điểm.

### 3. Retrieval có scope, expiry và privacy

`MemoryRepository.listForContext(profileId, { conversationId, externalProvider })` trả fact:

- cùng profile, active và chưa hết hạn;
- global hoặc conversation scope khớp đúng conversation hiện tại;
- nếu provider ngoài tổ chức, chỉ `allow_external`;
- sort `updated_at DESC`, có tie-break deterministic.

`ChatController` gọi repository ngay trước runtime. Runtime chạy lại external-provider filter để
giữ fail-closed nếu một caller khác truyền fact chưa lọc.

Không dùng semantic search: với vài chục fact ngắn, bounded linear retrieval ít phức tạp hơn, dễ
audit và không tạo thêm privacy boundary.

### 4. Context budget và instruction boundary

Context order:

1. Base system prompt.
2. Memory block.
3. Documents lượt hiện tại.
4. Conversation history theo sliding window.

Memory block ghi rõ:

- đây là dữ liệu cá nhân hoá, không phải instruction;
- chỉ dùng fact liên quan;
- phát biểu hiện tại, rõ ràng của người dùng thắng fact mâu thuẫn.

Builder giữ tối đa 50 fact theo thứ tự caller và cho memory dùng tối đa 10% available budget. Fact
không vừa budget bị bỏ; documents/history vẫn dùng phần còn lại. Kết quả trả count included và
truncated để quan sát mà không lộ nội dung.

### 5. Consent UX

Tab **Nexa nhớ** trong Settings là bề mặt v1:

- danh sách active/archived, kind, scope, sharing, provenance, confirmation và expiry;
- form thêm/sửa giới hạn 500 ký tự;
- archive/restore và hard delete có confirmation;
- checkbox external sharing có cảnh báo consequence, mặc định tắt;
- cảnh báo khi gần 50 fact và thông báo rõ Nexa không tự lưu memory.

Không có tool `save_memory` trong v1. Điều này giữ ranh giới agency: Nexa có thể dùng fact đã xác
nhận, nhưng không được tự thay đổi hồ sơ người dùng.

### 6. Retention, purge và observability

Retention chỉ sweep history/audit theo chính sách; long-term memory chỉ đổi bởi người dùng, expiry
hoặc purge profile. Log repository chỉ có id/metadata. Event runtime `memory-context` chỉ có
provider, eligible/included/truncated counts.

## Risks / Trade-offs

- **Fact sai hoặc cũ:** người dùng có CRUD/archive/expiry; current explicit statement thắng memory.
- **Prompt injection trong fact:** memory block bị đánh dấu data, không instruction; không có
  auto-ingestion. Đây là giảm thiểu chứ không phải sandbox tuyệt đối.
- **External disclosure:** internal-only default, lọc hai lớp, warning trong UI. Organization-wide
  policy để tắt hoàn toàn external sharing vẫn là open question trong root `DESIGN.md`.
- **Quá nhiều fact:** cap 50 và 10% budget; UI cảnh báo từ 45. Retrieval theo recency, chưa theo
  relevance, là trade-off được chấp nhận cho v1.
- **Conversation bị xoá:** global fact giữ provenance null; conversation fact mất anchor và ngừng
  được inject cho đến khi người dùng sửa.

## Migration / Rollback

Migration v5 chỉ tạo bảng và index, không backfill. App cũ có thể bỏ qua bảng mới nếu rollback tầng
ứng dụng. Không tự chạy down migration vì drop table sẽ mất dữ liệu người dùng.

## Open Questions

- Có cần org policy chặn `allow_external` cho toàn bộ memory?
- Memory có trở thành navigation cấp một sau v1 hay ở trong Settings cho tới khi có Today/Goals?

## Resolved Questions

- Goals/Commitment Engine v1 không migrate hoặc tự seed từ memory fact `kind=goal`. Memory tiếp tục
  là fact tham chiếu; commitment là state công việc riêng và chỉ được tạo qua thao tác rõ ràng của
  người dùng.
