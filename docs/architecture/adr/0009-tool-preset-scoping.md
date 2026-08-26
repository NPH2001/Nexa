# ADR 0009 — Thu hẹp danh mục tool theo ngữ cảnh bằng preset cố định

**Trạng thái:** Đề xuất
**Ngày:** 2026-08-26

## Bối cảnh

`AgentRuntime.buildToolSpecs()` map thẳng `mcp.availableTools()` sang khối `tools` không lọc gì,
và khối đó được truyền lại ở **mỗi vòng** của vòng lặp tool-calling (`maxToolIterations` mặc định
5). Với 12 feature flag đang bật hết (OPEN-QUESTIONS G1) thì đó là cả 98 tool, mỗi vòng.

### Số đo thật — và một hiệu chỉnh quan trọng

Bản đề xuất đầu của change này lấy số từ `mcp-atlassian-tools.json` (schema mà MCP server công
bố): 98 tool ≈ **29.900 token**. Con số đó **sai cho Nexa**. Nexa không gửi schema của server —
nó gửi `jsonSchema` trong `tool-registry/`, là schema **Nexa tự viết**, chặt hơn nhiều (§11.3:
"tool nào không có định nghĩa ở đây thì không được gọi"). Đo trên chính `buildToolRegistry()`:

| Preset | Số tool | Ký tự | ~Token | So với `all` |
| --- | --- | --- | --- | --- |
| `jira-read` | 33 | 13.470 | **~3.368** | −68% |
| `jira-full` | 63 | 27.196 | **~6.799** | −36% |
| `confluence-read` | 20 | 7.774 | **~1.944** | −82% |
| `confluence-full` | 35 | 15.446 | **~3.862** | −64% |
| `all-read` | 53 | 21.244 | **~5.311** | −50% |
| `all` (hành vi trước ADR này) | 98 | 42.642 | **~10.661** | — |

Nên quy mô thật của vấn đề là **~10.700 token mỗi vòng**, không phải ~30.000. Tỉ lệ tiết kiệm giữ
nguyên (36–82%, phần lớn câu hỏi rơi vào 50–68%), nhưng con số tuyệt đối nhỏ hơn khoảng ba lần:
tiết kiệm ~5.000 token mỗi vòng, không phải ~15.000. Ghi lại ở đây để không ai lặp lại lỗi lấy số
từ file catalog của server rồi tưởng là số Nexa thật sự gửi.

Ba lý do vẫn giữ quyết định dù mức lợi nhỏ hơn: chi phí nhân theo số vòng (5 vòng × 5.000 =
25.000 token mỗi lượt); phần token đó bị chiếm khỏi context window đúng chỗ lẽ ra dành cho tài
liệu PDF/DOCX; và bắt model phân biệt 98 tool tên gần giống nhau (`jira_get_issue` /
`jira_search` / `jira_search_fields`) làm giảm chất lượng chọn tool.

## Quyết định

**Chọn một trong sáu preset cố định cho mỗi lượt, bằng một hàm thuần xác định, và đưa kèm một tool
meta để model tự xin danh mục đầy đủ khi preset hẹp không đủ.**

Preset là hợp của các feature flag đã có — không thêm trục phân loại mới, vì 12 cờ hiện tại đã
phân hoạch trọn 98 tool, mỗi tool đúng một cờ.

### Vì sao xác định, không phải để model tự chọn nhóm

| | Token còn lại | Độ trễ thêm | Test |
| --- | --- | --- | --- |
| Router bằng model (2 lượt) | thấp nhất | **+1 round-trip mọi câu hỏi** | phi xác định |
| **Bộ chọn xác định** | 1.944–6.799 | 0 | hàm thuần |
| Danh mục hai tầng (schema theo yêu cầu) | ~2.100 + schema đã dùng | 0 | trung bình |

Yếu tố quyết định là **độ trễ**: `maxToolIterations` đã là 5, cộng một round-trip cố định vào mọi
câu hỏi là đánh đổi tệ cho một trợ lý desktop nơi người dùng chờ ký tự đầu tiên. Danh mục hai tầng
tốt hơn về token nhưng cần đường schema-on-demand, và giá trị của nó chỉ bộc lộ khi có connector
MCP thứ hai — để dành cho lúc đó.

### Ràng buộc quan trọng nhất: preset phải CỐ ĐỊNH

Cách hiển nhiên — "chọn đúng những tool liên quan tới câu hỏi này" — sinh một tập khác nhau cho
gần như mọi câu hỏi. Khối `tools` nằm ở **đầu** request, nên nó là prefix của prompt. Mỗi tập khác
nhau là một prefix mới ⇒ khi bật prompt caching, **luôn cache miss**, và việc lọc có thể thành
**lỗ ròng** so với gửi cả 98 tool nhưng cache được. `packages/llm-client` hiện chưa dùng caching
(`grep cache_control` không ra gì), nên ADR này không bật nó — chỉ **bảo toàn điều kiện** cho nó.

Vì vậy: sáu preset, biết trước, cộng sort tool theo tên để cùng một preset sinh khối `tools`
giống nhau từng byte. `tool-preset.test.ts` khẳng định số preset là 6 và mọi quan hệ bao hàm;
`agent-runtime.test.ts` khẳng định hai câu hỏi khác nhau cùng preset cho khối `tools` bằng nhau.

**Đừng biến preset thành động.** Đó là toàn bộ nội dung của ràng buộc này.

### Fail-open: tool meta, chặn trước cổng bảo mật

Mọi preset hẹp kèm `nexa_mo_rong_tool` (không tham số). Model gọi nó ⇒ `runTurn` xử lý ngay trong
vòng lặp, trả danh mục rút gọn (98 dòng tên + mô tả ≤120 ký tự ≈ **2.132 token**) làm tool result,
và nâng `tools` lên `all` cho các vòng còn lại của lượt.

Điểm chặn nằm ở vòng lặp `runTurn`, **không** trong `executeToolCall`, vì `executeToolCall` đi qua
`mcp.resolveCallable()` và tên meta không có trong registry ⇒ sẽ ném `TOOL_NOT_ALLOWED`. Đúng như
thiết kế. Cách "sửa" sai là nhét một `ToolDefinition` giả vào registry cho nó lọt qua cổng — đó
chính xác là loại đường vòng mà comment trong `AtlassianMcpManager.callTool` cảnh báo. Chặn ở tầng
trên giữ `resolveCallable` **không đổi một dòng**.

Kèm theo: lời gọi meta không phải write, không preview, không xác nhận, không `operation_id`,
không ghi `ToolCallSink`, không chiếm hạn mức một-write-mỗi-lượt. Nó là thao tác lên chính
request, không lên hệ thống đích.

### Đoán sai tốn bao nhiêu

Một lượt hai vòng, câu hỏi bị xếp sai vào `jira-read` rồi phải mở rộng:

| | Vòng 1 | Vòng 2 | Tổng |
| --- | --- | --- | --- |
| Không lọc (trước ADR này) | 10.661 | 10.661 | **21.322** |
| Lọc + mở rộng | 3.430 | 10.661 + 2.132 danh mục | **16.223** |

Đoán sai **vẫn rẻ hơn** không lọc. Điểm hoà vốn ở khoảng 4–5 vòng: ở trần 5 vòng, đường mở rộng
tốn ~54.600 token so với ~53.300 nếu không lọc — đắt hơn 2%. Nói cách khác, cơ chế fail-open
không phải một hình phạt; nó chỉ hết lợi thế ở đúng những lượt dài nhất.

## Hệ quả

- Thêm `toolScoping` vào `featureFlagsSchema`, mặc định **bật**. IT khoá được qua `forcedFeatures`
  trong `resources/policy.json` ⇒ rollback toàn tổ chức không cần build lại.
- Thêm `ToolPreset`, `TOOL_PRESET_FLAGS`, `TOOL_PRESETS`, `EXPAND_TOOLS_TOOL_NAME` vào
  `@nexa/shared-types`; thêm `packages/agent-runtime/src/tool-preset-selector.ts` (hàm thuần).
- `buildToolSpecs()` nhận `(preset, includeExpandTool)` và sort theo tên. `tools` trong `runTurn`
  trở thành biến gán lại được.
- **Không sửa** `packages/atlassian-mcp-manager`: `availableTools()`, `findTool()`,
  `resolveCallable()`, `callTool()` giữ nguyên. Lọc chạy SAU `availableTools()`, nên preset không
  bao giờ nới quyền — một tool bị feature flag tắt vẫn không xuất hiện dù preset chứa nhóm của nó.
- **Không sửa** `ConfirmationGuard`/`OperationTracker`. Preset đổi cái model *thấy*, không đổi cái
  được phép *chạy*. Hệ quả có chủ ý: model gọi một tool **ngoài** preset đã gửi thì tool đó **vẫn
  chạy** (nếu qua `resolveCallable`) — từ chối nó sẽ thêm một chế độ lỗi mới mà không thêm chút
  bảo mật nào, vì cổng thật đã ở dưới.
- Thêm sự kiện log `tool-preset` (`preset`, `toolCount`, `expanded`). Không trường nào nằm trong
  danh sách cấm ở `docs/security/threat-model.md`; câu hỏi người dùng không được ghi.
- Một dòng mới trong `DEFAULT_SYSTEM_PROMPT` nói cho model biết danh mục có thể đã bị thu hẹp.

## Rủi ro còn lại

**Model không gọi tool meta mà chỉ trả lời "tôi không có công cụ phù hợp."** Đây là rủi ro thật và
nghiêm trọng nhất: nó biến một câu hỏi làm được thành một lời từ chối, âm thầm, không có dấu vết
lỗi nào. Biện pháp: mô tả tool viết ở thể mệnh lệnh, cộng một dòng trong system prompt. Cách phát
hiện: tỉ lệ `expanded` theo từng preset — preset hẹp mà tỉ lệ mở rộng gần 0 trong khi người dùng
vẫn báo "trợ lý nói không làm được" là dấu hiệu của đúng rủi ro này. Chưa có ngưỡng chốt cho tỉ lệ
đó; xem OPEN-QUESTIONS H1.

**Bộ chọn sai trên câu nối tiếp không nhắc lại hệ đích** ("còn ticket kia thì sao?"). Fail-open
che phần lớn. Hai bẫy tiếng Việt đã xử lý tường minh và có test: "trạng thái" bỏ dấu thành
"trang thai" (chứa "trang" — dấu hiệu Confluence) bị gỡ trước khi khớp; "đóng" và "gán" bị **bỏ
khỏi** danh sách động từ write vì bỏ dấu chúng trùng "động" trong "hoạt động" và "gần" trong
"gần đây".
