# ADR 0007 — Approval gắn payload hash, dùng một lần, hết hạn nhanh

**Trạng thái:** Đề xuất (xem OPEN-QUESTIONS B7, B8)
**Ngày:** 2026-08-01

## Bối cảnh

§10.3 quy định:

```
operation_id = uuid()
payload_hash = sha256(tool_name + normalized_payload)
approval     = { operation_id, payload_hash, approved_at, expires_at }
```

Nhưng không định nghĩa "normalized", không nói thời hạn bao lâu, và không nói approval có
dùng lại được không.

§17.2 đặt bốn kịch bản test bắt buộc liên quan trực tiếp tới thành phần này (kịch bản 2, 3, 4, 5).

## Quyết định

### 1. Chuẩn hoá payload

JSON canonical form:
- sort key **đệ quy**, so sánh theo code-unit (không dùng `localeCompare` — nó phụ thuộc locale
  và sẽ cho hash khác nhau trên máy khác nhau)
- không khoảng trắng
- loại `undefined`, giữ `null`
- giữ nguyên thứ tự mảng (mảng có ngữ nghĩa thứ tự)
- **KHÔNG normalize Unicode**

Lý do không normalize Unicode: nếu normalize, chuỗi người dùng nhìn thấy trong preview và chuỗi
thật sự gửi đi có thể khác nhau ở mức byte mà hash vẫn khớp. Với tiếng Việt — nơi cùng một chữ
gõ được bằng nhiều cách tổ hợp — điều đó không phải trường hợp lý thuyết.

### 2. Hash tính trên payload ĐÃ VALIDATE

Sau khi Zod điền default, không phải payload thô từ model. Hash payload thô là lỗ hổng: giá trị
default có thể đổi giữa lúc preview và lúc thực thi.

### 3. Approval dùng một lần

`consume()` xoá approval và đưa `operation_id` vào tập "đang chạy". Gọi lần hai ⇒
`OPERATION_ALREADY_RUNNING`. Thành công ⇒ vào tập "đã xong", cũng không gọi lại được.

Ba lớp chống double-submit, cố ý chồng lên nhau:
1. UI khoá nút ngay sau lần bấm đầu
2. `ConfirmationGuard` từ chối approval đã tiêu
3. Unique index `idx_tool_calls_operation` trong SQLite

### 4. TTL 120 giây

Đủ để đọc một preview có bảng diff; đủ ngắn để một màn hình bị bỏ quên không còn giá trị.
Cấu hình được qua `settings.approvalTtlSeconds` (15–900s).

### 5. Kiểm tra lại TOÀN BỘ ở `consume()`

Không tin kết quả của `approve()` trước đó. Giữa hai thời điểm, approval có thể đã hết hạn,
payload có thể đã bị sửa, hoặc ai đó gọi lại lần hai. Kiểm tra lại: tồn tại, chưa tiêu,
đã approved, chưa hết hạn, đúng tool, **và hash của payload thật sự sắp gửi**.

## Hệ quả

- Sửa `canonicalize()` = làm mọi approval cũ vô hiệu. Có unit test khoá hành vi lại
  (`security.test.ts` → `canonicalize / computePayloadHash`).
- `ConfirmationGuard` không biết cách gọi tool, `AtlassianMcpManager` không biết approval là gì.
  Tách bạch có chủ ý: gộp lại thì dễ xuất hiện một đường đi vừa kiểm tra vừa thực thi, và đó
  chính là chỗ để lọt.
- Trạng thái `uncertain` **không** vào tập "đã xong" — §16 yêu cầu tra cứu trước khi retry, và
  tra cứu có thể kết luận là chưa tạo, khi đó phải cho thử lại.
