## Why

§14 chốt phạm vi MVP là TXT/Markdown, PDF và DOCX. Trên thực tế, tài liệu mà người dùng cần đưa
vào Nexa phần lớn nằm ngoài bốn loại đó: bảng số liệu là `.xlsx`, tài liệu trình bày là `.pptx`,
hợp đồng và biểu mẫu cũ vẫn là `.doc`/`.xls` từ thời Office 97, và rất nhiều câu hỏi thực tế bắt
đầu bằng một ảnh chụp màn hình lỗi hoặc một tấm ảnh chụp giấy tờ.

Hôm nay những file đó bị từ chối ở bước validate, và người dùng phải tự chuyển đổi bên ngoài — tức
là copy nội dung nội bộ sang một công cụ khác để rồi dán ngược vào Nexa. Chỗ đó vừa mất công vừa
đúng là kiểu rò rỉ mà §11 muốn tránh.

Change này mở rộng đường nạp file sang toàn bộ bộ Office và ảnh, giữ nguyên mọi ranh giới đã có:
đường dẫn không rời main process, không lưu bản sao file, và tài liệu không tới được provider
ngoài tổ chức khi chưa allowlist tường minh.

## What Changes

- Mở rộng `@nexa/document-processor` sang `.xlsx`, `.pptx`, `.doc`, `.xls`, `.ppt` và ảnh
  PNG/JPEG/WebP/GIF. Mỗi định dạng có bộ đọc riêng viết trong repo, không thêm dependency nào.
- Thêm `ZipArchive` — bộ đọc ZIP chỉ đọc có trần bung dữ liệu theo entry và theo tổng, để một gói
  OOXML dựng ngược không thành zip bomb.
- Thêm `CfbArchive` — bộ đọc OLE2 cho ba định dạng nhị phân cũ, có trần số bước chain và kiểm biên
  từng lần đọc.
- Ảnh đi tới model theo đường **đa phương thức**: `ChatMessage.content` của `@nexa/llm-client` nhận
  thêm dạng mảng mảnh `text` / `image_url`, ảnh gửi bằng data URL base64 chứ không bằng URL mạng.
- Gỡ metadata ảnh (EXIF/XMP/comment) TRƯỚC khi mã hoá base64. Không gỡ được thì không gửi.
- Thêm cột `models.supports_vision` (migration v11, mặc định 0) và kiểm tra năng lực fail-closed
  tách khỏi kiểm tra quyền: `MODEL_DOES_NOT_SUPPORT_IMAGES`.
- Ảnh không vừa cửa sổ ngữ cảnh là **lỗi** (`IMAGE_EXCEEDS_CONTEXT`), không phải một lần cắt bớt
  im lặng như với văn bản.
- Thêm `maxImageSizeMb` (mặc định 8) tách khỏi `maxFileSizeMb`.
- UI: hộp thoại chọn file suy thẳng từ bảng định dạng của pipeline; chip đính kèm phân biệt ảnh;
  cảnh báo khi model đang chọn không đọc được ảnh; Cài đặt → Model có ô "Đọc được ảnh".

## Non-goals

- OCR. Ảnh và PDF scan vẫn không có lớp văn bản cục bộ (§2.2). Model thị giác tự đọc chữ trong ảnh
  nếu nó làm được, Nexa không nhận đó là kết quả trích xuất.
- Giải mã và vẽ lại điểm ảnh. Không nhúng bộ decode ảnh nào; ảnh không được thu nhỏ, chỉ được
  chặn theo trần dung lượng và kích thước.
- Tính lại công thức Excel, theo external link, hay đọc macro/VBA.
- Định dạng ngoài Office và ảnh: OpenDocument, RTF, ZIP tài liệu, video, audio.
- Tự dò năng lực thị giác của model. `GET /v1/models` không nói gì về phương thức đầu vào, nên
  người dùng khai tay.

## Impact

- **Code:** 8 module mới trong `document-processor`; `ChatMessage` đa phương thức trong
  `llm-client`; ngân sách ảnh trong `context-builder`; chính sách năng lực trong `document-policy`;
  file picker, chat controller và hai màn hình renderer.
- **Data:** migration v11 thêm một cột boolean. Không thêm bảng. Ảnh KHÔNG được lưu — base64 cũng
  là một bản sao file, và §8.1 cấm lưu bản sao.
- **Privacy:** metadata ảnh bị gỡ trước khi rời máy; log chỉ ghi kích thước, media type và số đếm.
- **Dependencies:** không thêm dependency nào.
