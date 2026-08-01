# Checklist trước pilot (Phụ lục C)

Hiện thực T-13-16. Mười mục theo đúng Phụ lục C của tài liệu thiết kế, kèm trạng thái thật.

**Trạng thái tổng: 3/10 đạt.** Bảy mục còn lại cần quyết định của tổ chức, máy Windows, hoặc
hệ thống thật — không phải việc viết thêm mã.

| # | Mục (Phụ lục C) | Trạng thái | Còn thiếu gì |
|---|---|---|---|
| 1 | Đã chốt LiteLLM base URL, cách cấp/thu hồi key và quy ước model id | ❌ | Cần admin LiteLLM. `docs/OPEN-QUESTIONS.md` A1 🔴 |
| 2 | Đã cấp certificate/ký số bộ cài | ❌ | Thủ tục cấp cert chưa khởi động. **Đường găng dài nhất** — T-02-5, C3 🔴 |
| 3 | Đã kiểm thử thêm/xoá/chọn model và lỗi khi key/model không hợp lệ | ⚠️ | Có test tự động (`connection-config.test.ts`, `llm-client.test.ts`) nhưng **chạy với mock**, chưa với LiteLLM thật (C2 🔴) |
| 4 | Đã kiểm thử cấu hình Jira/Confluence URL, username, PAT và MCP tool allowlist | ⚠️ | 30 test với mock MCP server. Package thật chưa chốt (A4 🔴) |
| 5 | Đã kiểm thử confirmation, payload hash, operation tracking và chống double-submit | ✅ | 7 kịch bản bắt buộc §17.2 đều xanh (`agent-runtime.test.ts`) |
| 6 | Đã kiểm tra DB, file config và log không chứa prompt/file/API key/PAT dạng rõ | ✅ | Test đọc thẳng file `.db` và log để khẳng định; 44 test redaction |
| 7 | Đã có hướng dẫn đối chiếu request_id/operation_id với log LiteLLM và lịch sử Atlassian | ✅ | [`docs/RUNBOOK.md`](../RUNBOOK.md) |
| 8 | Đã có hướng dẫn cài đặt, gỡ cài đặt và báo lỗi | ⚠️ | [Cho IT](it-deployment.md) đã có. **Chưa có hướng dẫn cho người dùng cuối** — xem dưới |
| 9 | Đã có quy trình thu hồi phiên bản lỗi | ⚠️ | [`release-recall.md`](release-recall.md) đã viết, nhưng **chưa diễn tập lần nào** |
| 10 | Đã có nhóm pilot, kịch bản UAT và đầu mối hỗ trợ | ❌ | Việc của tổ chức |

## Mục 8 — hướng dẫn người dùng cuối còn thiếu

Cần một tài liệu một trang cho nhân viên, không phải cho IT. Nội dung tối thiểu:

- lấy LiteLLM API key ở đâu, hỏi ai
- lấy Atlassian PAT ở đâu, hỏi ai
- ba màn hình đầu tiên phải cấu hình
- khi báo lỗi thì gửi gì (**gói chẩn đoán**, kèm mã yêu cầu — đừng gửi file `.db`)
- điều gì xảy ra với dữ liệu khi đổi máy: **phải nhập lại key và PAT**

Chưa viết vì nó phụ thuộc mục 1 và 4: chưa chốt LiteLLM và MCP thì không viết được bước
"vào đâu lấy key".

## Điều kiện tiên quyết theo §19

> *"Không nên triển khai tool write trước khi hoàn thiện secure storage, kiểm tra kết nối
> Jira/Confluence, confirmation guard, operation tracking và xử lý kết quả không chắc chắn."*

| Điều kiện | Trạng thái |
|---|---|
| Secure storage | ✅ code xong, đã chạy thật trên Linux keyring; **DPAPI Windows chưa xác minh** |
| Kiểm tra kết nối Jira/Confluence | ⚠️ code xong, mới chạy với mock |
| Confirmation guard | ✅ đủ 8 mục §10.2, TTL, dùng một lần, hash gắn payload |
| Operation tracking | ✅ gồm cả tra cứu trạng thái `uncertain` và banner tập trung |
| Xử lý kết quả không chắc chắn | ✅ không tự retry; tra cứu hộ; "không tra được" ≠ "chưa tạo" |

Ba mục ✅ đã đủ về mặt mã nguồn. **Hai mục ⚠️ là lý do chưa nên bật tool write cho người dùng
thật** — không phải vì code thiếu, mà vì chưa ai chạy nó với Jira thật một lần nào.

## Tiêu chí nghiệm thu §21 — đối chiếu

| Hạng mục §21 | Trạng thái |
|---|---|
| Cài/gỡ không cần admin; executable có chữ ký | ⚠️ NSIS per-user xong; **chữ ký chưa có** |
| Khởi động < 5 giây | ✅ đo được 304 ms tới `window-ready` (Linux, chưa đóng gói) |
| Idle < 500 MB, chat < 800 MB | ❌ **chưa đo trên Windows** |
| Lưu/test/xoá LiteLLM key an toàn; renderer không đọc được key | ✅ có test |
| Lịch sử lưu/đọc/tìm/xoá; nội dung không đọc được bằng công cụ SQLite thường | ✅ có test |
| Đọc đúng TXT/PDF/DOCX trong giới hạn; temp được xoá | ✅ có test |
| MCP read theo quyền username/PAT; lỗi xác thực có hướng dẫn rõ | ⚠️ mock |
| MCP write không chạy khi chưa xác nhận; double-click không tạo trùng | ✅ có test |
| Có request_id/operation_id; đối chiếu được; không lưu secret/prompt/file | ✅ có test + runbook |
| API key/PAT không nằm trong localStorage, file config hay log | ✅ có test |
| Chỉ cài gói có chữ ký hợp lệ; hỗ trợ rollback | ⚠️ rollback xong; **chữ ký chưa có** |
| Nhóm pilot hoàn thành UAT, không còn lỗi P0/P1 | ❌ chưa pilot |
| Chat streaming ổn định, cancel được, lỗi có request_id | ✅ có test |

## Ba việc chặn pilot

Theo thứ tự thời gian cần khởi động:

1. **Certificate ký số** — thủ tục thường mất nhiều tuần. Chặn mục 2 và hai dòng §21. Khởi động ngay.
2. **Chốt package MCP Atlassian (A4)** — chặn mục 4, và ảnh hưởng cả yêu cầu runtime trên máy trạm.
3. **Một máy Windows để xác minh** — DPAPI, đo RAM, kiểm thử UI bằng tay. Chặn mục 3, 4 và ba dòng §21.
