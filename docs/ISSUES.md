# Nexa — Sổ đăng ký vấn đề còn tồn đọng

Một chỗ duy nhất để biết **còn gì chưa xong và ai giải quyết được**.

> **Đây là mục lục, không phải nơi chứa chi tiết.** Mỗi mục trỏ tới tài liệu gốc. Sửa nội dung
> thì sửa ở tài liệu gốc rồi cập nhật một dòng ở đây — đừng viết lại chi tiết ở hai nơi, hai
> bản sẽ lệch nhau trong vòng một tuần.

Cập nhật: 2026-08-01 · Mã `A*`–`F*` tra ở [`OPEN-QUESTIONS.md`](OPEN-QUESTIONS.md), mã `T-*` tra ở
`TASKLIST.md`

Số mục 🔴 trong `OPEN-QUESTIONS.md` phải bằng số dòng ở mục 1 dưới đây. Lệch nhau nghĩa là một
trong hai file chưa được cập nhật.

## Tình hình một dòng

Mã nguồn của MVP đã xong và kiểm chứng được: **317 test đơn vị/tích hợp + 12 test E2E chạy
Electron thật**, lint và typecheck sạch, app khởi động và chạy được.

**Không có việc lập trình nào đang chặn.** Toàn bộ 7 mục chặn phát hành đều cần quyết định của
tổ chức, một certificate, hoặc một hệ thống thật để đối chiếu.

---

## 1. Chặn phát hành — 7 mục

Không phát hành cho người dùng thật khi những mục này còn mở.

| # | Vấn đề | Ai giải quyết được | Chi tiết |
|---|---|---|---|
| 1 | **Certificate ký số chưa có.** Bộ cài chưa ký. Job CI `signing-gate` cố ý fail trên `main` để không ai lỡ phát hành. | Mua/xin cert — **thủ tục thường mất nhiều tuần, đây là đường găng dài nhất** | C3, T-02-5 |
| 2 | **Package MCP Atlassian chưa chốt.** Toàn bộ tính năng Jira/Confluence đang chạy với mock server tôi tự viết. | Dev lead chọn package; ảnh hưởng cả yêu cầu runtime trên máy trạm (nếu là package Python thì máy cần Python/uv) | A4 |
| 3 | **Chưa test với LiteLLM / Jira / Confluence thật.** Hợp đồng tích hợp đúng theo tài liệu, nhưng tài liệu có thể lệch thực tế. Cần trả lời A3 (PAT một hay hai, scope nào) trước khi làm được. | Cấp base URL + key/PAT môi trường thử | C2, A3 |
| 4 | **LiteLLM: chưa chốt base URL, định dạng key, endpoint kiểm tra key, quy trình rotate.** | Quản trị LiteLLM | A1 |
| 5 | **Kết nối OpenAI trực tiếp trái §6 của tài liệu thiết kế** (*"Nexa không kết nối trực tiếp provider"*). Đã được chấp nhận nhưng chưa có ATTT duyệt. | ATTT duyệt + cập nhật §6/§6.1 của tài liệu | F1 |
| 6 | **Mã hoá cục bộ: chưa chốt SQLCipher hay AES-GCM per-field.** Đang dùng per-field (ADR 0002, trạng thái *Đề xuất*). | ATTT | A2, ADR 0002 |
| 7 | **Tìm kiếm hội thoại: chưa chốt chiến lược.** Đang dùng decrypt-and-scan có trần; sẽ không scale quá ~50k tin nhắn. | Kiến trúc + ATTT | A9, ADR 0005 |

## 2. Chỉ làm được trên Windows thật — 3 mục

CI đã tự động hoá được phần lớn (job `verify-windows` trên `windows-latest`). Ba việc dưới đây
runner không thay thế được.

| # | Việc | Vì sao CI không làm được | Chi tiết |
|---|---|---|---|
| 1 | **Xác nhận credential KHÔNG mở được từ tài khoản Windows khác.** Đây là điểm mấu chốt của §8.2 — nếu sai thì toàn bộ mô hình bảo vệ secret sụp. | CI chỉ có một tài khoản | C1 |
| 2 | **Đo RAM thật** so với §12.1 (idle < 500 MB, chat < 800 MB) | Runner không phản ánh máy trạm | C1, T-13-15 |
| 3 | **Duyệt giao diện bằng mắt.** E2E khẳng định hành vi, không khẳng định nó *trông* đúng. | Không tự động hoá được | C1 |

## 3. Cần quyết định, không chặn phát hành — 8 mục

Code chạy được với giả định tôi đã chọn. Quyết định khác đi thì phải sửa, và chỗ cần sửa đã ghi
trong từng mục.

| # | Câu hỏi | Giả định đang dùng | Chi tiết |
|---|---|---|---|
| 1 | Chat (không kèm tài liệu) ra OpenAI — chỉ cảnh báo, **không chặn**. Có chấp nhận? | Cảnh báo, không chặn. Chặn chat thì tính năng vô dụng | F1 |
| 2 | **Không có usage log tập trung** cho lời gọi OpenAI. §15.2 dựa vào usage log LiteLLM; nguồn đó không tồn tại. Muốn có thì cần telemetry tập trung — điều §11.2 cấm theo mặc định. **Hai yêu cầu xung đột.** | Không có. Chỉ log cục bộ | F2 |
| 3 | IT có cần **tắt hẳn** kết nối OpenAI theo nhóm người dùng? Hiện chưa có cờ trong `forcedFeatures`. | Chưa có | F1 |
| 4 | Atlassian PAT: một hay hai? Scope tối thiểu? Cùng domain? Không chặn phát hành độc lập, nhưng là điều kiện để làm được mục 1.3. | Hai kết nối tách biệt, hai PAT | A3 |
| 5 | Model nào được nhận tài liệu nội bộ? Nội bộ đang **fail-open** (ngược §3). | Rỗng = cho phép với model nội bộ; **fail-closed** với model ngoài | A5 |
| 6 | Người dùng có được **tắt lưu lịch sử**? | Được | A7 |
| 7 | Auto-update trong app hay IT phân phối? | Mặc định **tắt**, IT phân phối | A8 |
| 8 | Có cần **app-level password** ngoài DPAPI? §11.3 và §16 ngụ ý có. | Không có | B1 |

Ngoài ra có 4 điểm **trong chính tài liệu thiết kế** nên xem lại: D1 (nên chốt chỉ stdio), D2
(allowlist domain nên là bắt buộc, không phải tuỳ chọn), D3 (NSIS không admin vs MSI cần admin
mâu thuẫn nhẹ), D4 (không có cách xoá một tin nhắn lẻ — vấn đề quyền riêng tư thật).

## 4. Nợ kỹ thuật đã biết — 9 mục

Tôi biết và chủ động để lại. Không cái nào là lỗi; mỗi cái là một đánh đổi đã ghi lý do.

| # | Nợ | Ảnh hưởng | Chi tiết |
|---|---|---|---|
| 1 | Một tiến trình MCP giữ **cả** PAT Jira và Confluence | Bị khai thác thì cả hai cùng lộ | E3 |
| 2 | "Kiểm tra kết nối" **restart MCP**, làm hỏng tool đang chạy dở | Chưa có khoá | E4 |
| 3 | Tìm kiếm không scale quá ~50k tin nhắn | `truncated` sẽ luôn bật, tính năng mất giá trị | A9 |
| 4 | Ước lượng token bằng heuristic ~4 ký tự/token, sai ±25% với tiếng Việt | Rủi ro lỗi context-length-exceeded | B2 |
| 5 | `confluenceWrite` là **cờ chết** — không tool nào dùng, bật lên không có tác dụng | Đã ghi rõ trong code và có test giữ danh sách | A6 |
| 6 | `TempWorkspace.lease()` có test nhưng **không được gọi ở production** (trích xuất làm trong RAM) | Giữ vì là đường chính thức nếu sau này cần file tạm | — |
| 7 | Không xoá được **một tin nhắn lẻ** — chỉ xoá cả hội thoại | Vấn đề quyền riêng tư nếu người dùng lỡ dán nội dung nhạy cảm | D4 |
| 8 | Không có i18n — chuỗi UI hard-code tiếng Việt | Cần refactor nếu sau này có tiếng Anh | D5 |
| 9 | Endpoint OpenAI chưa đọc `HTTPS_PROXY` | Mạng chỉ ra ngoài qua proxy thì kết nối này không chạy, lỗi hiện ra chung chung | F3 |

## 5. Việc trên GitHub, chưa làm — 4 mục

| # | Việc | Cảnh báo |
|---|---|---|
| 1 | Bật branch protection trên `main` | Xem `CONTRIBUTING.md` |
| 2 | Tạo team thật cho `.github/CODEOWNERS` | ⚠️ Bật "Require Code Owners" **trước khi** tạo team `@nexa/security-team` và `@nexa/ops-team` sẽ **kẹt mọi PR** |
| 3 | Bật gitleaks (job đã có trong CI) | |
| 4 | Quyết định về `TASKLIST.md` đang bị `.gitignore` loại ra | 6 tài liệu đã commit tham chiếu các mã `T-xx-yy` trong đó — người clone về không tra được |

## 6. Chưa có, và cần người khác làm — 4 mục

| # | Việc | Ai |
|---|---|---|
| 1 | **Pentest / review độc lập** về bảo mật | Đội ATTG. Không nên là tôi — tôi viết chính đoạn code đó | T-11-15 |
| 2 | File icon thật (hiện là bản tạm sinh bằng script) | Design | E8 |
| 3 | **Hướng dẫn cho người dùng cuối** (lấy key ở đâu, báo lỗi thế nào) | Viết được nhưng **phụ thuộc A1 và A4** — chưa chốt thì không viết nổi bước "vào đâu lấy key" | Phụ lục C mục 8 |
| 4 | **Chính sách nâng cấp Electron.** Đang ở bản 43; major mới ra ~8 tuần/lần, chỉ 3 bản gần nhất được hỗ trợ. Quan trọng hơn nữa: `node:sqlite` là API *experimental*, phải đọc ghi chú phát hành trước mỗi lần nâng. | Cần một người chịu trách nhiệm — hiện chưa có | E10, ADR 0003 |

## 7. Đã đóng trong quá trình làm

Ghi lại để không ai mở lại một câu hỏi đã có câu trả lời.

| Mục | Kết quả |
|---|---|
| E1 — driver SQLite | ✅ **Đã chốt**: `node:sqlite`, bỏ hẳn `better-sqlite3`. ADR 0003 là ADR duy nhất đã ký |
| E7 — quản lý thao tác `uncertain` | Đã có banner tập trung, đọc từ DB nên sống sót qua khởi động lại |
| E8 / C5 — icon | Đã có bản tạm hợp lệ (7 kích thước) |
| C1 — chạy thử app | Đã chạy thật trên Linux + 12 E2E. Phần Windows chuyển sang CI |
| A6 — Confluence write | Ngoài MVP theo §22.3 |
| A10 — đánh giá Tauri | Không làm, dùng Electron theo §22.3 |
| B5–B10 | Đều đã quyết định và ghi lý do trong ADR 0006/0007 |

---

## Thứ tự nên bắt đầu

1. **Khởi động thủ tục certificate ngay** (mục 1.1) — nó dài nhất và chặn nhiều thứ nhất.
2. **Chốt package MCP** (mục 1.2) — nó ảnh hưởng cả yêu cầu triển khai của IT.
3. **Đưa OpenAI qua ATTT** (mục 1.5) — nếu bị từ chối thì phải gỡ, càng sớm càng ít việc.
4. Còn lại có thể chạy song song.

## Tài liệu gốc

| Nội dung | Ở đâu |
|---|---|
| Chi tiết từng câu hỏi + giả định đã dùng + chỗ cần sửa | [`OPEN-QUESTIONS.md`](OPEN-QUESTIONS.md) |
| Quyết định kiến trúc + lý do + hệ quả | [`architecture/adr/`](architecture/adr/) |
| Mối đe doạ + biện pháp + test tương ứng | [`security/threat-model.md`](security/threat-model.md) |
| Đối chiếu Phụ lục C và tiêu chí §21 | [`operations/pre-pilot-checklist.md`](operations/pre-pilot-checklist.md) |
| Điều tra sự cố | [`RUNBOOK.md`](RUNBOOK.md) |
| Hợp đồng với hệ thống ngoài | [`integration/`](integration/) |
| Kế hoạch theo epic và mã `T-*` | `TASKLIST.md` (⚠️ đang bị gitignore) |
