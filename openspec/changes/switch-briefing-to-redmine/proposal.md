## Why

Tổ chức đang quản lý việc hằng ngày trên Redmine, không còn dùng Jira cho việc cá nhân. Bản tin "Hôm nay" (change `add-daily-briefing`) vẫn lấy việc được giao từ Jira nên hiện không phản ánh việc thật của người dùng. Redmine đã có kết nối và tool đọc (`add-redmine-xwiki-connectors`), nên đổi nguồn là hợp lý ngay bây giờ.

## What Changes

- Bản tin lấy issue được giao cho người dùng từ **Redmine** thay cho Jira. Jira không còn là nguồn của bản tin.
- Dùng tool READ `redmine_search_issues` với bộ lọc do code dựng (`assigned_to_id='me'`, trạng thái mở, sắp theo hạn). Không có tham số nào đến từ renderer hay model.
- Nguồn bản tin đổi tên `jira` → `redmine` trong kiểu dùng chung, id mục (`redmine:<id>`), nhãn giao diện và tóm tắt.
- Cờ chính sách dùng `redmineRead` thay cho `jiraSearch`.
- Mã tham chiếu hiện dạng `#123`, liên kết mở issue trên Redmine (`<baseUrl>/issues/123`).
- **BREAKING (nội bộ)**: bỏ `inActiveSprint` khỏi mô hình bản tin. Redmine không có khái niệm sprint nên trường này luôn sai; giữ lại là code chết. Thứ tự trong nhóm "đang làm" còn: có hạn gần trước, rồi mới cập nhật gần đây.
- Không đổi: nhóm theo mức khẩn, cam kết cục bộ, tóm tắt LLM tuỳ chọn, cache theo ngày.

## Capabilities

### New Capabilities
<!-- Không có. -->

### Modified Capabilities
- `daily-briefing`: nguồn issue chuyển từ Jira sang Redmine (khối nguồn, thiếu nguồn, phạm vi nêu trong bản tin, cache); bỏ tín hiệu sprint khỏi thứ tự nhóm "đang làm".

## Impact

- `packages/daily-briefing`: `model.ts`, `build.ts` (+ test).
- `packages/shared-types`: `domain.ts` (`BriefingSourceName`, `inActiveSprint`).
- Main: `briefing-jira.ts` → `briefing-redmine.ts`, `briefing-service.ts`, `briefing-summary.ts`, `services.ts` (+ test).
- Renderer: `briefing-ui.ts`, `TodayView.tsx` (+ test).
- Phụ thuộc: kết nối `redmine` và `mcpGateway` (ADR 0010). Chưa cấu hình thì bản tin báo "chưa kết nối Redmine", không làm hỏng phần cam kết.
