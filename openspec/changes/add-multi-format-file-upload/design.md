## Context

`document-processor` đã có sẵn khung đúng cho việc này: validate → trích xuất trong worker có trần
bộ nhớ → chuẩn hoá → chunk, với đường dẫn không bao giờ rời main process. Việc mở rộng định dạng
vì thế không phải dựng đường mới mà là cắm thêm bộ đọc vào đúng chỗ `extract()` phân nhánh.

Ảnh thì khác hẳn. Nó không sinh ra văn bản, nên nó không đi được qua chunk và không nằm được trong
một `ChatMessage` dạng chuỗi. Đó là phần duy nhất của change này chạm tới giao thức gửi model.

## Goals / Non-goals

### Goals

- Nhận đủ bộ Office (`.docx`/`.doc`, `.xlsx`/`.xls`, `.pptx`/`.ppt`) và ảnh PNG/JPEG/WebP/GIF.
- Không thêm dependency: mọi thứ chạy trên dữ liệu không tin cậy đều phải audit được trong repo.
- Mọi lối bung dữ liệu (inflate, chain sector, chuỗi bản ghi) đều có trần tường minh.
- Ảnh rời máy đã sạch metadata, hoặc không rời máy.
- Ảnh không tới được model thì người dùng phải BIẾT, không bao giờ im lặng.

### Non-goals

- OCR, giải mã điểm ảnh, thu nhỏ ảnh.
- Tính công thức, đọc macro, theo external link.
- Tự dò năng lực thị giác của model.

## Decisions

### D1. Tự viết bộ đọc thay vì thêm thư viện

Ba lựa chọn: thêm thư viện npm (`xlsx`, `word-extractor`), tự viết, hoặc từ chối định dạng cũ.

Chọn **tự viết**. Lý do quyết định không phải là kích thước bundle mà là bề mặt tấn công: mọi byte
ở đây đến từ một file người dùng nhặt về, và bộ đọc chạy trong worker của chính app. Bản `xlsx`
trên npm registry còn mang CVE prototype-pollution chưa vá. Tự viết cũng là cách duy nhất đặt được
trần bung dữ liệu vào ĐÚNG chỗ cần — `inflateRawSync({ maxOutputLength })` dừng giữa chừng, thay
vì cấp phát xong rồi mới phát hiện quá cỡ.

Cái giá đã chấp nhận: chất lượng trích xuất ở mức "đủ dùng", không bằng bộ chuyển đổi chuyên
dụng. Ngày tháng trong Excel ra số serial; `.doc` tiếng Việt mã TCVN3/VNI ra sai dấu.

### D2. Ảnh là một `DocumentKind`, không phải một loại đính kèm riêng

Ảnh đi qua đúng đường ống của tài liệu: cùng FileBroker, cùng validate, cùng worker, cùng
`ProcessedDocument`. Chỉ khác ở nhánh cuối: `text` rỗng, `chunks` rỗng, và có thêm `image`.

Tách ảnh thành một khái niệm riêng sẽ phải nhân đôi mọi thứ đã đúng — giới hạn số file, hash
đường dẫn, chính sách provider, ghi attachment — và mỗi bản sao là một chỗ để hai nhánh trôi lệch
nhau. Chính sách quan trọng nhất (§11.2, tài liệu không tới provider ngoài khi chưa allowlist) áp
cho ảnh MIỄN PHÍ đúng vì lý do này.

### D3. Quyền và năng lực là hai kiểm tra tách rời

`assertModelMayReceiveDocuments` trả lời "được phép gửi không". `assertModelSupportsImages` trả
lời "model đọc được không". Gộp lại thì thông báo cho người dùng sai một nửa: họ sẽ đi xin cấp
quyền cho một model vốn chỉ không biết xem ảnh.

`supportsVision` do người dùng khai, mặc định false. `GET /v1/models` của LiteLLM không trả về
phương thức đầu vào, và đoán theo tên model là kiểu hỏng âm thầm tệ nhất: gateway nhận request,
bỏ ảnh đi, rồi model trả lời trôi chảy về một tấm ảnh nó chưa từng thấy.

### D4. Ảnh không vừa context là lỗi, không phải cắt bớt

Văn bản rút gọn được — bỏ vài chunk vẫn còn ý chính, và `documentsTruncated` báo cho người dùng.
Ảnh thì hoặc gửi cả tấm hoặc không có gì. "Không có gì" mà vẫn trả lời được là đúng kịch bản mà
D3 muốn tránh, nên ở đây `IMAGE_EXCEEDS_CONTEXT` dừng hẳn lượt.

### D5. Gỡ metadata ở mức khối, không giải mã ảnh

JPEG bỏ APP1–APP13/APP15/COM nhưng GIỮ APP0 (JFIF) và APP14 (Adobe) — hai khối đó mô tả cách diễn
giải màu, bỏ đi thì ảnh CMYK đảo màu. PNG giữ danh sách chunk cho phép. WebP bỏ chunk EXIF/XMP và
tắt cờ tương ứng trong VP8X. GIF bỏ comment extension và application extension mang XMP.

Không giải mã điểm ảnh vì như thế phải nhúng một bộ decode ảnh chạy trên dữ liệu lạ — đúng loại
bề mặt tấn công mà D1 đang tránh.

Khi không gỡ được thì KHÔNG gửi ảnh gốc. Một cam kết về quyền riêng tư mà có nhánh dự phòng âm
thầm bỏ qua chính nó thì không phải cam kết.

### D6. `ChatMessage.content` là union, mặc định vẫn là chuỗi

`string | ChatContentPart[]`. Tuyệt đại đa số message không có ảnh, và một số gateway cũ chỉ nhận
chuỗi — chuyển hết sang dạng mảng là thay đổi hành vi cho 99% lượt gửi để phục vụ 1%. Chỉ message
mang ảnh mới ở dạng mảng, và mọi ảnh của một lượt gộp vào MỘT message.

Ảnh gửi bằng data URL base64 chứ không bằng URL. URL mạng sẽ khiến provider tự đi tải file — mở
một đường ra ngoài mà Nexa không kiểm soát và allowlist domain (§11.2) không nhìn thấy.

## Risks / Trade-offs

- **Bộ đọc tự viết có thể sai với file thật.** Giảm bằng fixture sinh từ mã trong `tests/support`,
  dựng đúng những chi tiết khó: mảnh văn bản đảo thứ tự, chuỗi SST cắt qua CONTINUE, mini stream.
  Vẫn cần thử với file thật của người dùng trước pilot.
- **`.doc` tiếng Việt mã cũ ra sai dấu.** Không sửa được từ phía đọc: file không mang thông tin
  code page. Đã ghi rõ trong comment của `legacy-text.ts`.
- **Ảnh đắt hơn cảm giác trực quan.** Một ảnh 1024×1024 tốn ~765 token. Ước lượng theo công thức ô
  512px, cố ý ước hơi cao.
- **Thứ tự slide `.ppt` theo thứ tự trong file**, có thể khác thứ tự trình chiếu nếu người dùng đã
  sắp lại. `.pptx` thì đúng tuyệt đối vì lấy từ `sldIdLst`.
