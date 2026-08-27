## 1. Contract và persistence

- [x] 1.1 Thêm shared types/schema cho check-in suggestion, activity type/action/status và global opt-in.
- [x] 1.2 Thêm migration v7 cho `commitment_check_ins` và activity metadata trên `local_audit`.
- [x] 1.3 Thêm CheckInRepository và ActivityRepository có profile filter, deterministic ordering và không free-text payload.
- [x] 1.4 Test migration, idempotent reconcile state, snooze/dismiss/mute, cascade/purge và secret absence.

## 2. Main scheduler và instrumentation

- [x] 2.1 Thêm ProactiveCheckInService với clock/timer injection; timer chỉ tồn tại khi opt-in.
- [x] 2.2 Wire service/repositories vào composition root và shutdown lifecycle.
- [x] 2.3 Ghi activity sau memory/commitment mutation thành công.
- [x] 2.4 Ghi tool preview, confirmation, result và uncertain/resolution mà không lưu raw payload.

## 3. IPC và renderer bridge

- [x] 3.1 Thêm validated channels cho list/toggle/respond/unmute check-in và list activity.
- [x] 3.2 Main inject profile, read-before-write ownership gate và tính snooze timestamp.
- [x] 3.3 Expose typed bridge qua preload allowlist; cập nhật wiring/schema parity tests.

## 4. UI

- [x] 4.1 Nâng Today bằng card opt-in/check-in có bốn action, loading/error/retry/empty.
- [x] 4.2 Thêm trạng thái mute + Bật lại nhắc trong Goals.
- [x] 4.3 Thêm navigation Hoạt động, filters type/status và timeline loading/empty/error/retry.
- [x] 4.4 Giữ responsive/accessibility ở 1280x860 và 620x720.

## 5. Verification

- [x] 5.1 Unit/integration tests cho service, repositories, IPC ownership và tool instrumentation.
- [x] 5.2 Electron E2E cho opt-in → suggestion → snooze/dismiss/mute/unmute và Activity filters.
- [x] 5.3 Chạy `pnpm verify`, `pnpm build`, full `pnpm test:e2e`.
- [x] 5.4 Visual smoke/screenshots ở 1280x860 và 620x720 cho Today và Activity.
- [x] 5.5 Review diff, xác nhận `.omx` không staged và commit theo Lore Protocol, không push.
