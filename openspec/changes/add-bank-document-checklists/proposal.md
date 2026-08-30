## Why

Nhân viên ngân hàng hiện có thể đưa từng tài liệu vào Chat hoặc Không gian Nghiệp vụ, nhưng chưa
có một đối tượng **bộ hồ sơ** để trả lời ba câu hỏi xác định: chứng từ nào đã nhận, chứng từ nào
còn thiếu và dữ liệu nào mâu thuẫn giữa các chứng từ. Hỏi model trực tiếp chỉ tạo ra một nhận xét
không lặp lại được và dễ biến lỗi trích xuất thành kết luận nghiệp vụ.

Change này thêm một lát cắt MVP cho hồ sơ KYC bán lẻ. Model chỉ phân loại và trích xuất trường có
cấu trúc; một rule pack có version quyết định checklist. Người dùng luôn thấy nguồn, luật, cách xử
lý và phần chưa kiểm được. Không có kết luận phê duyệt/từ chối và không có write tới core banking.

## What Changes

- Thêm package thuần `@nexa/document-checklist` chứa schema tài liệu trích xuất, schema mẫu
  checklist, rule pack v1 và bộ chạy xác định.
- Ship mẫu `retail-kyc-basic` dưới dạng resource chỉ đọc, có id + version và được IT thay thế khi
  phân phối.
- Thêm migration v10 cho case, metadata/trường trích xuất và báo cáo checklist. Nội dung, tên case,
  tên file và finding đều được mã hóa; không lưu bản sao file hay raw text.
- Thêm job trích xuất có schema trong main. Chỉ model qua LiteLLM nội bộ được nhận nội dung; output
  sai schema bị từ chối và thử lại có giới hạn; trường không chắc phải mang `needsReview`.
- Thêm namespace IPC `ba:checklist:*`, repository ownership gate theo profile và activity metadata.
- Thêm tab **Hồ sơ** trong Không gian Nghiệp vụ: tạo case, chọn mẫu, đính kèm file, chạy kiểm tra,
  xem tóm tắt và checklist có bằng chứng.

## Non-goals

- OCR/vision cho PDF scan hoặc ảnh giấy tờ.
- Xác thực chữ ký, con dấu hoặc giấy tờ thật/giả.
- Tự phê duyệt, từ chối, cập nhật core banking hoặc bulk-apply finding.
- Template editor cho người dùng cuối.
- Đồng bộ hồ sơ giữa máy hoặc thay DMS của ngân hàng.

## Impact

- **Code:** package thuần mới; migration/repository; main extraction/review service; IPC/bridge;
  renderer tab Hồ sơ.
- **Data:** ba bảng mới, cascade theo profile/case; raw file và raw text không được lưu.
- **Privacy:** fail-closed với provider ngoài tổ chức; log chỉ chứa id, enum, version và số đếm.
- **Dependencies:** không thêm dependency ngoài workspace.
