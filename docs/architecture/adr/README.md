# ADR — Architecture Decision Records

Mỗi file ghi một quyết định kiến trúc: bối cảnh, lựa chọn, hệ quả.

**Trạng thái: 1/7 đã được chốt.** Sáu ADR còn lại vẫn là `Đề xuất` — chúng là giả định tôi đã
dùng để viết code, không phải quyết định đã được tổ chức thông qua.
Câu hỏi tương ứng nằm ở [`docs/OPEN-QUESTIONS.md`](../../OPEN-QUESTIONS.md).

| ADR | Chủ đề | Trạng thái | Câu hỏi liên quan |
|---|---|---|---|
| [0001](0001-electron-monorepo.md) | Electron + React + monorepo source-only | Đề xuất | §22.2 Tauri evaluation |
| [0002](0002-field-level-encryption.md) | AES-256-GCM per-field thay vì SQLCipher | Đề xuất | A2 🔴 |
| [0003](0003-sqlite-driver-abstraction.md) | `node:sqlite` là driver duy nhất; bỏ native module | ✅ **Đã chấp nhận** 2026-08-01 | E1 |
| [0004](0004-mcp-stdio-only.md) | Chỉ dùng MCP stdio, không dùng localhost HTTP | Đề xuất | A4 🔴, D1 |
| [0005](0005-search-decrypt-and-scan.md) | Tìm kiếm bằng decrypt-and-scan có giới hạn | Đề xuất | A9 🔴 |
| [0006](0006-tool-calling-loop.md) | Ràng buộc vòng lặp tool-calling | Đề xuất | B3 |
| [0007](0007-approval-binding.md) | Approval gắn payload hash, dùng một lần | Đề xuất | B7, B8 |

## Cách dùng

Khi một quyết định được chốt, đổi `Trạng thái: Đề xuất` thành `Trạng thái: Đã chấp nhận —
<tên người chốt>, <ngày>`. Nếu chốt khác đi, thêm ADR mới thay thế và đánh dấu ADR cũ là
`Bị thay thế bởi <số>` — không sửa nội dung ADR cũ.
