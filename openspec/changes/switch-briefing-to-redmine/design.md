## Context

`briefing-jira.ts` gọi `jira_search` qua `AtlassianMcpManager` với JQL cố định. Redmine đi qua `RemoteMcpServer` (`services.redmine`) và cổng `resolveCallable` kiểm cờ `redmineRead`, nên mọi lỗi cấu hình/chính sách đã có mã lỗi sẵn.

## Goals / Non-Goals

**Goals:**
- Thay nguồn issue của bản tin bằng Redmine, giữ nguyên các bất biến cũ: code dựng truy vấn, chỉ đọc, có trần, thiếu nguồn không làm hỏng bản tin.

**Non-Goals:**
- Không giữ Jira làm nguồn dự phòng hay song song. Người dùng đã nói không lấy theo Jira nữa (YAGNI).
- Không thêm lọc theo dự án/tracker, không phân trang quá trần.
- Không đổi ADR 0010 hay cách dựng server Redmine.

## Decisions

- **Đổi tên nguồn, không thêm nguồn thứ ba.** `BRIEFING_SOURCES` thành `['commitment', 'redmine']`. Cache RAM theo ngày nên không có dữ liệu cũ cần migrate.
- **Truy vấn:** `redmine_search_issues` với `assigned_to_id='me'`, `status='open'`, `sort='due_date:asc'`, `limit=50`. `status='open'` là loại trừ phía server nên không cần hai điều kiện như JQL cũ. Trần 50 giữ nguyên bản tin cũ; tool cho tối đa 100.
- **Đọc payload:** `{ total_count, issues: [{ id, subject, status: { name }, due_date, updated_on }] }`. Bỏ qua từng issue hỏng; payload không parse được thì ném lỗi để không biến "gateway trả HTML lỗi" thành "hôm nay không có việc". Cách xử lý này giữ nguyên từ bản Jira.
- **Ngày hạn:** `due_date` dạng `YYYY-MM-DD` neo giữa trưa UTC, cùng lý do ranh giới ngày như trước.
- **Khoá và liên kết:** `key` là `#<id>`; URL dựng bằng `redmineIssueUrl` từ `baseUrl` của kết nối `redmine`.
- **Phụ thuộc vào service:** `DailyBriefingService` nhận `redmine: () => McpToolSource-like | null` qua closure (giống `mcp` trước đây), vì server Redmine bị dựng lại khi đổi kết nối.
- **Bỏ `inActiveSprint`:** xoá khỏi model, build, shared-types, view. Phương án giữ trường luôn `false` bị loại vì là code chết.
- **Ánh xạ lỗi sang trạng thái nguồn:** giữ bảng cũ, thêm `REDMINE_AUTH_FAILED` → `unauthenticated` và `REDMINE_GATEWAY_REQUIRED` → `not_configured`.

## Risks / Trade-offs

- [Chưa có payload `search_issues` thật cho trường hợp có/không có `due_date`] → parser chấp nhận thiếu `due_date`/`updated_on`; cần chạy thử thật (task 5.2) trước khi coi là xong.
- [Người dùng còn việc trên Jira sẽ không thấy trong Hôm nay] → đây là quyết định của người dùng; nói rõ phạm vi trong dòng chú thích của bản tin.
- [Quyền xem issue phụ thuộc API key Redmine] → lỗi 403 hiện ở trạng thái nguồn, không làm hỏng cam kết.

## Migration Plan

Không có dữ liệu lưu trữ. Rollback là revert commit. Cờ `jiraSearch` giữ nguyên cho chat, chỉ bản tin thôi dùng nó.

## Open Questions

- Có cần giới hạn theo dự án nếu người dùng thuộc nhiều dự án Redmine? Chưa; làm khi có nhu cầu thật.
