## 1. Kiểu và cấu hình

- [x] 1.1 Thêm `toolScoping: z.boolean().default(true)` vào `featureFlagsSchema` trong `packages/shared-types/src/settings.ts`, kèm comment giải thích mục đích và cách IT khoá qua `policy.json`
- [x] 1.2 Thêm kiểu `ToolPreset` (union 6 nhãn: `jira-read`, `jira-full`, `confluence-read`, `confluence-full`, `all-read`, `all`) và bảng ánh xạ preset → danh sách `keyof FeatureFlags` vào `packages/shared-types` (cạnh `tools.ts`)
- [x] 1.3 Thêm test khẳng định bảng ánh xạ **phủ trọn** 12 feature flag tool: hợp của tất cả nhóm trong preset `all` bằng đúng tập cờ tool hiện có — test này sẽ đỏ nếu ai đó thêm cờ tool mới mà quên cập nhật preset
- [x] 1.4 Xác nhận `policy.json` khoá được cờ mới bằng cùng cơ chế như các cờ hiện có (đọc `connection-config` / nơi merge policy, thêm test nếu chưa có)

## 2. Bộ chọn preset

- [x] 2.1 Tạo module mới `packages/agent-runtime/src/tool-preset-selector.ts` với một hàm thuần `selectPreset(question: string): ToolPreset` — không I/O, không phụ thuộc `deps`
- [x] 2.2 Cài chuẩn hoá đầu vào: hạ chữ thường + bỏ dấu tiếng Việt; giữ chuỗi gốc riêng để khớp mẫu issue key phân biệt chữ hoa
- [x] 2.3 Cài trục hệ đích: từ khoá Jira (`jira`, `issue`, `ticket`, `sprint`, `backlog`, `epic`, `bug`) + mẫu `[A-Z]{2,10}-\d+` trên chuỗi gốc; từ khoá Confluence (`confluence`, `wiki`, `space`, `trang`, `tai lieu`)
- [x] 2.4 Cài trục ý định: từ khoá write (`tao`, `sua`, `cap nhat`, `xoa`, `chuyen`, `gan`, `dong`, `them`, `comment`, `binh luan`, `create`, `update`, `delete`, `move`, `assign`) — không chắc thì trả về nhánh read (D6)
- [x] 2.5 Cài bảng quyết định hai trục → 6 preset, với không-tín-hiệu → `all-read` (D3)
- [x] 2.6 Viết `tool-preset-selector.test.ts`: mỗi ô của bảng quyết định một test, cộng ca biên — không dấu, tiếng Anh trộn tiếng Việt, chuỗi rỗng, câu hỏi chỉ có issue key, chuỗi khớp nhầm mẫu key (`UTF-8`), câu hỏi nhắc cả hai hệ
- [x] 2.7 Thêm test khẳng định tính xác định: gọi 100 lần cùng một câu hỏi cho cùng kết quả

## 3. Lọc trong `buildToolSpecs`

- [x] 3.1 Đổi `buildToolSpecs()` trong `packages/agent-runtime/src/agent-runtime.ts` để nhận `preset: ToolPreset` và lọc `mcp.availableTools()` theo tập cờ của preset — lọc **sau** `availableTools()`, không sửa `atlassian-mcp-manager`
- [x] 3.2 Thêm sort ổn định theo `name` trước khi map sang `ChatToolSpec`, áp dụng cho **cả** nhánh cờ tắt
- [x] 3.3 Trong `runTurn`: lấy message `role === 'user'` cuối cùng của `input.history`, gọi `selectPreset`, và bỏ qua bộ chọn (dùng `all`) khi `toolScoping` tắt
- [x] 3.4 Đổi `const tools` thành biến gán lại được để vòng lặp thay được giữa các vòng (chuẩn bị cho nhóm 4)
- [x] 3.5 Test: câu hỏi Jira-read chỉ sinh tool `jiraRead`/`jiraSearch`; câu hỏi Confluence-write chỉ sinh tool Confluence; không-tín-hiệu sinh `all-read` — dùng hook `h.llm.requests[0].tools` đã có ở `agent-runtime.test.ts:530`
- [x] 3.6 Test khẳng định prefix ổn định: hai câu hỏi khác nhau cùng preset sinh khối `tools` giống nhau từng phần tử, cùng thứ tự
- [x] 3.7 Test khẳng định preset không nới quyền: tắt một feature flag, tool đó không xuất hiện dù preset chứa nhóm của nó

## 4. Đường mở rộng danh mục

- [x] 4.1 Định nghĩa hằng tên tool meta `nexa_mo_rong_tool` và `ChatToolSpec` của nó (không tham số), kèm mô tả mệnh lệnh yêu cầu model gọi ngay khi không thấy tool phù hợp và không nói với người dùng là không làm được
- [x] 4.2 Đưa tool meta vào khối `tools` cho mọi preset trừ `all`, và không đưa vào khi `toolScoping` tắt
- [x] 4.3 Trong vòng lặp `runTurn`, chặn lời gọi có tên meta **trước** khi tới `executeToolCall`; xây tool result là danh sách tên + mô tả ngắn của tool khả dụng; đẩy vào `messages` bằng `toolResultMessage`
- [x] 4.4 Sau khi xử lý, đặt lại biến `tools` thành preset `all` cho các vòng còn lại của lượt
- [x] 4.5 Xử lý trường hợp MCP chưa sẵn sàng: trả tool result nói rõ không có tool nào khả dụng, lượt vẫn tiếp tục
- [x] 4.6 Bảo đảm lời gọi meta không tăng `writesThisTurn`, không gọi `input.toolCalls.begin()`, không tạo `operation_id`, không đẩy `requestConfirmation`
- [x] 4.7 Bảo đảm lời gọi meta vẫn tính vào `toolCallCount` và vào hạn mức `maxToolIterations` như một vòng bình thường
- [x] 4.8 Thêm một câu vào `DEFAULT_SYSTEM_PROMPT` (`packages/agent-runtime/src/context-builder.ts`) nói rõ danh mục tool có thể đang bị thu hẹp và cách yêu cầu mở rộng
- [x] 4.9 Test: model gọi meta ở vòng 1 ⇒ `requests[1].tools` chứa toàn bộ tool khả dụng
- [x] 4.10 Test: không có lời gọi nào tới MCP mock cho tên meta; `findTool(meta)` trả `null`; `resolveCallable(meta)` vẫn ném `TOOL_NOT_ALLOWED`
- [x] 4.11 Test: không có `requestConfirmation` nào được gọi, không bản ghi `ToolCallSink` nào được tạo cho lời gọi meta
- [x] 4.12 Test: gọi meta hai lần trong một lượt không ném lỗi
- [x] 4.13 Test: sau khi mở rộng, model gọi một tool write ngoài preset ban đầu ⇒ vẫn đi qua preview + xác nhận đầy đủ
- [x] 4.14 Test: lượt sau khi đã mở rộng quay về preset theo câu hỏi mới (không nhớ trạng thái mở rộng)

## 5. Số liệu và log

- [x] 5.1 Thêm sự kiện log trong `runTurn` ghi `preset`, `toolCount`, và `expanded` (boolean) qua logger của `packages/observability`
- [x] 5.2 Kiểm tra sự kiện mới không mang trường bị cấm log theo `docs/security/threat-model.md`; không ghi câu hỏi, không ghi từ khoá đã khớp
- [x] 5.3 Test khẳng định log không chứa nội dung câu hỏi: chạy một lượt với câu hỏi có chuỗi đánh dấu riêng, khẳng định chuỗi đó không xuất hiện trong log đã thu

## 6. Tài liệu

- [x] 6.1 Viết `docs/architecture/adr/0009-tool-preset-scoping.md`: quyết định bộ chọn xác định thay vì router bằng model, và **ràng buộc preset phải cố định** để giữ prefix ổn định cho prompt caching — ghi rõ đây là lý do không được làm preset động về sau
- [x] 6.2 Thêm mục vào `docs/OPEN-QUESTIONS.md` cho các câu hỏi còn mở ở `design.md`: ngưỡng chấp nhận của bộ chọn, mở rộng có nên nhớ theo hội thoại, `jiraServiceDesk` có nên tách preset
- [x] 6.3 Cập nhật `README.md`: thêm dòng vào phần cấu hình vận hành nói về cờ `toolScoping` và cách tắt qua `policy.json`
- [x] 6.4 Cập nhật `docs/RUNBOOK.md`: cách đọc số liệu preset/expanded khi điều tra "trợ lý nói không có công cụ phù hợp"

## 7. Xác minh

- [x] 7.1 `pnpm verify` sạch (lint + typecheck + test)
- [x] 7.2 Chạy `pnpm dev` với mock MCP, gửi một câu hỏi Jira-read và một câu hỏi Confluence-write, đối chiếu log preset và số tool với con số dự kiến trong `design.md` (33 và 35)
- [x] 7.3 Đo token thật của khối `tools` trước/sau bằng một câu hỏi giống nhau ở hai trạng thái cờ, ghi số đo vào ADR 0009
- [ ] 7.4 Kiểm tra bằng tay đường mở rộng: hỏi một câu Jira-read nhưng yêu cầu tạo issue giữa lượt, xác nhận model gọi meta và hoàn tất được việc
      - **CHƯA LÀM ĐƯỢC — chặn bởi OPEN-QUESTIONS C2.** Task này cần một model thật tự *quyết định*
        gọi `nexa_mo_rong_tool`. Nexa chưa có kết nối LiteLLM thật (mới chạy với mock server), và
        mock LLM phát lại kịch bản cố định nên không kiểm tra được quyết định của model.
      - Cơ chế đã được phủ bằng test: `agent-runtime.test.ts` khẳng định khi model *có* gọi meta
        thì vòng sau nhận đủ 98 tool và tool write sau đó vẫn đi qua preview + xác nhận đầy đủ.
      - Phần **chưa** kiểm chứng được là xác suất model thật sự gọi nó. Đó chính là rủi ro
        OPEN-QUESTIONS H1, và chỉ đo được ở pilot bằng tỉ lệ `expanded` trong log.
