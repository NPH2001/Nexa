# ADR 0005 — Tìm kiếm bằng decrypt-and-scan có giới hạn

**Trạng thái:** Đề xuất (cần chốt — xem OPEN-QUESTIONS A9 🔴)
**Ngày:** 2026-08-01

## Bối cảnh

Hai yêu cầu của tài liệu mâu thuẫn trực tiếp với nhau:

- §2.1 và EPIC-05: người dùng phải **tìm kiếm** được trong hội thoại.
- §8.1 và §21: nội dung message lưu dạng `content_ciphertext`, và *"không đọc được bằng công cụ
  SQLite thông thường nếu chưa có khóa"*.

Không thể `LIKE` trên ciphertext. Tài liệu không nói cách giải quyết.

## Các phương án đã cân nhắc

| # | Phương án | Ưu | Nhược | Kết luận |
|---|---|---|---|---|
| 1 | Bảng FTS5 lưu plaintext | Nhanh, đầy đủ tính năng | **Phá vỡ tiêu chí §21** — mở file .db là đọc được nội dung | Loại |
| 2 | Blind index: `HMAC(key, token)` mỗi từ | Nhanh, ciphertext vẫn kín | Chỉ khớp nguyên từ; kém với tiếng Việt có dấu và tìm một phần; lộ pattern tần suất từ | Cân nhắc lại nếu cần scale |
| 3 | **Decrypt-and-scan theo lô, có trần** | Đúng ngữ nghĩa tìm kiếm, không lộ gì thêm | O(n) theo số message | **Chọn** |

## Quyết định

Phương án 3, với hai chốt chặn cứng:

- `maxMessagesScanned` — mặc định 2.000
- `budgetMs` — mặc định 3.000 ms

Chạm bất kỳ trần nào ⇒ trả `truncated: true`, và UI **phải** nói rõ "kết quả chưa đầy đủ".
Đây là phần quan trọng nhất của quyết định: một tìm kiếm không đầy đủ mà im lặng thì tệ hơn
là không có tìm kiếm, vì người dùng sẽ kết luận sai rằng thông tin không tồn tại.

Chuẩn hoá so khớp: NFD + bỏ dấu + `đ→d` + hạ chữ thường. Nhờ đó "kế hoạch" tìm được "ke hoach"
và ngược lại.

## Số đo

Với ~4.000 message (100 hội thoại × 40 message): **~180 ms** trên máy dev. Chấp nhận được ở
quy mô MVP.

**Sẽ không scale** khi người dùng tích luỹ 50.000+ message — lúc đó `truncated` sẽ luôn bật và
tính năng mất giá trị. Cần đo lại ở pilot và quyết định có chuyển sang phương án 2 hay không.

## Hệ quả

- Tìm kiếm chạy trong main process, không chặn UI (renderer là tiến trình riêng).
- Một bản ghi hỏng không làm chết cả lần tìm kiếm — bỏ qua và đi tiếp.
- Bộ nhớ: giải mã theo lô 200 message, không nạp toàn bộ lịch sử vào RAM.
