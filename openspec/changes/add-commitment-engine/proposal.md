## Why

Nexa đã nhớ context ổn định và giúp mở lại hội thoại, nhưng mục tiêu hiện chỉ là một memory fact
không có trạng thái công việc, bước tiếp theo hoặc thời điểm cần quay lại. Companion cần duy trì một
cam kết xuyên nhiều phiên làm việc mà không tự suy luận hay tự tạo nghĩa vụ thay người dùng.

## What Changes

- Thêm commitment được mã hoá và gắn cứng với profile hiện tại.
- Mỗi commitment có outcome, next action, status, due/check-in và hội thoại nguồn tuỳ chọn.
- Thêm IPC CRUD có validation và ownership gate như memory.
- Thêm màn hình **Mục tiêu** để tạo, sửa, hoàn thành, mở lại và xoá commitment.
- Today ưu tiên commitment đang active/blocked theo due/check-in thay vì coi memory kind `goal` là
  một task.
- Không tự tạo commitment từ chat, memory hoặc tool output; không có background write action.

## Impact

- **Code:** local-store, shared types/IPC, Electron main/bridge và renderer.
- **Data:** migration v6 tạo bảng `commitments`; outcome/next action dùng field encryption.
- **Privacy:** dữ liệu nằm local, purge theo profile, không được tự đưa vào model context trong v1.
- **Dependencies:** không thêm package.
