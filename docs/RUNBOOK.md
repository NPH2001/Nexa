# Runbook — điều tra sự cố Nexa

Dành cho đội hỗ trợ và vận hành.

Đây là hiện thực của yêu cầu §15.2 và của tiêu chí nghiệm thu §21:
*"Có request_id/operation_id cục bộ; có thể đối chiếu với usage log LiteLLM và lịch sử Atlassian."*

---

## Nguyên tắc: ba nguồn, hai mã

Nexa **không** có kho log tập trung (§4.1). Mọi cuộc điều tra là ghép ba nguồn lại:

| Nguồn | Chứa gì | Ai truy cập |
|---|---|---|
| Log cục bộ trên máy người dùng | request_id, operation_id, error_code, thời gian, trạng thái tool | Người dùng tự xuất |
| Usage log của LiteLLM | model, token, latency, trạng thái, key alias | Quản trị LiteLLM |
| Activity/audit của Jira/Confluence | ai làm gì, lên đối tượng nào, lúc nào | Quản trị Atlassian |

Hai mã nối chúng lại:

- **`request_id`** (`req_<32 hex>`) — một lượt hỏi–đáp. Có ở mọi log dòng liên quan và trong
  header `X-Request-ID` gửi tới LiteLLM.
- **`operation_id`** (UUID) — một thao tác thay đổi dữ liệu. Sinh lúc mở màn hình xác nhận,
  theo suốt tới khi có kết quả.

**Không có mã nào trong ba nguồn chứa nội dung hội thoại, nội dung file, API key hay PAT.**

---

## Bước 1 — Lấy gói chẩn đoán từ người dùng

Hướng dẫn người dùng: **Cài đặt → Chẩn đoán → Xuất gói chẩn đoán**.

Gói được mở sẵn trong thư mục Downloads, gồm:

| File | Nội dung |
|---|---|
| `summary.json` | Phiên bản, nền tảng, driver SQLite, backend kho bảo mật, trạng thái kết nối (chỉ hostname), danh sách model, cấu hình đã lược |
| `correlation.json` | 200 sự kiện gần nhất: event_type, request_id, operation_id, status, error_code |
| `nexa*.log` | Log ứng dụng đã redact |

Gói này an toàn để gửi qua email nội bộ. Nếu bạn thấy trong đó một chuỗi trông giống secret,
**đó là lỗi** — báo ngay, kèm mẫu, để bổ sung vào `Redactor`.

## Bước 2 — Tìm mã yêu cầu

Người dùng thường đã có sẵn: mọi thông báo lỗi trong Nexa đều hiển thị `Mã yêu cầu: req_…`.

Nếu không, tìm trong `correlation.json` theo thời điểm xảy ra sự cố.

```bash
# Toàn bộ dòng log của một lượt
grep 'req_01H2X3…' nexa.log | python3 -m json.tool

# Chỉ các sự kiện bảo mật
grep '"category":"security"' nexa.log
```

## Bước 3 — Đối chiếu

### Chat lỗi hoặc chậm

1. **Local**: tìm `llm-request-completed` cùng `request_id` → có `durationMs`, `model`, `finishReason`.
2. **LiteLLM**: tra usage log theo cùng `request_id` (đi trong header `X-Request-ID`).
   - Có bản ghi ⇒ request đã tới gateway. So `durationMs` hai bên để biết độ trễ nằm ở mạng hay ở model.
   - Không có bản ghi ⇒ request chưa rời máy: xem `llm-http-error` hoặc lỗi mạng trong local log.

### Thao tác Jira/Confluence

1. **Local**: tìm `operation_id` trong `correlation.json`. Chuỗi sự kiện mong đợi:
   `tool.approved` → `tool.executed` (hoặc `tool.uncertain`).
2. **Atlassian**: mở activity/audit của tài khoản người dùng, lọc theo khoảng thời gian của
   `operation_id` đó.
   - Có thao tác ⇒ đã thực hiện, dù local báo `uncertain`.
   - Không có ⇒ chưa thực hiện, cho phép thử lại an toàn.

Nexa **không** gửi `operation_id` sang Atlassian (API Atlassian không có chỗ nhận), nên việc
đối chiếu ở đây dựa vào **tài khoản + thời gian + đối tượng**, không phải khớp mã trực tiếp.
Đây là giới hạn đã biết của §11.2: *"MVP không cam kết audit tập trung end-to-end."*

---

## Sự cố thường gặp

### App không mở được

Log ghi `app-startup-failed` kèm `errorCode` **trước** khi hiện dialog.

| errorCode | Nguyên nhân | Xử lý |
|---|---|---|
| `SECRET_UNAVAILABLE` | Kho bảo mật không giải mã được | Người dùng có đang đăng nhập đúng tài khoản Windows cũ không? Dữ liệu có bị copy từ máy khác không? |
| `LOCAL_DB_LOCKED` | DB bị giữ, hỏng, hoặc schema mới hơn app | Đóng hết tiến trình Nexa. Nếu là "schema newer than app", người dùng đã cài đè bản cũ — cài lại bản mới. |

Không có file log nào ⇒ ổ đĩa không ghi được. App vẫn chạy nhưng chỉ log trong RAM; gói chẩn
đoán khi đó chứa `memory-log.jsonl`.

### "Không xác định được thao tác đã hoàn tất hay chưa"

Đây là hành vi **đúng thiết kế** (§16), không phải lỗi.

1. Trong Nexa, banner vàng ở đầu màn hình liệt kê các thao tác treo → bấm **Kiểm tra kết quả**.
   Nexa tự tra tại hệ thống đích.
2. Nếu Nexa báo *"Không tra cứu được"*, phải kiểm tra thủ công tại Jira/Confluence **trước khi**
   cho người dùng thử lại. Thử lại mù là cách chắc chắn tạo dữ liệu trùng.

### Không kết nối được Jira/Confluence

Thứ tự kiểm tra:

1. `mcp:status` trong Cài đặt — trạng thái `error` kèm mã lỗi.
2. `MCP_SERVER_UNAVAILABLE` ⇒ tiến trình MCP không khởi động được. Kiểm tra lệnh MCP đã cài trên
   máy chưa (xem `NEXA_MCP_COMMAND`).
3. `ATLASSIAN_AUTH_FAILED` ⇒ PAT hết hạn, bị thu hồi, hoặc tài khoản thiếu quyền với dự án/space
   cụ thể. Nexa không phân biệt được ba trường hợp này — Atlassian trả cùng một mã.
4. `DOMAIN_NOT_ALLOWED` ⇒ URL không nằm trong allowlist của `policy.json`.

**Lưu ý:** bấm "Kiểm tra kết nối" sẽ **khởi động lại tiến trình MCP** và làm hỏng tool đang chạy
dở (OPEN-QUESTIONS E4).

### Người dùng nói "AI quên mất đoạn trước"

Tìm `truncatedContextCount > 0` trên message. Hội thoại đã vượt cửa sổ ngữ cảnh và các message
cũ bị lược bỏ (ADR 0006 — cửa sổ trượt, không tóm tắt).

Cách xử lý: bắt đầu hội thoại mới, hoặc đổi sang model có cửa sổ lớn hơn trong Cài đặt → Model.

### Tìm kiếm báo "kết quả chưa đầy đủ"

Đúng thiết kế (ADR 0005). Lịch sử đã lớn hơn ngân sách quét. Hướng dẫn người dùng thu hẹp từ khoá.
Nếu xảy ra thường xuyên ở pilot thì cần xem lại chiến lược tìm kiếm — ghi nhận lại cho đội phát triển.

---

## Việc KHÔNG được làm

- **Không** yêu cầu người dùng gửi file `nexa.db`. Nó chứa toàn bộ hội thoại đã mã hoá; gửi đi
  là chuyển dữ liệu nhạy cảm ra ngoài máy họ mà không giải quyết được gì (bạn không có khoá).
- **Không** yêu cầu người dùng đọc API key hay PAT cho bạn. Nexa cố ý không hiển thị lại — hỏng
  thì nhập giá trị mới, không cần biết giá trị cũ.
- **Không** tự chỉnh `policy.json` trên máy người dùng. Đó là file do IT phân phối; sửa cục bộ
  sẽ bị ghi đè ở lần cập nhật sau và làm lệch cấu hình so với chính sách.
