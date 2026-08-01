# Nexa — Tài liệu thiết kế kỹ thuật và kế hoạch triển khai MVP

> **Bản trích xuất tự động** từ `Nexa_Tai_lieu_thiet_ke_va_trien_khai_MVP_v1.1.docx`.
> Sinh bằng `scripts/extract-design-doc.mjs`. **File .docx là bản gốc có thẩm quyền** — khi hai
> bản lệch nhau thì .docx đúng.
> Mục đích của bản này: để `grep` được từ trong repo và để diff khi tài liệu ra phiên bản mới.

NEXA

TÀI LIỆU THIẾT KẾ KỸ THUẬTVÀ KẾ HOẠCH TRIỂN KHAI MVP

Trợ lý AI chạy trên máy tính cá nhân, tích hợp LiteLLM và MCP


| Tên hệ thống | Nexa |
|---|---|
| Mục đích | Tài liệu nền tảng để thiết kế, phát triển, kiểm thử và triển khai MVP |
| Đối tượng sử dụng | Đội phát triển, kiến trúc, bảo mật, vận hành và quản trị sản phẩm |
| Phạm vi | Ứng dụng Windows + LiteLLM + MCP Atlassian cấu hình cục bộ |
| Phiên bản tài liệu | 1.1 – 01/08/2026 |

TRẠNG THÁI: ĐÃ CẬP NHẬT MÔ HÌNH AUTH VÀ MCP CỤC BỘ


## Thông tin tài liệu


| Mục | Nội dung |
|---|---|
| Mục tiêu | Chuyển mô tả ý tưởng Nexa thành đặc tả đủ rõ để đội phát triển bắt đầu triển khai MVP. |
| Giả định chính | LLM không chạy trên laptop. Người dùng tự nhập LiteLLM API key, endpoint và danh sách model muốn sử dụng. Jira/Confluence được truy cập qua MCP Atlassian bằng tài khoản và Personal Access Token của chính người dùng. |
| Nguyên tắc dữ liệu | Hội thoại, cấu hình kết nối và secret được lưu cục bộ có mã hóa. LiteLLM/Jira/Confluence chỉ lưu log theo cơ chế sẵn có của từng hệ thống; Nexa không cần kho hội thoại tập trung. |
| Nguyên tắc thao tác | Mọi tool làm thay đổi dữ liệu phải hiển thị bản xem trước và được người dùng xác nhận. |
| Nền tảng ưu tiên | Windows 10/11 64-bit; kiến trúc ban đầu tối ưu cho Windows doanh nghiệp. |


## Mục lục

1. Tổng quan sản phẩm

2. Phạm vi MVP và ngoài phạm vi

3. Nguyên tắc kiến trúc

4. Kiến trúc tổng thể

5. Kiến trúc ứng dụng desktop

6. Kiến trúc dịch vụ dùng chung và hệ thống đích

7. Luồng nghiệp vụ chính

8. Thiết kế lưu trữ cục bộ

9. Thiết kế kết nối và hợp đồng tích hợp

10. Tích hợp MCP và cơ chế xác nhận

11. Bảo mật và kiểm soát dữ liệu

12. Yêu cầu tài nguyên máy trạm

13. Cấu trúc mã nguồn đề xuất

14. Xử lý tài liệu

15. Logging, giám sát và kiểm toán

16. Xử lý lỗi và khả năng phục hồi

17. Kiểm thử

18. Đóng gói, phát hành và cập nhật

19. Lộ trình triển khai

20. Backlog MVP

21. Tiêu chí nghiệm thu

22. Rủi ro và quyết định còn mở


## 1. Tổng quan sản phẩm

Nexa là ứng dụng trợ lý AI được cài đặt và sử dụng trực tiếp trên laptop của nhân viên. Người dùng tự cấu hình endpoint và API key do LiteLLM cấp, thêm các model muốn sử dụng, xử lý tài liệu do mình lựa chọn và gọi Jira/Confluence thông qua MCP Atlassian.

Ứng dụng desktop đảm nhiệm giao diện, Agent Runtime, đọc file cục bộ, quản lý cấu hình kết nối, bảo vệ secret, kiểm soát xác nhận thao tác và lưu lịch sử hội thoại. Nexa gọi trực tiếp LiteLLM bằng API key của người dùng và chạy hoặc kết nối MCP Atlassian trên máy để truy cập Jira/Confluence bằng thông tin đăng nhập của chính người dùng.


> Mục tiêu kiến trúcGiảm tối đa thành phần máy chủ riêng của Nexa: laptop gọi LiteLLM trực tiếp, quản lý MCP Atlassian cục bộ, không yêu cầu GPU và lưu hội thoại/credential an toàn theo tài khoản Windows.


### 1.1 Mục tiêu sản phẩm

- Cung cấp một kênh sử dụng AI thống nhất cho nhân viên trên laptop.
- Tái sử dụng hạ tầng LiteLLM và danh sách model hiện có.
- Tích hợp công cụ doanh nghiệp qua MCP thay vì viết tích hợp riêng cho từng màn hình.
- Giữ lịch sử hội thoại ở máy người dùng, giảm lưu trữ nội dung nhạy cảm trên server.
- Đảm bảo người dùng luôn kiểm soát các thao tác có khả năng làm thay đổi dữ liệu.
- Tạo nền tảng có thể mở rộng thêm tool, workflow và chính sách sau giai đoạn MVP.

### 1.2 Đối tượng sử dụng


| Nhóm | Nhu cầu chính |
|---|---|
| Nhân viên nghiệp vụ | Chat với AI, hỏi đáp tài liệu, đọc Jira/Confluence, tạo hoặc cập nhật công việc có xác nhận. |
| Quản trị LiteLLM | Sinh/thu hồi API key, cấu hình model và hạn mức ở LiteLLM; không quản lý hội thoại của Nexa. |
| An toàn thông tin | Kiểm soát cách lưu API key/PAT, domain được phép kết nối, log cục bộ và dữ liệu gửi tới model. |
| Đội vận hành | Theo dõi LiteLLM, kênh phát hành ứng dụng và hỗ trợ lỗi kết nối cục bộ. |
| Đội phát triển | Phát triển desktop app, secure storage, LiteLLM client, MCP Atlassian integration, kiểm thử và phát hành. |


## 2. Phạm vi MVP và ngoài phạm vi


### 2.1 Phạm vi MVP

- Thiết lập endpoint và API key LiteLLM do người dùng được cấp.
- Cho phép người dùng thêm, xóa và chọn model muốn sử dụng; kiểm tra model với LiteLLM khi có thể.
- Trò chuyện với LLM và nhận phản hồi theo streaming.
- Tạo, đổi tên, tìm kiếm và xóa hội thoại cục bộ.
- Đính kèm và trích xuất nội dung từ TXT, PDF, DOCX.
- Cấu hình Jira URL, tên đăng nhập và Personal Access Token; đọc Jira issue thông qua MCP Atlassian.
- Tạo Jira issue sau khi người dùng xem trước và xác nhận.
- Cấu hình Confluence URL, tên đăng nhập và Personal Access Token; đọc trang Confluence thông qua MCP Atlassian.
- Ghi local diagnostic tối thiểu; sử dụng usage log của LiteLLM và activity/audit của Atlassian khi cần truy vết.
- Đóng gói bộ cài cho Windows và có cơ chế kiểm tra cập nhật.

### 2.2 Ngoài phạm vi MVP

- Chạy LLM, embedding hoặc OCR nâng cao trực tiếp trên laptop.
- Multi-agent hoặc workflow tự động phức tạp.
- Tự động thao tác dữ liệu doanh nghiệp mà không cần xác nhận.
- Đồng bộ lịch sử hội thoại giữa nhiều máy.
- Plugin marketplace cho người dùng tự cài tool.
- Voice assistant, speech-to-text, screen control hoặc điều khiển máy tính.
- Lưu bản sao đầy đủ của file đính kèm trong cơ sở dữ liệu.
- Hỗ trợ macOS và Linux trong giai đoạn đầu.

## 3. Nguyên tắc kiến trúc


| Nguyên tắc | Diễn giải |
|---|---|
| Local-first cho hội thoại | Nội dung hội thoại, cấu hình cá nhân và credential reference được lưu trên laptop; không có kho hội thoại Nexa tập trung. |
| Tự cấu hình kết nối | Người dùng nhập LiteLLM API key, model, Jira/Confluence URL, username và PAT trong màn hình Settings. |
| User-in-the-loop | Tool có side effect bắt buộc hiển thị bản xem trước và yêu cầu xác nhận. |
| Least privilege | Quyền thực tế do LiteLLM key và quyền của tài khoản/PAT Atlassian quyết định; Nexa chỉ bật đúng nhóm tool cần thiết. |
| Explicit file access | Chỉ đọc file do người dùng chủ động chọn; không quét thư mục hoặc ổ đĩa. |
| Traceable | Mỗi request/tool call có request_id hoặc operation_id; đối chiếu local log với log LiteLLM và lịch sử Jira/Confluence khi cần. |
| Fail closed | Khi thiếu cấu hình, secret không giải mã được hoặc kết nối không xác thực được, Nexa không gọi LLM/tool. |
| No local secret in plaintext | Token, khóa mã hóa và thông tin nhạy cảm không lưu dạng rõ trên ổ đĩa. |


## 4. Kiến trúc tổng thể

Kiến trúc ưu tiên desktop tự cấu hình. Laptop chịu trách nhiệm giao diện, lịch sử, secure storage, Agent Runtime và MCP Atlassian. Dịch vụ dùng chung bắt buộc chỉ gồm LiteLLM và các hệ thống Jira/Confluence hiện có; không cần Nexa Backend, Identity Service hoặc MCP Gateway riêng trong MVP.


### 4.1 Phân tách trách nhiệm


| Năng lực | Laptop | Máy chủ nội bộ |
|---|---|---|
| Giao diện và UX | Có | Không |
| Lịch sử hội thoại | Lưu cục bộ có mã hóa | Không lưu dài hạn |
| Agent orchestration | Có, toàn bộ lifecycle phiên và tool call | Không cần thành phần server Nexa trong MVP |
| Quản lý model | Người dùng lưu danh sách model cục bộ và chọn model | LiteLLM quyết định key có được gọi model đó hay không |
| Gọi LLM | Gọi trực tiếp bằng endpoint + API key đã mã hóa | LiteLLM routing, quota và provider abstraction |
| MCP tools | MCP client + Atlassian MCP cục bộ + confirmation | Jira/Confluence kiểm tra quyền tài khoản/PAT |
| File người dùng | Đọc file được chọn | Chỉ nhận nội dung cần thiết |
| Audit | Local diagnostic và lifecycle tool tối thiểu | Usage log LiteLLM + activity/audit sẵn có của Atlassian |


### 4.2 Giao thức kết nối


| Kết nối | Giao thức đề xuất | Yêu cầu |
|---|---|---|
| Desktop → LiteLLM | HTTPS + SSE | Authorization Bearer bằng LiteLLM API key lấy từ secure storage; timeout; cancel; request_id. |
| Desktop → MCP Atlassian | MCP stdio hoặc localhost chỉ bind loopback | MCP được khởi chạy/kết nối từ main process; renderer không nhận username/PAT. |
| MCP Atlassian → Jira/Confluence | HTTPS/API Atlassian | Dùng URL, username và PAT của người dùng; bắt buộc TLS và validate hostname. |
| Desktop → Update Server | HTTPS | Chữ ký gói cài đặt; kiểm tra checksum; kênh stable/beta. |


## 5. Kiến trúc ứng dụng desktop


### 5.1 Công nghệ khuyến nghị


| Thành phần | Lựa chọn MVP | Lý do |
|---|---|---|
| Desktop shell | Electron | Tốc độ phát triển nhanh, hệ sinh thái TypeScript và MCP thuận lợi. |
| UI | React + TypeScript | Phù hợp giao diện chat, quản lý trạng thái và component hóa. |
| Agent Runtime | Node.js/TypeScript | Dùng chung type với UI; thuận lợi gọi LiteLLM và MCP SDK. |
| Local database | SQLite + SQLCipher hoặc mã hóa lớp ứng dụng | Nhẹ, dễ đóng gói, hỗ trợ truy vấn lịch sử. |
| Secret protection | Windows DPAPI/Credential Manager | Gắn secret với tài khoản Windows; không lưu plaintext. |
| Streaming | Server-Sent Events | Đơn giản cho luồng token một chiều; dễ debug hơn WebSocket. |
| Packaging | electron-builder | Tạo installer, ký số và hỗ trợ auto-update. |


> Phương án tối ưu tài nguyênNếu yêu cầu RAM rất nghiêm ngặt, có thể đánh giá Tauri ở giai đoạn sau. MVP nên ưu tiên Electron để giảm rủi ro triển khai và rút ngắn thời gian phát triển.


### 5.2 Các module chính


| Module | Trách nhiệm |
|---|---|
| Renderer/UI | Chat list, message thread, model selector, file picker, tool confirmation và màn hình cấu hình LiteLLM/Jira/Confluence. |
| Main Process | Quản lý cửa sổ, hệ thống file, secure storage, update, lifecycle. |
| Preload Bridge | API IPC giới hạn giữa renderer và main; không bật nodeIntegration trong renderer. |
| Agent Runtime | Tạo request, quản lý context, quyết định gọi model/tool, ghép kết quả vào hội thoại. |
| LLM Client | Gọi LiteLLM bằng API key cục bộ, streaming, cancellation, timeout, test kết nối và chuẩn hóa lỗi. |
| MCP Client/Manager | Khởi chạy hoặc kết nối MCP Atlassian, truyền credential từ main process, tools/list, tools/call và quản lý lifecycle. |
| Confirmation Guard | Phân loại read/write; tạo preview; chờ xác nhận; chống double-submit. |
| Document Processor | Đọc TXT/PDF/DOCX, trích xuất văn bản, giới hạn kích thước, cleanup file tạm. |
| Local Repository | SQLite migrations, CRUD conversation/message/attachment metadata. |
| Security Service | DPAPI/Credential Manager, lưu LiteLLM key và PAT, credential reference, redaction log và xóa secret. |
| Update Service | Kiểm tra phiên bản, tải gói ký số, cập nhật có kiểm soát. |


### 5.3 Nguyên tắc IPC Electron

- Tắt nodeIntegration cho renderer và bật contextIsolation.
- Chỉ expose các hàm IPC cụ thể qua preload; không expose ipcRenderer trực tiếp.
- Validate toàn bộ input tại main process bằng schema.
- Không cho UI truyền đường dẫn tùy ý để đọc file; chỉ sử dụng handle từ file picker.
- Không ghi token, nội dung file hoặc prompt đầy đủ vào console log.
- Giới hạn danh sách domain được phép gọi từ desktop.

## 6. Kiến trúc dịch vụ dùng chung và hệ thống đích


| Thành phần | Trách nhiệm |
|---|---|
| LiteLLM Gateway | Nhận API key, xác thực key, route model, áp dụng quota/rate limit và ghi usage theo cấu hình LiteLLM. |
| Model Provider | Cung cấp LLM phía sau LiteLLM; Nexa không kết nối trực tiếp provider. |
| Atlassian MCP Server/Adapter | Chạy cục bộ hoặc do Nexa quản lý trên laptop; chuyển tools/list và tools/call thành API Jira/Confluence. |
| Jira | Xác thực username/PAT, kiểm tra quyền dự án/issue và ghi lịch sử thao tác của người dùng. |
| Confluence | Xác thực username/PAT, kiểm tra quyền space/page và ghi lịch sử thao tác của người dùng. |
| Update/Distribution Server | Tùy chọn; cung cấp installer, version manifest và bản cập nhật đã ký số. |
| Nexa Backend riêng | Không bắt buộc trong MVP. Chỉ bổ sung khi cần quản trị tập trung, telemetry hoặc policy ở giai đoạn sau. |


### 6.1 Dữ liệu có thể phát sinh ngoài laptop


| Trường/nguồn | Ví dụ | Mục đích |
|---|---|---|
| LiteLLM request id | req_01H... | Truy vết lệnh gọi model |
| LiteLLM key identifier | key alias/hash, không phải secret | Nhận diện credential ở LiteLLM |
| Timestamp | 2026-08-01T10:30:00+07:00 | Vận hành và kiểm toán |
| Model | gpt-5.x-internal | Usage/quota |
| Token usage | input/output token | Theo dõi chi phí và hạn mức |
| LLM status/latency | success/error, 2350 ms | Theo dõi chất lượng dịch vụ |
| Atlassian account | username của người dùng | Gắn thao tác với tài khoản đích |
| Atlassian action | create issue/update page | Lịch sử nghiệp vụ tại hệ thống đích |
| Target object | JIRA-123 hoặc page id | Truy vết đối tượng đã đọc/thay đổi |
| Client version | 1.1.0 | Hỗ trợ xử lý lỗi |
| Local request/operation id | req_... / op_... | Đối chiếu local log với hệ thống bên ngoài |


> Không lưu/không gửi secretLiteLLM API key, Jira PAT, Confluence PAT không được đưa vào prompt, tool argument, local log, telemetry hoặc log tập trung. Secret chỉ được giải mã tại Electron main process ngay trước khi tạo kết nối.


## 7. Luồng nghiệp vụ chính


### 7.1 Chat thông thường

1. Người dùng mở hoặc tạo hội thoại.

2. Desktop tải danh sách model đã lưu cục bộ; người dùng chọn model hoặc thêm model mới trong Settings.

3. Người dùng nhập câu hỏi; Agent Runtime tạo request_id.

4. Desktop gửi messages/context cần thiết tới LiteLLM.

5. LiteLLM xác thực API key, kiểm tra model/quota theo cấu hình của key và route tới provider.

6. Desktop nhận token theo SSE và cập nhật UI.

7. Khi hoàn tất, nội dung được lưu vào SQLite cục bộ.

8. LiteLLM có thể ghi usage metadata theo cấu hình hiện có; Nexa không gửi nội dung hội thoại tới một backend riêng.


### 7.2 Hỏi đáp với file

1. Người dùng chọn file qua file picker.

2. Ứng dụng kiểm tra loại file, dung lượng, số lượng và chính sách.

3. Document Processor trích xuất văn bản vào vùng nhớ hoặc thư mục tạm.

4. Ứng dụng hiển thị file đã chọn và lượng nội dung dự kiến gửi.

5. Agent Runtime cắt đoạn hoặc rút gọn nội dung theo context limit.

6. Nội dung cần thiết được gửi tới model qua LiteLLM.

7. Ứng dụng xóa file tạm sau khi hoàn tất hoặc khi phiên bị hủy.

8. Local DB chỉ lưu metadata và nội dung trích xuất nếu chính sách cho phép.


### 7.3 Tool chỉ đọc

1. LLM hoặc người dùng yêu cầu đọc Jira/Confluence.

2. Agent Runtime kiểm tra tool có được bật trong cấu hình cục bộ và kết nối Jira/Confluence tương ứng đã sẵn sàng.

3. MCP Client gọi Atlassian MCP server/adapter được quản lý trên laptop.

4. MCP dùng URL, username và PAT đã giải mã để gọi Jira hoặc Confluence; hệ thống đích kiểm tra quyền của tài khoản.

5. Kết quả được trả về, rút gọn nếu cần và đưa vào context của LLM.

6. Kết quả cuối cùng hiển thị cho người dùng; Nexa ghi local lifecycle tối thiểu và hệ thống đích giữ activity/audit theo khả năng sẵn có.


### 7.4 Tool thay đổi dữ liệu

1. Agent Runtime nhận tool call có side effect.

2. Confirmation Guard dừng thực thi và tạo bản xem trước.

3. UI hiển thị hệ thống đích, hành động, dữ liệu gửi và dữ liệu bị thay đổi.

4. Người dùng chọn Xác nhận hoặc Hủy.

5. Khi xác nhận, desktop tạo approval record cục bộ gắn với payload hash và operation_id dùng một lần.

6. Confirmation Guard kiểm tra approval còn hiệu lực rồi mới cho MCP Client thực thi bằng credential của người dùng.

7. Tool được thực thi tại Jira/Confluence; kết quả, operation_id và object key được lưu cục bộ ở mức tối thiểu.

8. UI hiển thị liên kết hoặc mã đối tượng vừa tạo/cập nhật.


## 8. Thiết kế lưu trữ cục bộ


### 8.1 Mô hình dữ liệu đề xuất


| Bảng | Trường chính | Ghi chú |
|---|---|---|
| profiles | id, windows_sid, display_name, created_at | Một profile theo tài khoản Windows; không phải tài khoản đăng nhập Nexa. |
| conversations | id, title, model_id, created_at, updated_at, archived_at | Model id lấy từ danh sách cấu hình cục bộ. |
| messages | id, conversation_id, role, content_ciphertext, status, created_at | Nội dung được mã hóa. |
| attachments | id, message_id, file_name, file_type, file_size, source_path_hash, extracted_text_ciphertext | Không mặc định lưu bản sao file. |
| tool_calls | id, message_id, tool_name, risk_level, preview_ciphertext, approval_status, result_summary_ciphertext | Theo dõi lifecycle tool. |
| connections | id, type, base_url, username, enabled, created_at, updated_at | Lưu metadata LiteLLM/Jira/Confluence; không chứa API key/PAT dạng rõ. |
| credential_refs | connection_id, secret_kind, secure_storage_key | Chỉ lưu tham chiếu tới secret được bảo vệ bằng DPAPI/Credential Manager. |
| schema_migrations | version, applied_at | Quản lý migration; local audit có thể đặt ở bảng riêng nếu cần. |
| settings | key, value_ciphertext, updated_at | Cấu hình cá nhân không phải secret. |
| local_audit | id, event_type, request_id, status, error_code, created_at | Không ghi key, PAT, prompt hoặc payload nghiệp vụ đầy đủ. |


### 8.2 Chiến lược mã hóa

- Tạo master key ngẫu nhiên cho mỗi profile người dùng.
- Bảo vệ master key bằng Windows DPAPI theo CurrentUser hoặc Credential Manager.
- Dùng master key để mã hóa hội thoại; LiteLLM API key và PAT ưu tiên lưu bằng Windows DPAPI/Credential Manager hoặc Electron safeStorage, không nằm trong localStorage.
- Mỗi bản ghi hoặc nhóm bản ghi cần nonce/IV riêng; lưu authentication tag.
- Không suy ra khóa từ username hoặc password Windows.
- Khi xóa profile hoặc xóa kết nối, phải xóa cả credential tương ứng khỏi secure storage và xóa dữ liệu cục bộ theo lựa chọn người dùng.
- Sao lưu dữ liệu cục bộ chỉ được hỗ trợ khi có chính sách và cơ chế mã hóa phù hợp.

### 8.3 Chính sách lưu giữ


| Loại dữ liệu | Mặc định | Khuyến nghị |
|---|---|---|
| Hội thoại | Lưu cục bộ cho đến khi người dùng xóa | Có thể cấu hình tự xóa sau 30/90/180 ngày. |
| File gốc | Không sao chép vào DB | Chỉ giữ đường dẫn/hash; cảnh báo khi file không còn tồn tại. |
| Nội dung trích xuất | Có thể lưu mã hóa | Cho phép tắt hoặc chỉ lưu với file nhỏ. |
| File tạm | Xóa ngay sau xử lý | Dọn thêm khi khởi động nếu phiên trước bị crash. |
| Log debug | 7–14 ngày | Giới hạn dung lượng và redact dữ liệu nhạy cảm. |
| Log ngoài laptop | Theo cấu hình LiteLLM và Atlassian | Nexa không đẩy secret/prompt/file content; việc lưu metadata phụ thuộc hệ thống đích. |


## 9. Thiết kế kết nối và hợp đồng tích hợp


### 9.1 Kênh kết nối mà desktop sử dụng


| Kênh | Operation/Endpoint | Mục đích |
|---|---|---|
| LiteLLM HTTPS | GET /v1/models (nếu được bật) | Kiểm tra API key và hỗ trợ người dùng tham khảo model khả dụng. |
| LiteLLM HTTPS | POST /v1/chat/completions | Chat/streaming tương thích OpenAI bằng model id người dùng đã cấu hình. |
| MCP local | initialize | Khởi tạo phiên MCP Atlassian và trao đổi capability. |
| MCP local | tools/list | Lấy danh sách Jira/Confluence tool do MCP server cung cấp. |
| MCP local | tools/call | Gọi tool sau khi validate schema và hoàn tất xác nhận nếu có side effect. |
| Jira qua MCP | Atlassian API | Đọc/tạo/cập nhật Jira bằng URL, username và PAT của người dùng. |
| Confluence qua MCP | Atlassian API | Đọc/cập nhật Confluence bằng URL, username và PAT của người dùng. |
| Update server (tùy chọn) | Version manifest | Kiểm tra phiên bản và tải gói cài đặt đã ký số. |
| Local IPC | connection.test/save/delete | Kiểm tra và quản lý cấu hình kết nối trong Electron main process. |
| Local IPC | models.add/remove/select | Quản lý danh sách model cục bộ; không lưu key trong renderer. |


### 9.2 Kết quả chuẩn hóa trong ứng dụng


> Success:{  "request_id": "req_...",  "data": { ... },  "meta": { "source": "litellm\|jira\|confluence" }}Error:{  "request_id": "req_...",  "error": {    "code": "JIRA_AUTH_FAILED",    "message": "Không xác thực được Jira. Hãy kiểm tra URL, tên đăng nhập và PAT.",    "retryable": false  }}


### 9.3 Yêu cầu bắt buộc cho mỗi request

- Với LiteLLM, main process thêm Authorization: Bearer <API key>; renderer không được đọc hoặc tự tạo header này.
- X-Request-ID/operation_id do desktop tạo và giữ xuyên suốt adapter, local log và thông báo lỗi.
- Không gửi device/user identifier ngoài laptop nếu chưa có nhu cầu và chính sách rõ ràng.
- Timeout rõ ràng; hỗ trợ cancel từ UI.
- Không tự retry tool tạo/cập nhật khi kết quả chưa rõ; phải dựa trên operation_id và tra cứu hệ thống đích trước.
- Error code ổn định để UI có thể hiển thị hướng dẫn phù hợp.

## 10. Tích hợp MCP và cơ chế xác nhận


### 10.1 Phân loại tool


| Mức | Ví dụ | Cách xử lý |
|---|---|---|
| READ | jira.get_issue, confluence.get_page | Chạy khi kết nối đã được kiểm tra; UI hiển thị tool đang hoạt động. Quyền cuối cùng do Jira/Confluence quyết định. |
| WRITE_LOW | jira.add_comment | Bắt buộc preview và xác nhận; thực thi bằng PAT của người dùng. |
| WRITE_HIGH | jira.update_issue, confluence.update_page | Preview chi tiết và xác nhận rõ; có thể tắt khỏi MVP theo cấu hình. |
| DESTRUCTIVE | delete/archive/permission change | Không bật trong MVP hoặc yêu cầu quy trình phê duyệt riêng. |


### 10.2 Nội dung màn hình xác nhận

- Tên công cụ và hệ thống đích.
- Hành động cụ thể: tạo, cập nhật, bình luận, chuyển trạng thái…
- Tài khoản/người dùng thực hiện.
- Dữ liệu sẽ được gửi tới hệ thống đích.
- Trường hoặc đối tượng sẽ bị thay đổi.
- Cảnh báo tác động và khả năng hoàn tác.
- Nút Xác nhận và Hủy; không dùng nút mơ hồ như Tiếp tục.
- Approval có thời hạn ngắn và chỉ dùng cho đúng payload hash.

### 10.3 Operation tracking và chống gọi lặp

Mỗi thao tác write phải có operation_id và payload hash do desktop tạo. Nexa khóa nút xác nhận sau lần gửi đầu, lưu trạng thái pending/success/uncertain và không tự retry khi chưa biết kết quả. Khi API đích hỗ trợ idempotency thì truyền idempotency key; nếu không, phải tra cứu object/result trước khi cho phép thử lại.


> operation_id = uuid()payload_hash = sha256(tool_name + normalized_payload)approval = { operation_id, payload_hash, approved_at, expires_at }


## 11. Bảo mật và kiểm soát dữ liệu


### 11.1 Kiểm soát trên desktop

- Ký số bộ cài và executable.
- Không chạy ứng dụng với quyền Administrator nếu không cần.
- Không cho renderer truy cập trực tiếp Node.js hoặc hệ thống file.
- Lưu LiteLLM API key, Jira PAT và Confluence PAT bằng DPAPI/Credential Manager hoặc Electron safeStorage; không lưu trong localStorage, file JSON hoặc SQLite dạng rõ.
- Có thể khóa màn hình Settings hoặc yêu cầu xác nhận Windows trước khi hiển thị/xóa credential; mặc định chỉ hiển thị giá trị đã che.
- Redact log: token, prompt, content file, dữ liệu Jira/Confluence.
- Quét dependency, khóa phiên bản và tạo SBOM cho bản phát hành.
- Cho phép xóa toàn bộ dữ liệu cục bộ theo profile người dùng.

### 11.2 Kiểm soát kết nối và hệ thống đích

- Chỉ cho phép HTTPS; validate certificate/hostname và chặn URL có credential nhúng hoặc scheme không an toàn.
- LiteLLM key phải có model/quota phù hợp; Jira/Confluence áp dụng quyền của chính tài khoản người dùng.
- Rate limit/quota được cấu hình tại LiteLLM theo key; Nexa hiển thị lỗi rõ khi key bị thu hồi hoặc vượt hạn mức.
- Nexa phải hiển thị cảnh báo dữ liệu và cho phép cấu hình domain/model được phép nhận tài liệu nội bộ.
- Không dùng PAT dùng chung. Mỗi người dùng tự nhập credential của chính mình; quyền tool không được vượt quyền tài khoản Atlassian.
- Cho phép cập nhật/xóa key và PAT; khi hệ thống đích thu hồi credential, Nexa phải yêu cầu cấu hình lại.
- Dùng local operation record kết hợp lịch sử/audit của Jira hoặc Confluence; MVP không cam kết audit tập trung end-to-end.
- Không thu thập telemetry tập trung mặc định; có thể bổ sung ở giai đoạn sau nếu tổ chức yêu cầu và phê duyệt.

### 11.3 Threat model sơ bộ


| Mối đe dọa | Biện pháp chính |
|---|---|
| Người dùng khác đọc lịch sử trên cùng máy | Mã hóa local DB; DPAPI CurrentUser; khóa ứng dụng. |
| Renderer bị XSS và đọc token | contextIsolation, CSP, preload API tối thiểu, không lưu token trong localStorage. |
| Tool call bị thay đổi sau xác nhận | Approval gắn với payload hash và hết hạn nhanh. |
| Gọi tool vượt quyền | Tool allowlist cục bộ + quyền thực tế của tài khoản/PAT tại Jira/Confluence; không coi LLM output là dữ liệu tin cậy. |
| Gửi file ngoài ý muốn | Chỉ file picker; preview; giới hạn domain/model và DLP nếu có. |
| Lộ dữ liệu qua log | Redaction và danh sách trường cấm log. |
| Bản cập nhật giả mạo | Ký số, checksum, HTTPS, pin kênh cập nhật. |
| Double-submit tạo trùng Jira | Operation lock cục bộ, disable nút sau xác nhận, lưu trạng thái uncertain và tra cứu trước khi retry. |


## 12. Yêu cầu tài nguyên máy trạm


| Tình huống | RAM dự kiến | CPU | Ổ đĩa/tạm |
|---|---|---|---|
| Mở ứng dụng, không hoạt động | 250–500 MB | < 2% | Không đáng kể |
| Chat thông thường | 400–800 MB | 3–15% | Rất ít |
| Gọi Jira/Confluence | 450–900 MB | 5–20% | Log nhỏ |
| Đọc PDF/DOCX nhỏ | 600 MB–1.2 GB | 10–40% ngắn hạn | 10–200 MB |
| Nhiều file/tài liệu lớn | 1–2 GB | Có thể cao trong thời gian ngắn | 200 MB–2 GB |
| Cài đặt/cập nhật | — | — | 300–800 MB |


### 12.1 Cấu hình công bố


| Mức | Yêu cầu |
|---|---|
| Tối thiểu | Windows 10/11 64-bit; CPU 2 nhân; RAM 8 GB; trống 2 GB; kết nối mạng nội bộ; không cần GPU. |
| Khuyến nghị | Windows 11 64-bit; CPU 4 nhân; RAM 16 GB; SSD; trống 5 GB; mạng ổn định tới LiteLLM/MCP. |
| Mục tiêu hiệu năng MVP | Idle < 500 MB RAM; chat < 800 MB; xử lý tài liệu < 1.5 GB; startup < 5 giây trên máy khuyến nghị. |


## 13. Cấu trúc mã nguồn đề xuất


> nexa/├─ apps/│  └─ desktop/│     ├─ src/main/            # Electron main process, secure storage, process manager│     ├─ src/preload/         # IPC bridge│     ├─ src/renderer/        # React UI│     └─ resources/           # MCP binaries/config templates nếu đóng gói├─ packages/│  ├─ agent-runtime/│  ├─ llm-client/│  ├─ mcp-client/│  ├─ atlassian-mcp-manager/│  ├─ connection-config/│  ├─ local-store/│  ├─ document-processor/│  ├─ security/│  ├─ shared-types/│  └─ ui-components/├─ docs/│  ├─ architecture/│  ├─ integration/│  └─ security/└─ tests/   ├─ e2e/   ├─ integration/   └─ fixtures/


### 13.1 Quy ước kỹ thuật

- Monorepo với pnpm workspaces hoặc tương đương.
- TypeScript strict; schema runtime dùng Zod hoặc JSON Schema.
- Không import trực tiếp code main process vào renderer.
- Mỗi tool có typed input/output, risk level và policy metadata.
- Migration DB có version và rollback strategy.
- Feature flag cục bộ cho tool/write action; model được người dùng thêm trong Settings và kiểm tra trước khi sử dụng.
- Không hard-code endpoint, model hoặc credential trong source code.

## 14. Xử lý tài liệu


| Loại file | Thư viện/chiến lược | Giới hạn MVP |
|---|---|---|
| TXT/Markdown | Đọc UTF-8; phát hiện encoding cơ bản | 20–30 MB/file |
| PDF | Parser text; không OCR mặc định | Giới hạn trang/kích thước; cảnh báo PDF scan |
| DOCX | Đọc paragraph/table text | Không xử lý macro/embedded object |
| Khác | Từ chối hoặc chỉ gửi metadata | Không mở rộng trong MVP |


### 14.1 Pipeline xử lý

- Validate MIME type và extension; không chỉ tin vào tên file.
- Kiểm tra kích thước và số lượng file trước khi đọc.
- Trích xuất văn bản trong worker/process riêng để tránh khóa UI.
- Chuẩn hóa text, loại bỏ ký tự điều khiển và giới hạn độ dài.
- Chunk theo token/context; giữ metadata trang/đoạn khi có thể.
- Không gửi toàn bộ file nếu câu hỏi chỉ cần một phần nhỏ.
- Xóa temp file trong finally và dọn khi app khởi động.

## 15. Logging, giám sát và kiểm toán


### 15.1 Log desktop


| Loại | Được ghi | Không được ghi |
|---|---|---|
| Application log | Phiên bản, startup, trạng thái module, error code | Prompt, response đầy đủ, token, nội dung file |
| Performance | Startup time, request latency, memory snapshot tổng quát | Nội dung người dùng |
| Security event | Credential save/delete, DB unlock failure, connection test failure, signature/update failure | API key, PAT hoặc credential plaintext |
| Tool lifecycle | Tool name, trạng thái, approval status, request_id | Payload nghiệp vụ đầy đủ |


### 15.2 Nguồn quan sát và truy vết

- LiteLLM cung cấp usage/status/latency theo khả năng cấu hình hiện có.
- Nexa ghi local latency/error code nhưng không ghi prompt, key hoặc PAT.
- Jira/Confluence giữ activity/audit gắn với tài khoản người dùng và đối tượng đích.
- Khi hỗ trợ người dùng, đối chiếu request_id/operation_id giữa local log, LiteLLM và Atlassian.
- Có thể thống kê approval confirmed/cancelled cục bộ; không gửi tập trung mặc định.
- Chỉ bổ sung telemetry tập trung khi có chính sách, consent và danh sách dữ liệu rõ ràng.
- Update server có thể ghi download/version metadata nhưng không nhận nội dung hội thoại hoặc secret.

## 16. Xử lý lỗi và khả năng phục hồi


| Tình huống | Hành vi mong muốn |
|---|---|
| Mất mạng khi chat | Dừng streaming, giữ draft, cho phép retry; không tạo message trùng. |
| LiteLLM timeout | Hiển thị lỗi có thể thử lại; không tự động chuyển model nếu người dùng chưa chọn hoặc chưa cấu hình model khác. |
| MCP Atlassian không khởi động/kết nối | Không thực thi tool; hiển thị lỗi cấu hình; cho phép test lại sau khi sửa URL/credential. |
| Tool write trả kết quả không rõ | Giữ operation ở trạng thái uncertain; tra cứu object/result trước khi cho phép retry. |
| Local DB bị khóa/hỏng | Khởi động chế độ chẩn đoán; không ghi đè; cung cấp export log không chứa nội dung. |
| Crash khi đang xử lý file | Dọn temp ở lần khởi động sau. |
| API key/PAT không hợp lệ hoặc bị thu hồi | Dừng kết nối tương ứng; yêu cầu người dùng cập nhật credential; không tự fallback sang credential khác. |
| Client quá cũ | Cảnh báo hoặc chặn theo version manifest nếu tổ chức triển khai update server. |


## 17. Kiểm thử


### 17.1 Phạm vi kiểm thử


| Lớp | Nội dung |
|---|---|
| Unit test | Agent state, schema validation, risk classification, encryption wrapper, repositories. |
| Integration test | LiteLLM mock, MCP Atlassian mock, SQLite migration, SSE cancellation, DPAPI/safeStorage adapter. |
| Contract test | LiteLLM endpoint/error mapping, MCP initialize/tools/list/tools/call và schema Jira/Confluence. |
| E2E desktop | Cấu hình LiteLLM, thêm model, chat, file attach, history, lưu credential, Jira/Confluence mock và confirmation. |
| Security test | XSS/CSP, IPC abuse, API key/PAT leakage, log redaction, malicious URL và update signature. |
| Performance test | Startup, memory idle, 100+ hội thoại, PDF lớn trong giới hạn. |
| UAT | Nhân viên nghiệp vụ thực hiện các kịch bản thật với môi trường thử nghiệm. |


### 17.2 Kịch bản bắt buộc cho tool write

- PAT không có quyền tại Jira/Confluence → hệ thống đích từ chối và Nexa hiển thị lỗi đã chuẩn hóa.
- Người dùng hủy → không có request thực thi gửi tới hệ thống đích.
- Payload bị thay đổi sau preview → approval không hợp lệ.
- Bấm xác nhận hai lần → chỉ tạo một đối tượng.
- Timeout sau khi gửi → giữ trạng thái uncertain và tra cứu đối tượng/kết quả trước khi retry.
- LiteLLM, MCP hoặc Atlassian trả lỗi → UI hiển thị request_id/operation_id và hướng dẫn phù hợp.
- Không lưu API key, PAT hoặc payload nhạy cảm trong local log hay log ngoài laptop.

## 18. Đóng gói, phát hành và cập nhật


### 18.1 Pipeline CI/CD

1. Lint, type-check và unit test.

2. Scan dependency, secret và license.

3. Build desktop theo môi trường.

4. Chạy integration/E2E trên Windows runner.

5. Tạo SBOM và checksum.

6. Ký số executable/installer.

7. Publish vào kênh beta hoặc stable nội bộ.

8. Cập nhật version manifest và release notes.

9. Rollout theo nhóm nhỏ trước khi mở rộng.


### 18.2 Chiến lược cập nhật


| Cơ chế | Khuyến nghị |
|---|---|
| Kênh cập nhật | Stable và beta; người dùng thường chỉ nhận stable. |
| Kiểm tra phiên bản | Khi khởi động và định kỳ tối đa một lần/ngày. |
| Bắt buộc cập nhật | Chỉ khi có lỗi bảo mật hoặc API không tương thích. |
| Rollback | Giữ bản cài trước hoặc cho phép tải bản ổn định gần nhất. |
| Chữ ký | Bắt buộc xác minh chữ ký và checksum trước khi cài. |
| Triển khai doanh nghiệp | Hỗ trợ MSI/EXE silent install nếu đội IT phân phối tập trung. |


## 19. Lộ trình triển khai


| Giai đoạn | Mục tiêu | Đầu ra |
|---|---|---|
| 0. Chuẩn bị | Chốt LiteLLM endpoint/key format, model naming, MCP Atlassian package, PAT scope và CI/CD | ADR, connection schema, threat model, repo. |
| 1. Desktop foundation | Electron shell, Settings, local DB và secure storage | App mở được, lưu profile, lưu/xóa secret an toàn. |
| 2. Chat LLM | LiteLLM connection test, model list cục bộ, chat, SSE, cancellation | Chat ổn định bằng API key người dùng. |
| 3. Local history | Conversation CRUD, search, encryption, migration | Lịch sử local an toàn. |
| 4. Document | TXT/PDF/DOCX, limit, temp cleanup | Hỏi đáp file trong giới hạn. |
| 5. MCP read | Cấu hình Jira/Confluence, quản lý MCP local, tools/list và read tools | Đọc dữ liệu bằng credential người dùng. |
| 6. MCP write | Preview, approval, operation lock và target result tracking | Tạo Jira task có xác nhận. |
| 7. Hardening | Security, performance, packaging, update | Release candidate. |
| 8. Pilot | Triển khai nhóm nhỏ, UAT, local diagnostics và thu thập phản hồi | Go/no-go production. |


> Thứ tự ưu tiênKhông nên triển khai tool write trước khi hoàn thiện secure storage, kiểm tra kết nối Jira/Confluence, confirmation guard, operation tracking và xử lý kết quả không chắc chắn.


## 20. Backlog MVP


| ID | Epic | Phạm vi | Ưu tiên |
|---|---|---|---|
| EPIC-01 | Desktop Foundation | Tạo Electron + React shell; preload; CSP; settings; crash handler. | P0 |
| EPIC-02 | Connection & Secret Management | Settings cho LiteLLM/Jira/Confluence; DPAPI/safeStorage; test/save/delete credential. | P0 |
| EPIC-03 | Model Configuration | Thêm/xóa/chọn model id; kiểm tra bằng LiteLLM; model mặc định. | P0 |
| EPIC-04 | LLM Chat | Streaming SSE; cancel; retry; error mapping; usage. | P0 |
| EPIC-05 | Local History | SQLite schema; encryption; CRUD; search; delete. | P0 |
| EPIC-06 | Document Processing | File picker; TXT/PDF/DOCX; limits; chunking; cleanup. | P1 |
| EPIC-07 | MCP Atlassian Read | Quản lý MCP local; Jira get/search; Confluence get/search; connection error mapping. | P1 |
| EPIC-08 | Confirmation Guard | Risk classification; preview; approve/cancel; payload hash. | P0 |
| EPIC-09 | MCP Write | Jira create issue; operation tracking; chống double-submit; result link; local audit. | P1 |
| EPIC-10 | Observability | Structured local log; operation id; redaction; hướng dẫn đối chiếu log LiteLLM/Atlassian. | P0 |
| EPIC-11 | Security Hardening | DPAPI; CSP; IPC validation; dependency scan; signing. | P0 |
| EPIC-12 | Packaging & Update | Installer; version manifest; beta/stable; rollback. | P1 |
| EPIC-13 | Testing & Pilot | E2E, performance, UAT, pilot rollout. | P0 |


### 20.1 User story tiêu biểu

- Là nhân viên, tôi muốn nhập LiteLLM key, thêm các model cần dùng và chọn model phù hợp cho từng hội thoại.
- Là nhân viên, tôi muốn lịch sử chat chỉ nằm trên laptop và có thể xóa khi cần.
- Là nhân viên, tôi muốn chọn một PDF và hỏi nội dung mà không phải tải file lên một hệ thống lưu trữ riêng.
- Là nhân viên, tôi muốn đọc Jira issue ngay trong Nexa.
- Là nhân viên, tôi muốn xem trước toàn bộ nội dung Jira task trước khi Nexa tạo task.
- Là người dùng, tôi muốn cập nhật hoặc xóa LiteLLM key và PAT ngay trong Settings mà không để lại secret dạng rõ trên máy.
- Là cán bộ an toàn thông tin, tôi muốn xác nhận key/PAT không xuất hiện trong DB, file cấu hình, log hoặc prompt và có thể đối chiếu operation_id với lịch sử Atlassian khi cần.

## 21. Tiêu chí nghiệm thu


| Hạng mục | Điều kiện đạt |
|---|---|
| Cài đặt | Cài và gỡ trên Windows không cần quyền admin nếu chính sách cho phép; executable có chữ ký. |
| Khởi động | Mở trong < 5 giây trên cấu hình khuyến nghị. |
| Tài nguyên | Idle < 500 MB RAM; chat thường < 800 MB; không có CPU nền bất thường. |
| Cấu hình LLM | Lưu/test/xóa LiteLLM key an toàn; thêm/xóa/chọn model; renderer không đọc được key plaintext. |
| Lịch sử | Lưu/đọc/tìm/xóa được; nội dung không đọc được bằng công cụ SQLite thông thường nếu chưa có khóa. |
| File | Đọc đúng TXT/PDF/DOCX trong giới hạn; temp được xóa. |
| MCP read | Cấu hình riêng Jira/Confluence; đọc đúng theo quyền của username/PAT; lỗi xác thực được hướng dẫn rõ. |
| MCP write | Không thể thực thi khi chưa xác nhận; double-click không tạo trùng. |
| Truy vết | Có request_id/operation_id cục bộ; có thể đối chiếu với usage log LiteLLM và lịch sử Atlassian; không lưu secret/prompt/file content. |
| Bảo mật | API key/PAT không nằm trong localStorage, file config hoặc log; renderer không có quyền file system/secure storage trực tiếp. |
| Update | Chỉ cài gói có chữ ký hợp lệ; hỗ trợ rollback hoặc tái cài bản trước. |
| Pilot | Nhóm người dùng thử hoàn thành kịch bản UAT và không có lỗi P0/P1 mở. |
| Chat | Streaming ổn định bằng LiteLLM key đã cấu hình; cancel được; lỗi có request_id và không lộ API key. |


## 22. Rủi ro và quyết định còn mở


### 22.1 Rủi ro chính


| Rủi ro | Tác động | Giảm thiểu |
|---|---|---|
| Electron dùng nhiều RAM | Ảnh hưởng máy 8 GB | Đặt budget, lazy-load, giới hạn webview/process, đo định kỳ. |
| MCP tool schema thay đổi | Lỗi runtime | Version tool, contract test, feature flag. |
| API key/PAT bị lưu hoặc lộ sai cách | Mất quyền LLM/Jira/Confluence | DPAPI/safeStorage, redaction, kiểm thử secret scanning, xóa credential đúng lifecycle. |
| Dữ liệu nhạy cảm gửi tới model ngoài | Rủi ro tuân thủ | Cảnh báo dữ liệu, allowlist model/domain, hướng dẫn người dùng và policy LiteLLM. |
| SQLite/khóa bị hỏng | Mất lịch sử local | Migration an toàn, backup tùy chọn được mã hóa, recovery guide. |
| Write action tạo trùng | Sai dữ liệu nghiệp vụ | Operation lock, status lookup, disable double-submit và không retry khi kết quả chưa rõ. |
| Update bị chặn bởi policy máy trạm | Không đồng nhất phiên bản | Hỗ trợ phân phối tập trung qua IT/endpoint management. |
| Người dùng nhập URL giả/malicious | SSRF hoặc gửi PAT sai đích | Chỉ HTTPS, validate URL/hostname, allowlist domain tổ chức nếu có, test certificate. |


### 22.2 Quyết định cần chốt trước khi code


| Chủ đề | Câu hỏi cần chốt |
|---|---|
| LiteLLM authentication | Định dạng key, base URL, cách thu hồi/rotate và endpoint kiểm tra key? |
| API topology | MVP chốt desktop gọi trực tiếp LiteLLM và MCP Atlassian chạy cục bộ; có cần BFF ở giai đoạn sau? |
| Local encryption | SQLCipher hay mã hóa từng trường bằng AES-GCM? |
| Credential Jira/Confluence | Dùng một hay hai PAT? PAT cần scope nào? Jira và Confluence có cùng base domain/tài khoản không? |
| Model data policy | Model nào được nhận tài liệu nội bộ/nhạy cảm? |
| Confluence write | Có nằm trong MVP hay chỉ Jira create issue? |
| Retention | Mặc định giữ hội thoại bao lâu? Người dùng có được tắt lưu lịch sử không? |
| Update channel | Tự động qua app hay do đội IT phân phối? |
| Telemetry | Mặc định chỉ local diagnostic; có cần gửi performance/error metadata tập trung sau pilot không? |
| Tauri evaluation | Có yêu cầu ngân sách RAM bắt buộc khiến Electron không phù hợp không? |


### 22.3 Khuyến nghị chốt cho MVP

- Dùng Electron + React + TypeScript.
- Desktop gọi trực tiếp LiteLLM; Nexa quản lý MCP Atlassian trên máy và gọi Jira/Confluence bằng credential người dùng.
- Người dùng nhập LiteLLM API key và danh sách model; API key/PAT lưu bằng DPAPI/Credential Manager hoặc Electron safeStorage.
- Lưu SQLite cục bộ và mã hóa nội dung; không sao chép file gốc.
- Cấu hình Jira và Confluence tách biệt; MVP bật Jira read/create và Confluence read, mọi write action đều cần xác nhận.
- Tool write luôn cần preview, approval gắn payload hash, operation_id và cơ chế chống double-submit.
- Rollout pilot 10–30 người dùng trước khi mở rộng.

## Phụ lục A – Cấu hình mẫu


> {  "litellm": {    "baseUrl": "https://litellm.internal",    "credentialRef": "secure://litellm/default",    "models": ["model-a", "model-b"],    "defaultModel": "model-a"  },  "atlassian": {    "jira": {      "baseUrl": "https://jira.internal",      "username": "user.name",      "credentialRef": "secure://jira/default",      "enabled": true    },    "confluence": {      "baseUrl": "https://confluence.internal",      "username": "user.name",      "credentialRef": "secure://confluence/default",      "enabled": true    }  },  "maxFileSizeMb": 30,  "maxFilesPerRequest": 5,  "historyRetentionDays": 180,  "logRetentionDays": 14,  "features": {    "jiraRead": true,    "jiraCreate": true,    "confluenceRead": true,    "confluenceWrite": false  }}Lưu ý: credentialRef chỉ là tham chiếu. LiteLLM key và PAT không xuất hiện trong file cấu hình.


## Phụ lục B – Mã lỗi đề xuất


| Code | Ý nghĩa | Retry |
|---|---|---|
| LITELLM_CONFIG_REQUIRED | Chưa cấu hình endpoint hoặc API key LiteLLM | Sau cấu hình |
| LITELLM_AUTH_FAILED | LiteLLM API key không hợp lệ/bị thu hồi | Sau cập nhật key |
| MODEL_NOT_CONFIGURED | Model chưa được thêm vào danh sách cục bộ | Sau cấu hình |
| LLM_TIMEOUT | Model phản hồi quá thời gian | Có |
| FILE_TOO_LARGE | File vượt giới hạn | Không |
| FILE_UNSUPPORTED | Loại file không hỗ trợ | Không |
| ATLASSIAN_CONFIG_REQUIRED | Chưa cấu hình Jira/Confluence tương ứng | Sau cấu hình |
| ATLASSIAN_AUTH_FAILED | Username/PAT không hợp lệ hoặc thiếu quyền | Sau cập nhật credential |
| TOOL_APPROVAL_REQUIRED | Cần xác nhận trước khi gọi tool write | Sau xác nhận |
| TOOL_EXECUTION_UNCERTAIN | Không rõ write đã hoàn tất | Tra cứu trạng thái |
| LOCAL_DB_LOCKED | Không mở được DB local | Có thể |
| MCP_SERVER_UNAVAILABLE | MCP Atlassian không khởi động/kết nối được | Có sau sửa cấu hình |


## Phụ lục C – Checklist trước pilot

☐ Đã chốt LiteLLM base URL, cách cấp/thu hồi key và quy ước model id.

☐ Đã cấp certificate/ký số bộ cài.

☐ Đã kiểm thử thêm/xóa/chọn model và lỗi khi key/model không hợp lệ.

☐ Đã kiểm thử cấu hình Jira/Confluence URL, username, PAT và MCP tool allowlist.

☐ Đã kiểm thử confirmation, payload hash, operation tracking và chống double-submit.

☐ Đã kiểm tra DB, file config và log không chứa prompt/file/API key/PAT dạng rõ.

☐ Đã có hướng dẫn đối chiếu local request_id/operation_id với log LiteLLM và lịch sử Atlassian.

☐ Đã có hướng dẫn cài đặt, gỡ cài đặt và báo lỗi.

☐ Đã có quy trình thu hồi phiên bản lỗi.

☐ Đã có nhóm pilot, kịch bản UAT và đầu mối hỗ trợ.

Kết luận: MVP dùng desktop tự cấu hình LiteLLM key/model và credential Jira/Confluence. Trước khi bật tool write, phải hoàn thiện secure storage, URL validation, confirmation, operation tracking và xử lý credential bị thu hồi.
