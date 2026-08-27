## ADDED Requirements

### Requirement: Timeline hiển thị bảy loại hoạt động có cấu trúc

Hệ thống SHALL hiển thị suggestion, memory mutation, commitment mutation, tool preview,
confirmation, tool result và uncertain operation với timestamp, type, action, status, related
object và request/operation id khi nguồn có các id đó.

#### Scenario: Memory được cập nhật

- **WHEN** mutation memory thành công qua ownership-gated IPC
- **THEN** timeline có event memory mutation cho fact id đó mà không chứa fact content

#### Scenario: Tool write hoàn tất

- **WHEN** tool đã đi qua preview/confirmation và trả kết quả
- **THEN** timeline có các event preview, confirmation và result với cùng operation id

#### Scenario: Tool result chưa chắc chắn

- **WHEN** write timeout sau khi có thể đã tới hệ thống đích
- **THEN** timeline có uncertain operation và không trình bày nó như success/failed chắc chắn

### Requirement: Timeline không lưu hoặc hiển thị payload nhạy cảm

Hệ thống SHALL NOT lưu hoặc trả cho timeline secret, credential, raw tool arguments, payload hash,
raw preview fields, raw MCP result, target URL, memory content hoặc commitment next action.

#### Scenario: Tool payload chứa secret marker

- **WHEN** một tool call có raw payload chứa chuỗi đánh dấu nhạy cảm
- **THEN** chuỗi đó không xuất hiện trong activity database row, IPC response hoặc Activity UI

### Requirement: Timeline filter theo type và status

Hệ thống SHALL cho phép filter độc lập theo activity type và status, giữ thứ tự timestamp giảm dần
và không trả event của profile khác.

#### Scenario: Filter uncertain operation

- **WHEN** người dùng chọn type uncertain operation và status uncertain
- **THEN** list chỉ chứa event cùng profile khớp cả hai filter

### Requirement: Activity UI có đủ async states

Hệ thống SHALL có loading, empty, error và retry state. Error SHALL giữ filter hiện tại và hiển thị
request id khi bridge cung cấp.

#### Scenario: Tải timeline thất bại rồi retry

- **WHEN** lần tải đầu trả lỗi và lần retry thành công
- **THEN** UI chuyển từ error sang list/empty mà không reset filter

### Requirement: Activity mutation không đi vòng confirmation guard

Hệ thống SHALL ghi timeline ở main-owned seams và SHALL NOT cho renderer emit activity hoặc dùng
timeline action để execute external writes.

#### Scenario: Renderer gọi channel lạ

- **WHEN** renderer cố gọi một channel activity/check-in không có trong preload allowlist
- **THEN** preload từ chối và main không nhận mutation
