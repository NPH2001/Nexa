---
title: 'Nexa remediation round 2 — MCP lifecycle and provider policy'
tags: ['nexa', 'remediation', 'mcp', 'policy', 'openai', 'testing', 'visual-qa']
created: 2026-08-23T11:26:45.148Z
updated: 2026-08-23T11:26:45.148Z
sources: []
links: ['nexa-remediation-final-2026-08-23.md']
category: session-log
confidence: medium
schemaVersion: 1
---

# Nexa remediation round 2 — MCP lifecycle and provider policy

# Mục tiêu

Tiếp nối kết quả tại [[nexa-remediation-final-2026-08-23]].

Tiếp tục remediation sau vòng review đầu: đóng race giữa MCP tool call và reconfigure/restart, thêm kill switch quản trị cho OpenAI trực tiếp, sửa tài liệu sai lệch và kiểm chứng lại toàn bộ release gates.

# Thay đổi triển khai

- AtlassianMcpManager theo dõi activeToolCallCount và trạng thái restarting; restart bị từ chối bằng OPERATION_ALREADY_RUNNING khi lifecycle đang bận. Tool call đang chạy luôn hoàn tất và counter được dọn trong finally.
- IPC chặn save/delete kết nối Jira, Confluence và MCP Gateway cũng như restart thủ công khi MCP đang bận. Lưu OpenAI không còn rebuild MCP ngoài ý muốn.
- OrgPolicy có allowDirectOpenAi. Policy false chặn save/test/build client, model add/default/resolve/verify và conversation creation; cấu hình cũ vẫn xóa được.
- Policy file không tồn tại giữ default tương thích. Policy tồn tại nhưng sai schema fail closed riêng cho OpenAI và ghi event org-policy-invalid-using-safe-defaults.
- ModelService bắt buộc nhận OrgPolicy; setDefault xác thực model trước khi xóa default cũ.
- Renderer chỉ dùng model được policy cho phép. Settings hiển thị cảnh báo khóa, vô hiệu hóa thao tác cấu hình/test nhưng giữ nút xóa và đánh dấu model cũ bị policy khóa.
- Tài liệu deployment, integration, threat model, open questions và README được đồng bộ với transport stdio/HTTPS gateway và kill switch OpenAI.

# Regression tests

- MCP restart bị từ chối trong delayed tool call và call vẫn hoàn tất.
- IPC không persist/rebuild khi MCP đang bận; manual restart và thao tác cấu hình chạy chen trong lúc rebuild cũng bị chặn.
- OpenAI bị chặn không ghi metadata hay secret; execution với cấu hình cũ cũng bị chặn.
- Policy áp dụng tại model service và conversation IPC boundary; LiteLLM vẫn hoạt động.
- Model mặc định không bị mất khi chọn id không tồn tại.
- Policy hỏng fail closed và trả log chẩn đoán.

# Visual QA

Reference: .omx/visual/nexa-remediation/settings-wide.png.
Generated state: .omx/visual/nexa-remediation/settings-openai-policy-locked.png.
Verdict được lưu tại .omx/state/nexa-remediation-round-2/ralph-progress.json: 95/100, pass. Đã thay emoji khóa bị fallback glyph trên Linux bằng nhãn chữ Chính sách tổ chức.

# Bằng chứng cuối

- pnpm verify: lint sạch, typecheck sạch, 21 test files và 390/390 tests pass.
- pnpm test:coverage: statements 70.13%, branches 62.06%, functions 57.75%, lines 72.21%.
- pnpm test:e2e: 15 pass trên Linux, 2 Windows-only skip đúng điều kiện.
- pnpm audit và pnpm audit --prod ở mức high: không có lỗ hổng đã biết.
- pnpm package:dir: tạo release/0.1.0/linux-unpacked/Nexa thành công.
- Electron fuses: cả 9 vị trí được đặt tên và kiểm tra; RunAsNode off, cookie encryption on, Node options off, CLI inspect off, ASAR integrity on, only-load-from-ASAR on, browser snapshot off, file protocol extra privileges off, Wasm trap handlers on. Strict mode làm build fail nếu Electron thêm fuse chưa được review.
- Renderer build 663.35 kB; main 376.36 kB; preload 2.54 kB.

# Quyết định và rủi ro còn lại

Policy phát hành mẫu giữ allowDirectOpenAi=true để không âm thầm đổi quyết định sản phẩm hiện tại; IT có thể đặt false để kill switch có hiệu lực. Các blocker còn lại cần môi trường/authority bên ngoài: Windows DPAPI và package job, credential hệ thống LiteLLM/Jira/Confluence thật, code signing, ownership nhóm tổ chức và chốt package MCP stdio. Các thay đổi hiện vẫn ở working tree, chưa commit.
