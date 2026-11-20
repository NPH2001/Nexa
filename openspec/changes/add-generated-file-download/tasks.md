## 1. Module thuần `shared-types/src/file-blocks.ts`

- [x] 1.1 Tạo `packages/shared-types/src/file-blocks.ts`: thuần, **không import zod** (renderer nạp module này qua entry hẹp `renderer.ts`, và entry đó cố ý không kéo zod vào tiến trình không tin cậy). Export giá trị + type từ `renderer.ts`, và `export *` từ `index.ts` cho main.
- [x] 1.2 Định nghĩa allowlist `FILE_BLOCK_FORMATS` (`drawio`, `txt`, `md`, `csv`, `json`, `xml`, `yaml`, `yml`, `sql`, `puml`, `mmd`, `svg`, `http`) kèm phần mở rộng, nhãn tiếng Việt và tên file mặc định cho từng định dạng. Đây là nguồn sự thật duy nhất — không có bản thứ hai ở renderer hay main.
- [x] 1.3 Định nghĩa `ContentSegment = TextSegment | FileBlockSegment | PartialBlockSegment | OversizeBlockSegment` với đủ trường UI cần (`format`, `fileName`, `content`, `byteLength`, `lineCount`, `reason`).
- [x] 1.4 Viết `parseFileBlocks(content)`: tách fence, đọc info string (`<format> filename=<tên>`), giữ nguyên phần văn xuôi trước/sau, và trả về segment theo đúng thứ tự xuất hiện.
- [x] 1.5 Luật dự phòng: fence `xml` mà nội dung mở đầu bằng `<mxfile` ⇒ định dạng `drawio`. Fence có định dạng ngoài allowlist ⇒ trả về `TextSegment` nguyên văn, không thành khối file.
- [x] 1.6 Fence đã mở mà chưa đóng ⇒ `PartialBlockSegment` kèm tên file nếu info string đã đủ; không đưa nội dung đang tới vào `content` để UI không đổ XML thô ra khung chat.
- [x] 1.7 Viết `normalizeFileName(raw, format)`: lược mọi thành phần đường dẫn và `/ \ :`, bỏ `..`, bỏ ký tự điều khiển và `< > : " | ? *`, bỏ dấu chấm/khoảng trắng ở cuối, đổi tên trùng thiết bị Windows (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`), cắt độ dài về ≤ 120 ký tự, và bảo đảm đúng phần mở rộng của `format`.
- [x] 1.8 Áp trần: `MAX_BLOCK_BYTES = 1_000_000` mỗi khối ⇒ `OversizeBlockSegment` kèm lý do; `MAX_BLOCKS_PER_MESSAGE = 20` ⇒ giữ 20 khối đầu và trả về số khối bị bỏ.
- [x] 1.9 Test parser: một khối; nhiều khối; văn xuôi trước/sau/giữa; không có fence; fence không `filename=`; fence `xml` + `<mxfile`; fence định dạng ngoài allowlist; `filename=setup.exe`; fence chưa đóng; fence 4 backtick; ba backtick nằm trong nội dung file; CRLF lẫn LF; dòng cuối không có newline (nội dung phải trùng từng ký tự).
- [x] 1.10 Test `normalizeFileName`: `../../Windows/System32/evil.txt`; `CON.txt`; `a:b.txt`; tên kết thúc bằng `.` và bằng khoảng trắng; tên rỗng sau chuẩn hoá ⇒ tên mặc định; tên 300 ký tự; tên có phần mở rộng lệch `format`; tên tiếng Việt có dấu (phải giữ được).

## 2. Contract trong `shared-types`

- [x] 2.1 Thêm `'file:save'` vào `IPC_CHANNEL_NAMES` ngay cạnh `'file:pick'`/`'file:release'` (`channels.ts`).
- [x] 2.2 Thêm `fileSaveSchema` (`fileName` 1–120, `format` enum theo allowlist, `content` 1–1_000_000) và đăng ký vào `IPC_SCHEMAS`; giữ `Covers<>` xanh để hai danh sách channel không lệch.
- [x] 2.3 Thêm mã lỗi `FILE_WRITE_FAILED` vào `ERROR_CODES` và catalog, `retryable: true`, thông điệp nêu đúng một hành động (chọn thư mục khác hoặc đóng ứng dụng đang giữ file).
- [x] 2.4 Test schema: payload có thêm `path`/`filePath`/`directory` bị strip trước khi tới handler; `content` rỗng và `content` vượt trần bị từ chối; `format` lạ bị từ chối.

## 3. Writer trong main process

- [x] 3.1 Thêm `apps/desktop/src/main/file-writer.ts`: nhận `{ fileName, format, content }`, chuẩn hoá lại tên bằng `normalizeFileName` từ `@nexa/shared-types`, đối chiếu allowlist, mở `dialog.showSaveDialog` với `defaultPath: join(app.getPath('downloads'), safeName)` và `filters` theo `format`.
- [x] 3.2 Ghi bằng `writeFile` async, encoding `utf8`; không `writeFileSync` (1 MB trên ổ mạng đủ làm nghẽn main process).
- [x] 3.3 Trả `{ saved: true, fileName }` hoặc `{ saved: false, canceled: true }`; **không** trả đường dẫn, **không** `shell.openPath`, **không** `shell.showItemInFolder`.
- [x] 3.4 Ánh xạ lỗi: định dạng/phần mở rộng ngoài allowlist ⇒ `FILE_UNSUPPORTED`; vượt trần ⇒ `FILE_TOO_LARGE`; `EACCES`/`EBUSY`/`ENOSPC`/`EPERM` ⇒ `FILE_WRITE_FAILED`.
- [x] 3.5 Đăng ký handler `'file:save'` trong `ipc.ts` cạnh `'file:pick'`, dùng `ctx.getWindow()` cho hộp thoại modal và ném `INTERNAL_ERROR` khi không có window; wire writer vào `services.ts`.
- [x] 3.6 Log `file-saved` / `file-save-canceled` / `file-save-failed` chỉ với `format`, `bytes`, `errorType`. Không tên file, không đường dẫn, không nội dung (§15.1).
- [x] 3.7 Test với `dialog`/`fs` mock: lưu thành công ghi đúng nội dung; huỷ hộp thoại không ghi byte nào và không ném lỗi; `..` trong `fileName` không đổi được nơi ghi; `.exe` bị từ chối trước khi hộp thoại mở; lỗi ổ đĩa thành `FILE_WRITE_FAILED`; log không chứa tên file.

## 4. Bridge và thẻ file trong chat

- [x] 4.1 Thêm `api.files.save({ fileName, format, content })` vào `bridge.ts` cạnh `pick`/`release`, kiểu chặt theo hợp đồng ở mục 2.
- [x] 4.2 Đổi nhánh render body của assistant message trong `ChatView.tsx` sang `parseFileBlocks`: `TextSegment` giữ nguyên cách render text thuần hiện tại; message của user **không** đổi một dòng nào.
- [x] 4.3 Dựng `FileBlockCard`: icon theo định dạng, tên file, nhãn định dạng, dung lượng, số dòng, nút **Tải xuống**, nút **Xem nội dung** (mặc định thu gọn).
- [x] 4.4 Nội dung khi mở xem: `<pre>` có `overflow` riêng, không tràn khung chat, không `dangerouslySetInnerHTML`, không thư viện highlight.
- [x] 4.5 Trạng thái `PartialBlockSegment`: "Đang tạo `<tên file>`…", không nút tải xuống. Nút tải xuống chỉ hiện khi fence đã đóng **và** `message.status !== 'streaming'`.
- [x] 4.6 Trạng thái `OversizeBlockSegment`: thẻ vô hiệu kèm lý do; các thẻ khác trong cùng message vẫn tải xuống được. Vượt trần số khối ⇒ nêu rõ còn khối chưa hiển thị.
- [x] 4.7 Trạng thái nút: đang lưu (disable, chống bấm đúp), đã lưu (toast "Đã lưu `<tên file>`"), huỷ (không toast, không lỗi), lỗi (toast lỗi + vẫn cho thử lại).
- [x] 4.8 CSS cho thẻ file trong `styles.css` theo token màu/spacing hiện có; kiểm cả theme sáng và tối nếu app có cả hai.
- [x] 4.9 Test renderer cho helper hiển thị (nhãn định dạng, format dung lượng, điều kiện hiện nút) và cho ba trạng thái thẻ.

## 5. Quy ước trong system prompt

- [x] 5.1 Thêm đúng một quy tắc vào `DEFAULT_SYSTEM_PROMPT` (`context-builder.ts`): khi người dùng yêu cầu một file, đặt toàn bộ nội dung trong một fence duy nhất kèm định dạng và `filename=<tên>`; chỉ tạo khối file khi người dùng yêu cầu file. Nêu danh sách định dạng được hỗ trợ ngắn gọn.
- [x] 5.2 Bước này làm **sau** mục 1–4: parser phải đủ tin cậy trước khi model bắt đầu sinh fence.
- [x] 5.3 Test: system prompt vẫn chứa nguyên các nguyên tắc cũ; quy tắc mới không tự thêm khối file vào các luồng khác (bản tin, BA review, checklist) vì chúng dùng prompt riêng.

## 6. Verification

> **Cập nhật 2026-11-19:** 6.2, 6.3 và 6.5 đã xong. Còn 6.4 (mở file bằng draw.io thật) — phải
> làm trước khi archive change.

- [x] 6.1 A11y: nút Tải xuống và Xem nội dung có `aria-label` rõ nghĩa kèm tên file; trạng thái đang tạo/đang lưu vào live region; thao tác đủ bằng bàn phím.
- [x] 6.2 E2E Electron với `dialog` mock: gửi một câu trả lời có fence `drawio` ⇒ thấy thẻ file ⇒ bấm Tải xuống ⇒ file trên đĩa trùng từng ký tự với nội dung trong fence. (`tests/e2e/app.e2e.ts`, kịch bản mock LiteLLM `file-block`, 2026-11-19)
- [x] 6.3 E2E: mở lại app, tải lại hội thoại cũ ⇒ thẻ file vẫn còn và vẫn tải xuống được (parse lại từ `message.content`, không có bảng mới). (lần mở thứ hai không có LiteLLM, 2026-11-19)
- [ ] 6.4 Kiểm bằng tay một vòng thật: nhờ model dựng sơ đồ `.drawio`, tải xuống, mở bằng draw.io để chắc file hợp lệ — file mở không được là "hợp lệ theo parser nhưng draw.io từ chối". **Chưa làm — cần người mở file bằng draw.io.**
- [x] 6.5 Chạy `pnpm verify` (lint + typecheck + test), `pnpm build`, và `pnpm test:e2e`. (2026-11-19: 101 file / 1408 test; build OK; E2E 39/39)
- [x] 6.6 Cập nhật README/DESIGN.md phần bề mặt chat, và ghi ba câu hỏi còn mở (nhị phân ở v2, clipboard, `html` trong allowlist) vào `docs/OPEN-QUESTIONS.md`.
