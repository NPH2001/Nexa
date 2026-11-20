## Why

Nexa hiện chỉ có một "nhân cách" duy nhất (`DEFAULT_SYSTEM_PROMPT`) và một bộ tool chung. Người dùng
làm nhiều vai trò khác nhau (BA viết tài liệu, PM theo dõi Redmine, người chỉ muốn tra cứu XWiki)
phải lặp lại hướng dẫn mỗi hội thoại và không có cách giới hạn agent chỉ làm đúng việc mình muốn.

Change này cho phép người dùng tự tạo agent tùy biến mức persona: tên, hướng dẫn riêng, phạm vi tool
và model mặc định. Đây là cấu hình của chính người dùng, không phải workflow hay tự động hóa.

## What Changes

- Thêm migration v13: bảng `agents` (gắn `profile_id`, nội dung hướng dẫn mã hoá) và cột nullable
  `conversations.agent_id` (`ON DELETE SET NULL`).
- Thêm `AgentRepository` trong `local-store`: CRUD, archive/restore.
- Mỗi agent có: `name`, `icon`, `instructions`, `toolCeiling` (một `ToolPreset` có sẵn, mặc định
  `all`), `localToolGroups` (bật/tắt nhóm tool cục bộ cam kết / nghiệp vụ BA), `modelId` tuỳ chọn.
- Hướng dẫn của agent được nối **sau** `DEFAULT_SYSTEM_PROMPT` trong một khối được đánh dấu là cấu
  hình người dùng, không phải quy tắc an toàn. Không bao giờ thay thế prompt gốc.
- `toolCeiling` là **trần**: preset do bộ chọn theo ngữ cảnh chọn (ADR 0009) được giao với trần này.
  Agent chỉ thu hẹp được thứ model nhìn thấy; không nới quyền, không đổi Confirmation Guard.
- Thêm IPC `agents:list/create/update/archive/restore/delete`; renderer không được gửi `profileId`.
- Thêm IPC `conversations:set-agent` để gắn/bỏ agent cho hội thoại.
- Thêm màn hình **Agent** (quản lý) và bộ chọn agent trong `ChatView`.
- `chat-controller` đọc agent của hội thoại, áp trần tool, tắt nhóm tool cục bộ không được phép, và
  dùng model mặc định của agent khi hội thoại chưa chọn model riêng.
- Không có tính năng chia sẻ, xuất/nhập, workflow, trigger tự động, hay agent gọi agent.

Không có thay đổi breaking: `agentId` và `agentInstructions` là optional ở runtime; hội thoại không
có agent chạy đúng như hiện nay.

## Capabilities

### New Capabilities

- `custom-agents`: CRUD agent theo profile, persona nối sau prompt gốc, trần tool chỉ thu hẹp,
  gắn agent vào hội thoại, model mặc định của agent.

### Modified Capabilities

Không có capability cũ nào bị đổi contract. (Hành vi chọn preset theo ngữ cảnh của ADR 0009 giữ
nguyên; trần của agent chỉ là một phép giao thêm phía sau nó.)

## Impact

- `packages/shared-types`: kiểu `Agent`, schema Zod, channel `agents:*`.
- `packages/local-store`: migration v13, `AgentRepository`, thêm `agentId` vào conversation.
- `packages/agent-runtime`: `BuildContextInput.agentInstructions?`, `RunTurnInput`/deps nhận trần
  preset; phần giao preset đặt trong runtime để test được độc lập.
- `apps/desktop/src/main`: `services.ts`, `ipc.ts`, `chat-controller.ts`.
- `apps/desktop/src/renderer`: `AgentsView`, bộ chọn trong `ChatView`, điều hướng `Sidebar`, `bridge.ts`.
- Không thêm dependency. Không đổi tập prefix `tools` khả dĩ: trần chỉ chọn trong 10 preset đóng
  và hai cờ local đã tồn tại.
