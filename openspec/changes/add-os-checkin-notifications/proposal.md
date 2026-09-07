## Why

Check-in engine đã tính đúng thời điểm cần nhắc, nhưng lời nhắc chỉ tồn tại trên màn hình Hôm nay.
Người dùng thu nhỏ Nexa để làm việc khác — đúng lúc cần được nhắc nhất — thì không thấy gì. Cả
`add-proactive-check-ins-and-agent-activity` lẫn `add-daily-briefing` đều cố ý loại thông báo OS ra
khỏi phạm vi, và giới hạn đó giờ là thứ duy nhất chắn giữa "Nexa biết bạn trễ hạn" và "bạn biết
mình trễ hạn".

Change này biến lời nhắc thành thông báo hệ điều hành và thêm tray icon, trong đúng ranh giới
vòng đời tiến trình mà `index.ts` đang giữ: **đóng cửa sổ vẫn là thoát hẳn**, không có tiến trình
nền nào ôm credential đã giải mã.

## What Changes

- Thêm notifier chạy trong main process, subscribe vào cổng `onChanged` mà
  `ProactiveCheckInService` đã chừa sẵn; service không cần biết Notification API tồn tại.
- Thêm tray icon với menu Mở Nexa / Tạm dừng nhắc 1 giờ / Thoát, dùng lại `resources/icon.ico`.
- Thêm tuỳ chọn thu nhỏ xuống tray. **Đóng cửa sổ vẫn thoát app như hiện tại** — không đổi
  `window-all-closed`.
- Thêm setting `checkInOsNotificationsEnabled` (mặc định **tắt**) và `notificationShowContent`
  (mặc định **tắt**).
- Mặc định nội dung thông báo là chung chung ("Bạn có 2 việc tới hạn"); tên cam kết chỉ xuất hiện
  khi người dùng bật `notificationShowContent`, vì trung tâm thông báo của OS hiển thị cả trên màn
  hình khoá và nằm ngoài vùng mã hoá của Nexa.
- Gộp nhiều suggestion cùng lúc thành MỘT thông báo, và không bắn thêm cho suggestion đã hiện.
- Im lặng khi cửa sổ đang hiện và đang focus — Hôm nay đã nói rồi, thông báo lúc đó chỉ là nhiễu.
- Bấm vào thông báo hoặc tray thì hiện cửa sổ và điều hướng thẳng tới Hôm nay.
- Thêm `app.setAppUserModelId` để Windows gắn đúng danh tính ứng dụng cho toast.
- **BREAKING (spec-level):** yêu cầu "SHALL NOT tuyên bố đã gửi OS notification" của
  `proactive-check-ins` được thay bằng hợp đồng mới: được gửi, nhưng không được coi là đã tới nơi.
- **KHÔNG** có nhắc khi app đã thoát. Việc đó cần một tiến trình nền thật và một quyết định về
  credential; nó nằm ngoài change này và được ghi lại thành câu hỏi mở.

## Capabilities

### New Capabilities

- `os-notifications`: thông báo hệ điều hành và tray cho check-in — điều kiện gửi, chính sách nội
  dung, gộp, deep-link, tray menu và ứng xử khi nền tảng không hỗ trợ.

### Modified Capabilities

- `proactive-check-ins`: nới yêu cầu "scheduler trung thực về lifecycle" để cho phép gửi thông báo
  OS trong khi tiến trình còn sống, đồng thời giữ nguyên cấm tuyên bố nhắc sau khi app đã thoát.

## Impact

- **Code:** `apps/desktop/src/main` (notifier, tray, lifecycle, deep-link event),
  `packages/shared-types` (settings, event channel), renderer (điều hướng khi được đánh thức, hai
  công tắc trong Cài đặt).
- **Data:** không có migration. Hai setting mới nằm trong settings đã mã hoá theo profile.
- **Privacy:** đây là bề mặt rò rỉ MỚI — nội dung rời khỏi vùng mã hoá của Nexa vào trung tâm
  thông báo của OS. Mặc định tắt nội dung là bắt buộc, không phải tuỳ chọn thẩm mỹ.
- **Lifecycle:** tray tồn tại cùng tiến trình; `window-all-closed` giữ nguyên hành vi thoát trên
  Windows/Linux.
- **Dependencies:** không thêm package; dùng `Notification` và `Tray` sẵn có của Electron.
