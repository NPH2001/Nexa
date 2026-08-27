## Context

Nexa là Electron app local-first: renderer không tin cậy, main process inject profile hiện tại và
SQLite dùng field encryption cho nội dung nhạy cảm. Commitments đã có `due_at`/`check_in_at`, còn
`local_audit` đã lưu metadata an toàn nhưng chưa có related object/action để làm activity feed.
`tool_calls` giữ preview/result đã mã hoá, nhưng không thể đại diện memory/commitment mutation hay
suggestion.

Ứng dụng hiện thoát hẳn trên Windows/Linux khi đóng cửa sổ. Vì vậy “proactive” trong change này
chỉ có nghĩa là scheduler trong tiến trình app đang sống. Không có OS notification và không được
copywriting như thể Nexa vẫn nhắc khi app đã đóng.

## Goals / Non-Goals

**Goals**

- Cho người dùng chủ động bật nhắc việc toàn cục, mặc định tắt.
- Tạo tối đa một suggestion hiện hành cho mỗi commitment, không trùng sau reload/restart.
- Persist snooze/dismiss/mute theo profile và giữ mọi action reversible khi hợp lý.
- Cung cấp timeline có cấu trúc, filter được, không chứa raw payload hay secret.
- Giữ confirmation guard, tool authorization và renderer trust boundary nguyên vẹn.

**Non-goals**

- Background process, notification OS, recurrence, calendar/tasks sync hoặc cloud sync.
- Tự tạo/sửa/hoàn thành commitment; tự gửi chat; tự thực thi tool hay thay đổi hệ thống ngoài.
- Lưu before/after content của memory/commitment hoặc raw preview/result vào activity feed.
- Thay thế diagnostics log hay `tool_calls` bằng timeline.

## Decisions

### 1. Opt-in dùng settings đã mã hoá

`proactiveCheckInsEnabled` là field top-level của `AppSettings`, mặc định `false`. Settings hiện
đã được `ConfigRepository` mã hoá và bind theo profile, nên không cần một bảng preference thứ hai.

Service không tạo interval khi setting tắt. Khi bật, service reconcile ngay rồi chạy mỗi phút.
Khi tắt, interval bị dừng và Today không trả suggestion; state cũ được giữ để bật lại không làm
mất lựa chọn snooze/mute.

### 2. Suggestion state tách khỏi commitment

Migration v7 tạo bảng:

```text
commitment_check_ins(
  id, profile_id, commitment_id,
  trigger_kind, trigger_at,
  state, snoozed_until,
  created_at, updated_at,
  UNIQUE(profile_id, commitment_id)
)
```

- `profile_id` và `commitment_id` đều cascade; repository xác minh commitment cùng profile.
- `trigger_kind`: `due | check_in`.
- `state`: `pending | acted | snoozed | dismissed | muted`.
- Bảng không nhân bản title/next action nên không có plaintext nhạy cảm mới.
- Mute giữ nguyên qua thay đổi due/check-in và complete → reopen; người dùng bật lại từ Goals.

Service chỉ xét commitment `active | blocked` có timestamp đã đến. Nếu cả due/check-in đã đến,
trigger mới nhất thắng; check-in thắng khi timestamp bằng nhau. Khi trigger hiện hành khác snapshot
đã lưu, state được reset về pending, trừ khi commitment đang muted. Cùng trigger không sinh bản ghi
hay activity event trùng sau restart.

Snooze dùng ba duration do main sở hữu: 1 giờ, 1 ngày hoặc 1 tuần. Khi hết snooze trong lúc app
đang mở, suggestion quay lại pending. `acted` và `dismissed` chỉ xử lý trigger hiện hành; một
due/check-in mới có thể sinh suggestion mới.

### 3. “Thực hiện” không phải tool action

Action **Thực hiện** chỉ:

1. đổi local suggestion sang `acted`;
2. mở hội thoại nguồn nếu commitment còn liên kết, nếu không mở Goals.

Nó không gửi message, không sửa commitment và không gọi tool. Mọi write bên ngoài tiếp tục cần
preview + confirmation + payload binding như trước.

### 4. Scheduler là in-app service có output port

`ProactiveCheckInService` nhận repository, settings, activity sink, clock và callback thay đổi.
Nó có `start/stop/reconfigure/reconcile/list/respond/unmute`, nên notification OS về sau có thể
subscribe cùng output port mà không đưa API notification vào domain hiện tại.

Main khởi động service sau bootstrap và dừng trong dispose/before quit. Windows/Linux đóng cửa sổ
vẫn quit process; macOS chỉ giữ scheduler nếu process thực sự còn sống. UI nói rõ giới hạn này.

### 5. Activity mở rộng local audit, không lưu payload mới

Migration v7 thêm các cột nullable vào `local_audit`:

```text
activity_type, activity_action, subject_type, subject_id
```

`ActivityRepository` chỉ nhận enum + identifiers:

- type: `suggestion | memory_mutation | commitment_mutation | tool_preview | confirmation |
tool_result | uncertain_operation`;
- status: `pending | success | failed | cancelled | uncertain | snoozed | dismissed | muted`;
- subject: `memory | commitment | tool` và id/tool name;
- request/operation id khi nguồn đã có.

Không có free-text/JSON metadata field. Timeline không lưu memory content, commitment title/next
action, secret, raw tool args, payload hash, preview fields, target URL hay raw result. Main có thể
resolve title hiện tại từ encrypted commitment record khi trả UI; record đã xoá dùng nhãn fallback.
Activity rows tiếp tục theo `logRetentionDays` và bị purge cùng profile.

### 6. Instrument ở main-owned seams

- Memory/commitment events được ghi sau mutation thành công trong IPC handler đã có ownership gate.
- Tool preview/result events được ghi qua `ToolCallSink` wrapper trong `ChatController`.
- Confirmation requested/approved/cancelled/expired được ghi quanh `askUser/approve/cancelTool`.
- Uncertain được ghi khi tool call chuyển sang `uncertain`; lookup resolution ghi result mới.
- Suggestion events được ghi trong cùng local transaction với state transition.

Renderer không emit activity và không truyền profile id. Timeline chỉ đọc qua một validated IPC.

### 7. Renderer surfaces

Today có card **Cần check-in**:

- disabled: giải thích opt-in và nút **Bật nhắc việc**;
- enabled + empty: nói chưa có mốc nào cần quay lại;
- due: reason + title/next action + bốn action;
- loading/error/retry rõ ràng.

Activity là navigation cấp một với hai combobox filter, list theo thời gian giảm dần và state
loading/empty/error/retry. Ở 620 px filter stack và timeline còn một cột; không tạo layout admin
dày đặc.

## Risks / Trade-offs

- `local_audit` bị retention sweep nên timeline không phải lịch sử vĩnh viễn. Đây là chủ ý để giữ
  cùng privacy/retention boundary với activity metadata cục bộ.
- Timeline không có before/after content; người dùng thấy loại mutation, trạng thái và object, đổi
  lại lấy được privacy boundary rõ ràng.
- Một timer mỗi phút chỉ hoạt động khi process sống; nhắc đúng giây và delivery sau khi app đóng
  nằm ngoài scope.
- Mute qua reopen có thể khiến người dùng quên đã tắt; Goals phải hiển thị trạng thái và nút bật lại.

## Migration / Rollback

Migration v7 chỉ thêm bảng/cột/index, không backfill. Rollback thủ công drop bảng/index; các cột
activity có thể được drop trên SQLite hiện tại. Không tự rollback vì sẽ mất suggestion state và
timeline metadata.
