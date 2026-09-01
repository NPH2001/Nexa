## Why

Today đã hiển thị commitment và check-in, nhưng người dùng mở máy buổi sáng vẫn phải tự ghép ba
nguồn mới biết hôm nay cần làm gì: cam kết cục bộ trong Nexa, việc được giao trên Jira, và những
mốc đã quá hạn từ hôm qua. Không có mặt phẳng nào trả lời được một câu duy nhất — "hôm nay tôi
phải làm gì trước" — nên Today hiện là một danh sách để đọc, không phải một bản tin để hành động.

Change này thêm **Bản tin công việc cá nhân**: một bản tổng hợp có mốc thời gian, dựng bằng code
thuần từ commitment cục bộ và issue Jira được giao, kèm một đoạn dẫn do model viết mà không được
thêm hay bớt bất kỳ mục nào.

## What Changes

- Thêm bản tin theo ngày, dựng deterministic từ hai nguồn: commitment `active`/`blocked` và issue
  Jira được giao cho người dùng hiện tại.
- Chia bản tin thành các nhóm cố định theo mức khẩn: **quá hạn**, **đến hạn hôm nay**, **cần chú ý
  trong 7 ngày**, và **đang làm không có mốc**. Mỗi mục nêu rõ lý do bằng ngày/trạng thái, không
  bằng điểm ưu tiên mờ.
- Thêm khối Jira read-only: gọi `jira_search` bằng JQL do code dựng (không phải model dựng), giới
  hạn số issue, và tự ẩn khối khi MCP chưa kết nối hoặc `jiraSearch` bị tắt — thiếu Jira không bao
  giờ làm hỏng phần commitment.
- Thêm tóm tắt LLM **tuỳ chọn, mặc định tắt**: model chỉ nhận danh sách mục đã chốt và chỉ được
  trả về một đoạn văn ngắn. Đoạn văn không thể thêm, bớt, đổi thứ tự hay đổi hạn của mục nào; bản
  tin vẫn hiển thị đầy đủ khi model lỗi hoặc bị từ chối.
- Thêm cache bản tin theo ngày/profile để mở lại app trong cùng buổi sáng không gọi lại Jira; làm
  mới là một hành động tường minh của người dùng.
- Thêm setting `dailyBriefingEnabled` (mặc định bật, chỉ dữ liệu cục bộ) và
  `dailyBriefingSummaryEnabled` (mặc định tắt, mới là cái gọi model).
- **KHÔNG** có lịch họp trong v1: Nexa chưa có calendar connector nào được duyệt (DESIGN.md "Open
  questions"). Bản tin phải nói rõ nó không biết lịch họp, thay vì im lặng để người dùng tưởng đã
  đủ.
- **KHÔNG** có thông báo nền hay thông báo OS: bản tin chỉ dựng khi app đang mở, giữ nguyên ranh
  giới của proactive check-in.

## Capabilities

### New Capabilities
- `daily-briefing`: dựng, nhóm, cache và làm mới bản tin công việc theo ngày từ các nguồn cục bộ và
  Jira read-only; quy tắc tóm tắt LLM không được đổi nội dung; hành vi khi thiếu nguồn.

### Modified Capabilities
<!-- Không có. `commitments` và `proactive-check-ins` chỉ được ĐỌC; bản tin không tạo, sửa hay
     hoàn thành commitment, và không sinh check-in suggestion. -->

## Impact

- **Code:** `packages/shared-types` (domain + IPC + settings), package thuần mới cho logic nhóm/
  xếp hạng, `apps/desktop/src/main` (briefing service, IPC), preload bridge, `TodayView` và
  Settings.
- **Data:** không thêm bảng chứa nội dung Jira. Cache bản tin nằm trong bộ nhớ tiến trình và mất
  khi đóng app; không có ciphertext mới, không có migration.
- **Mạng:** chỉ đi qua MCP manager sẵn có bằng tool READ đã có trong registry; không thêm endpoint,
  không thêm credential.
- **Privacy:** tóm tắt LLM đi qua đúng cổng chia sẻ hiện có — nội dung commitment bị giữ lại với
  provider ngoài như `commitmentContextEnabled` đang làm; log chỉ chứa id, enum và số đếm.
- **Agency:** bản tin là bề mặt chỉ đọc. Không transition issue, không comment, không ghi
  commitment, nên không có đường nào chạm Confirmation Guard.
- **Dependencies:** không thêm package.
