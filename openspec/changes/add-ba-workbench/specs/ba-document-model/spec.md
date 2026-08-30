## ADDED Requirements

### Requirement: Tài liệu BA được lưu dưới dạng item có cấu trúc

Hệ thống SHALL lưu tài liệu BA thành danh sách item có kiểu `field`, `use_case`, `rule`,
`flow_step`, `error_code` hoặc `actor`, mỗi item khớp một schema cố định, và SHALL sinh mọi bản
văn xuôi từ danh sách đó chứ không lưu văn xuôi làm nguồn sự thật.

#### Scenario: Sửa một item rồi xuất lại tài liệu
- **WHEN** người dùng sửa một use case rồi xuất bản Markdown
- **THEN** bản Markdown phản ánh nội dung mới mà không cần trích xuất lại

### Requirement: Trích xuất từ chối output không khớp schema

Hệ thống SHALL kiểm tra output trích xuất bằng schema trước khi lưu, SHALL NOT ép kiểu hay điền
giá trị mặc định cho trường thiếu, và SHALL thử lại tối đa hai lần trước khi báo thất bại.

#### Scenario: Model trả về use case thiếu actor
- **WHEN** output trích xuất thiếu trường bắt buộc
- **THEN** hệ thống từ chối output, thử lại kèm thông báo lỗi schema, và báo thất bại nếu vẫn không khớp

### Requirement: Phần không chắc chắn được tách riêng, không đoán thầm

Hệ thống SHALL đánh dấu `needs_review` cho item mà bước trích xuất không xác định được, SHALL hiển
thị chúng tách khỏi phần đã chắc chắn, và SHALL NOT dùng item `needs_review` làm căn cứ kết luận
trong báo cáo review.

#### Scenario: Một bảng trong DOCX không rõ là field hay rule
- **WHEN** trích xuất không xác định được kiểu item
- **THEN** item được ghi với `needs_review` và hiển thị trong nhóm cần người soát

### Requirement: Tài liệu dài được trích xuất theo chunk rồi hợp nhất

Hệ thống SHALL chia tài liệu theo cấu trúc heading sẵn có, trích xuất từng chunk độc lập, rồi hợp
nhất kết quả bằng bộ dò trùng xác định.

#### Scenario: Cùng một use case xuất hiện ở hai chunk
- **WHEN** hai chunk cùng sinh ra một use case có nội dung chuẩn hoá trùng khít
- **THEN** hệ thống giữ một item và ghi nhận cả hai vị trí nguồn

### Requirement: Dò trùng là xác định và không dùng embedding

Hệ thống SHALL chuẩn hoá text tiếng Việt (bỏ dấu, hạ chữ, bỏ stopword), bắt trùng khít bằng băm và
gắn cờ gần-trùng bằng Jaccard trên token-set với ngưỡng cố định, và SHALL NOT dùng embedding hay
lời gọi model để so sánh.

#### Scenario: Hai rule diễn đạt khác nhau cùng một ý
- **WHEN** hai rule có độ tương đồng token-set vượt ngưỡng
- **THEN** hệ thống gắn cờ gần-trùng và để người dùng quyết định gộp, chứ không tự gộp

### Requirement: Hai mệnh đề ngược nghĩa không bao giờ được đề xuất gộp

Hệ thống SHALL giữ từ phủ định khi chuẩn hoá, SHALL xếp cặp chỉ lệch nhau ở từ phủ định vào nhóm
nghi mâu thuẫn thay vì nhóm nghi trùng, và SHALL NOT đề xuất gộp cặp đó.

#### Scenario: Một rule và bản phủ định của nó
- **WHEN** tài liệu chứa "cho phép sửa đơn hàng" và "không cho phép sửa đơn hàng"
- **THEN** hệ thống xếp cặp này vào nhóm nghi mâu thuẫn và không đưa vào danh sách gợi ý gộp

### Requirement: Trang mã lỗi tổng hợp đầy đủ và phát hiện bất nhất

Hệ thống SHALL gom mọi item `error_code` của một tài liệu thành một trang, SHALL chỉ ra mã lỗi xuất
hiện trong flow hoặc use case nhưng thiếu trong bảng mã lỗi và ngược lại, và SHALL chỉ ra mã lỗi
mang hai thông điệp khác nhau.

#### Scenario: Mã lỗi được nhắc trong luồng ngoại lệ nhưng chưa khai báo
- **WHEN** một use case tham chiếu mã lỗi không có item `error_code` tương ứng
- **THEN** trang mã lỗi liệt kê mã đó trong nhóm thiếu khai báo kèm vị trí tham chiếu

#### Scenario: Một mã lỗi có hai thông điệp
- **WHEN** hai item `error_code` cùng mã nhưng khác thông điệp
- **THEN** trang mã lỗi hiển thị cả hai bản và đánh dấu bất nhất

### Requirement: Trích xuất không chạy lại khi nội dung không đổi

Hệ thống SHALL lưu hash nội dung nguồn cùng kết quả trích xuất và SHALL tái dùng kết quả khi hash
không đổi.

#### Scenario: Bấm trích xuất lần thứ hai trên cùng tài liệu
- **WHEN** nội dung nguồn không thay đổi kể từ lần trích xuất trước
- **THEN** hệ thống trả kết quả đã lưu mà không gọi model

### Requirement: Nội dung tài liệu được mã hoá, không có cột plaintext để join

Hệ thống SHALL mã hoá payload của mọi item, SHALL thực hiện join, dò trùng và tổng hợp trên object
đã giải mã trong main process, và SHALL NOT tạo cột plaintext chứa nội dung nghiệp vụ để phục vụ
truy vấn SQL.

#### Scenario: Mở file SQLite bằng công cụ thông thường
- **WHEN** một người mở file database bằng trình xem SQLite
- **THEN** không đọc được mã lỗi, tên use case hay nội dung rule ở dạng rõ
