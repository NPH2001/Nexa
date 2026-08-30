# Hợp đồng consent và transport cho ảnh nội bộ (BA vision)

- Trạng thái: **DỰ THẢO — chờ Security owner và ATTT duyệt.** Chưa có hiệu lực.
- Bối cảnh: openspec `add-ba-workbench`, quyết định D7; task 13.1
- Người soạn: nhóm phát triển Nexa · 2026-08-30
- Chặn: task 13.2–13.4 (`ảnh → danh sách field`) không được bắt đầu trước khi tài liệu này được duyệt

> Tài liệu này **không** xin duyệt tính năng vision nói chung. Nó xin duyệt một phạm vi hẹp đã
> được cố ý thu nhỏ, và nêu rõ những gì Nexa sẽ **không** làm kể cả khi được duyệt.

## 1. Vì sao cần một quyết định riêng

Yêu cầu gốc của tính năng BA có câu *"đọc ảnh, mô tả validate các trường theo hình ảnh và common
validate chung"*. Khi làm G1–G2, phần **có giá trị** của yêu cầu đó đã được giải xong mà không cần
ảnh: rulebook `ba-rulebook.json` trả lời được "trường kiểu này cần validate nào" cho trường đến từ
bất kỳ nguồn nào, và `R-FLD-02` chạy trên đó (D7).

Phần còn lại của yêu cầu chỉ đóng góp đúng một việc: **liệt kê tên trường từ một ảnh chụp màn hình
form**. Việc đó nhỏ, nhưng nó đòi một thứ mà Nexa đang **cố ý đóng**, nên nó không phải là một dòng
code — nó là một quyết định.

## 2. Dữ liệu thật sự di chuyển

Đây là điểm khiến ảnh khác hẳn văn xuôi, và là lý do tài liệu này tồn tại.

Một ảnh chụp màn hình sản phẩm nội bộ mang theo **nhiều hơn nội dung mà người dùng định gửi**. Một
BA chụp form để hỏi "form này có những trường nào" thường vô tình gửi kèm:

| Đi kèm ngoài ý muốn | Ví dụ điển hình |
| --- | --- |
| Dữ liệu khách hàng thật trên môi trường staging | tên, số điện thoại, số tài khoản trong bảng phía sau |
| Định danh nội bộ | URL hệ thống, tên máy chủ, mã nhân viên ở thanh trạng thái |
| Danh tính người chụp | avatar, tên đăng nhập, tab trình duyệt, thông báo Slack |
| Bề mặt kỹ thuật | tên môi trường, phiên bản build, thanh công cụ debug |

Không có phép cắt tự động nào đáng tin cho việc này. Nexa **không** đề xuất tự động che (redaction)
vì một bộ che sai một lần là một sự cố rò rỉ, còn một bộ che đúng chín lần vẫn không đổi được điều
đó. Trách nhiệm chọn ảnh nào được gửi phải nằm ở người dùng, và Nexa phải làm cho lựa chọn đó khó
bấm nhầm.

## 3. Vì sao việc này đụng thẳng F1

`DESIGN.md` ghi: *"File and image attachment stay disabled for `chatgpt` selections until Nexa has a
reviewed, explicit external-data consent and media transport contract."* Đó chính là hợp đồng mà
tài liệu này định trở thành.

Ba sự thật về hiện trạng, đã kiểm lại trong mã nguồn:

1. **Không đường nào trong Nexa nhận ảnh.** `document-processor` chỉ chấp nhận `.txt`, `.md`,
   `.pdf`, `.docx` (`EXTENSION_MAP` trong `pipeline.ts`). Mở vision là mở thêm loại file ở
   `FileBroker`, không phải chỉ đổi một cờ.
2. **Nexa có đường gọi thẳng `api.openai.com`** (OPEN-QUESTIONS F1), tức là có một provider **ngoài
   tổ chức** đang tồn tại trong sản phẩm. Bất kỳ khả năng gửi ảnh nào cũng phải trả lời được câu
   "ảnh có bao giờ đi ra đó không".
3. **Chính sách tài liệu cho provider ngoài đã fail-closed** (`externalDocumentAllowedModels`, rỗng
   = từ chối). Đây là tiền lệ đúng để áp cho ảnh, và tài liệu này đề xuất áp chặt hơn một mức.

## 4. Điều khoản đề xuất

Mỗi điều khoản có thể được duyệt, sửa hoặc bác **riêng lẻ**. Cột "nếu bị bác" nói rõ hệ quả để việc
sửa không phải đoán.

### C1. Ảnh KHÔNG BAO GIỜ rời hạ tầng nội bộ

Ảnh chỉ được gửi tới provider nội bộ (LiteLLM). Với provider ngoài tổ chức, đường ảnh bị **chặn
trong main process**, không phải bị ẩn trong giao diện — và chặn không điều kiện, không có allowlist
per-model như tài liệu văn bản.

*Vì sao chặt hơn `externalDocumentAllowedModels`:* một tài liệu DOCX là thứ người dùng đã đọc và
biết trong đó có gì. Một ảnh thì không — mục 2 đã nêu. Cho phép khai báo ngoại lệ per-model ở đây
là tạo ra đúng cái hộp chọn mà ai đó sẽ tick vào một ngày bận việc.

**Nếu bị bác** (tức ATTT cho phép ảnh ra provider ngoài): cần thêm một allowlist thứ ba, fail-closed,
tách khỏi hai danh sách hiện có — và cần một cảnh báo mạnh hơn mức đang dùng cho tài liệu.

### C2. Consent là từng ảnh một, không nhớ, không áp dụng lại

Mỗi lần gửi ảnh là một lần xác nhận riêng, hiển thị: tên file, kích thước, model đích, provider đích
và câu nói rõ ảnh sẽ được gửi tới đâu. Không có "nhớ lựa chọn này", không có consent theo phiên,
không có consent theo tài liệu.

*Vì sao:* consent được nhớ là consent không còn được đọc. Đây cũng là hình dạng mà Confirmation
Guard đang dùng cho mọi thao tác ghi (§7.4) nên nó không phải một cơ chế mới.

**Nếu bị bác** (cho phép nhớ theo phiên): phải nói rõ phiên hết hiệu lực khi nào, và bản xem trước
vẫn phải hiện ở lần đầu.

### C3. Ảnh không nằm lại trên đĩa

Ảnh đi qua `FileBroker` như file hiện tại: renderer nhận **token**, không nhận đường dẫn (§5.3).
Main đọc ảnh, gửi đi, rồi giải phóng token ngay — thành công hay thất bại. Ảnh **không** được ghi
vào `temp` của Nexa và **không** được ghi vào SQLite.

**Nếu bị bác** (cần lưu ảnh để tra lại): ảnh thành nội dung người dùng và phải mã hoá tại chỗ như
mọi cột khác (bất biến §21), cộng một chính sách retention riêng. Đây là thay đổi lớn hơn nhiều so
với phần còn lại của tài liệu này.

### C4. Chỉ **danh sách tên trường** được lưu, không lưu gì khác từ ảnh

Kết quả trích xuất từ ảnh là một danh sách `field` theo đúng schema `ba-kit` đang có. Model **không**
được suy luận quy tắc nghiệp vụ, không sinh use case, không sinh mã lỗi từ ảnh. Validate vẫn do
rulebook sinh ra (D7).

*Vì sao:* thu hẹp phạm vi output là cách rẻ nhất để giới hạn thiệt hại nếu ảnh có chứa dữ liệu thật.
Một danh sách tên trường thì gần như không thể mang theo số tài khoản của ai; một đoạn văn xuôi do
model tự viết từ ảnh thì có.

### C5. Trường lấy từ ảnh mặc định `needs_review`

Không có ngoại lệ, kể cả khi model tự nhận là chắc chắn. Trường như vậy hiển thị tách riêng và
**không** được dùng làm căn cứ trong báo cáo review cho tới khi người dùng soát (D4, đã có sẵn cơ
chế).

### C6. Log chỉ có số đếm

Log ghi: có/không có ảnh, số ảnh, kích thước, model đích, provider đích, số trường trích được. Không
ghi tên file, không ghi nội dung ảnh, không ghi tên trường. Cùng hợp đồng log đang áp cho review và
trích xuất.

### C7. IT khoá được toàn tổ chức, và mặc định là TẮT

Một cờ riêng (đề xuất: `features.baVision`), mặc định **tắt**, khoá được bằng `forcedFeatures` trong
`policy.json` — cùng đường mà `baWorkbench` đang dùng. Cờ này **không** đi kèm `baWorkbench`: một tổ
chức phải bật được workbench mà vẫn cấm ảnh.

## 5. Bốn câu hỏi tôi không tự trả lời được

Đây là phần thật sự cần chữ ký, phần còn lại chỉ là hệ quả.

1. **Ảnh chụp màn hình sản phẩm nội bộ có được phép gửi tới LiteLLM không?** LiteLLM là hạ tầng nội
   bộ, nhưng nó chuyển tiếp tới một model, và model đó chạy ở đâu là câu hỏi của ATTT chứ không phải
   của Nexa. Nếu backend phía sau LiteLLM là một dịch vụ cloud thì C1 chưa đủ và phải siết tiếp
   bằng allowlist model.
2. **Môi trường nào được phép chụp?** Nếu tổ chức cấm đưa dữ liệu staging/production ra khỏi hệ
   thống thì phần lớn giá trị của tính năng biến mất, và nên biết điều đó **trước** khi làm 13.2.
3. **Cần lưu vết ai đã gửi ảnh nào không?** C3 và C6 cố ý không lưu gì để truy lại. Nếu ATTT cần một
   dấu vết kiểm toán thì nó mâu thuẫn trực tiếp với C3, và mâu thuẫn đó phải được giải trước khi
   code.
4. **Ai chịu trách nhiệm khi một ảnh chứa dữ liệu khách hàng thật được gửi đi?** Nexa làm cho lựa
   chọn đó rõ ràng và khó bấm nhầm; nó không thẩm định được nội dung ảnh. Ranh giới trách nhiệm nên
   được ghi ra chứ không để ngầm hiểu.

## 6. Tiêu chí nghiệm thu nếu được duyệt

13.2–13.4 chỉ được coi là xong khi có đủ:

- Test khẳng định ảnh **không** tới provider ngoài tổ chức, kiểm ở tầng main process chứ không ở UI
  (13.4 đã yêu cầu).
- Test khẳng định trường lấy từ ảnh mang `needsReview = true` (13.3).
- Test khẳng định token file được giải phóng cả trên đường thất bại.
- Test khẳng định log không chứa tên file và tên trường.
- E2E: tắt cờ `baVision` thì không có đường nào chọn được ảnh, và kênh IPC tương ứng bị từ chối
  trong main kể cả khi renderer gọi thẳng — cùng khuôn với test đang có cho `baWorkbench`.

## 7. Nếu bị bác toàn bộ

Tính năng BA **không** mất phần có giá trị. Rulebook + `R-FLD-02` đã trả lời được câu hỏi khó
("trường này còn thiếu validate nào") cho trường đến từ văn xuôi và bảng trong DOCX. Cái mất là sự
tiện lợi của việc khỏi gõ tay danh sách trường từ một ảnh.

Trong trường hợp đó, đề xuất: đóng D7 với kết luận "không làm", gỡ mục 13 khỏi change này, và ghi lý
do vào ADR 0010 để lần sau không ai mở lại từ đầu.
