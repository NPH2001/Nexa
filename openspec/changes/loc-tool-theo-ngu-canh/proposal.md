## Why

Mỗi lượt gọi model hiện gửi **toàn bộ 98 tool** kèm JSON Schema. `buildToolSpecs()` (`packages/agent-runtime/src/agent-runtime.ts`) map thẳng `mcp.availableTools()` không lọc gì, và khối `tools` này được truyền lại ở **mỗi vòng** của vòng lặp tool-calling (`maxToolIterations` mặc định 5).

Đo trực tiếp trên `buildToolRegistry()` — tức đúng những gì Nexa gửi đi: 98 tool = **42.642 ký tự ≈ 10.661 token mỗi vòng**. Một câu hỏi cần 3 vòng tốn ~32.000 token chỉ để mô tả tool, trước khi tính history, tài liệu, hay câu trả lời.

> **Hiệu chỉnh so với bản đề xuất đầu.** Bản đầu ghi ~29.900 token, lấy từ `mcp-atlassian-tools.json`. Con số đó là schema của **MCP server**, không phải của Nexa: `tool-registry/` có `jsonSchema` Nexa tự viết, chặt hơn khoảng ba lần. Tỉ lệ tiết kiệm không đổi (36–82%), nhưng con số tuyệt đối là ~5.000 token/vòng chứ không phải ~15.000. Xem ADR 0009.

Hệ quả có ba mặt: chi phí LiteLLM nhân theo số vòng của mọi request; độ trễ prefill tăng (người dùng chờ lâu hơn trước ký tự đầu tiên); và phần token đó bị chiếm khỏi context window đúng chỗ lẽ ra dành cho tài liệu PDF/DOCX mà `document-processor` trích xuất. Thêm vào đó, buộc model phân biệt 98 tool tên gần giống nhau (`jira_get_issue` / `jira_search` / `jira_search_fields`) làm giảm chất lượng chọn tool.

Vấn đề này sẽ nặng hơn, không nhẹ đi: mọi connector MCP thêm về sau đều cộng thẳng vào con số đó.

## What Changes

- Thêm khái niệm **tool preset**: một tập nhóm tool cố định, ít và có tên. Mỗi preset là một hợp của các `requiredFeature` đã có — không thêm metadata mới vào `ToolDefinition`, vì 12 feature flag hiện tại **đã phân hoạch chính xác cả 98 tool** (`jiraRead` 18, `jiraSearch` 15, `jiraLink` 8, `jiraCreate` 6, `jiraServiceDesk` 5, `jiraComment` 4, `jiraWorkflow` 4, `jiraUpdate` 3, `confluenceRead` 19, `confluenceWrite` 9, `confluenceWriteHigh` 6, `confluenceSearch` 1 — tổng đúng 98).
- Thêm bộ chọn preset **thuần xác định** (deterministic, không gọi model, không tốn token): dựa trên câu hỏi mới nhất của người dùng trong `input.history`, quyết định preset theo hai trục — hệ đích (Jira / Confluence / cả hai) và ý định (read-only / có write).
- Sửa `buildToolSpecs()` nhận preset và lọc `availableTools()` theo preset đó. Thứ tự serialize khối `tools` được **sắp xếp ổn định theo `name`** để cùng một preset luôn sinh ra cùng một byte prefix.
- Thêm tool meta `nexa_mo_rong_tool` (không có tham số) vào mọi preset hẹp. Model gọi nó khi không thấy tool phù hợp; runtime **không** đẩy lời gọi này xuống MCP mà xử lý ngay trong vòng lặp: nâng preset lên `all` cho các vòng còn lại của lượt đó và trả về danh mục đầy đủ như một tool result. Đây là cơ chế **fail-open** — bộ chọn đoán sai chỉ tốn một round-trip, không bao giờ dẫn tới "không làm được việc".
- Sửa vòng lặp trong `runTurn` để `tools` trở thành biến có thể thay đổi giữa các vòng (hiện là `const` tính một lần trước vòng lặp).
- Thêm cờ cấu hình cho phép tắt hoàn toàn cơ chế này (quay về gửi cả 98 tool) — đường thoát khi vận hành thật phát hiện bộ chọn sai nhiều hơn dự kiến.
- Thêm sự kiện log (`observability`) ghi preset đã chọn, số tool đã gửi, và mỗi lần `nexa_mo_rong_tool` được gọi — số liệu để đánh giá độ chính xác của bộ chọn sau pilot mà không cần log nội dung câu hỏi.

Không có thay đổi **BREAKING**. Không đổi `ToolDefinition`, không đổi schema DB, không đổi IPC channel, không đổi hợp đồng LiteLLM.

Ngoài scope (ghi rõ để không bị nhầm là đã giải quyết):
- Không dùng model làm router hai lượt (phương án C đã bị loại vì thêm một round-trip cho **mọi** câu hỏi).
- Không làm danh mục hai tầng / schema-on-demand (phương án D) — để dành cho khi có connector thứ hai.
- Không bật prompt caching trong `llm-client`. Change này chỉ **bảo toàn điều kiện** để caching hoạt động (prefix ổn định); việc bật là change riêng.
- Không sửa `summarizeResult` để rút gọn kết quả tool — đòn bẩy token độc lập, change riêng.

## Capabilities

### New Capabilities
- `tool-scoping`: quy tắc quyết định tập tool nào được gửi cho model trong một lượt — định nghĩa preset, bộ chọn xác định, tính ổn định của prefix, và cờ tắt.
- `tool-catalog-expansion`: cơ chế fail-open cho phép model tự yêu cầu danh mục tool đầy đủ khi preset hẹp không đủ, và ràng buộc lời gọi meta này không bao giờ đi xuống MCP server.

### Modified Capabilities
(không có — `openspec/specs/` chưa có spec nào; hành vi hiện tại của `buildToolSpecs` chưa từng được đặc tả thành capability)

## Impact

- **Code**: `packages/agent-runtime/src/agent-runtime.ts` (`runTurn`, `buildToolSpecs`, xử lý lời gọi meta trong vòng lặp) và một module mới cho bộ chọn preset. `packages/shared-types` (kiểu preset + cờ cấu hình mới trong `appSettingsSchema`).
- **Không sửa** `packages/atlassian-mcp-manager`: `availableTools()`, `findTool()`, `resolveCallable()`, `callTool()` giữ nguyên. Điều này có chủ ý — `resolveCallable` là cổng bảo mật duy nhất trước khi thực thi, và change này không được chạm vào nó.
- **Không sửa** `ConfirmationGuard`, `OperationTracker`: mọi tool write vẫn đi qua preview + xác nhận không đổi. Preset chỉ ảnh hưởng "model *thấy* tool nào", không ảnh hưởng "tool nào *được phép chạy*" — hai tầng vẫn tách bạch.
- **Bất biến bảo mật**: không bất biến nào trong `README.md` bị nới. Thu hẹp tập tool gửi đi là **giảm** bề mặt, không mở. Lời gọi `nexa_mo_rong_tool` bị chặn trước `resolveCallable` nên không tạo đường vòng nào tới MCP.
- **Test**: `packages/agent-runtime/src/agent-runtime.test.ts` đã có sẵn hook đọc `h.llm.requests[0].tools` (dòng 530) — điểm khẳng định tự nhiên cho preset. Cần thêm test cho bộ chọn (thuần hàm, dễ test) và cho luồng mở rộng.
- **Chi phí/hiệu năng**: giảm 36–82% token khối `tools` tuỳ preset — `jira-read` = 33 tool ≈ 3.368 token thay cho 10.661 (−68%); trường hợp không có tín hiệu hệ đích dùng `all-read` = 5.311 token (−50%). Số đo đầy đủ trong ADR 0009.
- **Không** thêm dependency mới. **Không** thêm lời gọi mạng nào.
- **Tài liệu**: cần một ADR mới (`docs/architecture/adr/0009-*`) vì đây là quyết định kiến trúc có đánh đổi rõ (xác định vs. model-routing, và tương tác với prompt caching); và một mục trong `docs/OPEN-QUESTIONS.md` cho câu hỏi còn mở về ngưỡng chính xác của bộ chọn tiếng Việt.
