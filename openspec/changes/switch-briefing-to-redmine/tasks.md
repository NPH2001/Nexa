## 1. Mô hình và dựng bản tin

- [x] 1.1 `packages/daily-briefing`: đổi nguồn `jira` → `redmine`, id mục `redmine:<key>`, bỏ `inActiveSprint` khỏi model và `compareInProgress`; cập nhật `build.test.ts`
- [x] 1.2 `shared-types/domain.ts`: `BriefingSourceName` thành `'commitment' | 'redmine'`, bỏ `inActiveSprint` khỏi view

## 2. Nguồn Redmine ở main process

- [x] 2.1 Thay `briefing-jira.ts` bằng `briefing-redmine.ts`: gọi `redmine_search_issues` với bộ lọc cố định, parse `issues`/`total_count`/`due_date`/`updated_on`, ném lỗi khi payload hỏng
- [x] 2.2 Ánh xạ lỗi sang trạng thái nguồn, gồm `REDMINE_AUTH_FAILED` và `REDMINE_GATEWAY_REQUIRED`
- [x] 2.3 Test `briefing-redmine.test.ts`: bộ lọc cố định, trần/`truncatedCount`, issue hỏng bị bỏ, payload hỏng ném lỗi, cờ tắt, chưa cấu hình, không log tiêu đề issue
- [x] 2.4 `briefing-service.ts` và `services.ts`: nhận server Redmine qua closure, URL issue từ `redmineIssueUrl` với `baseUrl` của kết nối `redmine`, cờ `redmineRead`; cập nhật `briefing-service.test.ts`
- [x] 2.5 `briefing-summary.ts`: nhãn nguồn Redmine
- [x] 2.6 Dọn cache bản tin khi lưu/xoá kết nối Redmine hoặc MCP Gateway (`ipc.ts`, có test trong `ipc.test.ts`)

## 3. Giao diện

- [x] 3.1 `briefing-ui.ts` và `TodayView.tsx`: nhãn "Redmine", nút "Kết nối Redmine" mở Cài đặt (như nút Jira trước đây; chưa nhảy thẳng tới mục Redmine), "Mở trên Redmine", chú thích phạm vi; cập nhật `briefing-ui.test.ts`

## 4. Dọn dẹp

- [x] 4.1 Xoá `briefing-jira.ts` và test cũ, rà lại không còn tham chiếu `jira` trong luồng bản tin (`grep`)
- [x] 4.2 Cập nhật `add-daily-briefing` (design/spec) hoặc ghi chú trỏ sang change này để hai tài liệu không mâu thuẫn

## 5. Kiểm chứng

- [x] 5.1 `pnpm verify` xanh (100 file, 1393 test)
- [x] 5.1b E2E `bản tin công việc cá nhân` viết lại với mock MCP Gateway (`tests/fixtures/mock-mcp-gateway-server.mjs`): kiểm ba header, bộ lọc cố định, mã #id, liên kết, chỉ đọc, và cache tự dọn khi lưu kết nối (35/35 E2E qua)
- [ ] 5.2 Chạy thử thật với Redmine: có issue quá hạn, đến hạn hôm nay, không có hạn; issue đã đóng không hiện

  Kịch bản (chuẩn bị 2026-11-19, **chưa chạy** — cần credential thật):

  1. Trên Redmine thật, giao cho chính tài khoản của API key 5 issue: **A** hạn hôm qua (mở), **B** hạn hôm nay (mở), **C** hạn sau 3 ngày (mở), **D** không có hạn (mở), **E** hạn hôm qua nhưng ở trạng thái đã đóng. Ghi lại số #id.
  2. Mở Nexa → Cài đặt: lưu MCP Gateway (URL + token), rồi Redmine (URL + API key); bấm "Kiểm tra kết nối" ở Redmine, phải thấy "đang dùng tài khoản …" đúng người.
  3. Vào Hôm nay → "Làm mới". Kỳ vọng: A ở "Quá hạn" (lý do "Quá hạn 1 ngày"), B ở "Đến hạn hôm nay", C ở "Trong 7 ngày tới", D ở "Đang làm"; **E không xuất hiện** (bộ lọc `status: 'open'`); mỗi mục có mã `#id` và "Mở trên Redmine" mở đúng `…/issues/<id>`.
  4. Đóng issue B trên Redmine → "Làm mới" ở Hôm nay → B biến mất.
  5. Xoá kết nối Redmine → bản tin báo nguồn Redmine chưa kết nối thay vì giữ dữ liệu cũ (cache đã dọn).
  6. Mở `logs/nexa.log`: không có tiêu đề issue, API key hay token gateway.
