## Context

Ba mảnh đã tồn tại và không được phá vỡ:

- **Commitment Engine** — `commitments` lưu title/next action dạng ciphertext, CRUD qua IPC có
  ownership gate theo profile (`packages/local-store/src/repositories/commitment-repository.ts`).
- **Confirmation Guard** — bốn bất biến: không chạy khi chưa approve, approval gắn `payload_hash`,
  approval dùng một lần, một `operation_id` chỉ thực thi một lần
  (`packages/agent-runtime/src/confirmation-guard.ts`).
- **Agent Runtime** — vòng lặp tool-calling tuần tự, tối đa một write mỗi lượt; context dựng bởi
  `buildContext()` với khối memory riêng và ngân sách token theo tỉ lệ.

Hai giới hạn hiện tại chặn luồng người dùng mong muốn:

1. `buildToolSpecs()` trả về `[]` khi `deps.mcp === null || !mcp.isReady`, và `executeRead`/
   `executeWrite` đều `this.deps.mcp as AtlassianMcpManager` rồi gọi `mcp.callTool()`. Mọi tool
   hôm nay đều là tool MCP.
2. Commitment không bao giờ đi vào context — `buildContext()` chỉ biết `memoryFacts` và
   `documents`.

`ToolDefinition` cũng mang giả định MCP trong chính kiểu: `mcpToolName` bắt buộc, `targetSystem` là
`'jira' | 'confluence'`, `requiredFeature` là `keyof FeatureFlags`.

## Goals / Non-Goals

**Goals:**

- Agent đề xuất được commitment từ hội thoại mà không nới lỏng một bất biến nào của Confirmation
  Guard.
- Tool commitment hoạt động khi chưa có Atlassian, và không bị preset selector cắt mất.
- Model biết người dùng đang treo việc gì, với ngân sách token tách bạch và có công tắc tắt riêng.
- Người dùng phân biệt được cam kết nào do mình tạo và cam kết nào do agent đề xuất.

**Non-Goals:**

- Không có tool xoá commitment, không cho agent đánh dấu `completed`.
- Không có OS notification hay background process — phạm vi nhắc việc giữ nguyên như hiện tại.
- Không tự động sinh commitment khi người dùng im lặng; không có "auto-accept".
- Không đưa memory và commitment về chung một khối context.
- Không thay đổi luồng check-in hay hành vi nút "Thực hiện" trên Today.

## Decisions

### D1 — Local tool registry song song với MCP, không nhét tool giả vào MCP registry

Thêm port `localTools: LocalToolRegistry | null` vào `AgentRuntimeDeps`. `LocalToolDefinition` là
kiểu riêng: `name`, `description`, `inputSchema` (Zod), `jsonSchema`, `riskLevel`, `buildPreview`,
`execute(payload, ctx)`. Không có `mcpToolName`, không có `requiredFeature` kiểu MCP.

`resolveCallable()` tra local registry TRƯỚC, MCP sau; tên local là danh sách đóng nên không có
nguy cơ tool MCP bị che. `buildToolSpecs()` gộp specs local vào kết quả và trả về khác rỗng ngay cả
khi `mcp === null`; local specs không chịu lọc theo `TOOL_PRESET_FLAGS`.

*Đã cân nhắc:* nhét một `ToolDefinition` giả vào `AtlassianMcpManager` — chính comment tại
`agent-runtime.ts:242` đã gọi đây là đường vòng và từ chối nó cho tool mở rộng danh mục. Giữ nguyên
lập trường đó.

*Đã cân nhắc:* xử lý riêng ở vòng lặp như `EXPAND_TOOLS_TOOL_NAME`. Không được: tool đó không ghi
gì, còn tool commitment PHẢI đi qua guard, tracker và `ToolCallSink`. Đi vòng nghĩa là viết lại
đường write lần thứ hai.

### D2 — Dùng lại `executeWrite`, chỉ thay điểm thực thi

`executeWrite()` giữ nguyên tám bước (preview → open → sink → confirm → consume → thực thi → cập
nhật → summary). Thay hai chỗ hôm nay ép kiểu sang MCP:

- Thực thi: `definition.kind === 'local' ? definition.execute(...) : mcp.callTool(...)`.
- `buildPreview`: `PreviewContext.readTool` chỉ được cấp cho tool MCP; preview tool local nhận
  `readCommitment(id)` do main process bơm vào, đọc thẳng repository.

Hệ quả: bất biến approval không nằm ở nhánh nào mới — không có đường nào ghi commitment mà không đi
qua `guard.consume()`.

### D3 — `ToolPreview.targetSystem` thêm `'local'`

Đây là thay đổi union công khai, mọi `switch` phải xử lý nhánh mới — chấp nhận có ích: renderer bắt
buộc phải nói rõ "thay đổi dữ liệu trên máy bạn" thay vì mượn nhãn Jira.

`targetSystemUrl` để rỗng cho tool local; `actingAccount` là profile hiện tại, không phải tài khoản
Jira. `reversible: true` cho create/update vì người dùng sửa hoặc xoá được trong Mục tiêu.

*Đã cân nhắc:* kiểu preview thứ hai (`LocalToolPreview`). Bị loại vì renderer, `ToolCallSink`,
activity và guard đều đang nhận đúng một kiểu; tách kiểu là chi phí lan rộng chỉ để tránh một
nhánh switch.

### D4 — Chuẩn hoá thời gian ở main process, không tin model

Model truyền `dueAt`/`checkInAt` dạng ISO **hoặc** chuỗi mô tả tiếng Việt. Main process phân giải
bằng một hàm thuần nhận `(text, now)`: hỗ trợ "hôm nay/ngày mai/ngày kia", "thứ N tuần này/tuần
sau", "N ngày/tuần/tháng nữa", "cuối tuần/cuối tháng", và ISO. Không phân giải được thì ném lỗi
validate — tool result bảo model hỏi lại người dùng, KHÔNG mở confirmation.

Lý do: model không biết chắc "hôm nay" là ngày nào theo giờ máy, và một mốc sai lệch một ngày sẽ
âm thầm sinh nhắc việc sai. Hàm thuần nhận `now` để test được, không dùng thư viện mới.

*Đã cân nhắc:* bắt model luôn trả ISO. Thực tế model vẫn suy ra ngày sai khi không có mốc "bây
giờ" đáng tin; chấp nhận cả hai dạng nhưng chốt phân giải ở chỗ biết giờ máy.

### D5 — Khối context cam kết tách khỏi memory

`buildContext()` nhận thêm `commitments?: readonly CommitmentContextItem[]` và sinh một system
message riêng, đặt sau khối memory, trước tài liệu. Ngân sách riêng
`COMMITMENT_CONTEXT_BUDGET_RATIO` (đề xuất 0.05) và trần `MAX_COMMITMENTS_IN_CONTEXT` (đề xuất 10).
Sắp xếp: quá hạn trước, rồi mốc gần nhất, rồi `updated_at` giảm dần; commitment không có mốc xếp
cuối.

Header nói rõ đây là dữ kiện tham chiếu, không phải chỉ dẫn — cùng lập trường với khối memory, để
nội dung do người dùng viết không trở thành kênh tiêm chỉ thị.

*Đã cân nhắc:* gộp vào khối memory dưới `kind=goal`. Bị loại: commitment là state thay đổi liên tục
có mốc thời gian, gộp chung sẽ ăn vào ngân sách memory và làm mất thứ tự ưu tiên theo hạn.

### D6 — Hai công tắc, mặc định khác nhau có chủ ý

- `agentCommitmentToolsEnabled` mặc định **false**. Đây là quyền ghi mới cho agent; theo tiền lệ
  `proactiveCheckInsEnabled`, quyền mới phải do người dùng bật.
- `commitmentContextEnabled` mặc định **true**, nhưng với provider ngoài áp cùng cổng chia sẻ như
  memory (`selectMemoryForProvider`): nội dung cam kết chỉ rời máy khi chính sách cho phép.

Đọc-để-trả-lời-tốt-hơn và ghi-vào-dữ-liệu-người-dùng là hai mức rủi ro khác nhau; mặc định khác
nhau phản ánh đúng điều đó.

### D7 — `created_by` trên commitment, `actor` trên activity

Migration v8: thêm `commitments.created_by TEXT NOT NULL DEFAULT 'user'` và cột actor cho
`local_audit`. Record cũ là `user` — đúng với lịch sử, vì trước change này agent không tạo được gì.

Activity vẫn không lưu plaintext title; nguồn tạo là enum, không phải nội dung.

## Risks / Trade-offs

- **Model đề xuất commitment quá nhiệt tình, biến chat thành máy sinh popup** → prompt nói rõ chỉ
  đề xuất khi người dùng phát biểu một cam kết có mốc thời gian; giữ trần một write mỗi lượt; mặc
  định tắt; theo dõi qua timeline Hoạt động để người dùng thấy tần suất.
- **Nội dung cam kết rò sang provider ngoài** → D6 chặn theo chính sách chia sẻ, có công tắc tắt
  riêng, và khối context được đếm/ghi log số mục đã gửi.
- **Mốc thời gian phân giải sai sinh nhắc sai** → D4 fail-closed khi không hiểu; preview luôn hiện
  ngày giờ tuyệt đối để người dùng bắt lỗi trước khi ghi.
- **Union `targetSystem` mở rộng làm vỡ nơi khác** → là lỗi biên dịch, không phải lỗi chạy;
  typecheck bắt hết trong một lần sửa.
- **Khối cam kết chiếm chỗ của lịch sử hội thoại** → ngân sách riêng nhỏ, lược khối cam kết trước
  khi lược lượt hiện tại (yêu cầu trong spec `commitment-context`).
- **Agent cập nhật đè lên chỉnh sửa tay của người dùng** → preview update hiện giá trị trước/sau
  đọc từ record thật, và `payload_hash` vô hiệu hoá approval nếu payload đổi giữa preview và thực
  thi.

## Migration Plan

1. Migration v8 (`created_by`, cột actor) — thuần thêm cột, có default, không backfill nội dung.
2. Mở rộng type (`ToolPreview.targetSystem`, `LocalToolDefinition`, settings) và sửa mọi chỗ
   typecheck báo lỗi.
3. Bật đường local tool trong runtime sau khi preview builder và guard test đã xanh.
4. Nạp context sau cùng, để có thể phát hành phần tool trước nếu cần.

Rollback: tắt hai setting đưa hệ thống về đúng hành vi hiện tại — tool không được công bố, khối
context không được dựng. Cột DB thừa là vô hại.

## Open Questions

- Trần `MAX_COMMITMENTS_IN_CONTEXT = 10` và tỉ lệ `0.05` là ước lượng; cần đo lại khi có hồ sơ
  người dùng thật nhiều cam kết.
- Có nên cho agent đề xuất `blocked` kèm lý do không, hay để người dùng tự đổi trạng thái trong
  Mục tiêu?
- Khi người dùng huỷ đề xuất nhiều lần cho cùng một nội dung, có nên im lặng trong phần còn lại
  của hội thoại không?
