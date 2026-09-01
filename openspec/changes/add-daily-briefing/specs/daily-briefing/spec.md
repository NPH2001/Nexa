## ADDED Requirements

### Requirement: Bản tin được dựng bằng code, không do model quyết định

Hệ thống SHALL dựng danh sách mục của bản tin bằng hàm thuần trên dữ liệu commitment và issue đã
lấy về. Model SHALL NOT quyết định mục nào xuất hiện, thuộc nhóm nào, hay đứng thứ mấy. Với cùng
một tập dữ liệu vào và cùng một mốc thời gian, hệ thống SHALL trả về cùng một danh sách theo cùng
thứ tự.

#### Scenario: Cùng dữ liệu cho cùng kết quả
- **WHEN** bản tin được dựng hai lần trên cùng tập commitment/issue và cùng thời điểm tham chiếu
- **THEN** hai kết quả có cùng số mục, cùng nhóm và cùng thứ tự

#### Scenario: Không có model vẫn có bản tin
- **WHEN** không có model nào được cấu hình
- **THEN** hệ thống vẫn trả về bản tin đầy đủ và chỉ thiếu đoạn tóm tắt

### Requirement: Bản tin nhóm mục theo mức khẩn có tên cố định

Hệ thống SHALL xếp mỗi mục vào đúng một nhóm trong tập cố định: `overdue`, `due_today`,
`due_this_week`, `in_progress`. Hệ thống SHALL tính nhóm từ mốc thời gian của mục so với ngày địa
phương của máy, và SHALL hiển thị lý do bằng ngày hoặc trạng thái thay vì điểm ưu tiên.

#### Scenario: Cam kết quá hạn từ hôm qua
- **WHEN** một commitment `active` có `dueAt` trước đầu ngày hôm nay
- **THEN** mục đó nằm nhóm `overdue` và nêu số ngày đã quá hạn

#### Scenario: Cam kết không có mốc thời gian
- **WHEN** một commitment `active` không có `dueAt` lẫn `checkInAt`
- **THEN** mục đó nằm nhóm `in_progress` và không được gán hạn giả

#### Scenario: Ranh giới ngày theo giờ máy
- **WHEN** một issue có `duedate` đúng ngày hôm nay theo múi giờ địa phương
- **THEN** mục đó nằm nhóm `due_today`, kể cả khi mốc UTC rơi sang ngày khác

### Requirement: Khối Jira là read-only và có trần rõ ràng

Hệ thống SHALL lấy issue bằng tool Jira READ đã có trong registry, với JQL do code dựng từ danh
tính người dùng hiện tại. Hệ thống SHALL NOT nhận JQL từ model hay từ renderer, SHALL giới hạn số
issue trả về, và SHALL NOT gọi bất kỳ tool ghi nào trong luồng bản tin.

#### Scenario: Renderer gửi JQL tuỳ ý
- **WHEN** renderer gọi IPC bản tin kèm một chuỗi JQL
- **THEN** main process bỏ qua chuỗi đó và dùng truy vấn đã dựng sẵn

#### Scenario: Vượt trần số issue
- **WHEN** truy vấn Jira trả về nhiều issue hơn trần đã cấu hình
- **THEN** hệ thống chỉ giữ số mục trong trần và nêu rõ còn issue chưa hiển thị

### Requirement: Thiếu một nguồn không làm hỏng bản tin

Hệ thống SHALL dựng bản tin từng nguồn độc lập. Khi Jira chưa kết nối, cờ `jiraSearch` đang tắt,
người dùng chưa có danh tính Jira, hoặc lời gọi tool lỗi/timeout, hệ thống SHALL vẫn trả về phần
commitment và SHALL đánh dấu nguồn Jira là không lấy được kèm lý do và một hành động khôi phục.
Hệ thống SHALL NOT trình bày một nguồn lỗi như là "không có việc nào".

#### Scenario: MCP chưa kết nối
- **WHEN** người dùng mở Today mà MCP Atlassian chưa cấu hình
- **THEN** bản tin hiện phần commitment bình thường và nói rõ chưa kết nối Jira nên chưa có việc từ Jira

#### Scenario: Lời gọi Jira timeout
- **WHEN** tool Jira vượt `toolTimeoutMs`
- **THEN** khối Jira ở trạng thái lỗi có nút thử lại, và phần commitment không bị ảnh hưởng

### Requirement: Tóm tắt LLM không được đổi nội dung bản tin

Tóm tắt SHALL là tuỳ chọn và mặc định tắt. Khi bật, hệ thống SHALL gửi cho model danh sách mục đã
chốt và SHALL chỉ đọc lại một chuỗi văn bản duy nhất. Hệ thống SHALL NOT để kết quả của model thêm,
bớt, gộp, đổi thứ tự hay đổi mốc thời gian của mục nào. Khi model lỗi, quá hạn thời gian, hoặc trả
về nội dung không hợp lệ, hệ thống SHALL hiển thị bản tin không kèm tóm tắt thay vì báo lỗi cả
bản tin.

#### Scenario: Model trả về thêm việc không có thật
- **WHEN** model trả về đoạn văn nhắc tới một việc không nằm trong danh sách đã chốt
- **THEN** danh sách mục hiển thị không đổi, vì chỉ đoạn văn được đọc lại và nó không phải nguồn dữ liệu

#### Scenario: Model lỗi
- **WHEN** lời gọi model thất bại
- **THEN** bản tin vẫn hiển thị đủ mọi nhóm và mục, kèm dấu hiệu tóm tắt không dựng được

#### Scenario: Tóm tắt tắt mặc định
- **WHEN** người dùng chưa bật tóm tắt
- **THEN** dựng bản tin không tạo bất kỳ lời gọi model nào

### Requirement: Bản tin nói rõ nó không biết lịch họp

Hệ thống SHALL nêu rõ phạm vi nguồn dữ liệu của bản tin. Vì chưa có calendar connector nào được
duyệt, bản tin SHALL NOT ngụ ý rằng nó đã bao gồm lịch họp trong ngày.

#### Scenario: Người dùng đọc bản tin buổi sáng
- **WHEN** bản tin hiển thị
- **THEN** nó nêu rõ phạm vi gồm cam kết và Jira, và chưa gồm lịch họp

### Requirement: Bản tin chỉ đọc và bám theo profile hiện tại

Hệ thống SHALL bind mọi truy vấn bản tin vào profile hiện tại trong main process. Bản tin SHALL
NOT tạo, sửa, hoàn thành hay xoá commitment, SHALL NOT sinh check-in suggestion, và SHALL NOT ghi
nội dung Jira hay nội dung commitment vào log, audit hay activity row.

#### Scenario: Mở bản tin nhiều lần
- **WHEN** người dùng mở và làm mới bản tin nhiều lần trong ngày
- **THEN** không có commitment nào bị thay đổi và không có check-in nào được sinh ra

#### Scenario: Ghi nhật ký
- **WHEN** hệ thống ghi log cho một lần dựng bản tin
- **THEN** dòng log chỉ chứa id, enum, số đếm và thời lượng, không chứa tiêu đề issue hay nội dung cam kết

### Requirement: Bản tin được cache theo ngày và làm mới tường minh

Hệ thống SHALL cache bản tin đã dựng theo profile và theo ngày địa phương trong bộ nhớ tiến trình,
để mở lại Today trong cùng ngày không gọi lại Jira. Hệ thống SHALL cung cấp một hành động làm mới
tường minh, và SHALL hiển thị thời điểm dữ liệu được lấy. Cache SHALL NOT tồn tại sau khi tiến
trình kết thúc.

#### Scenario: Mở lại Today trong cùng buổi sáng
- **WHEN** người dùng rời Today rồi quay lại trong cùng ngày
- **THEN** bản tin hiện ngay từ cache và không có lời gọi Jira mới

#### Scenario: Sang ngày mới
- **WHEN** người dùng mở Today sau khi ngày địa phương đã đổi
- **THEN** hệ thống dựng lại bản tin cho ngày mới thay vì dùng cache hôm trước
