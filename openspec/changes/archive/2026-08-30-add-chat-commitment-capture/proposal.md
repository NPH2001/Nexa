## Why

Commitment Engine và proactive check-in đã chạy, nhưng hai đầu của vòng lặp vẫn đứt: người dùng nói
kế hoạch và hạn chót trong chat rồi phải tự gõ lại vào màn hình Mục tiêu, còn model thì không hề
biết người dùng đang nợ việc gì nên không thể nhắc hay đề xuất bước tiếp theo. Kết quả là Nexa nhớ
được ngữ cảnh nhưng không nối được ngữ cảnh đó với công việc đang treo.

Change này nối hai đầu: agent được phép **đề xuất** tạo/cập nhật commitment ngay trong hội thoại
(người dùng vẫn bấm xác nhận như mọi thao tác ghi), và commitment đang hoạt động được nạp vào
context để câu trả lời bám đúng việc đang làm.

## What Changes

- Thêm nhóm tool cục bộ `commitment_create` và `commitment_update` cho agent, chạy trong main
  process, không đi qua MCP và khả dụng ngay cả khi chưa kết nối Atlassian.
- Hai tool này mang risk `WRITE_LOW` và đi qua đúng Confirmation Guard hiện có: preview → người
  dùng xác nhận → consume approval → ghi DB. Không có đường tắt tự ghi.
- **BREAKING (type-level):** mở rộng `ToolPreview.targetSystem` từ `'jira' | 'confluence'` sang
  thêm `'local'` để preview mô tả được thao tác trên dữ liệu máy người dùng; mọi nơi switch trên
  union này phải xử lý nhánh mới.
- Preview commitment hiển thị outcome, next action, status, due/check-in đã chuẩn hoá sang giờ máy
  và conversation nguồn; với update thì hiện giá trị trước/sau lấy từ record thật.
- Thêm chuẩn hoá mốc thời gian tương đối tiếng Việt ("thứ 6 tuần sau", "cuối tháng", "3 ngày nữa")
  thành ISO trong main process, dựa trên giờ hệ thống; model chỉ truyền chuỗi mô tả hoặc ISO.
- Nạp commitment `active`/`blocked` vào context model như một khối system riêng, tách khỏi khối
  memory, có trần số lượng và trần token riêng.
- Ghi `commitment_mutation` vào activity timeline với `actor` phân biệt người dùng và agent, giữ
  nguyên nguyên tắc không lưu plaintext title trong activity row.
- Thêm opt-in `agentCommitmentToolsEnabled` (mặc định **tắt**) và `commitmentContextEnabled`
  (mặc định **bật** khi có commitment) trong settings đã mã hoá theo profile.
- Không thêm tool xoá commitment, không cho agent đổi `status` sang `completed` mà không có xác
  nhận, và không tự tạo commitment khi người dùng chưa duyệt.

## Capabilities

### New Capabilities

- `chat-commitment-capture`: agent đề xuất tạo/cập nhật commitment từ hội thoại qua tool cục bộ có
  preview và confirmation, gồm cả chuẩn hoá mốc thời gian tương đối và ghi activity.
- `commitment-context`: nạp commitment đang hoạt động vào context model với ngân sách token riêng,
  chính sách provider ngoài và giới hạn số lượng.

### Modified Capabilities

- `commitments`: nới ràng buộc "SHALL NOT tự động chuyển chat thành commitment" thành "chỉ được tạo
  sau một xác nhận tường minh của người dùng, kể cả khi đề xuất bắt nguồn từ chat"; bổ sung yêu cầu
  phân biệt nguồn tạo (người dùng thao tác tay hay agent đề xuất).

## Impact

- **Code:** `packages/agent-runtime` (registry tool cục bộ, preview builder, context-builder),
  `packages/shared-types` (ToolPreview, settings, activity actor), `packages/local-store`
  (repository đọc commitment cho context, cột nguồn tạo), `apps/desktop/src/main`
  (chat-controller nạp commitment, wiring tool cục bộ), renderer (nhãn preview cho thao tác local).
- **Data:** migration v8 thêm cột `created_by` cho `commitments` và cột actor cho `local_audit`;
  không backfill nội dung nhạy cảm, record cũ mặc định `user`.
- **Privacy:** title/next action của commitment sẽ được gửi tới model khi context bật; với provider
  ngoài phải áp cùng chính sách chia sẻ như memory và cho phép tắt riêng.
- **Agency:** agent chỉ đề xuất; mọi ghi đều qua Confirmation Guard hiện có và giữ bất biến
  approval một lần, gắn payload hash.
- **Dependencies:** không thêm package.
