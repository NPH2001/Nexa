## 1. Contract

- [x] 1.1 Proposal, design và spec delta cho change.
- [x] 1.2 Cập nhật README phần định dạng được hỗ trợ.

## 2. Bộ đọc định dạng

- [x] 2.1 `ZipArchive` — đọc ZIP có trần bung theo entry và theo tổng, hỗ trợ ZIP64.
- [x] 2.2 `ooxml.ts` — `.xlsx` (SST, ô thưa, thứ tự sheet) và `.pptx` (thứ tự `sldIdLst`, ghi chú).
- [x] 2.2b `spreadsheet-dates.ts` — ô ngày ra ISO thay vì số serial, cho cả `.xlsx` và `.xls`.
- [x] 2.3 `CfbArchive` — đọc OLE2 gồm FAT, DIFAT, mini stream, có trần chain.
- [x] 2.4 `legacy-word.ts` — piece table Word 97, bỏ chỉ dẫn field, dự phòng Word 6/95.
- [x] 2.5 `legacy-excel.ts` — BIFF8 gồm SST qua CONTINUE, LABELSST/LABEL/RK/MULRK/NUMBER/FORMULA.
- [x] 2.6 `legacy-ppt.ts` — cây bản ghi PowerPoint 97, gom chữ theo slide.
- [x] 2.7 `image.ts` — nhận dạng, đọc kích thước, gỡ metadata bốn định dạng, ước lượng token.
- [x] 2.8 Nối vào `extract()`, `pipeline.ts` (bảng extension/MIME, nhận dạng theo họ), types.

## 3. Đường đi của ảnh tới model

- [x] 3.1 `ChatMessage.content` dạng union + helper `messageText` trong `llm-client`.
- [x] 3.2 Ngân sách và mảnh ảnh trong `context-builder`, kèm `imagesIncluded`/`imagesTruncated`.
- [x] 3.3 `assertModelSupportsImages` / `mayReceiveImages` trong `document-policy`.
- [x] 3.4 `IMAGE_EXCEEDS_CONTEXT` — dừng lượt thay vì bỏ ảnh im lặng.

## 4. Persistence, main và UI

- [x] 4.1 Migration v11 `models.supports_vision` + repository + model service + IPC schema.
- [x] 4.2 `maxImageSizeMb` trong settings, nối vào `DocumentProcessor`.
- [x] 4.3 File picker suy từ bảng định dạng; chat controller truyền `modelSupportsVision`.
- [x] 4.4 Renderer: ô "Đọc được ảnh" ở Cài đặt → Model; chip ảnh và cảnh báo ở ChatView.

## 5. Verification

- [x] 5.1 Fixture sinh từ mã: `make-office.ts`, `make-legacy-office.ts`, `make-image.ts`.
- [x] 5.2 Test cho từng định dạng, cho zip bomb và cho việc gỡ metadata.
- [x] 5.3 Test ảnh trong context và trong `runTurn`.
- [x] 5.4 Lint + typecheck + full test + build.
- [x] 5.5 E2E chạy app thật: đính kèm ảnh, bị chặn ở model chỉ đọc chữ, và mock LiteLLM xác nhận
      ảnh tới nơi đã gỡ metadata.
- [x] 5.6 Chạy thử với 8 tài liệu thật (`.docx`, `.xlsx`, `.pptx`, `.doc`) — xem OPEN-QUESTIONS J2.
