## Why

Tám mô tả tính năng BA được đưa vào không phải tám tính năng. Đọc kỹ thì bảy trong tám đều
là **cùng một việc**: lấy nghiệp vụ ở dạng văn xuôi, biến nó thành một cấu trúc, rồi hoặc chiếu
cấu trúc đó ra một dạng khác (tài liệu theo mẫu, sơ đồ, ma trận, trang mã lỗi), hoặc kiểm tra
cấu trúc đó có thiếu gì không.

Điều này quan trọng vì nó chỉ ra **vì sao các công cụ AI hiện tại của BA không có value**. Khi
tài liệu chỉ tồn tại dưới dạng văn xuôi, mọi thứ model làm với nó đều là ý kiến: "review" ra
nhận xét chung chung, "viết lại" ra một bản miên man khác, "tổng hợp mã lỗi" bỏ sót mà không ai
biết là đã bỏ sót. Không có gì để đối chiếu nên không có gì để bảo đảm.

Change này dựng **mô hình tài liệu có cấu trúc làm nguồn sự thật**, đặt cạnh một **kho tri thức
nghiệp vụ đã được người dùng xác nhận**. Sau đó:

- Việc viết = chiếu cấu trúc ra văn bản theo template.
- Việc vẽ = chiếu cấu trúc ra Mermaid.
- Việc review = chạy một bộ luật **xác định** trên cấu trúc, không hỏi ý kiến model.
- Việc tổng hợp mã lỗi = một phép gom trên cấu trúc, đếm được, không bỏ sót được.

Model chỉ làm hai việc nó thật sự giỏi: **trích xuất** văn xuôi thành cấu trúc, và **diễn đạt**
cấu trúc thành văn xuôi. Phán quyết "tài liệu đã đủ case chưa" do code trả lời, kèm danh sách
luật đã kiểm — nên nó lặp lại được, test được và cãi được.

## What Changes

### Chọn lọc — tám mô tả ban đầu được xử lý thế nào

| # | Mô tả gốc | Quyết định | Vì sao |
| --- | --- | --- | --- |
| 1 | Research domain, thống kê thông tin đã confirm, hỏi lại và áp dụng | **Nhận — Giai đoạn 1** | Là nền của mọi thứ còn lại. R-KB-01 (review đối chiếu tri thức đã confirm) không tồn tại nếu thiếu nó |
| 8 | Tổng hợp mã lỗi trong US ra một trang | **Nhận — Giai đoạn 1** | Rẻ nhất, giá trị thấy ngay, và nó ép đường trích xuất tài liệu phải tồn tại trước |
| 6 | Chia use case và rule ngắn gọn, hết trùng lặp | **Nhận — Giai đoạn 1+2** | Không giải bằng prompt. Giải bằng schema: UC là record có ô cố định, rule là một mệnh đề nguyên tử ≤200 ký tự có id. Miên man trở thành không hợp lệ |
| 2 | Viết tài liệu theo template mẫu | **Nhận — Giai đoạn 2** | Template là **hợp đồng outline kiểm tra được**, không phải một đoạn prompt |
| 4 | Vẽ mô hình, flow | **Nhận, thu hẹp — Giai đoạn 2** | Chiếu ra Mermaid/PlantUML dạng text. Không dựng canvas vẽ, không thêm dependency UI |
| 5 | Map bước trong flow với use case | **Nhận — Giai đoạn 2** | Gần như miễn phí khi flow và UC đã có cấu trúc. Và nó trở thành luật review R-FLOW-01 |
| 7 | AI review tài liệu "thật sự có value" | **Nhận, làm lại cách tiếp cận — Giai đoạn 3** | Không gắn link rồi hỏi model. Bộ luật xác định + rule pack có version + báo cáo nêu rõ đã kiểm N luật, đạt M. Xem D2 |
| 3 | Đọc ảnh, validate các trường theo ảnh | **Tách đôi** | Nửa có giá trị (“trường nào cần validate, common validate là gì”) là một **rulebook trong KB**, không cần vision → Giai đoạn 2. Nửa vision (ảnh → danh sách trường) → **Giai đoạn 3, hoãn**: cần hợp đồng consent/transport cho ảnh mà DESIGN.md đang đóng, và đụng F1 |

### Thay đổi kỹ thuật

- Thêm package `packages/ba-kit`: **thuần logic, không Electron, không LLM, không DB**. Chứa toàn
  bộ Zod schema của mô hình tài liệu, bộ chuẩn hoá UC/rule, bộ dò trùng lặp, các phép chiếu
  (Markdown theo template, Mermaid, ma trận truy vết, trang mã lỗi) và bộ luật review. Đây là
  bức tường ngăn BA lan ra phần còn lại của Nexa.
- Thêm migration v9 với bảng tiền tố `ba_`: `ba_knowledge`, `ba_knowledge_links`, `ba_documents`,
  `ba_doc_items`, `ba_doc_links`, `ba_reviews`. Mọi nội dung nghiệp vụ đều mã hoá như
  `memory_facts`/`commitments`. Không có `ba_projects` — tri thức gắn thẳng vào profile (D11).
- Bộ template chuẩn **ship sẵn** trong `apps/desktop/resources/ba-templates.json`, IT ghi đè được
  lúc phân phối như `policy.json`. Không có bảng `ba_templates`, không có editor template (D12).
- Thêm namespace IPC `ba:*` và một nhóm setting duy nhất `ba` trong `AppSettings`, có công tắc
  tổng `baWorkbenchEnabled` (mặc định **tắt**) và ghi đè được bằng `forcedFeatures` trong
  `policy.json` để IT khoá toàn tổ chức.
- Thêm registry tool cục bộ `createBaToolRegistry()` trong main, tên tiền tố `nexa_ba_`, nằm
  ngoài preset Atlassian, chỉ nối vào specs khi chế độ BA bật — giữ nguyên tập prefix hữu hạn
  của ADR 0009 (2 trạng thái × 6 preset).
- Thêm đích điều hướng **Nghiệp vụ** trong renderer với các tab Tri thức / Mẫu / Tài liệu / Review.
- Tái dùng nguyên vẹn: Confirmation Guard cho mọi write, `ActivityRepository` cho audit,
  `document-processor` cho ingest TXT/PDF/DOCX, cơ chế mã hoá và profile binding hiện có.

Không có breaking change: migration chỉ thêm bảng, input runtime mới đều optional, và mọi thứ
nằm sau một cờ mặc định tắt.

## Capabilities

### New Capabilities

- `ba-knowledge-base`: tri thức nghiệp vụ có provenance, trạng thái xác nhận, phát hiện mâu thuẫn,
  thống kê sử dụng và một khối context riêng.
- `ba-document-model`: mô hình tài liệu có cấu trúc (field, use case, rule, flow step, error code,
  actor), đường trích xuất từ văn xuôi, và các phép chiếu ra trang mã lỗi / ma trận truy vết.
- `ba-authoring`: template kiểm tra được, sinh tài liệu theo template, chuẩn hoá UC/rule, rulebook
  common validate và chiếu flow ra Mermaid.
- `ba-review`: bộ luật review xác định có version, báo cáo nêu rõ phạm vi đã kiểm, và đối chiếu
  tài liệu với tri thức đã xác nhận.

### Modified Capabilities

Không capability nào bị đổi contract. `tool-scoping` giữ nguyên hợp đồng; tool BA đi cùng đường
tool cục bộ mà `chat-commitment-capture` đã mở.

## Impact

- **Code:** package mới `packages/ba-kit`; `packages/local-store` (migration + 4 repository);
  `packages/shared-types` (domain, channels, ipc, settings); `packages/agent-runtime`
  (một khối context mới, có budget riêng); Electron main (IPC, job trích xuất, registry tool BA);
  renderer (đích Nghiệp vụ).
- **Dữ liệu:** 6 bảng SQLite mới, mọi cột nội dung mã hoá với encryption context bất biến
  `ba_<bảng>.<cột>`. Không có cột plaintext nào chứa nội dung nghiệp vụ — join và dò trùng chạy
  trên object đã giải mã trong main, theo đúng cách `search.ts` (A9) đang làm.
- **Privacy:** tri thức và tài liệu BA mặc định `internal_only` và **không bao giờ** đi tới provider
  ngoài tổ chức trong change này. Không có ngoại lệ per-item như memory — BA là tài sản của tổ chức,
  không phải preference cá nhân.
- **Operations:** log chỉ ghi id, loại và số lượng; không ghi tiêu đề tri thức, nội dung tài liệu
  hay finding.
- **Dependencies:** không thêm vector DB, embedding model, thư viện vẽ hay OCR. Dò trùng dùng
  Jaccard trên token đã chuẩn hoá — xác định và test được bằng unit test thuần.
- **Hoãn có chủ ý:** vision (ảnh → trường), xuất tài liệu thẳng lên Confluence, đồng bộ tri thức
  giữa nhiều người dùng. Mỗi cái đều cần một quyết định riêng, ghi trong `## Open questions`.
