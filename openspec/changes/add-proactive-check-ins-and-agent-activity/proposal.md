## Why

Commitment Engine v1 đã giúp người dùng lưu outcome, bước tiếp theo và thời điểm quay lại, nhưng
Today mới chỉ tính độ ưu tiên khi renderer tải dữ liệu. Nexa chưa có một cơ chế opt-in để nhắc lại
trong lúc ứng dụng đang mở, cũng chưa có bề mặt bền vững cho người dùng kiểm tra agent đã gợi ý,
thay đổi dữ liệu cục bộ hay đi qua confirmation guard như thế nào.

Change này bổ sung một check-in engine chỉ chạy trong tiến trình app và một activity timeline
local-first. Cả hai phải làm Nexa chủ động hơn mà không giả vờ có background process, không tự tạo
commitment, không tự gọi tool write và không làm yếu renderer trust boundary.

## What Changes

- Thêm global opt-in `proactiveCheckInsEnabled`, mặc định tắt, lưu trong settings đã mã hoá theo
  profile.
- Thêm suggestion state riêng, derive idempotent từ due/check-in của commitment active/blocked.
- Thêm hành động Thực hiện, Nhắc lại sau, Bỏ qua, Không nhắc việc này nữa và Bật lại nhắc.
- Thêm in-app scheduler chỉ tồn tại khi app đang mở và setting đã bật; không thêm OS notification
  hay background process.
- Mở rộng local audit bằng activity metadata có kiểu chặt và thêm read model/filter cho timeline.
- Ghi bảy nhóm sự kiện: suggestion, memory mutation, commitment mutation, tool preview,
  confirmation, tool result và uncertain operation.
- Thêm navigation **Hoạt động**, loading/empty/error/retry và filter theo loại/trạng thái.

## Impact

- **Code:** local-store migration/repositories, shared domain/IPC, Electron main/services,
  preload bridge và renderer.
- **Data:** migration v7 thêm `commitment_check_ins` và các cột activity metadata cho
  `local_audit`; không backfill nội dung nhạy cảm.
- **Privacy:** không lưu secret, raw tool payload, raw MCP result, memory content hay commitment
  title trong activity rows. Nội dung commitment tiếp tục chỉ tồn tại trong ciphertext hiện có.
- **Agency:** suggestion không phải commitment và mọi external write vẫn đi qua confirmation guard.
- **Dependencies:** không thêm package.
