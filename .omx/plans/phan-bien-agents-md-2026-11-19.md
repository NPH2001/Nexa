# Báo cáo phản biện theo AGENTS.md

Ngày: 2026-11-19 · Chế độ: review-only, chưa sửa source.
Phạm vi: ~118 file đang sửa/chưa commit trên `main`. Thứ tự ưu tiên: KISS/YAGNI → DRY → SOLID.
Baseline: `pnpm verify` xanh (lint, typecheck, 99 file / 1380 test).

## 1. Backlog theo ưu tiên

| Ưu tiên | Mã | Nguyên tắc | Phát hiện | Đề xuất tối thiểu |
| ------- | -- | ---------- | --------- | ----------------- |
| P1 | Y-1 | Quy trình | Nhóm UI/UX (theme, shortcuts, toast, composer, settings-groups, copy, StateBlocks, ThemeSwitch; ~15 file) không có change OpenSpec. | Viết change bổ sung (proposal + tasks) cho nhóm này. |
| P1 | T-1 | Test | Handler `file:save` (`ipc.ts`) không có test trong `ipc.test.ts`; chỉ `file-writer` được test. Tasks 6.2–6.5 của `add-generated-file-download` còn mở (E2E, kiểm tay draw.io, build + e2e). | Thêm test handler (validate đầu vào, gọi writer); làm nốt 6.2–6.5. |
| P2 | K-1 + S-1 + S-4 + D-1 | KISS/SRP/DRY | `buildHandlers` 1031 dòng/87 handler trong một closure. Vòng đời MCP (`rebuildMcp`, `rebuildWorkMcp`, `mcpRebuildInFlight`) nằm ở tầng IPC và hai hàm trùng cấu trúc; 3 field MCP của `NexaServices` bị gán lại từ ngoài. 6 hàm `require*ForCurrentProfile` cùng một bất biến bảo mật. | Tách `register*Handlers` theo namespace; đưa vòng đời MCP vào `mcp-lifecycle.ts` với một `rebuild(system)`; gộp 6 guard thành một hàm dùng chung (giữ `requireBaWorkbench()`). Chỉ di chuyển code, giữ test xanh. |
| P2 | T-2 | Test | `rebuildWorkMcp` (mới) và `windowBackgroundColor` (`window.ts`, mới) chưa có test. | Test hành vi rebuild (lỗi start không chặn lưu, cờ in-flight); test `windowBackgroundColor` theo preference. |
| P2 | K-2 | SRP | `SettingsView.tsx` 1696 dòng (+143) chứa 5 panel đã là component độc lập. | Chuyển mỗi panel sang file riêng, không đổi logic. |
| P2 | K-3 | SRP | `ChatView.tsx` +213 dòng, chứa `FileBlockCard`, `MessageBody`, `MessageBubble`. | Chuyển 3 component này sang file riêng; không tách `ChatView` chính. |
| P2 | Y-2 | YAGNI | `copy.ts` chỉ được `tests/renderer-copy.test.ts` dùng (không có import production). | Quyết định: xoá cùng test, hoặc giữ làm lint nội dung và ghi rõ trong DESIGN.md. |
| P2 | Q-1 | Tài liệu | README ghi 1108 unit/integration + 33 E2E; thực tế 1380 unit/integration và 35 E2E khai báo (33 + 2 Windows-only). | Cập nhật số liệu README. |
| P3 | Y-3 | YAGNI | Thư mục `1/` (15 ảnh chụp, chưa theo dõi, không được tham chiếu). | Xoá hoặc thêm `.gitignore`. |
| P3 | Y-4 | YAGNI | Export chỉ dùng nội bộ/test: `ResolvedTheme`, `DEFAULT_THEME_PREFERENCE`, `parseThemePreference`, `readCachedTheme`, `ShortcutKey`, `ShortcutContext`, `SendState`, `SettingsGroup`, `SETTINGS_TAB_ORDER`, `groupOfTab`; `REDMINE_SECRET_HEADER_KEYS` (chỉ test dùng, test tự khẳng định hằng số). | Bỏ `export` thừa; xoá hằng và test vô nghĩa. |
| P3 | D-ngày giờ | DRY | `formatActivityTimestamp` và `formatCommitmentDate` dùng cùng option `dd/mm/yyyy HH:mm`. Các hàm định dạng khác khác nhau có chủ đích. | Gộp đúng hai hàm này nếu muốn; không làm bộ định dạng toàn app. |
| P3 | Q-2 | Quy trình | `add-daily-briefing` đã xong 34/34 task; `add-redmine-xwiki-connectors` còn 1 task (10.4 chạy thật phần ghi + qua UI). | Archive daily-briefing; chốt 10.4 sau khi có môi trường thật. |

## 2. Theo dõi, không sửa lúc này

| Mã | Lý do không sửa |
| -- | --------------- |
| K-4 `App.tsx` 619 dòng (+43) | Chưa có bằng chứng khó test; xem lại khi thêm tính năng. |
| K-5 `bootstrapServices` 318 dòng (+171) | Là composition root; đã tách `buildRedmineServer`/`buildXwikiServer`. |
| S-2 `ChatController` nhận cả `NexaServices` | Đã có 843 dòng test chạy được, file gần như không đổi; thu hẹp dependency phức tạp hơn lợi ích. |
| S-3 Thêm server MCP thứ ba phải sửa nhiều chỗ | YAGNI: khái quát khi có connector thứ ba (phần ở `ipc.ts` đã được S-1 gom). |
| `chat-controller.runTurn` 318 dòng | Không đổi trong đợt này. |
| `TodayView`, `GoalPanel`, `BaWorkbenchView` | Không đổi hoặc giảm trong đợt này. |
| `use-theme`, `use-global-shortcuts`, `ThemeSwitch`, `StateBlocks` chưa có test riêng | Glue mỏng; phần logic đã nằm trong `theme.ts`, `shortcuts-ui.ts` đã có test. Renderer nằm ngoài coverage config. |
| `index.ts` autostart MCP (vòng lặp mới) | File entry; có thể bao phủ qua E2E. |

## 3. Đã kiểm tra, không có vấn đề

- Không có code bị comment, không có TODO/FIXME.
- `StateBlocks`, `ThemeSwitch`, `useTheme`, `useGlobalShortcuts` đều được dùng.
- Redmine/XWiki khớp phạm vi proposal (không mở tool `delete_*`).
- `AgentRuntime` phụ thuộc `McpToolSource`; `AtlassianMcpManager`, `RemoteMcpServer`, `McpToolRouter` thay thế được nhau; router đóng với mở rộng (đã có test).
- `classifyRedmineError`/`classifyXwikiError`, `truncate*`, `stripSecrets` vs `redaction`: trùng hình thức nhưng khác lý do nghiệp vụ, để riêng.
- Phần lớn thay đổi hành vi trong `packages/*` có test đi kèm (llm-client, local-store, tool-preset, shared-types, mcp-client, connection-config, observability).

## 4. Thứ tự thực hiện đề xuất

1. Y-1 và T-1: bổ sung spec và test còn thiếu trước khi đổi cấu trúc.
2. Dọn P3 an toàn: Y-3, Y-4, Q-1 (một commit nhỏ).
3. K-2, K-3: chỉ di chuyển component, `pnpm verify` sau mỗi bước.
4. K-1 + S-1 + S-4 + D-1 kèm T-2: chia thành các commit nhỏ, từng namespace một.
5. Quyết định Y-2, gộp ngày giờ, archive daily-briefing (Q-2).

Mỗi bước: thay đổi nhỏ, đúng phạm vi, `pnpm verify` xanh trước khi sang bước sau.

## 5. Giới hạn của báo cáo

- Dựa trên đọc code, đo tĩnh (độ dài hàm/độ lồng) và grep; chưa chạy E2E, build hay coverage.
- Chưa soi từng tham số/field chưa dùng bên trong `work-mcp-servers`, `ipc.ts`, `chat-controller.ts`.
- Phần UI chỉ được xét theo cấu trúc code, không chấm giao diện, a11y hay bảo mật (đã có kế hoạch riêng `review-source-ui-nexa.md`).

## 6. Trạng thái xử lý (cập nhật 2026-11-19)

Kết quả cuối: `pnpm verify` 101 file / 1408 test xanh; `pnpm build` OK; `pnpm test:e2e` 39/39. Chưa commit.

| Mã | Trạng thái | Ghi chú |
| -- | ---------- | ------- |
| Y-1 | ✅ Đã xử lý (trước đợt này) | Change `add-ui-ux-refresh`. |
| T-1 | ✅ Handler có test; 6.2, 6.3, 6.5 xong | **Còn mở 6.4**: mở file `.drawio` bằng draw.io thật (cần người). |
| K-1 + S-1 + S-4 + D-1 | ✅ Đã xử lý | `buildHandlers` chỉ còn ghép 17 hàm `register*Handlers`; vòng đời MCP ở `mcp-lifecycle.ts` (`rebuild(system)`, nơi duy nhất gán lại `services.mcp/redmine/xwiki` sau bootstrap); 6 guard dùng chung `requireOwned`. |
| T-2 | ✅ Đã xử lý | `window.test.ts` (3 test) và 8 test vòng đời MCP + 4 test guard BA trong `ipc.test.ts`. |
| K-2 | ✅ Đã xử lý | 5 panel ra file riêng, code giống từng dòng. |
| K-3 | ✅ Đã xử lý | `FileBlockCard`, `MessageBody`, `MessageBubble` (kèm `UncertainAction`, `describeToolCall`) ra file riêng; `tests/wiring.test.ts` đổi đường dẫn file đọc (được duyệt). |
| Y-2 | ✅ Đã xử lý | Xoá `copy.ts` và `tests/renderer-copy.test.ts` (quyết định a); DESIGN.md + design.md cập nhật. |
| Q-1 | ✅ Đã xử lý | README: 1408 unit/integration + 39 E2E (37 + 2 Windows-only). |
| Y-3 | ✅ Đã xử lý | Xoá thư mục `1/`. |
| Y-4 | ✅ Một phần, có chủ đích | Bỏ export `ResolvedTheme`, `DEFAULT_THEME_PREFERENCE`, `ShortcutContext`, `SettingsGroup`; xoá `REDMINE_SECRET_HEADER_KEYS` + dòng test tự khẳng định. **Giữ** export của `parseThemePreference`, `readCachedTheme`, `ShortcutKey`, `SendState`, `SETTINGS_TAB_ORDER`, `groupOfTab` vì test import. |
| D-ngày giờ | ✅ Đã xử lý | `formatDateTime` trong `datetime-ui.ts` (có test); `formatCommitmentDate` giữ nhánh `null`. |
| Q-2 | ⏳ Còn mở | Chưa archive `add-daily-briefing`: `switch-briefing-to-redmine` còn task 5.2 (đã có kịch bản, cần Redmine thật). Delta MODIFIED của switch đặt tên "Khối **Redmine** là read-only…" trong khi spec gốc là "Khối **Jira** là read-only…" — cần thêm mục RENAMED trước khi archive. `add-redmine-xwiki-connectors` 10.4 vẫn mở. |

Phát sinh trong đợt:

- `tests/performance.test.ts` (mở DB + migration < 2 s) thỉnh thoảng đỏ ~5050 ms khi cả bộ test chạy song song trên Windows; chạy riêng luôn xanh. Có sẵn từ baseline, chưa xử lý.
- `openspec/changes/add-redmine-xwiki-connectors/tasks.md` 3.2 còn nhắc `REDMINE_SECRET_HEADER_KEYS` đã xoá.
