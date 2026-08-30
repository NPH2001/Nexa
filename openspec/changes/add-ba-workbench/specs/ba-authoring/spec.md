## ADDED Requirements

### Requirement: Template là hợp đồng outline kiểm tra được

Hệ thống SHALL lưu template gồm danh sách mục có thứ tự, mỗi mục ghi rõ bắt buộc hay tuỳ chọn và
kiểu item được phép chứa, và SHALL NOT coi template chỉ là một đoạn văn bản hướng dẫn gửi cho model.

#### Scenario: Sinh tài liệu thiếu mục bắt buộc
- **WHEN** bản nháp sinh ra không có item nào cho một mục bắt buộc
- **THEN** hệ thống đánh dấu mục đó là thiếu ngay trên bản nháp, không im lặng bỏ qua

### Requirement: Bộ template chuẩn ship kèm ứng dụng và do IT ghi đè

Hệ thống SHALL nạp bộ template từ một file resource đi kèm bản cài, SHALL cho phép IT thay thế file
đó lúc phân phối, và SHALL NOT cung cấp chức năng tạo hay sửa template cho người dùng cuối trong
change này.

#### Scenario: Người dùng chọn template
- **WHEN** người dùng tạo tài liệu mới
- **THEN** hệ thống hiển thị danh sách template chuẩn để chọn, không có tuỳ chọn tạo template mới

#### Scenario: IT phân phối bộ template riêng của tổ chức
- **WHEN** file resource template bị thay thế lúc phân phối
- **THEN** ứng dụng dùng bộ template đó mà không cần thay đổi mã

### Requirement: Template hỏng không làm hỏng khởi động

Hệ thống SHALL kiểm file resource template bằng schema lúc khởi động, SHALL loại các template không
hợp lệ kèm log nêu id và lý do, và SHALL tiếp tục khởi động với các template còn lại.

#### Scenario: Một template trong file resource sai schema
- **WHEN** file chứa một template thiếu trường bắt buộc
- **THEN** template đó bị loại, các template còn lại vẫn dùng được và log ghi id cùng lý do

### Requirement: Tài liệu ghi lại phiên bản template đã dùng

Hệ thống SHALL lưu `template_id` và `template_version` trên tài liệu tại thời điểm chọn, và SHALL
hiển thị khi phiên bản đó khác phiên bản template hiện có.

#### Scenario: IT nâng phiên bản một template
- **WHEN** người dùng mở tài liệu được viết theo phiên bản cũ
- **THEN** hệ thống nêu rõ tài liệu theo phiên bản cũ và để người dùng chọn có chuyển sang bản mới hay không

### Requirement: Sinh tài liệu là phép chiếu từ mô hình theo template

Hệ thống SHALL sinh bản Markdown từ item của tài liệu theo thứ tự mục của template đang chọn, và
SHALL NOT thêm nội dung nghiệp vụ không có trong mô hình.

#### Scenario: Đổi template trên cùng một tài liệu
- **WHEN** người dùng chọn một template khác cho cùng tài liệu
- **THEN** hệ thống sinh lại bản Markdown theo bố cục mới mà nội dung item không đổi

### Requirement: Use case bị ràng buộc để không miên man

Hệ thống SHALL bắt buộc use case có id, tên tối đa 120 ký tự, actor, precondition, main flow tối đa
12 bước với mỗi bước tối đa 200 ký tự, luồng thay thế, luồng ngoại lệ, postcondition, role và tác
động dữ liệu; và SHALL từ chối item vượt giới hạn thay vì cắt bớt im lặng.

#### Scenario: Main flow dài quá giới hạn
- **WHEN** một use case có 15 bước trong luồng chính
- **THEN** hệ thống từ chối item và chỉ ra rằng luồng chính cần được tách thành use case riêng

### Requirement: Rule là một mệnh đề nguyên tử có liên kết

Hệ thống SHALL bắt buộc mỗi rule là một mệnh đề tối đa 200 ký tự, có id, và gắn với ít nhất một use
case hoặc field; và SHALL tách một rule chứa nhiều điều kiện độc lập thành nhiều rule khi chuẩn hoá.

#### Scenario: Rule ghép hai điều kiện độc lập
- **WHEN** bộ chuẩn hoá gặp một rule nối hai mệnh đề không phụ thuộc nhau
- **THEN** hệ thống đề xuất tách thành hai rule và để người dùng xác nhận

### Requirement: Rulebook common validate quyết định trường nào cần validate

Hệ thống SHALL lưu một rulebook ánh xạ `field_type` sang tập validate chuẩn của tổ chức, SHALL áp
rulebook cho field lấy từ bất kỳ nguồn nào, và SHALL cho phép đánh dấu một field là `no_validation`
kèm lý do.

#### Scenario: Field kiểu email thiếu validate định dạng
- **WHEN** một field được nhận diện kiểu email nhưng không có rule định dạng
- **THEN** hệ thống chỉ ra validate còn thiếu theo rulebook, kèm tên validate cụ thể

#### Scenario: Field cố ý không cần validate
- **WHEN** người dùng đánh dấu một field là `no_validation` kèm lý do
- **THEN** hệ thống không báo thiếu validate cho field đó nữa và giữ lại lý do trong tài liệu

### Requirement: Sơ đồ là phép chiếu ra text từ mô hình flow

Hệ thống SHALL sinh sơ đồ dưới dạng mã Mermaid từ `flow_step` và liên kết giữa chúng, SHALL cho
phép sao chép mã đó, và SHALL NOT thêm trình vẽ hay dependency UI mới trong change này.

#### Scenario: Sửa một bước trong flow
- **WHEN** người dùng đổi thứ tự hai bước trong flow
- **THEN** mã Mermaid sinh lại phản ánh thứ tự mới mà không cần thao tác vẽ

### Requirement: Ma trận truy vết nối bước flow với use case

Hệ thống SHALL sinh ma trận hai chiều giữa `flow_step` và `use_case` từ liên kết đã lưu, và SHALL
chỉ ra ô trống ở cả hai chiều.

#### Scenario: Một bước flow chưa có use case nào phủ
- **WHEN** một `flow_step` không có liên kết `covers` tới use case nào
- **THEN** ma trận đánh dấu bước đó là chưa được phủ

### Requirement: Agent không tự ghi tài liệu mà không qua xác nhận

Hệ thống SHALL đưa mọi tool BA có rủi ro ghi qua preview và approval của Confirmation Guard, và
SHALL NOT cung cấp tool xoá tri thức hay tài liệu cho agent.

#### Scenario: Agent gọi tool sinh tài liệu theo mẫu
- **WHEN** agent gọi `nexa_ba_soan_theo_mau`
- **THEN** hệ thống dựng preview nêu rõ tài liệu đích và chỉ ghi sau khi người dùng duyệt
