## ADDED Requirements

### Requirement: Tri thức nghiệp vụ chỉ vào kho qua xác nhận của người dùng

Hệ thống SHALL chỉ tạo item tri thức ở trạng thái `draft` khi agent đề xuất, và SHALL NOT tự
chuyển hội thoại, tài liệu hay memory thành tri thức `confirmed`. Chỉ người dùng mới đặt được
trạng thái `confirmed`.

#### Scenario: Agent đề xuất tri thức từ hội thoại
- **WHEN** agent gọi `nexa_ba_de_xuat_tri_thuc` và người dùng duyệt preview
- **THEN** hệ thống ghi item với `status = 'draft'`, `created_by = 'agent'` và nguồn là hội thoại hiện tại

#### Scenario: Agent cố đặt trạng thái confirmed
- **WHEN** lời gọi tool chứa `status = 'confirmed'`
- **THEN** hệ thống từ chối input trước khi dựng preview

### Requirement: Mỗi item tri thức có nguồn gốc truy được

Hệ thống SHALL lưu `source_kind` ∈ `conversation | document | url | manual` cùng tham chiếu nguồn
cho mọi item, và SHALL NOT lưu item không có nguồn.

#### Scenario: Nhập tay trong màn hình Nghiệp vụ
- **WHEN** người dùng tự nhập một item và lưu
- **THEN** hệ thống ghi `source_kind = 'manual'` và đóng dấu thời điểm xác nhận

### Requirement: Tri thức được thay thế chứ không bị ghi đè im lặng

Hệ thống SHALL hỗ trợ chuyển item sang `outdated` kèm `superseded_by` trỏ tới item thay thế, và
SHALL giữ item cũ để tra lại.

#### Scenario: Quy tắc nghiệp vụ thay đổi
- **WHEN** người dùng xác nhận một item mới thay cho item cũ
- **THEN** item cũ chuyển `outdated`, trỏ `superseded_by` tới item mới, và không còn được đưa vào context

### Requirement: Mâu thuẫn giữa hai tri thức đã xác nhận được lưu và hiển thị

Hệ thống SHALL cho phép ghi quan hệ `conflicts` giữa hai item trong `ba_knowledge_links` và SHALL
hiển thị các cặp mâu thuẫn trong tổng quan kho tri thức.

#### Scenario: Hai item confirmed nói ngược nhau
- **WHEN** người dùng đánh dấu hai item là mâu thuẫn
- **THEN** cả hai item hiển thị cảnh báo mâu thuẫn và cặp đó xuất hiện trong tổng quan

### Requirement: Kho tri thức có thống kê sử dụng

Hệ thống SHALL đếm `use_count` và ghi `last_used_at` mỗi khi item được đưa vào context hoặc được
luật review dùng, và SHALL hiển thị tổng quan gồm số item theo trạng thái, số cặp mâu thuẫn, item
chưa từng được dùng và item được dùng nhiều nhất.

#### Scenario: Tri thức chưa từng được dùng
- **WHEN** một item `confirmed` có `use_count = 0` sau khi được tạo
- **THEN** tổng quan liệt kê item đó trong nhóm chưa được dùng

### Requirement: Tri thức nghiệp vụ không rời khỏi tổ chức

Hệ thống SHALL coi mọi item tri thức là `internal_only`, SHALL NOT cung cấp tuỳ chọn chia sẻ ra
provider ngoài tổ chức cho từng item, và SHALL loại toàn bộ khối tri thức khỏi context khi provider
của lượt chat là provider ngoài tổ chức.

#### Scenario: Lượt chat dùng provider ngoài tổ chức
- **WHEN** người dùng gửi một lượt chat tới provider ngoài tổ chức
- **THEN** context không chứa item tri thức nào và log chỉ ghi provider cùng số lượng bị loại

### Requirement: Tri thức được đưa vào context như dữ liệu tham chiếu có giới hạn

Hệ thống SHALL chèn tối đa 30 item `confirmed` của profile hiện tại, sắp theo thời điểm cập nhật
giảm dần, thành một khối riêng tách khỏi memory và commitment, dùng tối đa 10% token budget khả
dụng, đóng khung là dữ liệu tham chiếu chứ không phải chỉ thị, và SHALL bỏ khối này trước lượt hiện
tại khi hết budget.

#### Scenario: Budget không đủ cho khối tri thức
- **WHEN** context đã dùng hết budget trước khi tới khối tri thức
- **THEN** hệ thống bỏ khối tri thức và vẫn gửi được lượt chat

#### Scenario: Kho có nhiều hơn 30 item confirmed
- **WHEN** profile có 40 item `confirmed`
- **THEN** khối context chứa 30 item được cập nhật gần nhất, và các item còn lại vẫn tra cứu được bằng tool tra cứu tri thức

### Requirement: Tri thức được nhóm theo category, không theo project

Hệ thống SHALL gắn mỗi item một `category` ∈ `domain | rule | term | constraint | decision` làm trục
nhóm duy nhất, và SHALL NOT dùng tiêu đề item, profile hay category để thay thế cho một trục phạm
vi dự án.

#### Scenario: Xem tổng quan theo nhóm
- **WHEN** người dùng mở tổng quan kho tri thức
- **THEN** hệ thống hiển thị số item theo trạng thái trong từng `category`

### Requirement: Tri thức nghiệp vụ được mã hoá và phân tách theo profile

Hệ thống SHALL mã hoá tiêu đề, nội dung và tham chiếu nguồn trước khi lưu, SHALL bind mọi IPC vào
profile hiện tại và SHALL xoá toàn bộ tri thức khi purge profile.

#### Scenario: Renderer yêu cầu item của profile khác
- **WHEN** renderer gửi id không thuộc profile hiện tại
- **THEN** main process từ chối trước khi đọc hoặc mutation
