## Goals / Non-goals

**Goals**

- Biến kết quả người dùng muốn đạt thành state bền vững, inspectable và reversible.
- Một click từ Today tới commitment đang cần chú ý.
- Giữ ranh giới consent: mọi create/update/delete đều do người dùng thao tác rõ ràng.

**Non-goals**

- Auto-extract từ hội thoại, autonomous planning hoặc background tool execution.
- Calendar/Tasks sync, notification OS, recurring commitments hoặc multi-user ownership.

## Decisions

### Separate entity instead of extending memory

Memory mô tả fact ổn định; commitment mô tả state công việc thay đổi thường xuyên. Bảng riêng tránh
nhồi due date/progress vào `memory_facts` và cho phép lifecycle rõ ràng.

```text
commitments(
  id, profile_id,
  title_ciphertext, next_action_ciphertext,
  status, due_at, check_in_at, completed_at,
  source_conversation_id,
  created_at, updated_at
)
```

Status gồm `active | blocked | paused | completed`. Hoàn thành có thể mở lại. Xoá là hard delete
có confirmation. Hội thoại nguồn dùng `ON DELETE SET NULL`; profile dùng `ON DELETE CASCADE`.

### Today is a resume surface, not a scheduler

Today chỉ đánh giá các timestamp local đã lưu khi người dùng mở ứng dụng. Overdue check-in đứng
trước due date, rồi tới recency. V1 không tạo timer nền hoặc notification nên không được mô tả như
đã chủ động chạy khi app đóng.

### Renderer never chooses a profile

Main inject `services.profileId`; update/delete đọc record và xác minh ownership trước mutation.
Title giới hạn 200 ký tự, next action 500 ký tự, timestamp là ISO datetime.

## Risks / Trade-offs

- Không có recurrence/snooze nên check-in được chỉnh trực tiếp trong form v1.
- Commitment chưa được đưa vào LLM context; tránh disclosure ngầm trước khi có policy/sharing UI.
- Goal memory cũ vẫn là memory và không được auto-migrate vì đó sẽ là chuyển nghĩa dữ liệu không
  có confirmation.
