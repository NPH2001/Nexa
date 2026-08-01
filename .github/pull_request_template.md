# Mô tả

<!-- Thay đổi gì, và vì sao. Nếu gắn với một mục trong TASKLIST hay OPEN-QUESTIONS, ghi mã ra. -->

Liên quan: <!-- T-xx-yy · EPIC-nn · OPEN-QUESTIONS A1 · (không có) -->

## Loại thay đổi

- [ ] Sửa lỗi
- [ ] Tính năng mới
- [ ] Refactor (không đổi hành vi)
- [ ] Tài liệu
- [ ] Hạ tầng / CI

---

## Checklist bắt buộc

- [ ] `pnpm verify` chạy sạch (lint + typecheck + test)
- [ ] Đã thêm hoặc cập nhật test cho hành vi mới
- [ ] Comment giải thích **vì sao**, không phải **làm gì** — và tham chiếu số mục tài liệu (§n) ở
      những chỗ hiện thực một yêu cầu cụ thể

## Checklist bảo mật

Bỏ qua mục nào **không** liên quan, nhưng đừng bỏ qua mục có liên quan.

- [ ] Không có secret, đường dẫn file, hay nội dung người dùng lọt vào log
      (§11.1 · `docs/security/threat-model.md`)
- [ ] Renderer không nhận thêm quyền nào: vẫn không có Node, không mạng, không secret (§5.3)
- [ ] Channel IPC mới có schema Zod trong `IPC_SCHEMAS` **và** tên trong `channels.ts`
- [ ] Tool mới có `riskLevel`, `requiredFeature`, và `buildPreview` nếu là write (§10.1, §13.1)
- [ ] Không nới lỏng bất biến nào trong bảng "Các bất biến bảo mật" của README
- [ ] Nếu đụng vào `ConfirmationGuard`, `canonicalize()` hay `payload_hash`: 7 kịch bản §17.2
      vẫn xanh, và đã cân nhắc việc mọi approval cũ trở nên vô hiệu

## Ảnh hưởng tới dữ liệu

- [ ] Không đổi schema DB
- [ ] Có migration mới, **có version**, và không sửa migration đã phát hành (§13.1)
- [ ] Không đổi `context` mã hoá của trường đang có (đổi = hỏng dữ liệu cũ — xem ADR 0002)

## Quyết định còn mở

<!--
Nếu PR này phải tự quyết một điều mà tài liệu chưa nói rõ, ghi vào docs/OPEN-QUESTIONS.md và
dẫn link ở đây. Đừng để một giả định nằm im trong code.
-->
