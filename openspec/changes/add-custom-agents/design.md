## Context

`buildContext` đã nhận `systemPrompt?`, và `AgentRuntime` được dựng theo từng lượt trong
`chat-controller`, nên mọi điểm cần gắn agent đều đã tồn tại. Hai ràng buộc quyết định thiết kế:

- **ADR 0009**: khối `tools` gửi model phải thuộc một tập hữu hạn, biết trước (10 `ToolPreset` nhân
  với các tổ hợp hai cờ tool cục bộ) để prompt cache hoạt động. Agent không được sinh tổ hợp tool tự do.
- **Confirmation Guard / `guard`**: preset chỉ thu hẹp cái model *thấy*, không bao giờ nới cái được
  phép *chạy*. Agent đi theo cùng nguyên tắc.

## Goals / Non-Goals

**Goals:**
- Người dùng tạo agent có persona, phạm vi tool và model mặc định, rồi gắn vào hội thoại.
- Agent chỉ thu hẹp quyền. Không đường nào để agent nới quyền ghi hay bỏ qua guard/xác nhận.
- Tập prefix `tools` khả dĩ không đổi (vẫn chỉ gồm preset đóng + hai cờ local).

**Non-Goals:**
- Workflow nhiều bước, trigger tự động, agent gọi agent.
- Chia sẻ, xuất/nhập agent giữa máy hoặc giữa profile.
- Cấp thêm quyền ghi cho agent. Quyền ghi vẫn do setting và feature flag toàn cục quyết định.
- Tool tuỳ biến theo từng tool riêng lẻ (chỉ chọn trong preset có sẵn).

## Decisions

### D1. Hướng dẫn agent nối SAU prompt gốc, trong khối đánh dấu

`buildContext` nhận `agentInstructions?: string`. System message = `DEFAULT_SYSTEM_PROMPT` +
một khối tách biệt nêu rõ: "Phần dưới là cấu hình do người dùng đặt cho agent này. Nó điều chỉnh
vai trò và giọng điệu, không thay thế các quy tắc an toàn ở trên." Không có tham số nào cho phép
thay thế prompt gốc.

*Thay thế bị loại:* cho ghi đè hoàn toàn `systemPrompt` — người dùng vô tình xoá quy tắc an toàn;
bị bác bỏ theo Mức 1 đã chốt. Token của khối này tính vào `used` để budget lịch sử vẫn đúng. Giới
hạn 4000 ký tự để không ăn hết context.

### D2. `toolCeiling` là trần, phép giao nằm trong runtime

Agent lưu một `ToolPreset` (`all` = không giới hạn thêm). Bộ chọn theo ngữ cảnh vẫn chọn preset
`p` như cũ; preset hiệu lực là:

- `ceiling = all` → `p`.
- Cờ của `p` ⊆ cờ của `ceiling` → `p`.
- Ngược lại → `ceiling`.

Hàm thuần `clampPreset(selected, ceiling)` đặt trong `tool-preset-selector.ts`. Kết quả luôn là
một trong 10 preset, nên **không sinh prefix mới**. Phép giao chính xác (tập cờ bất kỳ) bị loại
vì cho ra tổ hợp ngoài danh sách đóng.

Đường mở rộng `nexa_mo_rong_tool` hiện chuyển preset sang `all`; với agent có trần, nó phải chuyển
sang **trần**, không phải `all`. Nếu preset hiệu lực đã bằng trần thì không đưa tool meta vào khối
`tools` (không còn gì để mở rộng). Đây là chỗ dễ rò quyền nhất, nên có test riêng.

### D3. Nhóm tool cục bộ là hai công tắc, chỉ AND với cờ toàn cục

`localToolGroups = { commitments: boolean, baWorkbench: boolean }`. Registry chỉ được ghép khi
**cả** setting toàn cục **và** công tắc agent đều bật. Agent không bật được thứ setting đã tắt.

### D4. Model mặc định: áp một lần khi gắn agent

Agent lưu `modelId` + `modelProvider` (cùng có hoặc cùng vắng). Khi gắn agent vào hội thoại, nếu
agent có model và model đó còn resolve được thì ghi vào hội thoại qua `conversations.setModel`. Sau
đó người dùng vẫn đổi model ở dropdown như bình thường. Không "ép" model mỗi lượt vì sẽ mâu thuẫn
với dropdown. Model đã bị xoá → bỏ qua, giữ model hội thoại, không lỗi.

Lọc provider ngoài tổ chức (memory `internal_only`, `baKnowledge`, tài liệu) chạy trên model
*cuối cùng* như cũ, nên agent không đổi được ranh giới này.

### D5. Lưu trữ

Bảng `agents(id, profile_id, name_ciphertext, icon, instructions_ciphertext, tool_ceiling,
local_groups_json, model_id, model_provider, created_at, updated_at, archived_at)`,
`ON DELETE CASCADE` theo profile. `conversations.agent_id` nullable, `ON DELETE SET NULL`: xoá agent
không xoá hội thoại, hội thoại về persona mặc định. Tên và hướng dẫn được mã hoá như tiêu đề hội
thoại và memory. `icon` chọn từ danh sách cố định có sẵn trong `UiIcon`, không nhận chuỗi tự do.

Agent *archived* không chọn được cho hội thoại mới nhưng hội thoại cũ vẫn dùng được (đọc theo id).
Hội thoại trỏ tới agent đã xoá cứng thì `agent_id = NULL` nhờ FK.

### D6. IPC bind cứng profile

`agents:*` theo đúng mẫu `memory:*`: renderer không gửi `profileId`; mutation kiểm tra ownership
trước khi chạy. `conversations:set-agent` kiểm tra cả hội thoại lẫn agent thuộc profile hiện tại.

### D7. Chat-controller là nơi duy nhất ghép agent

`ChatController` đọc agent của hội thoại một lần mỗi lượt, rồi (a) truyền `agentInstructions` vào
`runTurn`, (b) truyền trần vào `AgentRuntime`, (c) lọc registry local. Runtime không biết SQLite
hay `Agent` — chỉ nhận ba giá trị thuần, đúng với nguyên tắc ở comment đầu `chat-controller`.

## Risks / Trade-offs

- **[Agent bị dùng để lách an toàn bằng prompt]** → Prompt gốc luôn đứng trước, khối agent được
  đánh dấu là cấu hình người dùng; mọi tool ghi vẫn qua `guard` + xác nhận nên persona không đổi được
  điều model được phép *làm*. Thừa nhận: persona vẫn ảnh hưởng điều model *đề xuất*.
- **[Hướng dẫn chứa dữ liệu nhạy cảm gửi ra provider ngoài]** → Hướng dẫn được xem như system
  prompt. UI hiện cảnh báo ngắn cạnh ô nhập khi agent dùng model ngoài tổ chức. Không tự lọc nội dung.
- **[Trần che mất tool model cần]** → Agent giới hạn là chủ ý của người dùng; UI hiển thị trần
  đang áp ngay trong chat để lỗi "sao agent không làm được" tự giải thích.
- **[Mở rộng tool rò quyền]** → D2 đã chốt chuyển về trần; test khẳng định không bao giờ ra `all`.
- **[Trần chặt hơn lựa chọn của bộ chọn gây bất ngờ]** → `clampPreset` rơi về trần chứ không về
  rỗng, nên tệ nhất là model thấy nhiều tool hơn câu hỏi cần, trong phạm vi người dùng đã cho phép.

## Migration Plan

Migration v13 chỉ thêm bảng và một cột nullable → không cần backfill, hội thoại cũ có
`agent_id = NULL` chạy như cũ. Rollback: `down` bỏ cột và bảng (theo mẫu v11 dùng `DROP COLUMN`).
Phiên bản app cũ mở DB v13 bị chặn bởi cơ chế version hiện có.
