## 1. Contract và setting

- [x] 1.1 Thêm `checkInOsNotificationsEnabled` (default false) và `notificationShowContent` (default false) vào schema settings; test khẳng định cả hai mặc định tắt.
- [x] 1.2 Thêm event `NEXA_EVENTS.navigate` với payload `{ view: 'today' }` vào channels và kiểu event dùng chung.
- [x] 1.3 Gọi `app.setAppUserModelId('net.fimaster.nexa')` trong `start()` trước khi mở cửa sổ.

## 2. Notifier

- [x] 2.1 Thêm `CheckInNotifier` nhận Notification API, clock và một hàm đọc trạng thái cửa sổ qua tham số; không import `electron` trực tiếp ở đường test được.
- [x] 2.2 Điều kiện gửi: hai setting cùng bật, và cửa sổ không hiện hoặc không focus.
- [x] 2.3 Gộp suggestion pending thành một thông báo; giữ `Set` id đã thông báo và loại id khi nó rời danh sách pending.
- [x] 2.4 Dựng nội dung theo `notificationShowContent`: mặc định chỉ nêu số lượng, bật rồi mới nêu tên cam kết.
- [x] 2.5 Tạm dừng một giờ: cờ trong bộ nhớ, chỉ chặn thông báo, không đụng state suggestion.
- [x] 2.6 Test: opt-in kép, im lặng khi focus, gộp, không lặp, tạm dừng, và không có nội dung nhạy cảm khi tuỳ chọn tắt.

## 3. Tray và lifecycle

- [x] 3.1 Dựng tray từ `resources/icon.ico` trong `start()`; nếu asset không dùng được trên nền tảng hiện tại thì log và bỏ qua tray thay vì chết.
- [x] 3.2 Menu tray: Mở Nexa / Tạm dừng nhắc 1 giờ / Thoát.
- [x] 3.3 Huỷ tray trong `before-quit`; khẳng định bằng test rằng không còn handle nào sau shutdown.
- [x] 3.4 Thêm setting thu nhỏ-xuống-tray cho hành vi minimize; **không** đổi `window-all-closed`.
- [x] 3.5 Test lifecycle: đóng cửa sổ cuối vẫn thoát app trên Windows/Linux như trước.

## 4. Deep-link

- [x] 4.1 Bấm thông báo hoặc Mở Nexa: khôi phục/hiện/focus cửa sổ, mở cửa sổ mới nếu không còn cửa sổ nào.
- [x] 4.2 Gửi `navigate` tới renderer sau khi cửa sổ sẵn sàng; renderer chuyển sang Hôm nay.
- [x] 4.3 Test: cả hai đường (còn cửa sổ và không còn cửa sổ) đều kết thúc ở Hôm nay.

## 5. UI

- [x] 5.1 Hai công tắc trong Cài đặt, mô tả nói thẳng rủi ro màn hình khoá của tuỳ chọn nội dung.
- [x] 5.2 Vô hiệu hoá công tắc kèm lý do khi `Notification.isSupported()` trả false.
- [x] 5.3 Sửa mô tả nhắc việc trên Hôm nay: nói rõ chỉ chạy khi Nexa đang mở, kể cả khi cửa sổ ẩn.
- [x] 5.4 Giữ responsive/accessibility ở 1280x860 và 620x720.

## 6. Verification

- [x] 6.1 Unit test cho notifier và tray lifecycle với Notification/Tray giả.
- [x] 6.2 E2E: bật hai setting, dựng một cam kết quá hạn, thu nhỏ cửa sổ, khẳng định notifier được gọi đúng một lần với nội dung chung chung.
- [x] 6.3 `pnpm verify` và `pnpm test:e2e` xanh; cập nhật DESIGN.md phần proactive check-in và ràng buộc lifecycle.
