# Quy ước làm việc trên repo Nexa

## Nhánh

| Nhánh | Vai trò | Ai đẩy được |
|---|---|---|
| `main` | Luôn ở trạng thái build được và test xanh. Mỗi commit là một ứng viên phát hành. | Chỉ qua PR |
| `feat/<mã-task>-<mô-tả>` | Tính năng. Ví dụ `feat/T-06-14-pdf-scan-warning` | Ai cũng được |
| `fix/<mô-tả>` | Sửa lỗi | Ai cũng được |
| `chore/<mô-tả>` | Hạ tầng, tài liệu, phụ thuộc | Ai cũng được |

Đặt tên nhánh theo mã task trong `TASKLIST.md` khi có — nhờ vậy nhìn lịch sử git là biết được
phần nào của MVP đã đi tới đâu.

**Branch protection cần bật trên `main`** (chưa bật):

- yêu cầu PR, không đẩy thẳng
- yêu cầu job `quality` và `security-scan` xanh
- yêu cầu review từ Code Owners (chỉ bật SAU khi đã điền team thật vào `.github/CODEOWNERS`)
- không cho force-push

## Commit

Dạng ngắn: `<phạm vi>: <việc đã làm>`

```
security: chặn backend basic_text của Linux
agent-runtime: không cho hai tool write trong cùng một lượt
docs: bổ sung runbook đối chiếu request_id
```

Không cần Conventional Commits nghiêm ngặt. Cần: đọc dòng đầu là hiểu.

## Trước khi mở PR

```bash
pnpm verify     # lint + typecheck + test — phải sạch
```

Rồi điền `.github/pull_request_template.md`. Phần checklist bảo mật trong đó không phải thủ tục:
nó liệt kê đúng những bất biến mà bộ test đang canh, và là chỗ để bạn tự kiểm tra trước khi
người review phải phát hiện hộ.

## Ba quy tắc dễ vi phạm nhất

**1. Renderer không được thêm quyền.** Không Node, không mạng, không secret, không file system.
Nếu tính năng của bạn cần một trong bốn thứ đó, nó thuộc về main process và đi qua một channel
IPC mới. Cả eslint lẫn cấu hình bundler đều chặn — nếu bạn đang tìm cách lách, hãy dừng lại và
hỏi trước.

**2. Không log nội dung.** `Redactor` che theo tên trường, theo giá trị đã đăng ký, và theo
pattern. Nhưng nó không đọc được ý định của bạn: nếu bạn nhét nội dung vào một trường tên
`detail`, nó sẽ lọt. Danh sách trường cấm ở `docs/security/threat-model.md`.

**3. Migration đã phát hành thì không sửa.** Thêm bản mới. Sửa bản cũ nghĩa là máy đã cài rồi
sẽ ở một trạng thái khác với máy cài mới, và không ai phát hiện ra cho tới khi dữ liệu hỏng.

## Khi tài liệu thiết kế không nói rõ

Đừng đoán im lặng. Ghi vào `docs/OPEN-QUESTIONS.md`: câu hỏi, giả định bạn đã dùng để code
tiếp, và chỗ cần sửa nếu quyết định khác đi. Một giả định được ghi ra là một quyết định chờ
duyệt; một giả định nằm trong code là một quả mìn.

Quyết định lớn về kiến trúc thì thêm ADR trong `docs/architecture/adr/`.

## Tài liệu thiết kế

`Nexa_Tai_lieu_thiet_ke_va_trien_khai_MVP_v1.1.docx` là **bản gốc có thẩm quyền** và không nằm
trong repo. Bản Markdown trích xuất ở `docs/design-doc-v1.1.md` để grep và diff.

Khi tài liệu ra phiên bản mới:

```bash
node scripts/extract-design-doc.mjs <đường-dẫn-bản-mới.docx> docs/design-doc-v1.2.md
```

rồi diff hai bản để biết điều gì đã đổi, và kiểm tra xem các tham chiếu `§n` trong mã nguồn
còn trỏ đúng chỗ không.
