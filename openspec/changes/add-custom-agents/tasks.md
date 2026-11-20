## 1. Shared types & IPC contract

- [x] 1.1 Thêm kiểu `Agent`, `AgentLocalGroups` và danh sách biểu tượng cố định trong `shared-types`.
- [x] 1.2 Thêm Zod schema: tên 1–60, hướng dẫn 0–4000, `toolCeiling` ∈ `TOOL_PRESETS`, icon ∈ danh sách, model cùng có hoặc cùng vắng.
- [x] 1.3 Thêm channel `agents:list/create/update/archive/restore/delete` và `conversations:set-agent`; không nhận `profileId` từ renderer.
- [x] 1.4 Test schema và typecheck channels ↔ schemas.

## 2. Local-store: schema & repository

- [x] 2.1 Migration v13: bảng `agents` (tên/hướng dẫn mã hoá, `ON DELETE CASCADE` theo profile) và `conversations.agent_id` nullable `ON DELETE SET NULL`; viết `down`.
- [x] 2.2 `AgentRepository`: create/get/list/update/archive/restore/delete, mọi truy vấn lọc theo `profile_id`.
- [x] 2.3 Mở rộng repository hội thoại: đọc `agentId` và `setAgent`.
- [x] 2.4 Test migration (up/down, dữ liệu cũ giữ nguyên), mã hoá không lộ plaintext, CRUD, cô lập profile, xoá agent → `agent_id = NULL`, purge profile.

## 3. Agent runtime

- [x] 3.1 Thêm hàm thuần `clampPreset(selected, ceiling)` trong `tool-preset-selector.ts`; luôn trả về một `ToolPreset` có sẵn.
- [x] 3.2 Thêm `agentInstructions?` vào `BuildContextInput`: nối sau prompt gốc trong khối đánh dấu, tính vào ngân sách token.
- [x] 3.3 Nhận trần preset trong `AgentRuntime`: áp `clampPreset`, đường `nexa_mo_rong_tool` chuyển về trần thay vì `all`, bỏ tool meta khi đã bằng trần.
- [x] 3.4 Test: bảng clamp (kể cả trần `all`), mở rộng tool không vượt trần, không có agent thì hành vi và khối `tools` giữ nguyên từng byte, prompt gốc luôn đứng trước.

## 4. Main process

- [x] 4.1 Wire `AgentRepository` vào `NexaServices`.
- [x] 4.2 Handler IPC `agents:*` và `conversations:set-agent` bind cứng profile hiện tại, kiểm tra ownership; từ chối agent archived khi gắn mới.
- [x] 4.3 Khi gắn agent có model: resolve và `setModel` nếu còn khả dụng, bỏ qua nếu không.
- [x] 4.4 `chat-controller`: đọc agent của hội thoại mỗi lượt, truyền `agentInstructions` và trần vào runtime, AND công tắc nhóm cục bộ với setting toàn cục khi ghép `localTools`.
- [x] 4.5 Test: IPC (ownership, validation), gắn/bỏ agent, model đã xoá, tool ghi vẫn qua guard, nhóm cục bộ bị tắt, bộ lọc provider ngoài vẫn chạy trên model cuối.

## 5. Renderer

- [x] 5.1 Mở rộng `bridge.ts` với `api.agents.*` và `conversations.setAgent`; thêm vào preload allowlist.
- [x] 5.2 `AgentsView`: danh sách, form tạo/sửa (tên, icon, hướng dẫn, trần tool, hai công tắc, model), archive/khôi phục/xoá có xác nhận; cảnh báo khi model là provider ngoài tổ chức.
- [x] 5.3 Mục điều hướng trong `Sidebar` và route trong `App.tsx`.
- [x] 5.4 Bộ chọn agent trong `ChatView` (kèm "Mặc định"), hiển thị tên agent và trần tool đang áp.
- [x] 5.5 Test phần logic thuần của UI (theo mẫu `*-ui.ts`/`*-ui.test.ts`), gồm nhãn trần tool và điều kiện hiện cảnh báo.

## 6. Tài liệu & kiểm tra

- [x] 6.1 Ghi ADR ngắn: trần tool là phép giao trong tập preset đóng, không phá ADR 0009.
- [x] 6.2 Cập nhật README/DESIGN nếu có mục liệt kê tính năng.
- [x] 6.3 Chạy typecheck, lint và toàn bộ test; xác nhận hội thoại không agent không đổi hành vi.
