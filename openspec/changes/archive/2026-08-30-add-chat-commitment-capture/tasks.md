## 1. Contract và persistence

- [x] 1.1 Mở rộng `ToolPreview.targetSystem` thêm `'local'` và sửa mọi nơi typecheck báo lỗi (renderer preview, sink, activity).
- [x] 1.2 Thêm kiểu `LocalToolDefinition`/`LocalToolRegistry` trong shared-types, tách khỏi `ToolDefinition` MCP.
- [x] 1.3 Thêm setting `agentCommitmentToolsEnabled` (default false) và `commitmentContextEnabled` (default true) vào schema settings đã mã hoá.
- [x] 1.4 Migration v8: `commitments.created_by` default `'user'` và cột actor cho `local_audit`; test migration lên/không backfill nội dung.
- [x] 1.5 Bổ sung `createdBy` vào CommitmentRepository create/update/read và thêm `listForContext(profileId, opts)` trả active/blocked đã sắp theo mốc quá hạn/gần nhất.

## 2. Chuẩn hoá thời gian

- [x] 2.1 Viết hàm thuần `resolveCommitmentTimestamp(text, now)` hỗ trợ ISO và mô tả tương đối tiếng Việt.
- [x] 2.2 Test bảng ca: hôm nay/ngày mai, thứ N tuần này/tuần sau, N ngày|tuần|tháng nữa, cuối tuần/cuối tháng, chuỗi không hợp lệ, biên chuyển tháng và múi giờ máy.

## 3. Local tool trong agent runtime

- [x] 3.1 Thêm port `localTools` vào `AgentRuntimeDeps`; `resolveCallable()` tra local trước MCP.
- [x] 3.2 Sửa `buildToolSpecs()` gộp local specs, trả khác rỗng khi `mcp === null`, và không lọc local theo `TOOL_PRESET_FLAGS`.
- [x] 3.3 Tách điểm thực thi trong `executeWrite()`: local dùng `execute()`, MCP giữ `callTool()`; không đổi thứ tự tám bước và không đổi guard.
- [x] 3.4 Cấp `PreviewContext` riêng cho tool local (`readCommitment`), không cấp `readTool` MCP.
- [x] 3.5 Test: không approve thì không ghi; payload đổi sau preview thì bị từ chối; approval dùng lại lần hai thất bại; tool local vẫn chiếm hạn mức một-write-mỗi-lượt.

## 4. Tool commitment

- [x] 4.1 Định nghĩa `commitment_create` (schema outcome, next action, due, check-in, status) và preview builder tương ứng.
- [x] 4.2 Định nghĩa `commitment_update` với ownership gate theo profile và preview hiện giá trị trước/sau đọc từ record thật.
- [x] 4.3 Chặn `status: 'completed'` và mọi thao tác xoá ở tầng schema lẫn tầng thực thi.
- [x] 4.4 Wire registry vào composition root ở main process, chỉ khi `agentCommitmentToolsEnabled` bật.
- [x] 4.5 Ghi `commitment_mutation` với actor agent sau mutation thành công; test activity không chứa plaintext outcome/next action.
- [x] 4.6 Bổ sung hướng dẫn ngắn trong system prompt: chỉ đề xuất khi người dùng phát biểu cam kết có mốc thời gian.

## 5. Commitment context

- [x] 5.1 Thêm `commitments` vào `BuildContextInput`, dựng khối system riêng với header dữ-kiện-không-phải-chỉ-dẫn.
- [x] 5.2 Thêm `MAX_COMMITMENTS_IN_CONTEXT` và `COMMITMENT_CONTEXT_BUDGET_RATIO`; trả về số mục đã gửi/bị lược trong `BuiltContext`.
- [x] 5.3 Nạp commitment trong chat-controller (main process chọn, renderer không truyền id) và áp cổng provider ngoài như memory.
- [x] 5.4 Test: rỗng khi không có commitment phù hợp; lược khối cam kết trước lượt hiện tại khi cạn ngân sách; tắt setting thì không request nào chứa khối này.

## 6. UI

- [x] 6.1 Preview thao tác local trong ChatView: nhãn đích là dữ liệu trên máy, hiện mốc thời gian tuyệt đối.
- [x] 6.2 Nhãn nguồn tạo (bạn / Nexa đề xuất) trong Mục tiêu và filter actor trong Hoạt động.
- [x] 6.3 Hai công tắc mới trong Cài đặt, kèm mô tả rủi ro và trạng thái mặc định.
- [x] 6.4 Giữ responsive/accessibility ở 1280x860 và 620x720.

## 7. Verification

- [x] 7.1 Unit/integration cho registry local, preview builder, chuẩn hoá thời gian, context builder và ownership gate.
- [x] 7.2 E2E: chat đề xuất cam kết → xác nhận → xuất hiện trong Mục tiêu → tới hạn thì sinh check-in suggestion.
- [x] 7.3 `pnpm verify` xanh và cập nhật DESIGN.md nếu hợp đồng tool/context thay đổi.
