## ADDED Requirements

### Requirement: Proactive check-in hoàn toàn opt-in

Hệ thống SHALL mặc định tắt proactive check-in cho mỗi profile. Hệ thống SHALL NOT tạo timer,
surface suggestion hoặc mô tả background reminder là đang hoạt động khi setting chưa được bật.

#### Scenario: Profile mới

- **WHEN** một profile chưa từng bật nhắc việc
- **THEN** Today hiển thị lời mời opt-in và main process không chạy check-in interval

#### Scenario: Tắt nhắc việc

- **WHEN** người dùng tắt nhắc việc toàn cục
- **THEN** interval dừng và Today không hiển thị suggestion cho tới khi bật lại

### Requirement: Suggestion chỉ được derive từ commitment

Hệ thống SHALL chỉ tạo suggestion từ commitment `active` hoặc `blocked` có due/check-in đã đến.
Hệ thống SHALL NOT tạo commitment mới, đổi lifecycle commitment hoặc suy luận nghĩa vụ từ chat,
memory hay tool result.

#### Scenario: Commitment tới thời điểm check-in

- **WHEN** app đang mở, opt-in đã bật và `check_in_at` của commitment đã đến
- **THEN** Today hiển thị một suggestion có reason check-in và related commitment

#### Scenario: Reconcile lặp lại

- **WHEN** service reconcile nhiều lần hoặc app khởi động lại với cùng trigger
- **THEN** chỉ có một suggestion hiện hành và không có activity generated trùng

### Requirement: Suggestion có bốn hành động an toàn

Hệ thống SHALL cho phép Thực hiện, Nhắc lại sau, Bỏ qua và Không nhắc việc này nữa. Các hành động
này SHALL chỉ thay đổi state local của suggestion/reminder và SHALL NOT gọi external tool write.

#### Scenario: Thực hiện

- **WHEN** người dùng bấm Thực hiện
- **THEN** suggestion chuyển `acted` và UI mở hội thoại nguồn hoặc Goals, không gửi message hay sửa commitment

#### Scenario: Nhắc lại sau

- **WHEN** người dùng chọn 1 giờ, 1 ngày hoặc 1 tuần rồi bấm Nhắc lại sau
- **THEN** suggestion bị ẩn tới thời điểm main tính từ duration đã chọn và sau đó xuất hiện lại nếu app còn mở

#### Scenario: Bỏ qua

- **WHEN** người dùng bấm Bỏ qua
- **THEN** trigger hiện tại chuyển `dismissed` và không xuất hiện lại trừ khi due/check-in thay đổi

#### Scenario: Không nhắc việc này nữa

- **WHEN** người dùng mute một suggestion
- **THEN** commitment đó không sinh suggestion mới cho tới khi người dùng bật lại nhắc trong Goals

### Requirement: Scheduler trung thực về lifecycle ứng dụng

Hệ thống SHALL chỉ schedule khi tiến trình Nexa đang sống. Hệ thống SHALL NOT tuyên bố đã gửi OS
notification hoặc tiếp tục chạy sau khi app đã thoát nếu chưa có background process thật.

#### Scenario: Đóng app trên Windows/Linux

- **WHEN** cửa sổ cuối cùng đóng và app quit
- **THEN** check-in scheduler dừng cùng process và không có delivery nào được hứa hẹn

### Requirement: Check-in state local-first và profile-bound

Hệ thống SHALL persist suggestion state theo profile/commitment, cascade khi purge/delete và không
lưu bản sao plaintext của title/next action.

#### Scenario: Renderer dùng suggestion của profile khác

- **WHEN** renderer gửi id không thuộc profile hiện tại
- **THEN** main từ chối trước mutation

#### Scenario: Purge profile

- **WHEN** người dùng purge dữ liệu profile
- **THEN** toàn bộ check-in state và activity liên quan bị xoá
