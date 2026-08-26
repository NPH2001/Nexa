## Context

`buildToolSpecs()` (`packages/agent-runtime/src/agent-runtime.ts:555`) map thẳng `mcp.availableTools()` sang `ChatToolSpec[]` không lọc gì. Kết quả được tính **một lần** ở `runTurn` (dòng 142) và truyền vào `streamOnce()` ở **mỗi vòng** của vòng lặp tool-calling (dòng 150), tối đa `maxToolIterations` = 5 vòng.

Số đo trên `buildToolRegistry()` — đúng những gì Nexa gửi đi:

| | Token (≈ ký tự / 4) |
| --- | --- |
| Cả 98 tool, `jsonSchema` của Nexa | **~10.661** (42.642 ký tự) |
| Trung bình một tool | ~109 (435 ký tự) |
| Chỉ tên + 1 dòng mô tả ≤120 ký tự, cả 98 tool | ~2.132 (8.529 ký tự) |

**Hiệu chỉnh:** bản đầu của tài liệu này lấy số từ `mcp-atlassian-tools.json` (~29.900 token). Đó
là schema của **MCP server**, không phải của Nexa — `tool-registry/` có schema Nexa tự viết, chặt
hơn khoảng ba lần. Quy mô thật của vấn đề nhỏ hơn tương ứng; tỉ lệ tiết kiệm giữ nguyên.

Ràng buộc phải tôn trọng:

- **`resolveCallable()` là cổng bảo mật duy nhất** trước khi thực thi tool (`atlassian-mcp-manager/src/manager.ts`). Comment trong `callTool` nói rõ việc tách "được phép gọi tool nào" khỏi "người dùng đã đồng ý chưa" là cố ý. Change này **không được** chạm vào cả hai tầng.
- **Feature flag đã phân hoạch trọn 98 tool.** 12 cờ, tổng đúng 98, không tool nào thuộc hai cờ. Đây là trục nhóm sẵn có — không cần thêm field vào `ToolDefinition`.
- **Model không được rơi vào trạng thái mù.** Nếu tập tool hẹp thiếu đúng tool cần, người dùng phải vẫn làm được việc.
- **Khối `tools` nằm ở đầu request.** Nó là prefix của prompt. `packages/llm-client` hiện chưa dùng prompt caching (`grep cache_control` không ra gì), nhưng thiết kế này không được làm việc bật caching về sau trở nên vô nghĩa.

## Goals / Non-Goals

**Goals:**

- Giảm token khối `tools` 36–82% tuỳ preset (đơn hệ chỉ tra cứu: −68% đến −82%), không giảm được việc gì người dùng đang làm được.
- Quyết định tập tool là **xác định và test được bằng unit test thuần** — không phụ thuộc model, không thêm round-trip.
- Số prefix `tools` khác nhau bị chặn ở một hằng số nhỏ, để prompt caching về sau vẫn dùng lại được giữa các câu hỏi.
- Có đường thoát: một cờ tắt là quay về hành vi hiện tại, không cần build lại.
- Có số liệu để đánh giá độ chính xác của bộ chọn sau pilot, mà không log nội dung câu hỏi.

**Non-Goals:**

- Không giảm token của **kết quả** tool (đó là việc của `summarizeResult`, change riêng).
- Không bật prompt caching — chỉ bảo toàn điều kiện cho nó.
- Không dùng model để chọn nhóm tool.
- Không làm schema-on-demand / danh mục hai tầng.
- Không đổi mặc định của bất kỳ feature flag nào (quyết định "full quyền 98 tool" theo G1 giữ nguyên — preset thu hẹp cái model **thấy**, không thu hẹp cái người dùng **được phép làm**).

## Decisions

### D1. Bộ chọn xác định, không phải router bằng model

Ba phương án đã cân nhắc:

| | Cách làm | Token còn lại | Độ trễ thêm | Test |
| --- | --- | --- | --- | --- |
| Router bằng model | Lượt 1 gửi 12 nhóm, model chọn, lượt 2 gửi schema nhóm đó | thấp nhất | **+1 round-trip mọi câu hỏi** | khó, phi xác định |
| **Bộ chọn xác định** | Quét câu hỏi bằng quy tắc, chọn preset | 1,9–6,8k | 0 | hàm thuần |
| Danh mục hai tầng | Gửi tên+mô tả cả 98, schema theo yêu cầu | ~2,1k + schema đã dùng | 0 | trung bình |

Chọn bộ chọn xác định. Lý do quyết định là **độ trễ**: `maxToolIterations` đã là 5, cộng một round-trip cố định vào mọi câu hỏi là đánh đổi tệ cho một trợ lý desktop nơi người dùng chờ ký tự đầu tiên. Danh mục hai tầng tốt hơn về token nhưng phức tạp hơn hẳn (cần đường schema-on-demand), và giá trị của nó chỉ bộc lộ khi có connector thứ hai — để dành cho lúc đó.

### D2. Preset là tập **cố định**, không phải tập tuỳ ý theo từng câu hỏi

Đây là quyết định quan trọng nhất và dễ làm sai nhất. Cách hiển nhiên — "chọn đúng những tool liên quan tới câu hỏi này" — sinh ra một tập khác nhau cho gần như mọi câu hỏi. Khi bật prompt caching, mỗi tập khác nhau là **một prefix mới, luôn cache miss**. Lúc đó việc lọc có thể trở thành **lỗ ròng** so với việc gửi cả 98 tool nhưng cache được.

Nên tập tool bị đóng lại thành 6 preset, mỗi preset là hợp của các feature flag:

| Preset | Feature flag | Số tool | ~Token | So với `all` |
| --- | --- | --- | --- | --- |
| `jira-read` | `jiraRead`, `jiraSearch` | 33 | ~3.368 | −68% |
| `jira-full` | + `jiraCreate`, `jiraComment`, `jiraLink`, `jiraUpdate`, `jiraWorkflow`, `jiraServiceDesk` | 63 | ~6.799 | −36% |
| `confluence-read` | `confluenceRead`, `confluenceSearch` | 20 | ~1.944 | −82% |
| `confluence-full` | + `confluenceWrite`, `confluenceWriteHigh` | 35 | ~3.862 | −64% |
| `all-read` | `jira-read` ∪ `confluence-read` | 53 | ~5.311 | −50% |
| `all` | cả 12 cờ | 98 | ~10.661 | — |

Sáu prefix khả dĩ, cố định, biết trước. Đó là con số cache-friendly.

Kèm theo: `buildToolSpecs()` phải **sort theo `name`** trước khi serialize. `availableTools()` hiện trả theo thứ tự registry — vốn đã ổn định, nhưng thứ tự đó là hệ quả tình cờ của thứ tự bốn hàm `build*Tools()`. Sort tường minh biến tính ổn định thành thứ được khẳng định bằng test, không phải thứ dễ vỡ khi ai đó sắp xếp lại registry.

### D3. Không tín hiệu ⇒ `all-read`, không phải `all`

Câu hỏi không nhắc Jira lẫn Confluence rất có thể là câu **không cần tool nào** ("tóm tắt file này", "viết lại đoạn này"). Gửi cả 98 tool cho nó là phần lãng phí thuần khiết nhất trong hành vi hiện tại. Nhưng ta không chứng minh được là không cần, nên chọn mức giữa: `all-read` (53 tool, ~5.311 token, −50%) — vẫn trả lời được mọi câu hỏi tra cứu, và mọi ý định write đều đi qua đường mở rộng ở D4.

### D4. Fail-open bằng một tool meta, chặn **trước** cổng bảo mật

Thêm `nexa_mo_rong_tool` (không tham số) vào mọi preset trừ `all`. Khi model gọi nó, `runTurn` xử lý ngay trong vòng lặp và **không** gọi `executeToolCall`.

Điểm chặn phải nằm ở vòng lặp `runTurn`, không phải trong `executeToolCall`, vì hai lý do:

1. `executeToolCall` đi qua `mcp.resolveCallable(name)`, và tên meta không có trong registry ⇒ sẽ ném `TOOL_NOT_ALLOWED`. Đúng như thiết kế — cổng đó nên từ chối mọi thứ ngoài registry.
2. Cách sửa sai sẽ là nhét một `ToolDefinition` giả vào registry để nó lọt qua cổng. Đó chính xác là loại đường vòng mà comment trong `callTool` cảnh báo. Chặn ở tầng trên giữ `resolveCallable` **không đổi một dòng nào**.

Hệ quả kèm theo: lời gọi meta không phải tool write, không sinh preview, không cần xác nhận, không tạo `operation_id`, không ghi vào `ToolCallSink`. Nó không phải một thao tác lên hệ thống đích — nó là một thao tác lên chính request.

### D5. Mở rộng chỉ có phạm vi **một lượt**

Sau khi model gọi meta, các vòng còn lại **của lượt đó** dùng `all`. Lượt kế tiếp lại bắt đầu từ bộ chọn.

Đánh đổi: hội thoại nhiều lượt cùng một chủ đề mà bộ chọn liên tục đoán sai sẽ trả giá mở rộng ở mỗi lượt. Cân nhắc cho tương lai là nhớ mức mở rộng theo `conversationId`, nhưng nó đưa trạng thái vào một runtime hiện đang không có trạng thái giữa các lượt — chưa đủ lý do để làm bây giờ. Xem Open Questions.

### D6. Suy ra ý định, và nghiêng về `read` khi không chắc

Bộ chọn có hai trục độc lập:

- **Hệ đích**: dấu hiệu Jira (`jira`, `issue`, `ticket`, `sprint`, `backlog`, `epic`, `bug`, và mẫu issue key `[A-Z]{2,10}-\d+`) so với dấu hiệu Confluence (`confluence`, `wiki`, `space`, `trang`, `tài liệu`).
- **Ý định**: động từ write (`tạo`, `sửa`, `cập nhật`, `xoá`, `chuyển`, `gán`, `đóng`, `thêm`, `comment`, `bình luận`, và các từ tiếng Anh tương ứng).

Khi trục ý định không chắc, chọn nhánh `read`. Lý do bất đối xứng: đoán thiếu tool write chỉ tốn một round-trip mở rộng (D4), còn đoán thừa thì tốn token trên **mọi** câu hỏi. Fail-open làm cho phía rẻ trở thành phía an toàn.

Chuẩn hoá đầu vào trước khi khớp: hạ chữ thường và **bỏ dấu** — người dùng gõ "tao issue" thay vì "tạo issue" là chuyện thường ngày. Mẫu issue key khớp trên chuỗi **gốc** (phân biệt chữ hoa), không phải chuỗi đã chuẩn hoá.

Đầu vào là message `role === 'user'` **cuối cùng** trong `input.history` — `history` đã bao gồm câu hỏi của lượt hiện tại.

### D7. Cờ tắt nằm trong `FeatureFlags`, không phải `appSettings`

`toolScoping: z.boolean().default(true)` thêm vào `featureFlagsSchema`. `FeatureFlags` đã chứa cờ hành vi ngoài tool (`autoUpdate`, `storeExtractedText`, `storeHistory`), nên đây là chỗ đúng — và quan trọng hơn: `policy.json` khoá được feature flag ở mức tổ chức, nên IT tắt được ở nơi bộ chọn tỏ ra sai nhiều, **không cần build lại**.

Cờ tắt ⇒ `buildToolSpecs()` trả về đúng như hôm nay (cả 98 tool, cộng sort ổn định), và tool meta không được đưa vào.

### D8. Số liệu đánh giá, không log nội dung câu hỏi

Mỗi lượt ghi một sự kiện: preset đã chọn, số tool đã gửi, và cờ `expanded` nếu meta được gọi. **Không** ghi câu hỏi, không ghi từ khoá đã khớp — `docs/security/threat-model.md` liệt kê trường cấm log, và nội dung người dùng nằm trong đó. Tỉ lệ `expanded / tổng lượt` theo từng preset là đủ để biết bộ chọn sai ở đâu.

## Risks / Trade-offs

- **Model không gọi tool meta mà chỉ trả lời "tôi không có công cụ phù hợp".** Đây là rủi ro thật và nghiêm trọng nhất — nó biến một câu hỏi làm được thành một câu trả lời từ chối, âm thầm. → Mô tả tool phải mệnh lệnh và ngắn ("Gọi ngay khi không thấy tool phù hợp, đừng nói với người dùng là không làm được"), cộng một câu trong `DEFAULT_SYSTEM_PROMPT` (`context-builder.ts:16`). Đo bằng tỉ lệ `expanded` ở D8: preset hẹp mà tỉ lệ mở rộng gần 0 trong khi vẫn có báo lỗi từ người dùng là dấu hiệu của rủi ro này.
- **Bộ chọn sai trên tiếng Việt trộn tiếng Anh, hoặc câu hỏi nối tiếp không nhắc lại hệ đích** ("còn ticket kia thì sao?"). → Fail-open che phần lớn; thêm bộ ca kiểm thử từ câu hỏi thật sau pilot.
- **Mẫu issue key `[A-Z]{2,10}-\d+` khớp nhầm** (mã hợp đồng, biển số, `UTF-8`). → Hại thấp: chỉ dẫn tới `jira-read` thay vì `all-read`, và mở rộng vẫn còn đó.
- **Người dùng thấy model "lắp bắp" khi mở rộng**: text model sinh trước lời gọi meta đã được stream qua `text-delta` rồi. → Mô tả tool yêu cầu gọi không kèm lời dẫn; chấp nhận phần dư còn lại.
- **Ai đó về sau làm preset động** vì "chọn chính xác hơn thì tiết kiệm hơn", phá mất tính ổn định prefix ở D2. → Ghi thành ADR `docs/architecture/adr/0009-*` với ràng buộc nêu tường minh, và một test khẳng định số preset khả dĩ là hữu hạn và preset không phụ thuộc gì ngoài `(preset, tập cờ đang bật)`.
- **Giảm token đo được có thể thấp hơn dự kiến** nếu phần lớn câu hỏi thật rơi vào `all-read` hoặc `all`. → D8 cho biết ngay sau pilot; nếu phân bố lệch về `all-read`, bước tiếp theo đúng là phương án danh mục hai tầng, không phải tinh chỉnh regex.
- **Mức lợi tuyệt đối nhỏ hơn ba lần so với ước lượng ban đầu** (~5.000 token/vòng, không phải ~15.000) vì số cũ lấy từ catalog của MCP server chứ không phải schema Nexa gửi. → Đã hiệu chỉnh ở Context và ADR 0009. Quyết định giữ nguyên: chi phí nhân theo số vòng, và phần token đó cạnh tranh trực tiếp với tài liệu trong context window. Nhưng nếu ai đó cần một lý do để **hoãn** change này lại thì đây là lý do trung thực nhất — nó không phải một chiến thắng lớn.

## Migration Plan

1. Thêm `toolScoping` vào `featureFlagsSchema`, mặc định **bật**. Không migration DB, không đổi IPC.
2. Cài bộ chọn như một module riêng, hàm thuần, kèm bộ test ca biên trước khi nối vào `runTurn`.
3. Nối vào `runTurn` + `buildToolSpecs()`; thêm sort ổn định (áp dụng cho **cả** nhánh cờ tắt, để bật/tắt cờ chỉ đổi tập tool chứ không đổi thứ tự).
4. Cài đường mở rộng ở vòng lặp `runTurn`.
5. Thêm sự kiện log D8.
6. Viết ADR 0009 và mục Open Questions.

**Rollback**: đặt `toolScoping: false` — qua `policy.json` khi phân phối, hoặc Settings. Hành vi trở lại đúng như trước change (khác duy nhất: thứ tự tool được sort, không ảnh hưởng nghĩa).

## Open Questions

- **Ngưỡng chấp nhận của bộ chọn là bao nhiêu?** Tỉ lệ mở rộng bao nhiêu phần trăm thì coi là bộ chọn hỏng và nên tắt cờ? Chưa có cơ sở để chốt trước pilot — cần số thật.
- **Mở rộng có nên nhớ theo hội thoại?** (D5) Đổi lấy việc đưa trạng thái vào runtime. Chờ số liệu về tần suất mở rộng lặp lại trong cùng hội thoại.
- **`jiraServiceDesk` (5 tool) có nên tách preset riêng?** Nó là miền nghiệp vụ khác hẳn (JSM request), hiện bị gộp vào `jira-full`. Chỉ 5 tool nên chưa đáng, nhưng nếu tổ chức không dùng JSM thì cách đúng là tắt cờ đó (phương án A) chứ không phải thêm preset.
- **Có nên thêm preset rỗng cho câu hỏi chắc chắn không cần tool?** Tiết kiệm nhiều nhất nhưng rủi ro cao nhất, và không có cách đoán đáng tin. Chỉ nên xét lại nếu D8 cho thấy tỉ lệ lượt không gọi tool nào rất cao.
