## Context

Nexa đã có đủ mảnh ghép nhưng chưa ghép: `CommitmentRepository` giữ cam kết đã mã hoá kèm
`dueAt`/`checkInAt`; `AtlassianMcpManager.callTool()` gọi được tool Jira READ mà không phải đi qua
Confirmation Guard (guard chỉ chặn WRITE); `TodayView` đã sắp xếp commitment bằng
`sortCommitmentsForToday`. Cái còn thiếu là một tầng tổng hợp trả lời "hôm nay làm gì trước".

Ba ràng buộc định hình thiết kế này:

1. **Không có calendar connector.** DESIGN.md để ngỏ câu hỏi "Calendar/Tasks connector nào trước".
   v1 vì thế không có lịch họp, và phải nói ra điều đó.
2. **Model không được cầm quyết định.** Repo đã có lập trường này ở BA review ("a model is used at
   exactly one point in review, and it never rules"). Bản tin đi theo đúng khuôn đó.
3. **Không có tiến trình nền.** Check-in engine chỉ chạy khi app mở. Bản tin cũng vậy: nó là thứ
   dựng khi người dùng mở Today, không phải thứ chạy lúc 7 giờ sáng.

## Goals / Non-Goals

**Goals:**

- Một mặt phẳng duy nhất trên Today trả lời được "hôm nay cần làm gì trước", ghép cam kết cục bộ và
  việc Jira được giao.
- Kết quả deterministic: cùng dữ liệu vào, cùng mốc thời gian ⇒ cùng danh sách, cùng thứ tự.
- Hỏng một nguồn không làm hỏng bản tin, và không bao giờ trình bày lỗi thành "không có việc nào".
- Không thêm bảng, không thêm migration, không thêm credential, không thêm package npm.

**Non-Goals:**

- Lịch họp, connector calendar, và mọi thứ suy ra từ lịch (tách thành change riêng sau khi ATTT
  duyệt nguồn).
- Thông báo OS hoặc dựng bản tin khi app đóng.
- Hành động ngay trong bản tin (transition issue, comment, hoàn thành cam kết). v1 là bề mặt chỉ
  đọc; mọi hành động vẫn đi qua Goals hoặc chat như hiện nay.
- Điểm ưu tiên do model chấm, hay bất kỳ thứ hạng nào người dùng không tự giải thích được.
- Nguồn thứ ba (mail, Confluence deadline) và việc định kỳ tự khai báo.

## Decisions

### 1. Logic nhóm nằm trong một package thuần `@nexa/daily-briefing`

Đi theo đúng đường `ba-kit` và `document-checklist`: package không biết SQLite, không biết LLM,
không biết MCP. Nó nhận một `BriefingInput` (danh sách commitment đã giải mã + danh sách issue đã
chuẩn hoá + `now` + timezone offset) và trả về `Briefing` đã nhóm, đã xếp thứ tự.

Vì sao không nhét thẳng vào `TodayView` như `sortCommitmentsForToday` hiện tại: hàm đó chỉ sắp xếp
một danh sách thuần cục bộ. Ở đây có ranh giới ngày địa phương, hai nguồn khác nhau và bốn nhóm —
đủ nhiều luật để đáng được test riêng, không cần dựng Electron.

**Đã cân nhắc:** để logic trong main process. Bỏ vì test nhóm/ranh giới ngày sẽ phải kéo theo
service, repository và mock MCP.

### 2. Bốn nhóm cố định, không có điểm số

`overdue` → `due_today` → `due_this_week` → `in_progress`. Trong mỗi nhóm: mốc thời gian sớm nhất
trước, rồi tới `updatedAt` mới nhất. Mỗi mục mang một `reason` có cấu trúc (enum + timestamp) để
renderer tự dựng câu tiếng Việt, thay vì main gửi sẵn câu chữ.

Vì sao: DESIGN.md đã chốt "Every surfaced commitment explains urgency through its status/date
instead of an opaque score". Một điểm ưu tiên 0–100 sẽ là thứ người dùng không kiểm chứng được.

**Đã cân nhắc:** một danh sách phẳng xếp theo điểm. Bỏ vì mất khả năng giải thích.

### 3. Ranh giới ngày tính theo giờ máy, và `now` là tham số

Nhóm được tính so với đầu ngày địa phương, không phải theo UTC — "quá hạn hôm qua" phải đúng với
cái người dùng thấy trên đồng hồ. `now` và timezone offset được tiêm vào, đúng như
`ProactiveCheckInService` đang nhận `now?: () => Date`, để test không phụ thuộc lúc chạy.

### 4. Jira: đúng một lời gọi `jira_search`, JQL do code dựng

Main dựng JQL cố định dạng `assignee = currentUser() AND resolution = EMPTY ORDER BY duedate ASC`
với `limit` trong trần của tool (tối đa 50). Người dùng không nhập JQL, model không sinh JQL,
renderer gửi JQL cũng bị bỏ qua.

Vì sao một lời gọi: `jira_get_issue_dates`/`jira_get_issue_sla` là per-issue, N issue thành N lời
gọi và biến việc mở Today thành một cơn bão request. `jira_search` đã trả về đủ key, summary,
status, assignee và due date cho một bản tin.

Vì sao không đi qua vòng lặp agent: bản tin không phải một lượt chat. `manager.callTool()` là API
sẵn có, tool là READ nên không chạm Confirmation Guard, và không có model nào ở giữa để bịa tên
tool. Cờ `jiraSearch` vẫn là cổng quyền duy nhất — tắt cờ thì `resolveCallable` từ chối, và khối
Jira báo "bị chính sách tắt", không phải "không có việc".

**Đã cân nhắc:** để người dùng tự cấu hình JQL. Hoãn sang v2 — nó thêm một bề mặt cấu hình và một
đường để nhập chuỗi tuỳ ý vào tool, đổi lại rất ít cho bản tin đầu tiên.

### 5. Kết quả MCP được parse có schema, hình dạng lạ là lỗi nguồn chứ không phải rỗng

Output của `mcp-atlassian` là JSON string trong content block. Main parse rồi validate bằng Zod,
bỏ qua từng issue không hợp lệ, nhưng nếu **toàn bộ** payload không parse được thì khối Jira vào
trạng thái lỗi. Đây là điểm dễ sai nhất: một parser dễ dãi sẽ biến "gateway trả HTML lỗi" thành
"hôm nay bạn không có việc gì" — đúng loại im lặng nguy hiểm mà spec cấm.

### 6. Cache trong bộ nhớ tiến trình, khoá theo `profileId + ngày địa phương`

Không có bảng mới, không có migration, và quan trọng hơn: **không có bản sao nội dung Jira nằm lại
trên đĩa**. Cùng lập trường với bank checklist ("source files and raw extracted text are transient
and never copied into SQLite").

Đánh đổi: đóng app là mất cache, mở lại sáng hôm sau gọi Jira một lần. Chấp nhận được — một lời gọi
`jira_search` mỗi ngày.

### 7. Tóm tắt: một lần gọi model, đọc lại đúng một chuỗi

`dailyBriefingSummaryEnabled` mặc định **tắt**. Khi bật, main gửi danh sách mục **đã chốt** và đọc
lại đúng một chuỗi văn bản; không có schema nào cho phép model trả về mục, thứ tự hay ngày. Kết
quả rỗng, quá dài, timeout hay lỗi ⇒ bản tin hiển thị không kèm tóm tắt, không phải bản tin lỗi.

Với provider ngoài, nội dung cam kết bị giữ lại đúng như cổng `commitmentContextEnabled` đang làm —
lọc lần cuối ngay trước khi gọi model, không phải ở tầng UI.

**Đã cân nhắc:** để model tự tổng hợp cả bản tin. Bỏ dứt khoát: một model bỏ sót việc quá hạn thì
người dùng không có cách nào biết là nó đã bỏ sót.

### 8. Bản tin nằm trên Today, không phải một đích điều hướng mới

DESIGN.md dặn "do not expose an empty destination before its core flow works". Bản tin thay thế
phần tổng quan hiện tại ở đầu Today; check-in card giữ nguyên vị trí và ngữ nghĩa. Không thêm mục
sidebar.

### 9. Hai cờ, tách theo mức rủi ro

- `dailyBriefingEnabled` (mặc định **bật**): chỉ đọc dữ liệu cục bộ và một tool READ đã được cấp
  quyền — không mở quyền mới nào.
- `dailyBriefingSummaryEnabled` (mặc định **tắt**): đây mới là cái gửi dữ liệu cho model, nên nó
  theo lập trường opt-in của `proactiveCheckInsEnabled`.

Cả hai nằm trong `appSettingsSchema`; phần cần IT khoá toàn tổ chức thì thêm vào `features` để
`forcedFeatures` trong `policy.json` với tới được.

## Risks / Trade-offs

- **`currentUser()` không giải được trên Jira Server/DC với PAT** → khối Jira báo lỗi kèm lý do từ
  gateway và một nút thử lại; phần commitment không bị ảnh hưởng. Nếu hạ tầng thật gặp, v2 sẽ
  resolve `accountId` một lần qua `jira_get_user_profile` rồi cache trong phiên.
- **Nhiều team không điền `duedate`** → gần như mọi issue rơi vào `in_progress` và bản tin loãng.
  Giảm nhẹ bằng cách xếp issue trong sprint đang chạy lên trước trong nhóm đó; nếu thực tế vẫn
  loãng thì v2 mới thêm JQL do người dùng cấu hình, chứ không đoán hộ.
- **Mở Today chậm vì chờ Jira** → dựng và render phần commitment trước, khối Jira tự điền vào sau;
  bản tin không bao giờ chờ mạng để hiện.
- **Tóm tắt tốn token mỗi sáng** → mặc định tắt, giới hạn số mục đưa vào prompt, và cache theo ngày
  nên nhiều nhất một lần gọi mỗi ngày mỗi profile.
- **Rò nội dung vào log** → log chỉ ghi id, enum, số đếm, thời lượng; áp cùng redactor hiện có.
  Test khẳng định không có tiêu đề issue nào lọt vào log.
- **Người dùng tưởng bản tin đã gồm lịch họp** → phạm vi nguồn được nêu thẳng trên bề mặt, và spec
  có requirement riêng cho nó.

## Migration Plan

Không có migration DB. Triển khai theo thứ tự: package thuần → shared types/settings → briefing
service + IPC trong main → bridge → Today UI → Settings toggle. Rollback là tắt
`dailyBriefingEnabled`: Today quay lại phần tổng quan cũ, không có dữ liệu nào phải dọn vì cache
chỉ nằm trong RAM.

## Open Questions

- [ ] Product owner: khi `duedate` trống rộng rãi, v2 nên cho người dùng cấu hình JQL, hay nên
      dùng sprint hiện tại làm hạn ngầm định? Ảnh hưởng: độ nhiễu của bản tin.
- [ ] Product owner: bản tin có nên hiện việc quá hạn quá N ngày một cách gọn lại (gộp thành một
      dòng) để nhóm `overdue` không nuốt cả màn hình không?
- [ ] Security owner: tóm tắt bản tin có được phép gửi tới provider ngoài khi người dùng đã bật
      chia sẻ, hay nên là LiteLLM-only như luồng chứng từ ngân hàng?
- [ ] IT/ATTT: calendar connector nào là nguồn lịch họp đầu tiên (DESIGN.md vẫn để ngỏ) — đây là
      thứ chặn phần "lịch họp buổi sáng" của yêu cầu gốc.
