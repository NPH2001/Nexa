# ADR 0010 — Cấu trúc là nguồn sự thật cho tài liệu BA, và phán quyết review do code trả

- Trạng thái: **Đã chốt** (2026-08-30)
- Bối cảnh: openspec `add-ba-workbench`, quyết định D1 và D2
- Thay thế: không

## Bối cảnh

Yêu cầu ban đầu cho tính năng Business Analyst gồm tám mô tả: research nghiệp vụ, viết tài liệu
theo mẫu, đọc ảnh để suy ra validate, vẽ flow, map flow với use case, chia use case/rule cho gọn,
AI review tài liệu, và tổng hợp mã lỗi.

Đọc kỹ thì bảy trong tám đều là **cùng một việc**: lấy nghiệp vụ ở dạng văn xuôi, biến nó thành
một cấu trúc, rồi hoặc chiếu cấu trúc đó ra dạng khác, hoặc kiểm tra cấu trúc đó thiếu gì.

Người đặt yêu cầu cũng nêu thẳng vấn đề với các công cụ AI review hiện có: *"gắn cái link nào và
bảo nó đưa ra nhận xét thì nó hơi khách quan… làm sao để chắc chắn rằng sau review thì tài liệu
của mình đã đầy đủ hết tất cả các case"*. Đây không phải lời than về chất lượng model. Nó là hệ
quả trực tiếp của việc **tài liệu chỉ tồn tại dưới dạng văn xuôi**.

## Vấn đề

Khi văn xuôi là nguồn sự thật, mọi câu hỏi có ích đều trở thành câu hỏi cho model:

| Câu hỏi | Với văn xuôi | Hệ quả |
| --- | --- | --- |
| "Có bao nhiêu mã lỗi?" | Model đếm | Có thể sai, và không ai biết là đã sai |
| "Tài liệu đã đủ case chưa?" | Model đoán | Ý kiến, không lặp lại được |
| "Rule nào trùng nhau?" | Model so sánh | Phụ thuộc lượt chạy |
| "Bước flow nào chưa có use case?" | Model dò | Bỏ sót âm thầm |

Không có gì để đối chiếu nên không có gì để bảo đảm. Chạy lại hai lần ra hai kết quả, và không có
cách nào phân biệt "tài liệu tốt" với "model hôm nay trả lời dễ tính".

## Quyết định

### D1 — Cấu trúc là nguồn sự thật, văn xuôi là phép chiếu

Tài liệu BA được lưu thành danh sách item có kiểu (`field`, `use_case`, `rule`, `flow_step`,
`error_code`, `actor`), mỗi item khớp một Zod schema trong `packages/ba-kit`. Văn bản người dùng
đọc **được sinh ra từ** danh sách đó.

Bốn câu hỏi ở trên khi đó thành: một phép `filter().length`, một bộ luật, một phép Jaccard, một
phép `Set.difference`. Đếm chính xác, thiếu thì chỉ ra được thiếu ở đâu.

Model chỉ làm hai việc nó thật sự giỏi: **trích xuất** văn xuôi thành cấu trúc, và **diễn đạt**
cấu trúc thành văn xuôi. Nó không giữ sự thật.

### D2 — Phán quyết review do code trả, model chỉ trích xuất và gợi ý

Review chạy một **rule pack có version** trên mô hình tài liệu. Mỗi luật là một hàm thuần
`(doc, confirmedKnowledge) => Finding[]`. Báo cáo nêu rule pack nào, phiên bản nào, đã kiểm bao
nhiêu luật, đạt bao nhiêu; mỗi finding có rule id, vị trí item và cách sửa.

Model được dùng ở đúng hai chỗ, cả hai đều không ra phán quyết: trích xuất tài liệu thành cấu
trúc, và đề xuất câu chữ sửa cho một finding **đã do code sinh ra**. Model không thêm, không xoá,
không hạ mức finding.

## Hệ quả

**Được:**

- Cùng tài liệu + cùng phiên bản rule pack ⇒ cùng tập finding, chạy lại bao nhiêu lần cũng thế.
- Bộ luật test được bằng unit test thuần, không cần model, không cần mạng.
- Báo cáo nói được **đã kiểm cái gì**, nên người đọc biết phần nào chưa được kiểm.
- Sơ đồ, ma trận truy vết, trang mã lỗi và bản Markdown theo mẫu đều là phép chiếu trên cùng một
  mô hình, nên chúng không thể lệch nhau.
- Đối chiếu tài liệu với **tri thức tổ chức đã xác nhận** (`R-KB-01`) trở thành khả thi — đây là
  luật khiến review đáng làm, và nó không tồn tại được nếu thiếu một kho tri thức có trạng thái.

**Mất:**

- Có thêm một bước trích xuất, và bước đó có thể sai. Giảm bằng: Zod chặn output không khớp, item
  không chắc mang cờ `needs_review` và hiển thị tách riêng, người dùng sửa trực tiếp được. Chấp
  nhận rằng lần trích xuất đầu cần người soát — nhưng soát một danh sách có cấu trúc nhanh hơn
  soát văn xuôi rất nhiều.
- Bộ luật có thể tạo cảm giác an toàn giả. Giảm bằng: UI luôn ghi rõ đã kiểm **cái gì**, và
  **không bao giờ** dùng chữ "đầy đủ" cho toàn tài liệu. Bộ luật kiểm tính đầy đủ về cấu trúc và
  về đối chiếu KB; nó không biết một yêu cầu nghiệp vụ chưa ai nghĩ tới.
- Trích xuất tốn token. Giảm bằng cache theo hash nội dung nguồn và chỉ chạy khi người dùng bấm.

## Phương án đã cân nhắc và loại

**Giữ văn xuôi, prompt kỹ hơn.** Rẻ nhất, và là thứ mọi công cụ hiện có đang làm. Loại vì nó
không giải được vấn đề gốc: câu trả lời vẫn là ý kiến, vẫn không lặp lại được, và "đã đủ case
chưa" vẫn không có căn cứ.

**Dùng model làm trọng tài, cho nó tự chấm điểm.** Loại vì điểm số không lặp lại được và không
truy được về một luật cụ thể. Một tài liệu 8/10 không nói cho BA biết phải sửa dòng nào.

**Dùng embedding để dò trùng và truy hồi.** Loại vì nó phá tính xác định — điều kiện tiên quyết
của cả ADR này — và thêm một dependency nặng vào một app local-first. Dò trùng dùng chuẩn hoá
tiếng Việt + Jaccard trên token-set, có ngưỡng đo được, test được.

## Ràng buộc kèm theo

- `packages/ba-kit` không import Electron, `@nexa/local-store`, `@nexa/llm-client` hay node
  builtin. Có test ranh giới runtime và một luật ESLint. Hàm nào cần model, DB hay main process
  thì không thuộc về đó.
- Luật review và phép chiếu đều là **registry**: thêm một luật hay một định dạng xuất mới là thêm
  một file cộng một dòng đăng ký, không mở lại lõi.
- Item `needs_review` không bao giờ được dùng làm căn cứ kết luận, và số item bị loại phải hiển
  thị chứ không được giấu.
