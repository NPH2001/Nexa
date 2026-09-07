## Context

Ba thứ đã có và không được phá:

- **`ProactiveCheckInService`** ([proactive-check-in-service.ts:34](../../../apps/desktop/src/main/proactive-check-in-service.ts))
  reconcile mỗi 60s và gọi `onChanged(changedAt)`. Comment trong đó đã nói trước tình huống này:
  *"Service không biết gì về Notification API. `onChanged` là output port duy nhất… một adapter OS
  notification tương lai có thể subscribe cùng port"*. Change này chính là adapter đó.
- **`emitCheckInsChanged`** trong `index.ts` hiện là consumer duy nhất của port, và nó chỉ đẩy
  event xuống renderer.
- **`window-all-closed`** gọi `app.quit()` trên Windows/Linux, kèm lý do viết thẳng trong mã:
  *"Không giữ tiến trình nền ôm credential đã giải mã trong bộ nhớ."*

Ràng buộc cuối cùng là thứ định hình toàn bộ thiết kế này: một tray "đóng để thu nhỏ" sẽ giữ tiến
trình sống vô thời hạn với credential đã giải mã trong RAM, tức là lật ngược một quyết định bảo mật
có chủ đích. Change này KHÔNG lật nó.

Hiện `app.setAppUserModelId` chưa được gọi, nên toast trên Windows sẽ hiện sai danh tính ứng dụng.

## Goals / Non-Goals

**Goals:**

- Người dùng thu nhỏ Nexa vẫn biết được khi có việc tới hạn.
- Không có bề mặt rò rỉ mới nào bật theo mặc định.
- `ProactiveCheckInService` không thêm một dòng nào biết về Notification.
- Bấm thông báo là tới thẳng chỗ cần xử lý, không phải mò lại.

**Non-Goals:**

- Không nhắc khi app đã thoát. Cần tiến trình nền thật + quyết định về credential.
- Không auto-launch lúc khởi động máy.
- Không thông báo cho bất kỳ nguồn nào khác (chat, tool, bản tin) trong v1.
- Không đổi ngữ nghĩa `window-all-closed`.
- Không hành động trực tiếp (Hoãn/Bỏ qua) từ trong thông báo — xem Open Questions.

## Decisions

### D1 — Notifier là adapter thuần, subscribe cổng có sẵn

`CheckInNotifier` nhận `(suggestions, windowState)` và quyết định gửi hay không. `index.ts` nối
`onCheckInsChanged` tới cả `emitCheckInsChanged` (như cũ) và `notifier.onCheckInsChanged()`.

Notifier nhận `Notification` API qua tham số để test được mà không cần Electron thật, giống cách
`ProactiveCheckInService` nhận `setIntervalFn`.

*Đã cân nhắc:* cho service tự bắn thông báo. Bị loại — nó sẽ kéo Electron vào một class hiện đang
test được bằng SQLite thuần, và trộn "tính toán khi nào cần nhắc" với "nhắc bằng cách nào".

### D2 — Mặc định giấu nội dung, không phải mặc định hiện

Trung tâm thông báo của OS hiển thị cả trên màn hình khoá, được các trợ lý đọc to, và bị đồng bộ
sang máy khác trên một số cấu hình Windows. Tên cam kết là kế hoạch công việc nội bộ — cùng loại dữ
liệu mà repo đang mã hoá trong SQLite và cố ý KHÔNG ghi vào activity row.

Mặc định: *"Nexa: 2 việc cần chú ý"*. Bật `notificationShowContent` mới thành *"Gửi báo cáo quý"*.

*Đã cân nhắc:* mặc định hiện tên cho hữu ích hơn. Bị loại: một tính năng tiện hơn 5% không đáng đổi
lấy việc kế hoạch nội bộ hiện trên màn hình khoá ở phòng họp.

### D3 — Tray tồn tại, nhưng đóng vẫn là thoát

Tray icon dựng khi app start, huỷ trong `before-quit`. Menu: Mở Nexa / Tạm dừng nhắc 1 giờ / Thoát.
Thêm setting thu nhỏ-xuống-tray cho hành vi minimize; **`window-all-closed` không đổi một dòng**.

Ranh giới này giữ đúng bất biến credential: tiến trình chỉ sống khi người dùng chưa đóng cửa sổ.
Người dùng muốn được nhắc thì để Nexa ở tray; muốn tắt hẳn thì đóng — và Nexa nói thật rằng lúc đó
nó không nhắc được.

*Đã cân nhắc:* đóng-để-xuống-tray như Slack/Teams. Bị loại trong v1 vì nó đòi hỏi khoá lại
credential cache khi ẩn, và đó là một change riêng ở tầng `@nexa/security`.

### D4 — Chống ồn bằng tập id đã thông báo

Notifier giữ một `Set<suggestionId>` đã thông báo trong bộ nhớ. Mỗi lần `onChanged`, chỉ những id
pending chưa có trong tập mới kích hoạt thông báo, và tất cả gộp thành một. Id biến mất khỏi danh
sách pending thì cũng rời khỏi tập, để một mốc mới sau này vẫn nhắc lại được.

Tập nằm trong RAM có chủ đích: app khởi động lại là một phiên làm việc mới, và nhắc lại một lần lúc
đó là đúng hơn im lặng.

### D5 — Điều kiện gửi là "người dùng có đang nhìn không", không phải "cửa sổ có tồn tại không"

Gửi khi `window === null || !isVisible() || !isFocused()`. Cửa sổ mở nhưng nằm sau trình duyệt vẫn
là không nhìn thấy.

### D6 — Deep-link qua event có sẵn

Thêm event `NEXA_EVENTS.navigate` với payload `{ view: 'today' }`. Main hiện/khôi phục cửa sổ rồi
gửi event; renderer đổi view. Không thêm channel IPC hai chiều nào.

### D7 — `setAppUserModelId` trong `start()`

Windows cần AppUserModelId khớp shortcut Start Menu thì toast mới hiện đúng tên và icon. Dùng
`net.fimaster.nexa` từ `electron-builder.yml`. Ở bản dev chưa cài shortcut, toast có thể không hiện
— đó là lý do D8 tồn tại.

### D8 — Kiểm tra `Notification.isSupported()` trước, và không hứa

Cài đặt vô hiệu hoá công tắc kèm lý do khi nền tảng không hỗ trợ. Kể cả khi hỗ trợ, Nexa không bao
giờ nói "đã nhắc bạn rồi" — Do Not Disturb, focus assist và chính sách nhóm đều có thể nuốt toast
mà không báo lỗi. Suggestion vẫn nằm trên Hôm nay, và Hôm nay mới là nguồn sự thật.

## Risks / Trade-offs

- **Kế hoạch nội bộ hiện trên màn hình khoá** → D2 mặc định tắt nội dung; mô tả setting nói thẳng
  rủi ro thay vì chỉ ghi "hiển thị chi tiết".
- **Thông báo dồn dập gây mất tin tưởng** → D4 gộp và không lặp; tạm dừng một giờ ngay trên tray.
- **Người dùng tưởng Nexa nhắc cả khi đã tắt app** → D3 giữ nguyên ngữ nghĩa thoát và spec bắt UI
  phải nói rõ; đây là rủi ro về kỳ vọng, không phải về mã.
- **Toast không hiện trên Linux tuỳ desktop environment** → D8 kiểm tra trước và không hứa.
- **Tray icon rò rỉ giữa các lần test E2E** → huỷ trong `before-quit` và khẳng định bằng test
  lifecycle.
- **`icon.ico` có thể không hợp làm tray trên Linux** → dùng lại asset hiện có, và nếu hỏng thì
  dựng PNG riêng trong bước triển khai chứ không đổi thiết kế.

## Migration Plan

1. Setting mới (mặc định tắt) — không migration DB, không đổi hành vi hiện tại.
2. `setAppUserModelId` + tray, chưa nối thông báo. Kiểm tra vòng đời thoát không hồi quy.
3. Nối notifier vào `onChanged`, ship với nội dung chung chung.
4. Thêm `notificationShowContent` và hai công tắc trong Cài đặt.

Rollback: tắt `checkInOsNotificationsEnabled` đưa hành vi về đúng hiện tại. Gỡ tray cần một lần
phát hành, nên tray được thêm sau setting để có thể dừng lại giữa chừng.

## Open Questions

- [ ] Product owner: thông báo có nên mang nút hành động (Hoãn 1 giờ / Bỏ qua) không? Windows và
      Linux hỗ trợ khác nhau, và hành động từ ngoài app sẽ đổi state mà người dùng chưa thấy màn
      hình xác nhận nào.
- [ ] Security owner: có chấp nhận "đóng để xuống tray" nếu credential cache bị khoá lại khi ẩn
      không? Đây là thứ chặn việc nhắc sau khi người dùng đóng cửa sổ.
- [ ] Product owner: bản tin buổi sáng (`add-daily-briefing`) có nên dùng chung notifier này cho
      một thông báo lúc bắt đầu ngày không, hay giữ nguyên chỉ-khi-mở-app?
