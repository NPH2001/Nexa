# Giai đoạn 1 — Nền

Kết quả người dùng thấy được khi xong G1: *đưa một US vào, nhận lại một trang mã lỗi đếm được;
ghi và tra được tri thức nghiệp vụ đã xác nhận.*

## 1. `packages/ba-kit` — logic thuần

- [x] 1.1 Dựng package mới, `dependencies` chỉ có `zod` và `@nexa/shared-types`.
- [x] 1.2 Zod schema cho item: `field`, `use_case`, `rule`, `flow_step`, `error_code`, `actor`, kèm mọi giới hạn độ dài của `ba-authoring`.
- [x] 1.3 Bộ chuẩn hoá text tiếng Việt: bỏ dấu, hạ chữ, bỏ stopword, sinh token-set.
- [x] 1.4 Dò trùng: băm cho trùng khít, Jaccard token-set với ngưỡng hằng số cho gần-trùng.
- [x] 1.5 Projection trang mã lỗi: gom, phát hiện mã thiếu khai báo, mã thừa, mã có hai thông điệp.
- [x] 1.6 Bộ hợp nhất kết quả nhiều chunk thành một mô hình tài liệu.
- [x] 1.7 Test ranh giới dependency — khẳng định `ba-kit` không import Electron, `llm-client`, `local-store`.
- [x] 1.8 Unit test cho 1.2–1.6 chạy không cần model, không cần DB.

## 2. Local-store — schema và repository

- [x] 2.1 Migration v9: `ba_knowledge`, `ba_knowledge_links`, `ba_documents`, `ba_doc_items`, `ba_doc_links`, `ba_reviews`; cascade theo `profile_id`; `down` xoá trọn. **Không** có `ba_projects` và `ba_templates` (D11, D12).
- [x] 2.2 Encryption context bất biến `ba_<bảng>.<cột>` cho mọi cột nội dung; không cột plaintext nào chứa nội dung nghiệp vụ.
- [x] 2.3 `BaKnowledgeRepository`: CRUD, `category`, chuyển trạng thái, `superseded_by`, link mâu thuẫn, tăng `use_count`, truy vấn thống kê theo `category`.
- [x] 2.4 `BaDocumentRepository`: CRUD tài liệu và item, lưu hash nội dung nguồn, `template_id` + `template_version`, đọc trọn mô hình để giải mã trong main.
- [x] 2.5 Test: migration lên/xuống, round-trip mã hoá, cascade purge profile, và khẳng định không đọc được nội dung bằng truy vấn SQLite thường.

## 3. Shared types, IPC và setting

- [x] 3.1 Kiểu domain `BaKnowledgeItem`, `BaDocument`, `BaDocItem` và vocabulary trạng thái.
- [x] 3.2 Namespace kênh `ba:*` cho knowledge, document, extract và errorCodes.
- [x] 3.3 Zod schema IPC; renderer không gửi `profileId`; typecheck channels ↔ schemas.
- [x] 3.4 Cờ `features.baWorkbench` mặc định tắt; khoá được bằng `forcedFeatures` trong `policy.json`. *(Đặt trong `features` thay vì một nhóm `ba` riêng ở `AppSettings`: `forcedFeatures` chỉ ghi đè được `features`, nên đây là đường có sẵn để IT khoá toàn tổ chức — cùng cách `toolScoping` làm.)*

## 4. Main process — job trích xuất

- [x] 4.1 `BaExtractionJob` dùng `llm-client` với output ràng buộc Zod; từ chối output không khớp, thử lại tối đa hai lần.
- [x] 4.2 Chunk theo heading trong `ba-kit` (`splitSections`); `document-processor` lo phần PDF/DOCX → text; hợp nhất bằng `ba-kit`. *(Bộ chunk của `document-processor` cắt theo token và CHỒNG LẤN giữa hai chunk — đúng cho việc nhồi context, sai cho trích xuất vì nó sinh trùng lặp nhân tạo.)*
- [x] 4.3 Đánh dấu `needs_review` cho item không xác định được; không điền giá trị mặc định.
- [x] 4.4 Cache theo hash nội dung nguồn; không gọi model khi nội dung không đổi.
- [x] 4.5 Handler IPC bind cứng profile; kiểm ownership trước mọi mutation.
- [x] 4.6 Log chỉ id, loại và số lượng; test khẳng định không log nội dung.

## 5. Renderer — đích Nghiệp vụ

- [x] 5.1 Thêm đích **Nghiệp vụ** vào Sidebar, ẩn khi `baWorkbenchEnabled` tắt.
- [x] 5.2 Tab **Tri thức**: danh sách theo `category`, tạo/sửa, chuyển trạng thái, đánh dấu mâu thuẫn, tổng quan thống kê.
- [x] 5.3 Tab **Tài liệu**: nhập nguồn, chạy trích xuất, xem item theo nhóm, nhóm `needs_review` tách riêng.
- [x] 5.4 Trang mã lỗi với ba nhóm: đã khai báo, thiếu khai báo, bất nhất.
- [x] 5.5 Trạng thái loading/empty/error/disabled cho mọi bề mặt; disabled nêu rõ cờ nào đang tắt.
- [x] 5.6 Test renderer cho helper thuần và E2E cho luồng nhập tài liệu → trang mã lỗi.

## 6. Agent runtime — khối context tri thức

- [x] 6.1 Mở rộng `BuildContextInput` bằng item tri thức `confirmed`.
- [x] 6.2 Khối riêng tách khỏi memory và commitment, tối đa 30 item của profile sắp theo `updated_at DESC`, budget 10%, đóng khung là dữ liệu tham chiếu.
- [x] 6.3 Bỏ khối trước lượt hiện tại khi hết budget.
- [x] 6.4 Loại toàn bộ khối khi provider ngoài tổ chức, lọc lại ngay trước lời gọi model.
- [x] 6.5 Test cap, budget, thứ tự và lọc provider.

## 7. Tool BA — hai tool đầu

- [x] 7.1 `createBaToolRegistry()` trong main, tên tiền tố `nexa_ba_`, ngoài preset Atlassian.
- [x] 7.2 `nexa_ba_tra_cuu_tri_thuc` (READ), tăng `use_count` và ghi `last_used_at`.
- [x] 7.3 `nexa_ba_tong_hop_ma_loi` (READ).
- [x] 7.4 Nối registry vào `chat-controller` chỉ khi `baWorkbenchEnabled` bật; test khẳng định tắt thì `localTools` không chứa tool BA.
- [x] 7.5 Test khẳng định tập prefix `tools` khả dĩ vẫn hữu hạn: 6 preset × 2 trạng thái BA.

# Giai đoạn 2 — Soạn thảo

Kết quả: *đưa nghiệp vụ vào, ra tài liệu đúng format, kèm sơ đồ và ma trận khớp nhau.*

## 8. Bộ template chuẩn (chỉ đọc)

- [x] 8.1 Schema template trong `ba-kit`: danh sách mục có thứ tự, bắt buộc/tuỳ chọn, kiểu item được phép, `id` và `version`.
- [x] 8.2 `apps/desktop/resources/ba-templates.json` với bộ chuẩn ban đầu; IT ghi đè lúc phân phối như `policy.json`.
- [x] 8.3 Nạp và kiểm bằng Zod lúc khởi động; template hỏng bị loại kèm log id + lý do, app vẫn khởi động.
- [x] 8.4 IPC `ba:template:list` chỉ đọc — không có create/update/delete.
- [x] 8.5 Tab **Mẫu** chỉ để xem và chọn; không có editor.
- [x] 8.6 Ghi `template_id` + `template_version` lên tài liệu; báo khi tài liệu theo phiên bản cũ hơn bản hiện có.

## 9. Sinh tài liệu và chuẩn hoá

- [x] 9.1 Projection Markdown theo template; đánh dấu mục bắt buộc còn trống.
- [x] 9.2 Bộ chuẩn hoá use case: áp giới hạn, từ chối item vượt giới hạn kèm lý do cụ thể.
- [x] 9.3 Bộ chuẩn hoá rule: tách mệnh đề ghép, bắt buộc liên kết tới UC hoặc field.
- [x] 9.4 Giao diện gộp item gần-trùng — hệ thống đề xuất, người dùng quyết định.
- [x] 9.5 Tool `nexa_ba_soan_theo_mau` (WRITE) qua preview và approval.

## 10. Rulebook validate và sơ đồ

- [x] 10.1 Schema rulebook: `field_type` → tập validate chuẩn, ship trong `apps/desktop/resources/ba-rulebook.json`. *(Không lưu trong KB như thiết kế ban đầu: rulebook là CHUẨN CỦA TỔ CHỨC, cùng loại với template — nên nó đi cùng đường D12 để IT ghi đè lúc phân phối. Để mỗi máy tự sửa được chuẩn validate thì nó thôi là chuẩn. KB vẫn dành cho tri thức dạng văn xuôi.)*
- [x] 10.2 Áp rulebook lên field; đánh dấu `no_validation` kèm lý do.
- [x] 10.3 Projection Mermaid từ `flow_step` và liên kết; nút sao chép mã.
- [x] 10.4 Projection ma trận truy vết flow ↔ use case, chỉ ô trống ở cả hai chiều.
- [x] 10.5 Tool `nexa_ba_trich_xuat_tai_lieu` (WRITE) dùng đúng hàm của `ba-kit`.

# Giai đoạn 3 — Kiểm tra và ảnh

Kết quả: *review nói rõ đã kiểm gì, thiếu ở đâu, sửa thế nào.*

## 11. Bộ luật review

- [x] 11.1 Registry luật trong `ba-kit`: mỗi luật có id, mô tả, mức mặc định, hàm thuần. *(Chữ ký là `(RuleInput) => Finding[]` thay vì `(doc, kb) => Finding[]` như D2 ghi: `R-FLD-02` cần rulebook và `R-TPL-01` cần mẫu — cả hai là CHUẨN CỦA TỔ CHỨC, không phải tài liệu cũng không phải tri thức, nên nhét vào `kb` sẽ làm hỏng nghĩa của `kb`. Vẫn thuần và vẫn xác định: một object dữ liệu vào, một mảng finding ra.)*
- [x] 11.2 Cài 15 luật của rule pack v1 (`R-FLOW-*`, `R-UC-*`, `R-FLD-*`, `R-ERR-*`, `R-RULE-*`, `R-TPL-01`, `R-KB-01`), mỗi luật một test. *(`R-UC-01`, `R-UC-04`, `R-UC-05` phải đổi cách kiểm so với bảng D2: Zod đã bắt buộc actor/precondition/postcondition/role khác rỗng và `dataEffects` có ít nhất một phần tử, nên "thiếu ô" là chuyện không xảy ra được ở tầng mô hình. Ba luật này vì thế kiểm đúng phần schema KHÔNG kiểm được — ô điền bằng chữ giữ chỗ ("TBD", "chưa xác định") và khai báo tự mâu thuẫn (`['none','create']`). Kiểm lại điều schema đã bảo đảm thì luật luôn đạt, và một luật luôn đạt là đúng thứ tạo cảm giác an toàn giả mà ADR 0010 nêu là rủi ro chính.)*
- [x] 11.3 Bộ chạy review: loại item `needs_review` khỏi căn cứ và báo số bị loại. *(Thêm khái niệm luật **bị bỏ qua**: thiếu mẫu/rulebook/tri thức thì luật không chạy và báo cáo nói rõ, thay vì trả rỗng rồi bị đếm là "đã đạt". `rulesRun + skipped = rulesTotal`.)*
- [x] 11.4 `BaReviewRepository`; lưu id và phiên bản rule pack cùng mỗi báo cáo. *(`findings_ciphertext` giữ trọn `{findings, skippedRules, knowledgeConsidered}` chứ không chỉ mảng finding: danh sách luật bị bỏ qua phụ thuộc vào việc lúc chạy có mẫu/rulebook hay không nên KHÔNG suy lại được từ pack — không lưu thì báo cáo mở lại sau này sẽ tự nhận là đã kiểm nhiều hơn thực tế.)*
- [x] 11.5 Test tính lặp lại: cùng tài liệu + cùng phiên bản ⇒ cùng tập finding. *(Test bắt được một lỗ hổng thật: `analyzeSimilarity` xếp `a`/`b` theo thứ tự mảng đầu vào, nên đảo thứ tự item làm đổi câu chữ của finding `R-RULE-01`. Đã chuẩn hoá chiều của cặp theo id trong luật.)*

## 12. Báo cáo và áp dụng

- [x] 12.1 Giao diện báo cáo: rule pack, số luật đã chạy, số đạt, finding theo mức; không dùng chữ "đầy đủ" cho toàn tài liệu. *(Thêm hai thứ ngoài yêu cầu vì thiếu chúng thì con số "đạt" nói dối: bảng **đã kiểm luật nào** kèm kết quả từng luật, và cảnh báo khi báo cáo trước chạy bằng phiên bản pack khác — spec `ba-review` đòi giao diện nêu rõ hai báo cáo khác phiên bản.)*
- [x] 12.2 Bước gợi ý câu chữ bằng model, chỉ nhận phần gợi ý; test khẳng định model không thêm/xoá/hạ mức finding. *(Renderer gửi CON TRỎ tới finding (`ruleId` + `itemId`), không gửi nội dung: main tra lại trong báo cáo đã lưu và từ chối nếu tra hụt — nếu không, renderer bịa được một finding để mớm cho model. Prompt chỉ mang `summarizeItem` hai dòng, không mang payload đầy đủ.)*
- [x] 12.3 Áp dụng từng finding là thao tác riêng của người dùng; ghi một dòng activity mỗi lần. *(Cần thêm `ba_document` vào `ACTIVITY_SUBJECT_TYPES` và `ba_document_mutation` vào `ACTIVITY_TYPES`; `local_audit` không có CHECK constraint trên hai cột này nên không phải migration. Ô sửa được là một allowlist theo kiểu item trong `ba-kit`, KHÔNG để Zod tự lọc: Zod bỏ im lặng khoá lạ nên `{...useCase, message}` sẽ parse thành công và không đổi gì — người dùng bấm áp dụng, thấy báo thành công, và không có gì thay đổi.)*
- [x] 12.4 Tool `nexa_ba_kiem_tra_tai_lieu` (READ). *(Danh mục tool BA thành năm; test "6 preset × 2 trạng thái BA" của 7.5 vẫn đúng vì danh mục vẫn chỉ phụ thuộc cờ.)*
- [x] 12.5 Test log/diagnostics không chứa nội dung finding. *(Bốn tầng: repository, dịch vụ review, tool, và gói chẩn đoán — tầng cuối là đường duy nhất log rời khỏi máy nên nó là chỗ đáng khẳng định nhất.)*

## 13. Vision — chỉ sau khi có quyết định riêng

- [ ] 13.1 Chốt hợp đồng consent và transport cho ảnh nội bộ với Security owner (Open question D7); không bắt đầu 13.2 trước khi có kết luận. **ĐANG CHẶN 13.2–13.4 — chưa có kết luận của ATTT tính tới 2026-08-30.** *(Dự thảo hợp đồng đã soạn xong và sẵn sàng để duyệt: `docs/security/ba-vision-consent-contract.md` — bảy điều khoản duyệt/bác riêng lẻ, bốn câu hỏi cần ATTT trả lời dứt khoát, tiêu chí nghiệm thu cho 13.2–13.4, và phương án nếu bị bác toàn bộ. Cũng có trong `docs/OPEN-QUESTIONS.md` mục I1. Phần còn thiếu của task này là CHỮ KÝ, không phải tài liệu.)* Mở vision đụng thẳng F1 (`DESIGN.md`: file và image attachment còn tắt cho `chatgpt` cho tới khi có hợp đồng consent và media transport đã được duyệt). Không bắt đầu 13.2 khi chưa có quyết định bằng văn bản.
- [ ] 13.2 Ảnh → danh sách field, phạm vi đúng thế; validate vẫn do rulebook sinh.
- [ ] 13.3 Field lấy từ ảnh mặc định `needs_review`.
- [ ] 13.4 Test khẳng định ảnh không đi tới provider ngoài tổ chức.

# Xuyên suốt

- [x] 14.1 Cập nhật `DESIGN.md`: đích Nghiệp vụ, hợp đồng tri thức BA, ranh giới BA ↔ memory. *(G3 bổ sung ba hợp đồng nữa: **BA review contract** (phán quyết do luật thuần trả, luật chưa chạy được báo là chưa kiểm chứ không phải đã đạt, không bao giờ nói tài liệu "complete"), **BA review assist contract** (model dùng ở đúng một chỗ và không ra phán quyết; áp dụng là thao tác riêng từng finding, không có bulk apply), và **BA review log contract**.)*
- [x] 14.2 Cập nhật `README.md`: cờ `baWorkbenchEnabled` và cách IT khoá bằng `policy.json`. *(G3 sửa lại "hai tool chỉ đọc" thành ba và mô tả bộ kiểm tra tài liệu.)*
- [x] 14.3 ADR 0010 — "cấu trúc là nguồn sự thật, phán quyết review do code trả" (D1 + D2).
- [x] 14.4 `pnpm verify` sạch sau mỗi giai đoạn; E2E cho luồng chính của giai đoạn đó.
