## 1. Package thuần `@nexa/daily-briefing`

- [x] 1.1 Dựng package (tsconfig, package.json, entry) theo khuôn `ba-kit`/`document-checklist`; không phụ thuộc DB, LLM hay MCP.
- [x] 1.2 Định nghĩa `BriefingInput`, `BriefingItem`, `BriefingGroup`, `BriefingSource` và enum lý do (`overdue`, `due_today`, `due_this_week`, `in_progress`, `check_in_due`).
- [x] 1.3 Viết hàm thuần `buildBriefing(input)`: chuẩn hoá commitment và issue về cùng một `BriefingItem`, gán nhóm theo ranh giới ngày địa phương, xếp thứ tự trong nhóm.
- [x] 1.4 Xếp issue thuộc sprint đang chạy lên trước trong nhóm `in_progress`.
- [x] 1.5 Test: bốn nhóm, commitment không mốc thời gian, `checkInAt` quá hạn, ranh giới ngày qua nhiều offset múi giờ, tính deterministic khi gọi hai lần, và trần số mục.

## 2. Contract và settings

- [x] 2.1 Thêm domain type bản tin vào `shared-types` và export cho renderer.
- [x] 2.2 Thêm `dailyBriefingEnabled` (mặc định bật) và `dailyBriefingSummaryEnabled` (mặc định tắt) vào `appSettingsSchema`.
- [x] 2.3 Thêm IPC schema `briefing:get` và `briefing:refresh` (không nhận JQL, không nhận filter tuỳ ý từ renderer).
- [x] 2.4 Test schema: renderer gửi thêm field lạ hoặc chuỗi JQL đều bị loại trước khi vào main.

## 3. Nguồn Jira read-only

- [x] 3.1 Viết bộ dựng JQL cố định trong main từ danh tính người dùng hiện tại; không có đường truyền JQL từ ngoài vào.
- [x] 3.2 Gọi `jira_search` qua `AtlassianMcpManager.callTool()` với `limit` trong trần tool và `toolTimeoutMs` hiện hành.
- [x] 3.3 Parse kết quả MCP bằng Zod: bỏ issue lỗi lẻ, nhưng payload không parse được thì trả trạng thái lỗi nguồn kèm lý do.
- [x] 3.4 Ánh xạ trạng thái nguồn: chưa cấu hình MCP, cờ `jiraSearch` tắt, không giải được người dùng, timeout, lỗi gateway — mỗi loại một lý do riêng và một hành động khôi phục.
- [x] 3.5 Test với mock MCP: thành công, vượt trần, payload rác, timeout, cờ tắt — và khẳng định không có tool WRITE nào được gọi.

## 4. Briefing service trong main

- [x] 4.1 Thêm `DailyBriefingService`: đọc commitment theo profile hiện tại, gọi nguồn Jira, ghép qua `buildBriefing`.
- [x] 4.2 Cache theo `profileId + ngày địa phương` trong bộ nhớ tiến trình; `refresh` bỏ qua cache; đổi ngày thì dựng lại.
- [x] 4.3 Trả phần commitment ngay cả khi nguồn Jira lỗi hoặc còn đang chờ.
- [x] 4.4 Wire service vào `services.ts` và nối IPC handler có ownership gate theo profile.
- [x] 4.5 Log chỉ id/enum/số đếm/thời lượng; test khẳng định không có tiêu đề issue hay nội dung cam kết trong log.
- [x] 4.6 Test: bind profile, cache hit/miss, sang ngày mới, và bản tin không sinh check-in hay mutation commitment nào.

## 5. Tóm tắt LLM tuỳ chọn

- [x] 5.1 Thêm job tóm tắt bounded trong main: nhận danh sách mục đã chốt, đọc lại đúng một chuỗi.
- [x] 5.2 Áp cổng chia sẻ với provider ngoài giống `commitmentContextEnabled`, lọc ngay trước khi gọi model.
- [x] 5.3 Lỗi, timeout, chuỗi rỗng hoặc quá dài ⇒ trả bản tin không kèm tóm tắt, không làm hỏng bản tin.
- [x] 5.4 Test: cờ tắt thì không có lời gọi model nào; model trả nội dung thừa cũng không đổi được danh sách mục.

## 6. Bridge và UI

- [x] 6.1 Expose `api.briefing.get/refresh` qua preload bridge có kiểu chặt.
- [x] 6.2 Dựng phần bản tin ở đầu `TodayView`: bốn nhóm, lý do theo ngày/trạng thái, thời điểm lấy dữ liệu, nút làm mới.
- [x] 6.3 Phủ đủ trạng thái: loading, empty, lỗi từng nguồn, chưa kết nối Jira, bị chính sách khoá.
- [x] 6.4 Nêu rõ phạm vi nguồn và việc bản tin chưa gồm lịch họp.
- [x] 6.5 Thêm toggle bản tin và toggle tóm tắt vào Settings, có mô tả nói rõ cái nào gửi dữ liệu cho model.
- [x] 6.6 Test renderer cho helper nhóm/nhãn và cho các trạng thái nguồn.

## 7. Verification

- [x] 7.1 Kiểm tra a11y: heading, live region cho tải bất đồng bộ, điều hướng bàn phím đủ cho nút làm mới.
- [x] 7.2 E2E Electron: mở Today thấy bản tin từ commitment khi không có Jira, rồi có Jira qua mock MCP.
- [x] 7.3 Chạy `pnpm verify`, build và E2E; chụp screenshot Today ở bề rộng mặc định và hẹp.
- [x] 7.4 Cập nhật README/DESIGN.md phần bề mặt Today và ghi câu hỏi còn mở vào `docs/OPEN-QUESTIONS.md`.
