## ADDED Requirements

### Requirement: Context của một hội thoại giữ N message gần nhất theo token budget
Hệ thống SHALL xây dựng context gửi tới model bằng cách giữ các message gần nhất của hội thoại hiện tại (thứ tự từ mới đến cũ), miễn là tổng token của chúng còn nằm trong ngân sách token khả dụng của model; hệ thống SHALL NOT tóm tắt các message bị loại bỏ.

#### Scenario: Hội thoại ngắn, nằm trong budget
- **WHEN** tổng token của toàn bộ history một hội thoại nhỏ hơn ngân sách khả dụng
- **THEN** toàn bộ history được đưa vào context, không có message nào bị loại bỏ

#### Scenario: Hội thoại dài, vượt budget
- **WHEN** tổng token của toàn bộ history vượt ngân sách khả dụng của model hiện tại
- **THEN** hệ thống giữ các message gần nhất vừa đủ ngân sách và loại bỏ các message cũ hơn khỏi context được gửi tới model, không tạo bản tóm tắt nào để thay thế các message bị loại bỏ

### Requirement: Số message bị loại bỏ được ghi lại và hiển thị cho người dùng
Khi có message bị loại bỏ khỏi context do vượt ngân sách token, hệ thống SHALL ghi lại số lượng message đã bị loại bỏ gắn với message tương ứng, để người dùng có thể biết hội thoại đã vượt cửa sổ ngữ cảnh.

#### Scenario: Message bị lược bỏ khi gửi lượt hội thoại
- **WHEN** một lượt hội thoại được gửi và có N message cũ bị loại khỏi context
- **THEN** hệ thống lưu lại giá trị N gắn với message của lượt đó để hiển thị cho người dùng

### Requirement: Ngân sách token được tính từ cửa sổ ngữ cảnh của model đang dùng
Hệ thống SHALL tính ngân sách token khả dụng cho history dựa trên `contextWindowTokens` của model đang được chọn, trừ đi phần dự trữ và áp hệ số an toàn, sử dụng cơ chế ước lượng token hiện có của hệ thống (không dùng tokenizer thật).

#### Scenario: Đổi sang model có cửa sổ ngữ cảnh lớn hơn
- **WHEN** người dùng đổi sang một model có `contextWindowTokens` lớn hơn
- **THEN** ngân sách khả dụng cho history tăng theo, cho phép giữ lại nhiều message hơn trong context của các lượt tiếp theo

### Requirement: Tài liệu đính kèm của lượt hiện tại được ưu tiên trước history cũ
Khi xây context cho một lượt hội thoại, hệ thống SHALL dành một phần ngân sách cho nội dung tài liệu đính kèm của lượt hiện tại trước khi phân bổ phần còn lại cho history cũ.

#### Scenario: Lượt hội thoại có tài liệu đính kèm
- **WHEN** người dùng gửi một lượt hội thoại kèm tài liệu đính kèm
- **THEN** hệ thống ưu tiên đưa nội dung tài liệu đính kèm vào context trong phần ngân sách dành riêng cho nó, trước khi lấp phần ngân sách còn lại bằng history cũ

### Requirement: Long-term memory fact được ưu tiên giữ trước history khi tính ngân sách
Khi hệ thống có memory fact active (xem capability long-term-memory) cần đưa vào context, hệ thống SHALL phân bổ ngân sách cho các fact đó trước khi phân bổ phần còn lại cho history của hội thoại; nếu ngân sách không đủ cho cả hai, hệ thống SHALL cắt bớt history trước khi cắt bớt memory fact.

#### Scenario: Ngân sách hạn chế với cả fact và history dài
- **WHEN** một hội thoại có memory fact active và history dài đến mức tổng ngân sách không đủ cho cả hai
- **THEN** hệ thống giữ toàn bộ memory fact (trong giới hạn trần của nó) và loại bỏ thêm message cũ trong history để bù lại phần ngân sách đã dùng cho fact
