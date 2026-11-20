## ADDED Requirements

### Requirement: Khối nội dung file được đánh dấu bằng code fence có tên file

Hệ thống SHALL nhận diện một khối nội dung file trong câu trả lời của model bằng code fence có
định dạng ở info string và tên file dạng `filename=<tên>`. Hệ thống SHALL coi một fence `xml` mà
nội dung mở đầu bằng `<mxfile` là định dạng `drawio`. Hệ thống SHALL NOT nhận diện khối file bằng
cách suy đoán từ nội dung khi không có fence.

Khi không nhận diện được khối nào, hệ thống SHALL hiển thị toàn bộ `message.content` như văn bản
thuần đúng như hành vi hiện tại — thiếu quy ước SHALL NOT làm mất hay cắt bớt nội dung.

#### Scenario: Fence có định dạng và tên file
- **WHEN** câu trả lời chứa một fence với info string `drawio filename=luong-thanh-toan.drawio`
- **THEN** hệ thống tách phần bên trong fence thành một khối file tên `luong-thanh-toan.drawio`,
  định dạng `drawio`, và phần văn xuôi trước/sau fence vẫn là văn bản thuần

#### Scenario: Model dùng fence `xml` cho sơ đồ
- **WHEN** một fence có info string `xml` và nội dung bắt đầu bằng `<mxfile`
- **THEN** hệ thống coi đó là khối file định dạng `drawio`

#### Scenario: Fence không có tên file
- **WHEN** một fence có định dạng nằm trong allowlist nhưng không có `filename=`
- **THEN** hệ thống vẫn tạo khối file và đặt tên mặc định theo định dạng đó

#### Scenario: Không có fence nào
- **WHEN** câu trả lời chỉ là văn xuôi
- **THEN** hệ thống hiển thị nguyên văn như hiện tại và không hiện thẻ file nào

#### Scenario: Nội dung XML thô không có fence
- **WHEN** câu trả lời chứa `<mxfile>` nhưng không nằm trong fence nào
- **THEN** hệ thống SHALL NOT tạo khối file, và nội dung vẫn hiện đầy đủ dạng văn bản thuần

### Requirement: Chỉ định dạng văn bản trong allowlist được nhận và được ghi

Hệ thống SHALL giữ đúng một allowlist định dạng, dùng chung cho cả tầng hiển thị và tầng ghi file.
Hệ thống SHALL từ chối mọi định dạng ngoài allowlist, kể cả khi model nêu tên file có phần mở rộng
đó. Hệ thống SHALL NOT ghi nội dung nhị phân và SHALL NOT giải mã base64 để ghi file.

Allowlist SHALL là danh sách trắng: một định dạng chưa được liệt kê là định dạng bị từ chối.

#### Scenario: Phần mở rộng thực thi
- **WHEN** model sinh một fence với `filename=setup.exe` hoặc `filename=run.bat`
- **THEN** hệ thống SHALL NOT tạo khối file có nút tải xuống cho khối đó

#### Scenario: Định dạng chưa được liệt kê
- **WHEN** model sinh fence với định dạng không nằm trong allowlist
- **THEN** hệ thống hiển thị phần đó như văn bản thuần thay vì thành thẻ file

#### Scenario: Main process kiểm lại lần nữa
- **WHEN** một lời gọi ghi file tới main process mang định dạng hoặc phần mở rộng ngoài allowlist
- **THEN** main process từ chối bằng `FILE_UNSUPPORTED` và SHALL NOT ghi bất kỳ byte nào xuống ổ đĩa

### Requirement: Tên file được chuẩn hoá trước khi dùng làm tên gợi ý

Hệ thống SHALL chuẩn hoá tên file do model đề xuất trước khi hiển thị và trước khi ghi: loại bỏ mọi
thành phần đường dẫn và ký tự phân cách, loại bỏ `..`, loại bỏ ký tự điều khiển và ký tự Windows
không cho phép, loại bỏ dấu chấm và khoảng trắng ở cuối, đổi tên trùng với tên thiết bị Windows
(`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`), và giới hạn độ dài. Hệ thống SHALL bảo
đảm tên sau chuẩn hoá có đúng phần mở rộng của định dạng đã nhận diện.

Hệ thống SHALL NOT nhận đường dẫn từ renderer, và SHALL NOT ghi vào bất kỳ đường dẫn nào ngoài
đường dẫn do hộp thoại lưu file của hệ điều hành trả về.

#### Scenario: Tên file chứa đường dẫn
- **WHEN** model đề xuất `filename=../../Windows/System32/evil.txt`
- **THEN** hệ thống dùng tên đã bị lược hết thành phần đường dẫn, chỉ còn `evil.txt`

#### Scenario: Tên trùng tên thiết bị Windows
- **WHEN** model đề xuất `filename=CON.txt`
- **THEN** hệ thống đổi thành một tên khác không trùng tên thiết bị

#### Scenario: Tên rỗng hoặc chỉ gồm ký tự bị loại
- **WHEN** tên file sau chuẩn hoá không còn ký tự nào hợp lệ
- **THEN** hệ thống dùng tên mặc định theo định dạng và vẫn cho tải xuống

#### Scenario: Renderer gửi kèm đường dẫn
- **WHEN** renderer gọi channel ghi file kèm một trường đường dẫn tuỳ ý
- **THEN** trường đó bị loại bỏ trước khi tới handler và không ảnh hưởng tới nơi file được ghi

### Requirement: Thẻ file hiển thị thay cho bức tường nội dung

Hệ thống SHALL hiển thị mỗi khối file đã nhận diện thành một thẻ gồm tên file, định dạng, dung
lượng và số dòng, kèm nút tải xuống. Hệ thống SHALL thu gọn nội dung khối theo mặc định và SHALL
cho người dùng mở xem nội dung đó trong cùng khung chat. Hệ thống SHALL hiển thị nhiều khối trong
cùng một message thành nhiều thẻ độc lập.

Hệ thống SHALL chỉ tách khối cho message của assistant; message của người dùng SHALL giữ nguyên
cách hiển thị hiện tại. Hệ thống SHALL NOT render nội dung khối hay văn xuôi dưới dạng HTML.

#### Scenario: Nội dung dài không tràn khung chat
- **WHEN** một khối file có 800 dòng XML
- **THEN** thẻ file hiện tên, dung lượng và số dòng ở trạng thái thu gọn, không đổ 800 dòng vào
  khung chat

#### Scenario: Hai khối trong một câu trả lời
- **WHEN** một câu trả lời chứa một fence `drawio` và một fence `md`
- **THEN** hệ thống hiện hai thẻ file riêng, mỗi thẻ tải xuống độc lập

#### Scenario: Người dùng dán code vào chat
- **WHEN** message của người dùng chứa một fence có định dạng trong allowlist
- **THEN** hệ thống hiển thị message đó như hiện tại và SHALL NOT hiện thẻ file

### Requirement: Khối chưa hoàn tất không cho tải xuống

Hệ thống SHALL hiển thị một khối có fence đã mở nhưng chưa đóng như trạng thái đang tạo, SHALL nêu
tên file nếu đã biết, và SHALL NOT hiện nút tải xuống. Hệ thống SHALL chỉ cho tải xuống khi fence
đã đóng và message không còn ở trạng thái `streaming`.

#### Scenario: Đang stream giữa khối
- **WHEN** message đang `streaming` và fence đã mở nhưng chưa đóng
- **THEN** hệ thống hiện "đang tạo file" kèm tên file, không hiện nút tải xuống, và SHALL NOT đổ
  nội dung thô đang tới vào khung chat

#### Scenario: Stream kết thúc giữa khối
- **WHEN** stream dừng (hoàn tất, lỗi, hoặc người dùng huỷ) mà fence vẫn chưa đóng
- **THEN** khối đó vẫn ở trạng thái chưa hoàn tất, không có nút tải xuống, và hệ thống nêu rõ nội
  dung chưa đầy đủ

#### Scenario: Fence đóng nhưng message chưa xong
- **WHEN** fence đã đóng nhưng `message.status` vẫn là `streaming`
- **THEN** nút tải xuống chỉ xuất hiện sau khi message chuyển khỏi `streaming`

### Requirement: Ghi file là một hành động tường minh của người dùng qua main process

Hệ thống SHALL ghi file chỉ khi người dùng bấm tải xuống và chọn nơi lưu trong hộp thoại lưu file
của hệ điều hành. Hệ thống SHALL mở hộp thoại với tên gợi ý đã chuẩn hoá, SHALL ghi nội dung dạng
văn bản UTF-8, và SHALL thực hiện việc ghi trong main process.

Hệ thống SHALL NOT tự lưu, SHALL NOT lưu hàng loạt nhiều khối bằng một lần bấm, SHALL NOT mở file
vừa lưu, và SHALL NOT mở thư mục chứa file. Hệ thống SHALL NOT trả đường dẫn đã lưu về renderer.

#### Scenario: Lưu thành công
- **WHEN** người dùng bấm tải xuống và chọn một thư mục trong hộp thoại
- **THEN** hệ thống ghi file với nội dung nguyên vẹn của khối và thông báo đã lưu kèm tên file,
  không kèm đường dẫn

#### Scenario: Người dùng huỷ hộp thoại
- **WHEN** người dùng đóng hộp thoại lưu file mà không chọn nơi lưu
- **THEN** hệ thống SHALL NOT ghi file nào và SHALL NOT hiển thị lỗi

#### Scenario: Ổ đĩa từ chối ghi
- **WHEN** việc ghi thất bại vì hết dung lượng, không có quyền, hoặc file đang bị ứng dụng khác giữ
- **THEN** hệ thống báo lỗi `FILE_WRITE_FAILED` kèm một hành động khôi phục cụ thể, và trạng thái
  thẻ file vẫn cho thử lại

#### Scenario: Nội dung nguyên vẹn
- **WHEN** một khối `.drawio` được lưu rồi mở lại
- **THEN** nội dung file trùng khớp từng ký tự với phần bên trong fence, không thêm dòng, không mất
  dòng cuối

### Requirement: Khối vượt trần bị vô hiệu chứ không làm hỏng message

Hệ thống SHALL áp trần dung lượng cho mỗi khối và trần số khối cho mỗi message. Khối vượt trần
SHALL hiện ra như một thẻ bị vô hiệu kèm lý do và SHALL NOT có nút tải xuống. Các khối còn lại
trong cùng message SHALL vẫn hoạt động bình thường. Main process SHALL từ chối lời gọi ghi vượt
trần bằng `FILE_TOO_LARGE`.

#### Scenario: Một khối quá lớn
- **WHEN** một khối file vượt trần dung lượng
- **THEN** thẻ của khối đó bị vô hiệu kèm lý do, các thẻ khác trong message vẫn tải xuống được

#### Scenario: Quá nhiều khối
- **WHEN** một message chứa nhiều khối hơn trần cho phép
- **THEN** hệ thống hiển thị số khối trong trần và nêu rõ còn khối chưa được hiển thị

### Requirement: Log không chứa tên file lẫn nội dung

Hệ thống SHALL log thao tác ghi file với đúng các trường an toàn: định dạng, số byte, và kết quả
(`saved`, `canceled`, `failed` kèm loại lỗi). Hệ thống SHALL NOT log tên file, đường dẫn, hay nội
dung khối.

#### Scenario: Lưu file có tên tiết lộ nội dung
- **WHEN** người dùng lưu một file tên `luong-thang-12-nhan-su.csv`
- **THEN** log chỉ chứa định dạng, số byte và kết quả; không có tên file và không có đường dẫn

### Requirement: Quy tắc quy ước file trong system prompt là tối thiểu

Hệ thống SHALL thêm vào system prompt mặc định đúng một quy tắc về cách bọc nội dung file, và quy
tắc đó SHALL yêu cầu model chỉ tạo khối file khi người dùng yêu cầu một file. Quy tắc này SHALL NOT
thay đổi các nguyên tắc hiện có trong system prompt.

#### Scenario: Người dùng không yêu cầu file
- **WHEN** người dùng hỏi một câu thông thường
- **THEN** câu trả lời không chứa khối file nào và cách trả lời không đổi so với hiện tại

#### Scenario: Người dùng yêu cầu một sơ đồ
- **WHEN** người dùng nhờ dựng một sơ đồ luồng dạng `.drawio`
- **THEN** model đặt toàn bộ nội dung trong một fence duy nhất kèm định dạng và `filename=`
