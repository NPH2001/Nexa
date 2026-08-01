# ADR 0002 — AES-256-GCM mã hoá từng trường, không dùng SQLCipher

**Trạng thái:** Đề xuất (cần ATTT chốt — xem OPEN-QUESTIONS A2 🔴)
**Ngày:** 2026-08-01

## Bối cảnh

§22.2 để ngỏ: *"Local encryption: SQLCipher hay mã hóa từng trường bằng AES-GCM?"*

§8.2 mô tả yêu cầu:
- master key ngẫu nhiên cho mỗi profile, bọc bằng Windows DPAPI CurrentUser
- **"Mỗi bản ghi hoặc nhóm bản ghi cần nonce/IV riêng; lưu authentication tag"**
- không suy ra khoá từ username hoặc password Windows

§21 đặt tiêu chí nghiệm thu: *"nội dung không đọc được bằng công cụ SQLite thông thường nếu
chưa có khóa"*.

## Quyết định

Mã hoá **từng trường** bằng AES-256-GCM. Định dạng lưu:

```
base64( version(1B) ‖ IV(12B) ‖ authTag(16B) ‖ ciphertext )
AAD = "${version}:${table}.${column}"
```

Master key 32 byte ngẫu nhiên, bảo vệ bằng Electron `safeStorage` (trên Windows là DPAPI
CurrentUser).

## Lý do

1. **Mô tả trong §8.2 chính là per-field AEAD.** SQLCipher mã hoá theo *page*, không theo bản
   ghi; câu "mỗi bản ghi cần nonce/IV riêng" không mô tả SQLCipher.
2. **SQLCipher là native module phải build theo ABI của Electron.** Lý lẽ này còn mạnh hơn lúc
   đầu: sau [ADR 0003](0003-sqlite-driver-abstraction.md), bộ cài **không còn native module nào**.
   Chọn SQLCipher là mang trở lại đúng thứ đã bỏ đi được — kèm theo yêu cầu toolchain C++ trên
   máy build và việc không cross-compile được.
3. **Per-field cho phép để metadata không nhạy cảm ở dạng rõ** (`created_at`, `role`, `status`),
   nên vẫn index và sort được. Với SQLCipher thì mọi thứ đều mờ như nhau — an toàn hơn một chút
   nhưng phải giải mã cả page cho mỗi truy vấn.
4. **AAD gắn ciphertext với đúng cột nó thuộc về.** Không thể lấy ciphertext của
   `messages.content` dán sang `settings.value` — một lớp bảo vệ SQLCipher không có.

## Hệ quả

**Tích cực**
- Không thêm native dependency.
- Kiểm chứng được bằng test: `local-store.test.ts` đọc thẳng file `.db` và khẳng định không
  tìm thấy plaintext.
- Đổi khoá (rotation) làm được ở mức từng bảng.

**Tiêu cực — cần biết rõ**
- **Tìm kiếm không dùng SQL được.** Đây là hệ quả lớn nhất; xem [ADR 0005](0005-search-decrypt-and-scan.md).
- Lập trình viên phải nhớ mã hoá trường mới. Giảm thiểu bằng cách để `ConversationRepository`
  là nơi duy nhất chạm SQL, và mọi cột nhạy cảm đều có hậu tố `_ciphertext` trong schema.
- Metadata vẫn lộ: số lượng hội thoại, thời điểm, độ dài xấp xỉ của message (theo kích thước
  ciphertext). SQLCipher che được phần này tốt hơn. Nếu ATTT coi đây là rủi ro thật thì phải
  xem lại quyết định.

## Chỗ cần sửa nếu chốt khác

`packages/security/src/crypto.ts` và `packages/local-store/src/store.ts` (interface `FieldCipher`).
Toàn bộ tầng repository nói chuyện qua `FieldCipher`, nên đổi sang SQLCipher là thay implementation
chứ không phải viết lại repository.
