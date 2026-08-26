## ADDED Requirements

### Requirement: Tập tool gửi cho model được xác định bởi một preset
Hệ thống SHALL chọn một preset tool cho mỗi lượt hội thoại và SHALL chỉ gửi các tool thuộc preset đó trong khối `tools` của request tới model. Hệ thống SHALL NOT gửi toàn bộ danh mục tool khi preset đã chọn hẹp hơn toàn bộ.

#### Scenario: Câu hỏi chỉ về Jira, chỉ tra cứu
- **WHEN** người dùng hỏi một câu chỉ chứa dấu hiệu Jira và không chứa dấu hiệu ý định write
- **THEN** khối `tools` của request chỉ chứa các tool thuộc `jiraRead` và `jiraSearch`, và không chứa tool nào thuộc nhóm Confluence hay nhóm write Jira

#### Scenario: Câu hỏi chỉ về Confluence, có ý định write
- **WHEN** người dùng hỏi một câu chỉ chứa dấu hiệu Confluence và có chứa dấu hiệu ý định write
- **THEN** khối `tools` chỉ chứa các tool thuộc `confluenceRead`, `confluenceSearch`, `confluenceWrite`, `confluenceWriteHigh`, và không chứa tool nào thuộc nhóm Jira

#### Scenario: Câu hỏi không có dấu hiệu hệ đích nào
- **WHEN** người dùng hỏi một câu không chứa dấu hiệu Jira lẫn Confluence
- **THEN** khối `tools` chứa các tool read của cả hai hệ (`jiraRead`, `jiraSearch`, `confluenceRead`, `confluenceSearch`) và không chứa tool write nào

#### Scenario: Câu hỏi nhắc cả hai hệ và có ý định write
- **WHEN** câu hỏi chứa dấu hiệu của cả Jira và Confluence, kèm dấu hiệu ý định write
- **THEN** khối `tools` chứa toàn bộ tool đang khả dụng

### Requirement: Số preset khả dĩ là hữu hạn và cố định
Hệ thống SHALL định nghĩa tập preset như một danh sách đóng, mỗi preset là hợp của một hoặc nhiều feature flag. Hệ thống SHALL NOT sinh tập tool tuỳ theo nội dung từng câu hỏi ngoài việc chọn một trong các preset đã định nghĩa.

#### Scenario: Hai câu hỏi khác nhau cùng preset sinh khối tool giống nhau từng byte
- **WHEN** hai câu hỏi có nội dung khác nhau nhưng được bộ chọn xếp vào cùng một preset, với cùng tập feature flag đang bật
- **THEN** khối `tools` của hai request giống nhau hoàn toàn: cùng số lượng tool, cùng thứ tự, cùng nội dung

#### Scenario: Tập tool của một preset không phụ thuộc câu hỏi
- **WHEN** cho cùng một preset và cùng tập feature flag đang bật
- **THEN** tập tool sinh ra là như nhau bất kể câu hỏi nào dẫn tới preset đó

### Requirement: Thứ tự tool trong khối `tools` ổn định
Hệ thống SHALL sắp xếp tool theo tên trước khi đưa vào khối `tools`, kể cả khi cơ chế lọc bị tắt.

#### Scenario: Thứ tự không đổi khi thứ tự registry đổi
- **WHEN** thứ tự các tool trả về từ danh mục thay đổi nhưng tập tool không đổi
- **THEN** khối `tools` gửi tới model vẫn có thứ tự như trước

### Requirement: Bộ chọn preset là xác định và không gọi model
Hệ thống SHALL quyết định preset chỉ từ nội dung message `user` cuối cùng trong history của lượt hiện tại, bằng quy tắc xác định. Hệ thống SHALL NOT gọi model, SHALL NOT gọi mạng, và SHALL NOT dùng nguồn ngẫu nhiên nào để quyết định preset.

#### Scenario: Cùng câu hỏi luôn cho cùng preset
- **WHEN** bộ chọn được gọi nhiều lần với cùng một câu hỏi
- **THEN** kết quả preset là như nhau mọi lần

#### Scenario: Chọn preset không phát sinh lời gọi model
- **WHEN** một lượt hội thoại chạy với cơ chế lọc đang bật
- **THEN** số lời gọi tới client model của lượt đó không tăng thêm so với khi cơ chế lọc bị tắt

#### Scenario: Câu hỏi viết không dấu vẫn nhận đúng dấu hiệu
- **WHEN** người dùng gõ câu hỏi không dấu chứa dấu hiệu ý định write (ví dụ "tao issue moi")
- **THEN** bộ chọn nhận ra ý định write như với câu hỏi có dấu

#### Scenario: Mẫu issue key được nhận trên chuỗi gốc
- **WHEN** câu hỏi chứa một chuỗi khớp mẫu issue key chữ hoa kèm số (ví dụ `PROJ-1234`) mà không chứa từ khoá Jira nào khác
- **THEN** bộ chọn xếp câu hỏi vào nhánh Jira

### Requirement: Preset không bao giờ mở rộng quyền
Hệ thống SHALL lọc theo preset **sau** khi đã áp dụng feature flag. Một tool bị tắt bởi feature flag SHALL NOT xuất hiện trong khối `tools` dù preset của nó có chứa nhóm tương ứng.

#### Scenario: Tool thuộc preset nhưng feature flag đã tắt
- **WHEN** preset đã chọn bao gồm nhóm của một tool, nhưng feature flag của tool đó đang tắt
- **THEN** tool đó không xuất hiện trong khối `tools`

#### Scenario: Tool thuộc preset nhưng server không công bố
- **WHEN** preset đã chọn bao gồm nhóm của một tool, nhưng MCP server không công bố tool đó
- **THEN** tool đó không xuất hiện trong khối `tools`

#### Scenario: Cơ chế lọc không thay đổi kết quả kiểm tra quyền thực thi
- **WHEN** model đề xuất gọi một tool
- **THEN** việc tool đó có được thực thi hay không được quyết định đúng như trước change này, không phụ thuộc preset đã chọn

### Requirement: Người dùng và tổ chức tắt được cơ chế lọc
Hệ thống SHALL cung cấp một feature flag điều khiển cơ chế lọc, mặc định bật. Khi cờ tắt, hệ thống SHALL gửi toàn bộ tool đang khả dụng như hành vi trước change này.

#### Scenario: Tắt cờ trả về hành vi cũ
- **WHEN** feature flag của cơ chế lọc bị tắt và người dùng gửi một câu hỏi chỉ chứa dấu hiệu Jira
- **THEN** khối `tools` chứa toàn bộ tool đang khả dụng, gồm cả tool Confluence

#### Scenario: Cờ bị khoá ở mức tổ chức
- **WHEN** chính sách tổ chức khoá feature flag này ở trạng thái tắt
- **THEN** người dùng không thể bật lại, và mọi lượt đều gửi toàn bộ tool

### Requirement: Ghi số liệu về preset mà không ghi nội dung câu hỏi
Hệ thống SHALL ghi log cho mỗi lượt: tên preset đã chọn và số tool đã gửi. Hệ thống SHALL NOT ghi nội dung câu hỏi của người dùng, và SHALL NOT ghi từ khoá đã khớp, vào log.

#### Scenario: Log chứa preset và số tool
- **WHEN** một lượt hội thoại chạy với cơ chế lọc đang bật
- **THEN** log của lượt đó chứa tên preset và số tool đã gửi

#### Scenario: Log không chứa câu hỏi
- **WHEN** người dùng hỏi một câu chứa nội dung nghiệp vụ
- **THEN** không dòng log nào của cơ chế lọc chứa nội dung đó hay bất kỳ đoạn nào của nó
