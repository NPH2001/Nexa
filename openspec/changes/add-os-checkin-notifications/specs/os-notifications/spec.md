## ADDED Requirements

### Requirement: Thông báo OS là opt-in riêng

Hệ thống SHALL mặc định tắt `checkInOsNotificationsEnabled` và SHALL NOT gửi thông báo OS khi
setting này chưa bật, kể cả khi proactive check-in đã bật. Hệ thống SHALL yêu cầu cả hai setting
cùng bật thì mới gửi.

#### Scenario: Chỉ bật check-in

- **WHEN** người dùng bật nhắc việc nhưng chưa bật thông báo hệ thống
- **THEN** suggestion vẫn hiện trên Hôm nay và không có thông báo OS nào được gửi

#### Scenario: Tắt check-in nhưng còn bật thông báo

- **WHEN** người dùng tắt proactive check-in
- **THEN** không có suggestion nào được sinh nên cũng không có thông báo OS nào được gửi

### Requirement: Nội dung nhạy cảm không ra khỏi vùng mã hoá theo mặc định

Hệ thống SHALL mặc định tắt `notificationShowContent` và SHALL dùng nội dung chung chung nêu số
lượng việc tới hạn, không nêu tên cam kết hay bước tiếp theo. Hệ thống SHALL chỉ đưa tên cam kết
vào thông báo khi người dùng bật tuỳ chọn này.

#### Scenario: Mặc định

- **WHEN** hai cam kết tới hạn và người dùng chưa bật hiển thị nội dung
- **THEN** thông báo nêu số lượng việc cần chú ý và không chứa tên cam kết hay bước tiếp theo

#### Scenario: Người dùng chấp nhận hiển thị nội dung

- **WHEN** người dùng bật hiển thị nội dung và một cam kết tới hạn
- **THEN** thông báo nêu tên cam kết đó

#### Scenario: Không có bí mật nào trong thông báo

- **WHEN** hệ thống dựng bất kỳ thông báo nào
- **THEN** thông báo không chứa credential, id nội bộ, payload tool hay nội dung memory

### Requirement: Không thông báo khi người dùng đang nhìn thấy màn hình

Hệ thống SHALL bỏ qua thông báo khi cửa sổ chính đang hiện và đang được focus, vì màn hình Hôm nay
đã hiển thị suggestion đó.

#### Scenario: Cửa sổ đang focus

- **WHEN** một suggestion mới xuất hiện trong lúc người dùng đang mở Nexa
- **THEN** không có thông báo OS nào được gửi và Hôm nay vẫn cập nhật như cũ

#### Scenario: Cửa sổ thu nhỏ

- **WHEN** một suggestion mới xuất hiện trong lúc cửa sổ đang thu nhỏ hoặc bị che
- **THEN** hệ thống gửi một thông báo OS

### Requirement: Gộp và không lặp lại

Hệ thống SHALL gộp mọi suggestion đang chờ thành MỘT thông báo cho mỗi lần thay đổi. Hệ thống
SHALL NOT gửi lại thông báo cho một suggestion đã được thông báo, kể cả khi service reconcile
nhiều lần.

#### Scenario: Ba việc tới hạn cùng lúc

- **WHEN** ba suggestion cùng chuyển sang pending trong một lần reconcile
- **THEN** người dùng nhận đúng một thông báo nói về ba việc

#### Scenario: Reconcile lặp lại

- **WHEN** service reconcile lại mà tập suggestion không đổi
- **THEN** không có thông báo mới nào được gửi

#### Scenario: Suggestion mới sau khi đã thông báo

- **WHEN** một cam kết khác tới hạn sau đó
- **THEN** hệ thống gửi một thông báo mới cho phần chưa từng được thông báo

### Requirement: Thông báo và tray mở đúng chỗ

Hệ thống SHALL hiện và focus cửa sổ chính khi người dùng bấm vào thông báo hoặc chọn Mở Nexa từ
tray, và SHALL điều hướng tới màn hình Hôm nay. Hệ thống SHALL mở lại cửa sổ nếu nó đã bị đóng.

#### Scenario: Bấm vào thông báo khi cửa sổ đang thu nhỏ

- **WHEN** người dùng bấm vào thông báo
- **THEN** cửa sổ được khôi phục, được focus và hiển thị Hôm nay

#### Scenario: Bấm tray khi không còn cửa sổ

- **WHEN** người dùng chọn Mở Nexa từ tray trong lúc không có cửa sổ nào
- **THEN** hệ thống mở một cửa sổ mới và hiển thị Hôm nay

### Requirement: Tray không đổi ngữ nghĩa thoát ứng dụng

Hệ thống SHALL giữ nguyên hành vi hiện tại: đóng cửa sổ cuối cùng trên Windows/Linux là thoát
ứng dụng. Hệ thống SHALL cho phép thu nhỏ xuống tray như một tuỳ chọn riêng, và SHALL NOT giữ
tiến trình sống sau khi người dùng đóng cửa sổ.

#### Scenario: Đóng cửa sổ

- **WHEN** người dùng đóng cửa sổ cuối cùng trên Windows
- **THEN** ứng dụng thoát, tray icon biến mất và không còn thông báo nào được gửi

#### Scenario: Thu nhỏ xuống tray

- **WHEN** người dùng bật thu nhỏ xuống tray rồi thu nhỏ cửa sổ
- **THEN** cửa sổ ẩn đi, tiến trình còn sống và thông báo vẫn hoạt động

#### Scenario: Thoát từ menu tray

- **WHEN** người dùng chọn Thoát trong menu tray
- **THEN** ứng dụng thoát theo đúng đường shutdown hiện có

### Requirement: Tạm dừng nhắc từ tray là hành động local

Hệ thống SHALL cho phép tạm dừng thông báo một giờ từ menu tray. Hành động này SHALL chỉ chặn
thông báo OS và SHALL NOT đổi state của suggestion, commitment hay setting đã lưu.

#### Scenario: Tạm dừng rồi có việc tới hạn

- **WHEN** người dùng tạm dừng một giờ và một cam kết tới hạn trong khoảng đó
- **THEN** không có thông báo OS nào được gửi nhưng Hôm nay vẫn hiển thị suggestion

#### Scenario: Hết thời gian tạm dừng

- **WHEN** một giờ trôi qua và vẫn còn suggestion chưa xử lý
- **THEN** hệ thống được phép thông báo lại

### Requirement: Trung thực khi nền tảng không hỗ trợ

Hệ thống SHALL kiểm tra khả năng hiển thị thông báo của nền tảng trước khi hứa hẹn bất cứ điều gì,
và SHALL nói rõ trong Cài đặt khi máy không hỗ trợ. Hệ thống SHALL NOT coi việc gọi API thành công
là bằng chứng người dùng đã nhìn thấy thông báo.

#### Scenario: Nền tảng không hỗ trợ

- **WHEN** hệ điều hành không hỗ trợ thông báo
- **THEN** Cài đặt hiển thị lý do và công tắc bị vô hiệu hoá thay vì bật một tính năng không chạy

#### Scenario: Người dùng bật Do Not Disturb

- **WHEN** hệ điều hành nuốt thông báo vì chế độ tập trung
- **THEN** Nexa không tuyên bố đã nhắc thành công và suggestion vẫn chờ trên Hôm nay
