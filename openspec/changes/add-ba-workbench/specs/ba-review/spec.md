## ADDED Requirements

### Requirement: Phán quyết review do luật xác định trả, không do model

Hệ thống SHALL sinh mọi finding bằng hàm luật thuần chạy trên mô hình tài liệu và tri thức đã xác
nhận, và SHALL NOT để model thêm, xoá hay hạ mức một finding.

#### Scenario: Chạy review hai lần trên cùng dữ liệu
- **WHEN** cùng một tài liệu và cùng một phiên bản rule pack được review lần thứ hai
- **THEN** tập finding trả về giống hệt lần đầu

#### Scenario: Model đề xuất bỏ qua một finding
- **WHEN** bước gợi ý cách sửa trả về nội dung đề nghị bỏ finding
- **THEN** hệ thống giữ nguyên finding và chỉ dùng phần gợi ý câu chữ

### Requirement: Mỗi finding có rule id, vị trí và cách sửa

Hệ thống SHALL gắn cho mỗi finding một `rule_id`, mức độ `blocker | warning | info`, tham chiếu tới
item liên quan và một gợi ý sửa; và SHALL NOT hiển thị nhận xét không có `rule_id`.

#### Scenario: Use case thiếu luồng ngoại lệ
- **WHEN** luật `R-UC-03` không đạt trên một use case
- **THEN** finding ghi `R-UC-03`, trỏ tới use case đó và nêu cần bổ sung luồng ngoại lệ nào

### Requirement: Báo cáo nêu rõ phạm vi đã kiểm

Hệ thống SHALL hiển thị id và phiên bản rule pack, tổng số luật đã chạy, số luật đạt và số finding
theo mức; và SHALL NOT kết luận rằng tài liệu đã đầy đủ.

#### Scenario: Tất cả luật đều đạt
- **WHEN** không có finding nào
- **THEN** báo cáo ghi rõ đã kiểm bao nhiêu luật và luật nào, chứ không tuyên bố tài liệu đầy đủ

### Requirement: Rule pack có phiên bản và được lưu cùng báo cáo

Hệ thống SHALL lưu id và phiên bản rule pack trong mỗi bản ghi review, và SHALL cho phép so sánh
hai báo cáo cùng phiên bản.

#### Scenario: Rule pack được nâng phiên bản
- **WHEN** một tài liệu được review lại sau khi rule pack đổi phiên bản
- **THEN** báo cáo mới ghi phiên bản mới và giao diện nêu rõ hai báo cáo khác phiên bản

### Requirement: Luật được đăng ký như dữ liệu, thêm luật không phải sửa pipeline

Hệ thống SHALL nạp luật từ một registry, mỗi luật là một đơn vị độc lập có id, mô tả và mức mặc
định; và SHALL cho phép thêm luật mới bằng cách đăng ký thêm mà không đổi bộ chạy review.

#### Scenario: Thêm một luật cho domain mới
- **WHEN** một luật mới được đăng ký vào rule pack
- **THEN** bộ chạy review áp dụng luật đó mà không cần thay đổi mã điều phối

### Requirement: Review đối chiếu tài liệu với tri thức đã xác nhận

Hệ thống SHALL chạy luật `R-KB-01` so sánh khẳng định nghiệp vụ trong tài liệu với toàn bộ item tri
thức `confirmed` của profile hiện tại, SHALL chỉ dùng item `confirmed` làm căn cứ, và SHALL trỏ tới
item tri thức cụ thể trong finding.

#### Scenario: Tài liệu nói ngược một quy tắc đã chốt
- **WHEN** một rule trong tài liệu mâu thuẫn với một item tri thức `confirmed`
- **THEN** finding `R-KB-01` nêu cả hai nội dung và trỏ tới item tri thức làm căn cứ

#### Scenario: Chỉ có tri thức draft liên quan
- **WHEN** item tri thức liên quan đang ở trạng thái `draft`
- **THEN** `R-KB-01` không sinh finding và item draft không được dùng làm căn cứ

### Requirement: Item chưa được soát không làm căn cứ kết luận

Hệ thống SHALL loại item `needs_review` khỏi căn cứ của luật và SHALL báo riêng số item bị loại.

#### Scenario: Tài liệu còn item cần soát
- **WHEN** review chạy trên tài liệu còn item `needs_review`
- **THEN** báo cáo ghi rõ số item bị loại khỏi phạm vi kiểm

### Requirement: Review không tự sửa tài liệu

Hệ thống SHALL chỉ sinh finding và gợi ý, và SHALL yêu cầu một thao tác áp dụng riêng của người
dùng cho từng thay đổi.

#### Scenario: Người dùng áp dụng một gợi ý
- **WHEN** người dùng chọn áp dụng gợi ý của một finding
- **THEN** hệ thống sửa đúng item đó và ghi một dòng activity, không đụng item khác

### Requirement: Log review không chứa nội dung nghiệp vụ

Hệ thống SHALL chỉ ghi id tài liệu, id rule pack, số luật và số finding theo mức vào log và activity
timeline; và SHALL NOT ghi nội dung finding, tên use case hay nội dung rule.

#### Scenario: Xuất gói chẩn đoán sau một lần review
- **WHEN** người dùng xuất gói chẩn đoán
- **THEN** gói chứa số đếm và id, không chứa nội dung tài liệu hay finding
