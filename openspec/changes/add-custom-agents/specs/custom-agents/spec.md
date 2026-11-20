## ADDED Requirements

### Requirement: Người dùng tạo và quản lý agent của riêng mình
Hệ thống SHALL cho phép người dùng tạo, sửa, archive, khôi phục và xoá agent. Mỗi agent gồm tên (1–60 ký tự), biểu tượng chọn từ danh sách có sẵn, hướng dẫn (0–4000 ký tự), trần tool, hai công tắc nhóm tool cục bộ và model tuỳ chọn. Agent SHALL gắn với `profile_id` hiện tại, và renderer SHALL NOT được chọn profile.

#### Scenario: Tạo agent mới
- **WHEN** người dùng nhập tên, hướng dẫn và bấm lưu trên màn hình Agent
- **THEN** hệ thống tạo agent `active` thuộc profile hiện tại và hiển thị ngay trong danh sách

#### Scenario: Dữ liệu không hợp lệ bị từ chối
- **WHEN** tên rỗng, hướng dẫn quá 4000 ký tự, hoặc biểu tượng ngoài danh sách
- **THEN** hệ thống từ chối bằng lỗi validation và không lưu gì

#### Scenario: Không truy cập agent của profile khác
- **WHEN** một yêu cầu sửa/xoá trỏ tới agent không thuộc profile hiện tại
- **THEN** hệ thống từ chối như thể agent không tồn tại

#### Scenario: Tên và hướng dẫn được mã hoá khi lưu
- **WHEN** một agent được lưu vào SQLite
- **THEN** tên và hướng dẫn không xuất hiện ở dạng plaintext trong file DB hay log

### Requirement: Hướng dẫn agent bổ sung vào prompt gốc, không thay thế
Hệ thống SHALL đặt hướng dẫn của agent SAU `DEFAULT_SYSTEM_PROMPT`, trong một khối nêu rõ đó là cấu hình do người dùng đặt và không thay thế các quy tắc an toàn. Hệ thống SHALL NOT cung cấp đường nào để agent loại bỏ hoặc ghi đè prompt gốc.

#### Scenario: Hội thoại có agent
- **WHEN** một lượt chat chạy trong hội thoại gắn agent có hướng dẫn
- **THEN** system message chứa `DEFAULT_SYSTEM_PROMPT` trước, rồi khối hướng dẫn của agent

#### Scenario: Hội thoại không có agent
- **WHEN** hội thoại không gắn agent
- **THEN** system message giống hệt hành vi trước change này

#### Scenario: Hướng dẫn tính vào ngân sách context
- **WHEN** hướng dẫn agent dài
- **THEN** token của nó được trừ khỏi ngân sách trước khi phân bổ cho lịch sử

### Requirement: Trần tool của agent chỉ thu hẹp quyền
Hệ thống SHALL áp trần tool của agent lên preset do bộ chọn theo ngữ cảnh chọn: nếu preset được chọn nằm trong trần thì giữ nguyên, ngược lại dùng trần. Preset hiệu lực SHALL luôn là một trong các `ToolPreset` có sẵn. Agent SHALL NOT làm model thấy tool mà preset `all` không cho phép, SHALL NOT thay đổi Confirmation Guard, và mọi tool ghi SHALL vẫn qua preview và xác nhận.

#### Scenario: Agent chỉ đọc không thấy tool ghi
- **WHEN** agent có trần `redmine-read` và người dùng yêu cầu tạo issue Redmine
- **THEN** khối `tools` gửi model không chứa tool ghi Redmine

#### Scenario: Preset được chọn nằm trong trần
- **WHEN** trần là `all-read` và bộ chọn chọn `jira-read`
- **THEN** preset hiệu lực là `jira-read`

#### Scenario: Preset được chọn vượt trần
- **WHEN** trần là `jira-read` và bộ chọn chọn `redmine-full`
- **THEN** preset hiệu lực là `jira-read`

#### Scenario: Mở rộng tool không vượt trần
- **WHEN** model gọi `nexa_mo_rong_tool` trong hội thoại của agent có trần `jira-read`
- **THEN** preset chuyển sang `jira-read` chứ không phải `all`, và tool meta không được đưa vào khi preset đã bằng trần

#### Scenario: Agent không bật được quyền mà setting đã tắt
- **WHEN** agent bật nhóm BA nhưng `features.baWorkbench` toàn cục đang tắt
- **THEN** tool BA không có trong khối `tools`

### Requirement: Công tắc nhóm tool cục bộ chỉ thu hẹp
Hệ thống SHALL chỉ ghép registry tool cam kết hoặc BA khi cả setting toàn cục và công tắc tương ứng của agent đều bật.

#### Scenario: Agent tắt nhóm cam kết
- **WHEN** `agentCommitmentToolsEnabled` bật nhưng agent tắt nhóm cam kết
- **THEN** tool cam kết không có trong khối `tools` của hội thoại đó

### Requirement: Gắn agent vào hội thoại
Hệ thống SHALL cho phép gắn, đổi hoặc bỏ agent của một hội thoại. Cả hội thoại và agent SHALL thuộc profile hiện tại. Agent đã archive SHALL NOT được chọn cho hội thoại, nhưng hội thoại đã gắn trước đó SHALL vẫn dùng agent đó. Xoá agent SHALL đặt `agent_id` của các hội thoại liên quan về rỗng mà không xoá hội thoại.

#### Scenario: Chọn agent trong chat
- **WHEN** người dùng chọn một agent `active` ở bộ chọn của hội thoại
- **THEN** các lượt sau của hội thoại đó chạy với agent này và UI hiển thị tên cùng trần tool đang áp

#### Scenario: Bỏ agent
- **WHEN** người dùng chọn "Mặc định"
- **THEN** `agent_id` về rỗng và hội thoại chạy như thường

#### Scenario: Xoá agent đang được dùng
- **WHEN** người dùng xoá cứng agent đang gắn vào một số hội thoại
- **THEN** các hội thoại vẫn còn, chạy với persona mặc định

### Requirement: Model mặc định của agent
Khi gắn một agent có model vào hội thoại, hệ thống SHALL đặt model của hội thoại theo agent nếu model đó còn khả dụng; nếu không khả dụng, hệ thống SHALL giữ model hiện tại mà không báo lỗi. Người dùng SHALL vẫn đổi model bằng dropdown sau đó. Bộ lọc dữ liệu theo provider ngoài tổ chức SHALL chạy trên model cuối cùng của lượt như hiện nay.

#### Scenario: Agent có model nội bộ
- **WHEN** gắn agent có model còn khả dụng vào hội thoại
- **THEN** model của hội thoại đổi theo agent

#### Scenario: Model của agent đã bị xoá
- **WHEN** gắn agent có model không còn trong danh sách
- **THEN** hội thoại giữ model hiện tại và việc gắn vẫn thành công

#### Scenario: Agent dùng model ngoài tổ chức
- **WHEN** model của agent là provider ngoài tổ chức
- **THEN** memory `internal_only`, tri thức BA và tài liệu bị lọc như mọi hội thoại dùng provider đó
