## Context

Nexa đã có `document-processor` để kiểm loại file, trích text và phát hiện PDF scan; BA Workbench
đã có pattern “model trích xuất, code phán quyết” với rule pack có version. Checklist ngân hàng
phải tái dùng hai đường đó nhưng không được nhồi dữ liệu KYC vào mô hình use case của `ba-kit`.

## Goals / Non-goals

### Goals

- Cùng case + cùng chứng từ trích xuất + cùng template/rule version cho cùng kết quả.
- Phân biệt rõ `missing`, `expired`, `mismatch`, `unreadable`, `needs_review` và `passed`.
- Mỗi item có rule id, bằng chứng và hành động tiếp theo.
- Luật thiếu căn cứ trả `needs_review`, không tự biến thành đạt hoặc thiếu.
- Không lưu file/raw text; nội dung trích xuất và báo cáo được mã hóa.

### Non-goals

- Đánh giá tính pháp lý hoặc tính xác thực của giấy tờ.
- Vision/OCR trước khi hợp đồng consent/transport được ATTT duyệt.
- Quyết định tín dụng, AML hay giao dịch.

## Decisions

### D1. Checklist domain riêng, dùng lại pattern chứ không dùng lại schema BA

`@nexa/document-checklist` là package thuần logic, không Electron/DB/LLM. `ba-kit` mô tả use case,
field và flow; checklist mô tả case, document evidence và requirement. Hai domain dùng cùng nguyên
tắc nhưng không chia sẻ union type để tránh một thay đổi ngân hàng làm vỡ BA authoring.

### D2. Model chỉ phân loại và trích xuất

Job nhận text đã đi qua `document-processor`, trả `documentType`, danh sách field với vị trí nguồn
và `needsReview`. Output không khớp Zod bị từ chối; model không được trả status checklist. Chỉ
provider `litellm` được dùng vì tài liệu ngân hàng luôn là dữ liệu nội bộ.

### D3. Rule pack xác định tạo checklist

Rule pack v1 chạy bốn nhóm:

- presence: có chứng từ thuộc loại được chấp nhận;
- required fields: có các trường bắt buộc và không còn `needsReview`;
- expiry: ngày hết hạn đọc được và chưa qua ngày review;
- cross-document match: cùng field phải khớp sau chuẩn hóa.

Mỗi requirement sinh đúng một checklist item. Cross-check sinh item riêng. Không có chữ “hồ sơ
hợp lệ”; UI chỉ nói “đạt theo các luật đã chạy”.

### D4. Resource chỉ đọc và version pinning

`bank-checklist-templates.json` đi kèm bản cài, đọc qua cùng ResourceReader với chuẩn BA. Case lưu
template id + version. Báo cáo lưu lại version đã chạy để kết quả cũ không bị diễn giải bằng chuẩn
mới.

### D5. Không lưu bản sao file hoặc raw text

DB chỉ giữ tên file đã mã hóa, hash đường dẫn, loại tài liệu, cờ scan/truncated và payload field đã
mã hóa. Khi cần kiểm lại nội dung nguồn, người dùng phải đính kèm lại hoặc về sau dùng DMS id.

### D6. Tab Hồ sơ nằm trong Không gian Nghiệp vụ

MVP thêm một tab thay vì destination mới. Nó dùng cùng feature gate `features.baWorkbench` và mọi
IPC vẫn bị main từ chối khi cờ tắt. UI có bốn vùng: tạo/chọn case, chứng từ, kết quả tóm tắt và bảng
checklist. Evidence luôn là nút/nhãn cụ thể, không phải confidence score mơ hồ.

## Risks / Trade-offs

- Không OCR nghĩa là PDF scan được báo không đọc được; đây là giới hạn công khai của MVP.
- Phân loại/trích xuất phụ thuộc model nội bộ; lỗi model không làm rule pass vì payload hỏng bị từ
  chối và field không chắc bị loại khỏi căn cứ.
- Mẫu KYC mặc định chỉ là khung kỹ thuật; ngân hàng phải thay bằng chuẩn đã được nghiệp vụ/pháp chế
  phê duyệt trước pilot.

## Verification

- Unit test schema, rule precedence, normalization, determinism và fail-closed uncertainty.
- Repository test migration, cascade, ownership và encryption-at-rest.
- Service test retry/schema/provider gate/log hygiene.
- IPC test feature/profile gate và file-token release.
- Renderer helper test summary/status labels; full lint/typecheck/test.
