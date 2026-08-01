# Quy trình thu hồi một bản phát hành lỗi

Hiện thực T-12-17 và mục *"Đã có quy trình thu hồi phiên bản lỗi"* của Phụ lục C.

Dùng khi một bản đã tới tay người dùng và cần chặn lại: lỗi bảo mật, hỏng dữ liệu, hoặc không
tương thích với LiteLLM/Atlassian.

## Quyết định trong 15 phút đầu

Câu hỏi duy nhất cần trả lời: **bản lỗi có thể làm hỏng dữ liệu hoặc lộ dữ liệu không?**

| Trả lời | Mức | Hành động |
|---|---|---|
| Có | **P0 — chặn cứng** | Ép người dùng dừng dùng ngay, kể cả khi đang làm việc dở |
| Không, chỉ khó chịu | **P1 — thu hồi mềm** | Ngừng phân phối, khuyến nghị nâng cấp, không chặn |

Đừng dùng chặn cứng cho lỗi P1. Ép đóng app giữa giờ làm việc là một sự cố riêng.

## P0 — chặn cứng

### Bước 1. Ngừng phân phối ngay

- Gỡ gói khỏi kênh phân phối của IT (Intune/SCCM/share nội bộ)
- Xoá artifact khỏi trang release

### Bước 2. Cập nhật version manifest

Đây là cơ chế duy nhất chặn được các máy đã cài. Có hai công tắc:

**a) Bản lỗi mới hơn bản tốt** → dùng `rollbackTo`:

```jsonc
{
  "channel": "stable",
  "version": "1.3.0",              // bản đang bị thu hồi
  "url": "https://updates.corp.local/nexa-1.3.0.exe",
  "sha256": "…",
  "releasedAt": "2026-08-01T00:00:00Z",
  "mandatory": false,
  "rollbackTo": {
    "version": "1.2.0",            // bản ổn định gần nhất
    "url": "https://updates.corp.local/nexa-1.2.0.exe",
    "sha256": "…"
  }
}
```

Máy đang chạy 1.3.0 sẽ nhận trạng thái `rollback-required`, hiện dialog và **đóng app**.

**b) Đã có bản vá** → dùng `minimumSupportedVersion`:

```jsonc
{
  "version": "1.3.1",
  "minimumSupportedVersion": "1.3.1",
  "mandatory": true
}
```

Mọi bản cũ hơn 1.3.1 nhận `unsupported-client` và bị chặn.

> ⚠️ **Cả hai công tắc chỉ có tác dụng khi `autoUpdate` đang BẬT và `updateManifestUrl` đã được
> khai trong `policy.json`.** Mặc định của Nexa là tắt. Nếu tổ chức để mặc định thì **không có
> đường chặn từ xa** — phải đẩy bản vá qua IT và thông báo trực tiếp.
>
> Đây là đánh đổi có ý thức của A8, không phải thiếu sót. Nhưng nó cần được biết trước khi có
> sự cố, không phải trong lúc có sự cố.

### Bước 3. Đẩy bản thay thế

Qua kênh IT như thường lệ (`docs/operations/it-deployment.md`). Bản thay thế phải qua đủ
checksum + chữ ký như mọi bản khác — **thu hồi khẩn cấp không phải lý do để bỏ bước kiểm chứng**.

### Bước 4. Thông báo

Người dùng bị chặn sẽ thấy dialog rồi app đóng. Họ cần biết **vì sao** và **khi nào dùng lại được**,
nếu không họ sẽ gọi hỗ trợ hàng loạt.

Mẫu:

> **Nexa tạm thời không sử dụng được**
>
> Phiên bản 1.3.0 có lỗi \<mô tả ngắn, không đi vào chi tiết kỹ thuật\>. Chúng tôi đã chặn để
> tránh ảnh hưởng tới dữ liệu của bạn.
>
> Bản thay thế 1.3.1 sẽ được đội IT cài trong \<khung giờ\>. Bạn không cần làm gì.
>
> **Dữ liệu của bạn vẫn còn nguyên trên máy** — hội thoại và cấu hình không bị ảnh hưởng.
> \<Nếu KHÔNG đúng thì phải nói rõ điều gì bị ảnh hưởng.\>
>
> Hỗ trợ: \<đầu mối\>

### Bước 5. Ghi lại

Trong 48 giờ:

- lỗi là gì và vì sao lọt qua CI
- **bổ sung test bắt được nó** — nếu không thêm test thì việc thu hồi chưa xong
- nếu là lỗi bảo mật: cập nhật `docs/security/threat-model.md`

## P1 — thu hồi mềm

1. Ngừng phân phối
2. Cập nhật manifest với bản mới, `mandatory: false` — người dùng thấy thông báo nhưng vẫn dùng được
3. Thông báo qua kênh thường
4. Vẫn phải bổ sung test

## Nếu dữ liệu người dùng đã bị ảnh hưởng

Nghiêm trọng hơn hẳn một bản lỗi thường. Thêm các bước:

1. **Xác định phạm vi** — bao nhiêu máy, dữ liệu nào. Gói chẩn đoán từ vài máy mẫu
   (`docs/RUNBOOK.md`) cho biết bản nào chạy trên máy nào.
2. **Bảo toàn bằng chứng** — bảo người dùng **đừng** dùng "Xoá toàn bộ dữ liệu" cho tới khi có
   hướng dẫn. Đó là thao tác không hoàn tác được.
3. **Với thao tác Jira/Confluence bị lỗi** — dữ liệu nằm ở hệ thống đích, không ở Nexa. Đối chiếu
   `operation_id` với activity/audit của Atlassian để biết chính xác cái gì đã được tạo hay sửa.
4. **Báo cáo ATTT** nếu có khả năng lộ credential. Người dùng phải **thu hồi PAT và LiteLLM key**
   rồi tạo mới — Nexa không làm hộ được việc đó.

## Việc chưa có

- **Chưa có cơ chế thu hồi tự động nào được kiểm chứng thật.** `rollback-required` và
  `unsupported-client` có test đơn vị, nhưng chưa từng chạy với một update server thật.
- **Chưa có certificate ký số**, nên bước xác minh chữ ký ở Bước 3 hiện chưa thực hiện được
  (OPEN-QUESTIONS C3).

Hai việc này nên được diễn tập một lần trước pilot — quy trình thu hồi chưa từng chạy thử là
quy trình chưa tồn tại.
