## Context

Nexa đã có một luồng file rất chặt, nhưng chỉ theo một chiều. `FileBroker.pick()` mở hộp thoại,
giữ đường dẫn thật trong một `Map` ở main process và chỉ trả về UUID cho renderer
([file-broker.ts:40-101](apps/desktop/src/main/file-broker.ts#L40-L101)); preload chỉ expose
`invoke`/`on` qua danh sách trắng ([preload/index.ts:22-59](apps/desktop/src/preload/index.ts#L22-L59));
mọi input được zod validate theo bảng `IPC_SCHEMAS`
([ipc.ts:522-622](packages/shared-types/src/ipc.ts#L522-L622)). Chiều ghi thì chưa tồn tại: grep
toàn repo không có `showSaveDialog` nào, và thứ gần nhất là `exportDiagnostics()` — ghi thẳng vào
`app.getPath('downloads')` rồi `shell.openPath` ([diagnostics.ts:19-96](apps/desktop/src/main/diagnostics.ts#L19-L96)),
nhưng đó là bundle do **code** dựng, không phải nội dung do **model** sinh.

Phía UI cũng chưa có gì để tựa vào: `message.content` được render nguyên khối như text thuần
([ChatView.tsx:610-617](apps/desktop/src/renderer/components/ChatView.tsx#L610-L617)). Repo cố ý
không có thư viện markdown nào trong `package.json`, nên không có cây AST để chèn vào — và cũng
không có sẵn bề mặt XSS nào để vô tình mở rộng.

Ba ràng buộc định hình thiết kế:

1. **Renderer không được chạm hệ thống file** (§11.1) và **không được đề xuất đường dẫn** (§5.3).
   Nguyên tắc này viết cho luồng đọc; luồng ghi phải chịu đúng nó, không được nhẹ hơn.
2. **Nội dung model sinh ra là dữ liệu không tin cậy.** Threat model đã ghi "không coi LLM output là
   dữ liệu tin cậy", và output đó có thể mang theo ảnh hưởng từ văn bản Jira/Confluence hoặc tài
   liệu người dùng đính kèm. Một nút "Tải xuống" là đường ngắn nhất biến chuỗi ký tự đó thành file
   trên ổ đĩa, nên tên file và phần mở rộng phải được coi như input thù địch.
3. **Không thêm bảng, không migration.** Nội dung file đã nằm trong `message.content` đã mã hoá.
   Lưu bản thứ hai chỉ để có nút tải xuống là nhân đôi dữ liệu nhạy cảm mà không đổi lấy được gì.

## Goals / Non-Goals

**Goals:**

- Nội dung file trong câu trả lời hiện ra dưới dạng một thẻ file gọn (tên, định dạng, dung lượng,
  số dòng) thay vì một bức tường XML giữa hội thoại.
- Một cú bấm là ra file đúng tên, đúng phần mở rộng, đúng nội dung — không copy tay, không mất dòng.
- Tải xuống vẫn hoạt động sau khi khởi động lại app, không cần lưu trùng nội dung ở đâu.
- Đường dẫn không rời main process theo cả hai chiều: renderer không gửi vào, cũng không nhận về.
- Cùng một allowlist và cùng một phép chuẩn hoá tên file chạy ở cả renderer và main.

**Non-Goals:**

- Render markdown đầy đủ (heading, bảng, link, inline code). Đó là một change riêng, với bề mặt bảo
  mật riêng cần bàn riêng.
- File nhị phân: PNG, PDF, XLSX, ZIP, hay bất cứ thứ gì đi qua base64. v1 chỉ ghi văn bản UTF-8.
- Mở file hoặc mở thư mục sau khi lưu. Mở một file do model sinh ra là bước xa hơn hẳn việc lưu nó.
- Tự lưu, lưu hàng loạt, hay lưu nhiều khối bằng một lần bấm.
- Sao chép vào clipboard: `setPermissionCheckHandler(() => false)`
  ([window.ts:123-127](apps/desktop/src/main/window.ts#L123-L127)) chặn quyền clipboard của
  renderer, nên việc này cần một channel IPC riêng và một quyết định riêng.
- Sửa nội dung khối trước khi lưu, hay xem trước sơ đồ `.drawio` bằng renderer đồ thị.
- Setting bật/tắt tính năng (xem Quyết định 8).

## Decisions

### 1. Đánh dấu bằng code fence, không bằng tool call

Model bọc nội dung file trong một fence có phần mở rộng và tên file:

````
```drawio filename=luong-thanh-toan.drawio
<mxfile ...>
```
````

Thêm đúng một quy tắc vào `DEFAULT_SYSTEM_PROMPT`
([context-builder.ts:16-28](packages/agent-runtime/src/context-builder.ts#L16-L28)): khi người dùng
yêu cầu một file, đặt toàn bộ nội dung trong một fence duy nhất kèm `filename=`; khi không ai yêu
cầu file thì không tạo fence.

**Đã cân nhắc: một tool `create_file` để model gọi.** Bỏ vì ba lý do. Nội dung file phải đi vào
tool argument, tức là toàn bộ XML `.drawio` bị serialize vào một JSON string — đắt token, dễ bị
model cắt giữa, và nhiều provider giới hạn độ dài argument. Tool call cũng không stream, nên người
dùng ngồi nhìn màn hình trống cho tới khi xong. Và mỗi tool mới lại thêm một mục vào registry cùng
với câu hỏi risk level, dù thao tác này không hề ra khỏi máy.

**Đã cân nhắc: nhận diện theo nội dung, không cần fence** (thấy `<mxfile` thì coi là drawio). Bỏ vì
không có điểm dừng: không biết khối kết thúc ở đâu, và không có tên file. Nhưng giữ lại một luật
dự phòng hẹp và kiểm được: một fence `xml` mà nội dung mở đầu bằng `<mxfile` được coi là `.drawio`,
vì model rất hay chọn `xml` thay vì `drawio` cho fence.

### 2. Parser và allowlist nằm trong `shared-types/file-blocks.ts`, không phải package mới

Module thuần, không React, không Electron, không zod. Bề mặt:

```ts
parseFileBlocks(content: string): readonly ContentSegment[]  // text | file-block | partial | oversize
normalizeFileName(raw: string, format: FileBlockFormat): string
FILE_BLOCK_FORMATS: readonly FileBlockFormat[]               // allowlist, một nguồn sự thật
```

Yêu cầu bắt buộc: **main và renderer phải dùng đúng một bản.** Main cần kiểm lại tên file và phần
mở rộng trước khi ghi — đúng khuôn `file-broker` đang dùng cho luồng đọc, nơi hộp thoại lọc ở mức
trình bày và main kiểm lại lần nữa "vì renderer có thể bị chèn mã"
([file-broker.ts:51-54](apps/desktop/src/main/file-broker.ts#L51-L54)). Hai bản allowlist thì đến
một ngày nào đó chúng sẽ lệch nhau, và bản lỏng hơn sẽ là bản đang chạy.

**Đã cân nhắc và LOẠI: package thuần mới `@nexa/file-blocks`** (đường của `@nexa/daily-briefing`,
`@nexa/ba-kit`). Không dùng được, vì renderer bị cấm import bất kỳ `@nexa/*` nào khác:
`electron.vite.config.ts` chỉ khai đúng một alias cho renderer —
`@nexa/shared-types/renderer` — và ghi rõ lý do "Renderer CHỈ được dùng shared-types. Mọi package
khác chạm vào Node hoặc secret (§13.1) — eslint chặn lúc lint, còn ở đây không khai alias để chặn
cả lúc build" ([electron.vite.config.ts:91-98](apps/desktop/electron.vite.config.ts#L91-L98)). Một
package mới sẽ hoặc phải phá ranh giới đó, hoặc phải tồn tại hai bản — cả hai đều tệ hơn.

`shared-types/src/renderer.ts` tồn tại chính xác cho việc này: entry hẹp đưa helper thuần sang
renderer mà không kéo zod vào tiến trình không tin cậy. Vì vậy `file-blocks.ts` **không được import
zod**; schema IPC của nó nằm trong `ipc.ts` và chỉ main chạm tới.

Phụ phẩm dễ chịu: không thêm package tức là không cần `pnpm install`, không thêm alias vào
`tsconfig.base.json`, `vitest.config.ts` và `electron.vite.config.ts`.

### 3. `dialog.showSaveDialog` trong main, không phải blob trong renderer

`window.ts` cho phép `blob:` và `data:` đi qua bộ chặn request
([window.ts:131-145](apps/desktop/src/main/window.ts#L131-L145)), nên `URL.createObjectURL` +
`<a download>` sẽ chạy được ngay hôm nay, khỏi cần channel mới.

Bỏ cách đó. Nó ghi file mà không hỏi người dùng muốn lưu ở đâu, không có cơ hội kiểm lại tên file ở
phía main, và làm renderer thành nơi quyết định file nào rơi xuống ổ đĩa — đúng thứ §11.1 nói không.
Tiết kiệm một channel IPC không đáng để đánh đổi ranh giới đó.

**Đã cân nhắc: ghi thẳng vào `app.getPath('downloads')` như `exportDiagnostics`.** Đây là tiền lệ có
thật trong repo, nhưng nội dung ở đó do code dựng và người dùng đã chủ động bấm "Xuất chẩn đoán".
Với nội dung do model sinh, việc để người dùng nhìn thấy tên file và chọn thư mục là một lớp kiểm
tra của con người, không phải một bước thủ tục. Hộp thoại cũng là thứ khiến đường dẫn được sinh ra
bởi hệ điều hành thay vì bởi tham số IPC.

### 4. Hợp đồng `file:save`: nội dung vào, không có đường dẫn ra

```ts
// channels.ts: thêm 'file:save' cạnh 'file:pick', 'file:release'
export const fileSaveSchema = z.object({
  fileName: z.string().min(1).max(120),
  format: fileBlockFormatSchema,
  content: z.string().min(1).max(1_000_000),
})
// → { saved: true, fileName } | { saved: false, canceled: true }
```

Main làm bốn việc, theo thứ tự: chuẩn hoá lại `fileName` bằng `@nexa/file-blocks` (bỏ mọi thành
phần đường dẫn, `..`, ký tự điều khiển, tên thiết bị Windows như `CON`/`NUL`/`COM1`, dấu chấm và
khoảng trắng ở cuối), đối chiếu phần mở rộng với allowlist, mở `showSaveDialog` với
`defaultPath: join(app.getPath('downloads'), safeName)`, rồi `writeFile(chosenPath, content, 'utf8')`.

Kết quả trả về **không chứa đường dẫn**. Người dùng vừa tự chọn thư mục nên họ biết file ở đâu;
renderer thì không cần biết, và cái gì không cần biết thì không nên nhận. Toast chỉ nói
"Đã lưu `<tên file>`".

Ghi bằng `writeFile` (async) chứ không `writeFileSync`: một file 1 MB trên ổ mạng đủ để làm nghẽn
main process, và main process nghẽn là cả UI đứng.

### 5. Allowlist chỉ gồm định dạng văn bản, và nó là danh sách trắng

`drawio`, `txt`, `md`, `csv`, `json`, `xml`, `yaml`/`yml`, `sql`, `puml`, `mmd`, `svg`, `http`.
Mọi thứ khác bị từ chối — kể cả khi model tự tin đặt tên `.exe`.

Danh sách trắng chứ không phải danh sách đen: một danh sách đen sẽ thiếu `.msi`, rồi thiếu `.vbs`,
rồi thiếu thứ gì Windows nghĩ ra năm sau. Đây cũng là lý do v1 không ghi nhị phân — không có đường
nào từ "chuỗi ký tự trong câu trả lời" tới "file chạy được", trừ khi chính người dùng đổi phần mở
rộng trong hộp thoại, và đó là quyết định của họ ở một mặt phẳng của hệ điều hành.

`svg` nằm trong danh sách dù nó chạy được script khi mở bằng browser. Lý do vẫn nhận: file được lưu
xuống ổ đĩa chứ không được Nexa mở, và một `.svg` không nguy hiểm hơn `.html`… mà `html` thì **không**
có trong danh sách, chính vì nó là thứ người dùng gần như chắc chắn sẽ bấm đúp để mở. Ranh giới ở
đây là "Nexa có mời người dùng mở file này không", và câu trả lời luôn là không.

### 6. Khối chưa đóng khi đang stream là một trạng thái, không phải lỗi

Chat stream từng delta vào `message.content`, nên có những khoảnh khắc fence đã mở mà chưa đóng.
Parser trả về segment `partial-block` cho trường hợp đó, và UI hiển thị "Đang tạo `<tên file>`…"
không kèm nút Tải xuống.

Nếu không xử lý riêng, mỗi lần tạo file người dùng sẽ thấy XML thô trào ra rồi biến mất khi khối
đóng lại — trông như một lỗi render, và đúng là một lỗi render.

Nút Tải xuống chỉ xuất hiện khi fence đã đóng **và** `message.status !== 'streaming'`. Ghi một file
mà byte cuối chưa tới thì tệ hơn là chưa cho ghi.

### 7. Chỉ message của assistant được tách khối; message người dùng giữ nguyên

Người dùng dán code vào chat là chuyện thường, và biến đoạn dán đó thành một thẻ file kèm nút tải
xuống là đem lại thứ họ không hỏi — họ đã có nội dung đó rồi. Giữ nhánh render của user message
đúng như hiện tại, không đổi một dòng.

### 8. Không thêm setting bật/tắt

Repo có thói quen đặt setting cho những gì chạm tới privacy hay tới model
(`dailyBriefingSummaryEnabled`, `commitmentContextEnabled`). Luồng này không gửi gì ra ngoài, không
gọi model thêm lần nào, và không tự chạy — mỗi lần ghi cần một cú bấm cộng một lần chọn thư mục.
Một công tắc toàn cục sẽ không chặn được rủi ro nào mà allowlist chưa chặn; nó chỉ thêm một ô trong
Settings và một nhánh trong code. Nếu sau này tổ chức yêu cầu khoá cứng việc ghi file, đó là một
policy field, không phải một preference — và khi đó nó thuộc `policy:get`, không thuộc change này.

### 9. Trần dung lượng và trần số khối

1 MB mỗi khối, 20 khối mỗi message. Khối vượt trần hiện ra như một thẻ bị vô hiệu kèm lý do, không
kèm nút Tải xuống; các khối còn lại trong cùng message vẫn dùng được bình thường.

Trần này không bảo vệ ổ đĩa (1 MB thì chả là gì) mà bảo vệ renderer: parse và đo dòng một chuỗi vài
chục MB trong lúc stream sẽ làm khung chat đứng. Nó cũng là chốt để `file:save` từ chối sớm thay vì
để zod ném ra một lỗi validate khó hiểu.

### 10. Mã lỗi mới `FILE_WRITE_FAILED`

`FILE_UNSUPPORTED` và `FILE_TOO_LARGE` đã đủ cho phần từ chối trước khi ghi. Cái thiếu là "ổ đĩa từ
chối", "file đang bị Excel giữ", "hết dung lượng" — hiện chỉ có `INTERNAL_ERROR`, mà thông điệp của
nó không cho người dùng biết phải làm gì. Thêm một mã `retryable: true` với thông điệp chỉ đúng một
hành động: chọn thư mục khác hoặc đóng ứng dụng đang giữ file.

Không log tên file, không log nội dung (§15.1) — chỉ `format`, `bytes`, và kết quả
`saved`/`canceled`/`failed` kèm `errorType`.

## Risks / Trade-offs

- **[Model không tuân quy ước fence]** → Nội dung vẫn hiện đầy đủ dạng text thuần như hôm nay, chỉ
  là không có thẻ file. Đây là điểm mạnh của cách chọn ở Quyết định 1: hỏng quy ước thì mất tiện
  nghi, không mất dữ liệu. Luật dự phòng `xml` + `<mxfile` bắt được ca hay gặp nhất.
- **[Prompt injection từ nội dung Jira/Confluence/tài liệu đính kèm đẩy model sinh khối file lạ]** →
  Allowlist văn bản, chuẩn hoá tên file, không nhị phân, không tự lưu, không tự mở. Tệ nhất là người
  dùng thấy một thẻ file họ không yêu cầu — họ vẫn phải bấm, vẫn phải chọn thư mục, và vẫn thấy tên
  file trước khi có gì rơi xuống ổ đĩa.
- **[Tên file hợp lệ trên Linux nhưng không hợp lệ trên Windows]** (`AUX`, `a:b.txt`, tên kết thúc
  bằng dấu chấm) → `normalizeFileName` xử lý theo luật Windows vì đây là app Windows-first, và
  `showSaveDialog` là lớp chắn cuối: người dùng thấy tên đã chuẩn hoá và sửa được.
- **[Người dùng đổi phần mở rộng trong hộp thoại thành `.bat`]** → Chấp nhận. Đó là hộp thoại của hệ
  điều hành và là quyết định tường minh của người dùng; Nexa không phải là thứ chặn người dùng lưu
  file trên máy của chính họ. Điều Nexa chịu trách nhiệm là không **đề xuất** phần mở rộng đó.
- **[Nội dung file đã ở trong `message.content`, nên nó nằm trong DB đã mã hoá và đi vào context của
  các lượt sau]** → Đúng, và điều này không đổi so với hôm nay. Đổi lại là tải xuống vẫn chạy sau
  khi restart mà không cần bảng mới. Cửa sổ trượt của `buildContext` vẫn là thứ quyết định khối đó
  còn được gửi lên model bao lâu.
- **[Parser viết tay sẽ sai ở ca lạ]** (fence lồng, fence 4 backtick, ` ``` ` trong nội dung file) →
  Package thuần nên test được từng ca không cần dựng Electron; danh sách ca lạ nằm ngay trong
  `tasks.md`. Nội dung `.drawio`/`.csv`/`.sql` gần như không bao giờ chứa ba backtick, nên ca xấu
  nhất là hiếm và hậu quả là hiển thị sai, không phải ghi sai.
- **[Thêm một channel IPC là thêm bề mặt tấn công]** → Bề mặt này chỉ ghi được văn bản, chỉ ghi được
  vào đường dẫn do hộp thoại sinh ra, và mỗi lần ghi cần một tương tác của người dùng. Không có
  đường nào từ channel này tới việc ghi đè một file mà người dùng không tự chọn trong hộp thoại.

## Migration Plan

Không có migration: không thêm bảng, không đổi schema, không đổi dữ liệu đã lưu.

Thứ tự triển khai để repo không bao giờ ở trạng thái không build được: `file-blocks.ts` trong
`shared-types` trước (thuần, có test) → mã lỗi và schema IPC → writer và handler trong main →
`bridge.ts` → UI trong `ChatView.tsx` → quy tắc system prompt cuối cùng. Bước cuối đứng sau cùng có
lý do: cho tới lúc đó, parser đã đủ tin cậy để chịu được cái mà model sẽ bắt đầu sinh ra.

Rollback là bỏ quy tắc trong system prompt — model thôi sinh fence, UI thôi hiện thẻ file, và không
có dữ liệu nào cần dọn.

## Open Questions

- **Có nên cho nhị phân ở v2 không** (PNG từ mermaid, XLSX từ bảng)? Cần trả lời hai câu trước:
  base64 trong `message.content` làm phồng DB và context tới mức nào, và ai chịu trách nhiệm khi một
  file nhị phân do model sinh ra bị mở bằng ứng dụng có lỗ hổng.
- **Nút "Sao chép" có đáng một channel IPC riêng không?** Rẻ về mã, nhưng mở quyền clipboard cho
  renderer thì không rẻ về nguyên tắc — cần một quyết định riêng, tách khỏi change này.
- **`html` có bao giờ được vào allowlist?** Chỉ khi có ai đó nêu được một ca dùng thật mà `.md`
  không giải quyết được.
