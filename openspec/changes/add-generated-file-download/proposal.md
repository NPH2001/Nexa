## Why

Khi người dùng nhờ Nexa dựng một sơ đồ `.drawio`, một file `.txt`, một `.csv` hay một `.md`, model
đã trả ra đúng nội dung — nhưng nội dung đó rơi thẳng vào `message.content` và được render như văn
bản thuần ([ChatView.tsx:615](apps/desktop/src/renderer/components/ChatView.tsx#L615)). Kết quả:
một bức tường XML giữa hội thoại, và cách duy nhất để dùng được nó là bôi đen, copy, mở Notepad,
dán, rồi tự đặt tên file kèm đúng phần mở rộng. Việc mà máy làm được thì người dùng đang phải làm
bằng tay, và mỗi lần copy thiếu một dòng là file không mở được.

Nexa hiện có luồng **đọc** file rất chặt (`file:pick` cấp token, đường dẫn không rời main process)
nhưng chưa có luồng **ghi** nào cho nội dung sinh ra trong hội thoại. Change này thêm chiều còn
lại: nhận diện khối nội dung file trong câu trả lời, hiển thị nó thành một thẻ file gọn thay vì
bức tường chữ, và cho tải xuống bằng một cú bấm qua hộp thoại lưu file của hệ điều hành.

## What Changes

- Thêm **quy ước khối file**: model bọc toàn bộ nội dung file trong một code fence có phần mở rộng
  và tên file (` ```drawio filename=luong-thanh-toan.drawio `). Bổ sung đúng một quy tắc vào
  `DEFAULT_SYSTEM_PROMPT`; không có tool mới, không có lượt gọi model thêm.
- Thêm package thuần `@nexa/file-blocks`: parser tách khối file khỏi văn xuôi, chuẩn hoá tên file,
  và giữ **allowlist phần mở rộng**. Cả renderer (để hiển thị) và main (để kiểm lại trước khi ghi)
  dùng chung đúng module này — hai lớp, cùng một nguồn sự thật, giống cách `file-broker` kiểm lại
  loại file mà hộp thoại đã lọc.
- Thêm **thẻ file** trong khung chat: tên file, định dạng, dung lượng, số dòng, nút **Tải xuống** và
  nút xem nội dung (mặc định thu gọn — XML `.drawio` mở sẵn chỉ là rác thị giác). Phần văn xuôi
  quanh khối vẫn render như hiện tại.
- Thêm channel IPC `file:save`: renderer gửi **nội dung + tên file gợi ý**, main mở
  `dialog.showSaveDialog` rồi ghi UTF-8. Renderer không bao giờ gửi đường dẫn, và đường dẫn đã lưu
  cũng không trả về renderer.
- Thêm mã lỗi `FILE_WRITE_FAILED` cho trường hợp ổ đĩa từ chối ghi hoặc file đang bị khoá — hiện
  chưa có mã nào diễn đạt được việc này.
- **KHÔNG** render markdown đầy đủ. Văn xuôi vẫn là text thuần do React escape; change này thêm
  đúng một phép tách khối, không mở cửa cho HTML hay `dangerouslySetInnerHTML`.
- **KHÔNG** ghi file nhị phân, không base64, và không cho phép phần mở dạng thực thi
  (`.exe`, `.bat`, `.ps1`, `.cmd`, `.lnk`, `.js`…). Nội dung model sinh ra có thể chịu ảnh hưởng từ
  văn bản Jira/Confluence hoặc tài liệu người dùng đính kèm, nên nút "Tải xuống" không được là
  đường ngắn nhất để một chuỗi ký tự lạ trở thành file chạy được trên máy.
- **KHÔNG** tự lưu, không tự mở file, không mở thư mục sau khi lưu. Mỗi lần ghi là một cú bấm của
  người dùng cộng một lần chọn thư mục.
- **KHÔNG** thêm bảng, không migration: khối file được parse lại từ `message.content` đã lưu, nên
  tải xuống vẫn hoạt động sau khi khởi động lại app mà không cần lưu trùng nội dung.

## Capabilities

### New Capabilities
- `generated-file-export`: quy ước đánh dấu khối nội dung file trong câu trả lời của model; cách
  parse và hiển thị khối đó (kể cả khi đang stream dở); chuẩn hoá tên file và allowlist phần mở
  rộng; hợp đồng ghi file qua main process và hành vi khi người dùng huỷ hoặc ổ đĩa lỗi.

### Modified Capabilities
<!-- Không có. `file-ingestion` là luồng ĐỌC file người dùng chọn và không bị change này chạm tới:
     không dùng lease token, không đi qua DocumentProcessor, không chia sẻ giới hạn kích thước. -->

## Impact

- **Code:** package thuần mới `packages/file-blocks`; `packages/shared-types`
  (`channels.ts`, `ipc.ts`, `errors.ts`); `packages/agent-runtime` (`context-builder.ts` —
  system prompt); `apps/desktop/src/main` (writer + đăng ký handler trong `ipc.ts`, `services.ts`);
  `apps/desktop/src/preload` không đổi mã, chỉ nhận thêm tên channel từ danh sách trắng;
  `apps/desktop/src/renderer` (`bridge.ts`, `ChatView.tsx`, `styles.css`).
- **Data:** không thêm bảng, không thêm ciphertext, không migration. Không có bản sao nội dung nào
  ngoài `message.content` đã có.
- **Mạng:** không có. Toàn bộ luồng nằm giữa renderer, main và ổ đĩa cục bộ.
- **Bảo mật:** đây là **quyền ghi file đầu tiên do renderer khởi phát** trong Nexa, nên phải thoả
  §5.3 (renderer không truyền đường dẫn) và §11.1 (renderer không chạm hệ thống file trực tiếp).
  Chốt chặn: đường dẫn do `dialog.showSaveDialog` sinh ra, tên file được chuẩn hoá và allowlist
  kiểm hai lần, nội dung chỉ là văn bản UTF-8 và có trần dung lượng.
- **Privacy/logging:** không log tên file lẫn nội dung (§15.1). Chỉ log phần mở rộng, số byte và
  kết quả `saved`/`canceled`/`failed`.
- **Agency:** không có side effect ngoài máy, không tool call, nên không có đường nào chạm
  Confirmation Guard. Người dùng vẫn là người bấm và người chọn thư mục.
- **Dependencies:** không thêm package npm. Parser viết tay vì repo cố ý chưa có thư viện markdown
  nào.
