## MODIFIED Requirements

### Requirement: Scheduler trung thực về lifecycle ứng dụng

Hệ thống SHALL chỉ schedule khi tiến trình Nexa đang sống. Trong khi tiến trình còn sống, hệ thống
MAY gửi thông báo hệ điều hành theo hợp đồng của `os-notifications`. Hệ thống SHALL NOT tuyên bố
sẽ nhắc sau khi app đã thoát, và SHALL NOT coi việc gửi thông báo là bằng chứng người dùng đã nhận
được nó.

#### Scenario: Đóng app trên Windows/Linux

- **WHEN** cửa sổ cuối cùng đóng và app quit
- **THEN** check-in scheduler dừng cùng process, tray icon biến mất và không có delivery nào được hứa hẹn

#### Scenario: Cửa sổ thu nhỏ nhưng tiến trình còn sống

- **WHEN** cửa sổ bị thu nhỏ và một mốc check-in tới hạn
- **THEN** scheduler vẫn chạy và được phép gửi một thông báo hệ điều hành

#### Scenario: Mô tả tính năng cho người dùng

- **WHEN** giao diện giải thích nhắc việc hoạt động thế nào
- **THEN** nó nói rõ nhắc việc chỉ chạy khi Nexa đang mở, kể cả khi cửa sổ đang ẩn
