## ADDED Requirements

### Requirement: Bảng phím tắt toàn cục
Hệ thống SHALL hỗ trợ các phím tắt sau, với `Ctrl` hoặc `Cmd` làm phím bổ trợ duy nhất: `N` tạo hội thoại mới, `K` focus ô tìm kiếm, `,` mở Cài đặt, `1` Hôm nay, `2` Mục tiêu, `3` Hoạt động, `4` Nghiệp vụ. Hệ thống SHALL NOT dùng phím đơn không có phím bổ trợ làm phím tắt toàn cục.

#### Scenario: Tạo hội thoại mới
- **WHEN** người dùng nhấn `Ctrl+N`
- **THEN** hệ thống tạo hội thoại mới

#### Scenario: Phím có thêm Alt hoặc Shift
- **WHEN** người dùng nhấn `Ctrl+Shift+N`
- **THEN** hệ thống không kích hoạt phím tắt nào

### Requirement: Không giành phím của bộ gõ hay dialog
Hệ thống SHALL NOT kích hoạt phím tắt khi người dùng đang gõ dở trong IME hoặc khi có dialog modal đang mở.

#### Scenario: Đang gõ Telex
- **WHEN** `isComposing` là true và người dùng nhấn `Ctrl+K`
- **THEN** không phím tắt nào được kích hoạt

#### Scenario: Có dialog xác nhận
- **WHEN** dialog modal đang mở và người dùng nhấn `Ctrl+1`
- **THEN** không phím tắt nào được kích hoạt

### Requirement: Phím tắt Nghiệp vụ theo cờ tính năng
Phím `Ctrl+4` SHALL chỉ kích hoạt khi tính năng Nghiệp vụ (BA) được bật.

#### Scenario: Tính năng BA tắt
- **WHEN** BA tắt và người dùng nhấn `Ctrl+4`
- **THEN** không phím tắt nào được kích hoạt

### Requirement: Gợi ý phím tắt cho người dùng và trình đọc màn hình
Mỗi phím tắt SHALL có nhãn hiển thị (ví dụ `Ctrl+N`) và giá trị `aria-keyshortcuts` tương ứng (ví dụ `Control+N`).

#### Scenario: Nhãn và giá trị ARIA khớp
- **WHEN** hệ thống dựng gợi ý cho phím mở Cài đặt
- **THEN** nhãn là `Ctrl+,` và `aria-keyshortcuts` là `Control+Comma`
