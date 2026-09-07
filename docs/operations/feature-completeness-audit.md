# Kiểm tra mức hoàn thiện tính năng — 2026-09-05

Đối chiếu 9 change chưa archive của OpenSpec với mã nguồn và test thật, trên nhánh
`feat/daily-briefing`. Mục đích: thay câu trả lời tự khai ("tasks.md đã tick") bằng bằng chứng
kiểm chứng được.

Tài liệu này KHÔNG thay [`pre-pilot-checklist.md`](pre-pilot-checklist.md). Checklist đó hỏi
"đã sẵn sàng cho người dùng thật chưa"; tài liệu này hỏi "cái đã viết có đúng cái đã hứa không".

## Tầng 1 — cổng tự động

| Cổng | Kết quả |
|---|---|
| `pnpm lint` | sạch |
| `pnpm typecheck` | sạch |
| `pnpm test` | 1157 test / 82 file, tất cả xanh (8,2 s) |
| `pnpm build` | thành công |
| `pnpm test:e2e` | 32 xanh / 2 skip (2,3 phút) |

Hai test skip là [`windows-secure-storage.e2e.ts`](../../tests/e2e/windows-secure-storage.e2e.ts)
— DPAPI và ngân sách khởi động §12.1 — bị `test.skip` ngoài `win32`. Job `verify-windows` trong
[`ci.yml`](../../.github/workflows/ci.yml) chạy đúng file này trên `windows-latest`, và cổng ký số
phụ thuộc vào nó. **Chưa xác nhận job đó xanh trên nhánh này.**

## Tầng 2 — đối chiếu spec ↔ test

15 file spec, 110 requirement, 181 scenario. Mỗi scenario được tra ngược về một test cụ thể.

| Change | Req / Scenario | Scenario thiếu bằng chứng |
|---|---|---|
| add-daily-briefing | 8 / 17 | 0 |
| add-os-checkin-notifications | 9 / 22 | 0 |
| add-commitment-engine | 4 / 4 | 0 |
| add-bank-document-checklists | 4 / 3 | 0 |
| loc-tool-theo-ngu-canh | 14 / 33 | 0 |
| add-ba-workbench | 38 / 45 | 0 |
| add-proactive-check-ins-and-agent-activity | 10 / 18 | 0 (đã bịt 2026-09-05) |
| add-multi-format-file-upload | 10 / 19 | 0 (đã bịt 2026-09-05) |
| add-memory | 13 / 20 | 0 (đã bịt 2026-09-05) |

**Lần quét đầu: 174/181 scenario có test trỏ thẳng vào.** Bảy khoảng trống đã được bịt trong
cùng ngày — xem mục cuối. Con số hiện tại là **181/181**, với một khoản có giới hạn được ghi rõ. Bảy scenario khi đó có mã nguồn hiện thực nhưng
không có test nào khẳng định — hỏng đi thì không cổng nào đỏ.

Ba scenario nữa được tính là có bằng chứng, nhưng là bằng chứng **gián tiếp**, nên ghi ra đây để
người đọc tự cân: *"không có model nào được cấu hình"* của bản tin đi vào đúng nhánh `catch` mà
test *"model lỗi"* đã phủ; *"mở bản tin nhiều lần không sinh check-in nào"* chỉ được chống đỡ bởi
test *"không gọi tool nào ngoài jira_search"* cộng với việc service không hề gọi tới mã check-in;
và *"Do Not Disturb"* được suy ra từ việc Nexa ghi log lý do bỏ qua và suggestion vẫn nằm lại trên
Hôm nay. Cả ba đều đúng theo cấu trúc mã, nhưng không có test nào mang đúng tên đó.

## Bảy khoảng trống, xếp theo rủi ro

### 1. Cửa sổ trượt ngữ cảnh không có test nào — `short-term-memory` (4 scenario)

Nặng nhất, và không sát nhau một cách tình cờ: [`context-builder.ts`](../../packages/agent-runtime/src/context-builder.ts)
**không có file test riêng**. `buildContext` được gọi trong 4 file test, nhưng cả 4 đều kiểm góc
khác (memory, cam kết, tri thức BA, hiệu năng).

Không test nào khẳng định `truncatedCount`, `documentsTruncated`, hay việc ngân sách đổi theo
`contextWindowTokens` của model đang dùng. Các scenario không có bằng chứng:

- *Hội thoại dài, vượt budget* → message cũ bị bỏ đúng cách
- *Message bị lược bỏ khi gửi lượt hội thoại* → số bị bỏ hiện cho người dùng. Có hiện thực ở
  [`ChatView.tsx:660`](../../apps/desktop/src/renderer/components/ChatView.tsx#L660) và
  [`App.tsx:214`](../../apps/desktop/src/renderer/App.tsx#L214), không có test
- *Đổi sang model có cửa sổ ngữ cảnh lớn hơn* → ngân sách nới theo
- *Lượt có tài liệu đính kèm được ưu tiên trước history cũ*

Đây là loại lỗi hỏng âm thầm đúng nghĩa: cắt nhầm ngữ cảnh không ném lỗi, không hiện trên màn
hình, chỉ làm câu trả lời tệ đi. Nên bịt trước.

Ghi chú phụ khi lần theo đường này: trong
[`chat-controller.ts:671`](../../apps/desktop/src/main/chat-controller.ts#L671), nhánh
`case 'context-truncated': break` là no-op — thông tin tới UI bằng đường khác
(`truncatedContextCount` trên message đã hoàn tất). Sự kiện đó hiện không có người nhận.

### 2. Ảnh không bao giờ được lưu — `file-ingestion` (1 scenario)

Scenario *Image attached with extracted-text storage enabled*. Hiện thực nằm ở một biểu thức duy
nhất, [`chat-controller.ts:156`](../../apps/desktop/src/main/chat-controller.ts#L156): ảnh có
`doc.text === ''` nên không được ghi. Không test nào khẳng định — mà đây là một cam kết bảo mật,
không phải một tiện ích. Một thay đổi vô hại kiểu "lưu cả tên file" là đủ để phá nó.

### 3. Activity UI: error → retry giữ nguyên filter (1 scenario)

Có đủ loading / error / request id / nút Thử lại trong
[`ActivityTimelineView.tsx`](../../apps/desktop/src/renderer/components/ActivityTimelineView.tsx).
File test kèm theo chỉ kiểm hàm dịch nhãn. Không test nào đi qua chuyển trạng thái error → list và
khẳng định filter không bị reset.

### 4. Agent không tự lưu fact ngầm — `long-term-memory` (1 scenario)

Đúng, và đúng vì một lý do khoẻ: **không có tool memory nào trong registry** để agent gọi. Nhưng
không test nào khẳng định sự vắng mặt đó, trong khi các vùng khác có
(`commitment-tools.test.ts`: "exposes exactly the create and update tools — no delete";
`ba-tools.test.ts`: "không có tool nào xoá tri thức hay tài liệu"). Rủi ro thấp, chi phí bịt cũng
thấp.

## Ba mục tự khai còn dở — đã kiểm chứng lại

| Mục | Thực tế |
|---|---|
| `add-ba-workbench` 13.1–13.4 | Chặn vì chưa có chữ ký ATTT. **Không nằm trong requirement nào của spec** — 38/38 requirement BA đều có test. Đây là việc ngoài hợp đồng spec, không phải lỗ hổng của tính năng đã giao |
| `add-memory` 8.4 | Chỉ là bước archive change, không phải mã nguồn |
| `loc-tool` 7.4 | Kiểm tra tay đường mở rộng. Đường này đã có 15/15 scenario xanh tự động, gồm cả e2e — kiểm tay còn lại là xác nhận với model thật |

## Trạng thái từng tính năng

| Tính năng | Nhãn |
|---|---|
| Bản tin công việc (daily-briefing) | Xong — spec đủ, test đủ, e2e đủ |
| Thông báo OS + tray | Xong về mã — **chưa commit**, và chưa ai chạy trên Windows |
| Cam kết (commitment-engine) | Xong |
| Checklist chứng từ ngân hàng | Xong về mã — chưa chạy với tài liệu thật |
| Thu hẹp danh mục tool (ADR 0009) | Xong — còn một lần kiểm tay với model thật |
| Không gian Nghiệp vụ (BA) | Xong trong phạm vi spec — nhánh vision bị chặn ngoài spec |
| Memory dài hạn | Xong, trừ một khẳng định về sự vắng mặt của tool |
| Memory ngắn hạn (cửa sổ ngữ cảnh) | **Xong code, chưa chứng minh** — không có test cho phần cắt ngữ cảnh |
| Nhận tệp đa định dạng | Xong, trừ khẳng định ảnh không được lưu |
| Proactive check-in + Activity | Xong, trừ một async state của UI |

## Đã bịt — 2026-09-05

Năm khoản, 21 test mới, suite đi từ 1157 lên 1178. Mỗi khoản đều được kiểm bằng cách phá mã nguồn
rồi xác nhận test đỏ; không khoản nào xanh một cách rỗng tuếch.

| Khoản | Ở đâu | Bằng chứng |
|---|---|---|
| Cửa sổ trượt ngữ cảnh | [`context-builder.test.ts`](../../packages/agent-runtime/src/context-builder.test.ts) — 8 test mới | Đặt `truncatedCount = 0` ⇒ 3 test đỏ |
| Ảnh không được lưu | `chat-controller.test.ts` — 3 test mới | Bỏ điều kiện `doc.text !== ''` ⇒ 2 test đỏ |
| Không có tool ghi memory | `wiring.test.ts` — 4 test mới | Danh sách registry và tool là tập đóng, đếm cứng |
| Nhánh lỗi Activity | `wiring.test.ts` — 3 test mới | Thêm `setTypeFilter` vào catch ⇒ 2 test đỏ |
| Số message bị lược đi hết đường | `wiring.test.ts` — 3 test mới | Chuỗi runtime → main → hai chỗ trong renderer |

**Một giới hạn phải nói rõ:** phần Activity là test ĐỌC MÃ NGUỒN, không phải test render. vitest ở
repo này chạy `environment: 'node'`, và eslint cấm renderer chạm `node:fs` (§5.3) — hai ràng buộc
đều đúng, và chúng khiến không thể render component để đi qua chuyển trạng thái error → list.
Test hiện tại bắt được cách hỏng thật sự có khả năng xảy ra (ai đó dọn dẹp trạng thái trong nhánh
lỗi, hoặc nối nút thử lại vào một đường tải khác) nhưng không chứng minh được chuyển trạng thái.
Muốn chứng minh thì phải thêm jsdom và testing-library — một quyết định về hạ tầng test, chưa ai
ra quyết định đó.

## Việc còn lại

Cần máy Windows hoặc hệ thống thật (tầng 4, chưa chạy):

1. Xác nhận job CI `verify-windows` xanh trên nhánh này
2. Chạy tay tray + thông báo OS trên Windows
3. `loc-tool` 7.4 với model thật
4. Các mục ⚠️ của [`pre-pilot-checklist.md`](pre-pilot-checklist.md): LiteLLM và Jira thật

## Một ghi chú về công cụ

[`document-processor.test.ts`](../../packages/document-processor/src/document-processor.test.ts)
chứa ký tự Unicode vô hình làm fixture (U+202E, U+200B), nên `file` xếp nó là `data` và **`grep`
bỏ qua nó im lặng** — không báo lỗi, chỉ không có kết quả. 22 test biến mất khỏi lần quét đầu của
đợt kiểm tra này. Script nào đếm hay quét file test bằng `grep` đều cần `-a`.
