## Context

Nexa hiện có ba kho dữ liệu người dùng, mỗi kho một mục đích rõ ràng:

| Kho | Nội dung | Ai ghi | Ghi khi nào |
| --- | --- | --- | --- |
| `memory_facts` (v5) | Sự thật **cá nhân** về người dùng | Người dùng | Xác nhận tường minh trong Settings |
| `commitments` (v6) | **Việc** đang dở | Người dùng, hoặc agent qua Confirmation Guard | Preview + approval |
| `conversations`/`messages` | Lịch sử chat | Hệ thống | Mỗi lượt |

Tri thức nghiệp vụ và tài liệu BA **không thuộc kho nào trong ba kho này**. Nó không phải sự thật
cá nhân (một quy tắc tính phí không mô tả người dùng), không phải việc đang dở, và không được để
sliding window nuốt mất. Nhét nó vào `memory_facts` sẽ phá luôn ba thứ: budget context của memory
(10%, `context-builder.ts:31`), ngữ nghĩa "fact cá nhân, có thể cho phép gửi ra ngoài per-item",
và màn hình Nexa nhớ vốn để người dùng soát lại chuyện của chính mình.

Những ràng buộc phải tôn trọng:

- **Confirmation Guard là cổng duy nhất trước mọi write.** Tool BA ghi dữ liệu người dùng thì đi
  đủ tám bước §7.4 như tool write ngoài (`shared-types/src/tools.ts:183` đã ghi rõ điều này cho
  `LocalToolDefinition`).
- **Khối `tools` là prefix của prompt (ADR 0009).** Tool cục bộ được nối vào specs ở
  `agent-runtime.ts:890`. Thêm tool BA theo kiểu "chọn động theo câu hỏi" sẽ làm nổ tập prefix và
  vô hiệu hoá điều kiện prompt caching mà ADR 0009 vừa bảo toàn.
- **Nội dung nghiệp vụ phải mã hoá tại chỗ** (bất biến §21). Không được tạo cột plaintext để tiện
  join.
- **Renderer không chạm file, không chạm mạng, không chạm secret** (§5.3, §11.3).
- **Không coi output của LLM là dữ liệu tin cậy** (§11.3). Cấu trúc do model trích xuất phải qua
  Zod trước khi được lưu.

## Goals / Non-Goals

**Goals:**

- Một BA đưa vào một US viết sẵn và nhận lại **một trang mã lỗi đầy đủ, đếm được** — không phải một
  danh sách "model nhớ được đến đâu".
- Kết luận "tài liệu đã đủ case chưa" là **xác định**: cùng tài liệu + cùng rule pack ⇒ cùng kết
  quả, chạy lại bao nhiêu lần cũng thế, và test được bằng unit test không cần model.
- Use case và rule **không thể miên man** vì schema không cho phép, chứ không vì prompt xin xỏ.
- Tri thức nghiệp vụ đã xác nhận trở thành thứ để **đối chiếu**, nên nó có ích cả khi người dùng
  không chủ động hỏi tới.
- Toàn bộ tính năng BA nằm gọn trong một package, một namespace IPC, một nhóm setting, một registry
  tool, một đích điều hướng — gỡ bỏ hoặc mở rộng đều không phải đụng phần còn lại của Nexa.

**Non-Goals:**

- Không dựng canvas/trình vẽ sơ đồ. Sơ đồ là phép chiếu ra text.
- Không vector DB, không embedding, không auto-summary bằng LLM phụ.
- Không tự học tri thức từ chat. Mọi item vào KB đều qua xác nhận, giống memory.
- Không tự sửa tài liệu của người dùng. Review ra finding; áp dụng là thao tác riêng.
- Không chấm điểm chủ quan kiểu "tài liệu này 8/10".
- Không đọc ảnh trong giai đoạn 1–2 (xem D7).
- Không đẩy tài liệu lên Confluence tự động trong change này. Khi làm, nó đi qua tool MCP hiện có
  và Confirmation Guard, không phải một đường xuất riêng.

## Decisions

### D1. Cấu trúc là nguồn sự thật, văn xuôi là phép chiếu

Tài liệu BA được lưu dưới dạng `ba_doc_items` — một danh sách item có kiểu (`field`, `use_case`,
`rule`, `flow_step`, `error_code`, `actor`), mỗi item là một object khớp Zod schema trong `ba-kit`.
Văn bản Markdown mà người dùng đọc **được sinh ra từ** danh sách đó, không phải ngược lại.

Vì sao đây là quyết định gốc: khi văn xuôi là nguồn sự thật, mọi câu hỏi có ích đều trở thành câu
hỏi cho model, và câu trả lời là ý kiến. "Có bao nhiêu mã lỗi?" → model đếm, có thể sai. "Đã đủ
case chưa?" → model đoán. Khi cấu trúc là nguồn sự thật, cả hai câu đều là truy vấn trên một
mảng: đếm chính xác, thiếu thì chỉ ra được thiếu ở đâu.

Đánh đổi chấp nhận: có một bước trích xuất, và bước đó có thể sai. Cách xử lý ở D4.

### D2. Phán quyết review do code trả, model chỉ trích xuất và gợi ý

Đây là câu trả lời cho "làm sao chắc chắn tài liệu đã đủ hết case".

Review chạy một **rule pack có version** trên mô hình tài liệu. Mỗi luật là một hàm thuần
`(doc: BaDocModel, kb: ConfirmedKnowledge[]) => Finding[]`. Báo cáo nêu rõ: rule pack nào, phiên
bản nào, đã kiểm bao nhiêu luật, đạt bao nhiêu, mỗi finding kèm **rule id + vị trí item + cách
sửa**. Không có finding nào không có rule id.

Rule pack v1 (giai đoạn 3):

| Rule id | Kiểm |
| --- | --- |
| `R-FLOW-01` | Mọi flow step map tới ≥1 use case |
| `R-FLOW-02` | Mọi use case được ≥1 flow step chạm tới, hoặc đánh dấu `standalone` |
| `R-UC-01` | Mỗi UC có actor, precondition, main flow, postcondition |
| `R-UC-02` | Mỗi UC có ≥1 luồng thay thế, hoặc ghi rõ `no_alternate` kèm lý do |
| `R-UC-03` | Mỗi UC có ≥1 luồng ngoại lệ |
| `R-UC-04` | Mỗi UC nêu role/quyền được thực hiện |
| `R-UC-05` | Mỗi UC ghi tác động dữ liệu (tạo/sửa/xoá/không) |
| `R-FLD-01` | Mọi field input có rule validate, hoặc `no_validation` kèm lý do |
| `R-FLD-02` | Field có kiểu nhận diện được (email, phone, tiền, ngày, mã định danh) có đủ common validate của rulebook |
| `R-ERR-01` | Mọi mã lỗi nêu trong flow/UC có trong bảng mã lỗi, và ngược lại |
| `R-ERR-02` | Một mã lỗi không mang hai thông điệp khác nhau |
| `R-RULE-01` | Không có rule trùng lặp hoặc mâu thuẫn trực tiếp |
| `R-RULE-02` | Không có rule mồ côi (không gắn UC/field nào) |
| `R-TPL-01` | Không thiếu mục bắt buộc của template đang dùng |
| `R-KB-01` | Không có khẳng định mâu thuẫn với tri thức đã `confirmed` trong KB |

`R-KB-01` là luật khiến review đáng làm. Mười bốn luật còn lại kiểm tính đầy đủ về hình thức —
hữu ích nhưng ai cũng làm được. `R-KB-01` kiểm tài liệu **so với những gì tổ chức đã chốt**, việc
mà không công cụ nào làm được nếu không có kho tri thức đã xác nhận.

Model được dùng ở đúng hai chỗ trong review, cả hai đều không ra phán quyết: trích xuất tài liệu
thành cấu trúc (D4), và với mỗi finding đã do code sinh ra, đề xuất một câu chữ sửa. Model **không**
được thêm, xoá hay hạ mức finding.

Giới hạn phải nói thẳng trong UI: bộ luật kiểm tính đầy đủ **về cấu trúc và về đối chiếu KB**. Nó
không biết một yêu cầu nghiệp vụ chưa ai nghĩ tới. Báo cáo ghi "đã kiểm 15/15 luật", không ghi
"tài liệu đã đầy đủ".

### D3. Rule pack là dữ liệu, không phải if-else rải rác

Mỗi luật là một module đăng ký vào `RULE_PACKS` trong `ba-kit`. Thêm luật cho một domain mới =
thêm một file + một dòng đăng ký + một test, không đụng pipeline. Rule pack có `id` và `version`;
`ba_reviews` lưu lại version đã chạy nên hai báo cáo cách nhau ba tháng vẫn so sánh được.

Cùng mô hình đó dùng cho **projection** (`ba-kit/projections/`): Markdown-theo-template, Mermaid,
ma trận truy vết, trang mã lỗi đều là `(BaDocModel) => string`. Muốn thêm PlantUML hay xuất CSV
sau này thì thêm một projection, không mở lại lõi.

### D4. Trích xuất là job có schema, không phải một lượt chat

Trích xuất chạy trong main process qua `llm-client` với output ràng buộc bởi Zod, giống cách
`document-processor` chạy pipeline. Không phải một lượt tool-calling trong chat.

Ba quy tắc:

1. Output không khớp schema thì **bị từ chối**, không ép kiểu. Thử lại tối đa hai lần với thông
   báo lỗi schema, sau đó báo thất bại cho người dùng.
2. Item mà model không chắc được đánh `needs_review` và hiển thị riêng, không trộn vào phần đã
   chắc. Không đoán thầm.
3. Tài liệu dài được chunk theo cấu trúc heading sẵn có của `document-processor`, mỗi chunk trích
   xuất độc lập rồi hợp nhất bằng dò trùng (D6). Không có "model đọc cả tài liệu trong một lần"
   vì nó vừa vượt budget vừa làm chất lượng tụt ở đuôi.

Chat vẫn có đường vào qua tool `nexa_ba_trich_xuat_tai_lieu`, nhưng nó gọi **cùng một hàm** trong
`ba-kit`. Không có hai đường trích xuất với hai hành vi.

### D5. Chống miên man bằng schema và budget, không bằng prompt

Ask #6 ("viết khá miên man và nhiều ý trùng nhau") là một vấn đề cấu trúc, không phải vấn đề
prompt. Xử lý:

- `use_case`: các ô cố định — id, tên (≤120 ký tự), actor, precondition, main flow (≤12 bước, mỗi
  bước ≤200 ký tự), alternate flows, exception flows, postcondition, role, data effect. Vượt giới
  hạn ⇒ Zod loại, không lưu.
- `rule`: **một mệnh đề nguyên tử**, ≤200 ký tự, có id, gắn với ≥1 UC hoặc field. Một rule chứa
  "và/hoặc" nối hai điều kiện độc lập bị bộ chuẩn hoá tách thành hai.
- Dò trùng: chuẩn hoá tiếng Việt (bỏ dấu, hạ chữ, bỏ stopword), băm để bắt trùng khít, và Jaccard
  trên token-set để gắn cờ gần-trùng cho người dùng quyết định. **Không dùng embedding** — cần xác
  định, cần test được, và cần chạy được không mạng.

**Ngưỡng là 0.7, đo rồi mới chốt.** Bản đầu của tài liệu này ghi 0.8. Chạy thật trên đúng loại cặp
mà ask #6 nhắm tới thì trượt: "Đơn hàng **phải** có ít nhất một sản phẩm" và "Đơn hàng **cần** có ít
nhất một sản phẩm" chỉ đạt 0.78, vì rule nghiệp vụ là câu ngắn nên một từ khác nhau đã kéo Jaccard
xuống gần 0.1. Giữ 0.8 thì đúng thứ cần bắt lại lọt lưới. 0.7 bắt được cặp đó và vẫn cách rất xa
cặp không liên quan (đo được 0.0).

**Hai hàng rào cho phủ định.** Hàng rào thứ nhất: `khong` không nằm trong danh sách từ dừng, nên
"cho phép sửa đơn" và "không cho phép sửa đơn" không bao giờ trùng khít. Hàng rào thứ hai: hai câu
lệch nhau ở token phủ định thì bị xếp vào **`potentialContradictions`**, không phải
`nearDuplicates` — chúng đo được 0.83, tức là không có hàng rào này chúng sẽ nằm ngay đầu danh sách
gợi ý gộp, và một cú bấm nhầm là mất một nửa nghiệp vụ. Đây cũng là đầu vào sẵn có cho `R-RULE-01`
ở G3.

### D6. Tri thức nghiệp vụ tách khỏi memory, có provenance và thống kê

`ba_knowledge` là bảng riêng, không phải một `kind` mới của `memory_facts`. Mỗi item có:

- `category` ∈ `domain | rule | term | constraint | decision`. Đây là trục nhóm duy nhất ở G1 —
  xem D11 về việc không có project.
- `status`: `draft` → `confirmed` → `outdated`. Chỉ item `confirmed` được `R-KB-01` dùng để đối
  chiếu và được đưa vào context. Đây là điều "confirm" trong mô tả gốc thực sự phải mang nghĩa.
- `source_kind` + `source_ref`: hội thoại nào, tài liệu nào, URL nào, hay người dùng tự nhập.
  Không có item nào không có nguồn.
- `superseded_by`: thay thế chứ không xoá. Lịch sử quyết định nghiệp vụ là thứ BA cần tra lại.
- `ba_knowledge_links` với `kind` ∈ `supports | conflicts | supersedes`. Mâu thuẫn là **quan hệ
  được lưu**, không phải thứ tính lại mỗi lần hỏi.
- `use_count`, `last_used_at`: tăng khi item được đưa vào context hoặc được `R-KB-01` dùng.

Phần "thống kê" trong mô tả gốc được đọc là: KB overview trả lời được **bao nhiêu item đã
confirmed / còn draft / đã outdated, theo từng `category`; bao nhiêu cặp đang mâu thuẫn; item nào
chưa được dùng lần nào** (tri thức chết — dấu hiệu research sai hướng hoặc tài liệu không dùng tới),
và item nào được dùng nhiều nhất. Đây là thống kê **về kho tri thức**, không phải thống kê nghiệp
vụ trong tài liệu — cái sau Nexa không có dữ liệu để làm.

Context: một khối riêng, tách khỏi memory và commitment, budget riêng **10%**, tối đa 30 item
`confirmed` của profile hiện tại sắp theo `updated_at DESC`, đóng khung là **dữ liệu tham chiếu chứ
không phải chỉ thị** — giống hệt hợp đồng khối commitment. Bị bỏ trước lượt hiện tại khi hết budget.

Hai đường vào tri thức có chủ đích khác nhau và không nên trộn: **khối context bị động chạy theo độ
mới**, còn **tra cứu chủ động chạy theo liên quan** qua `nexa_ba_tra_cuu_tri_thuc`. Không có xếp
hạng liên quan trong khối bị động vì làm thế cần embedding, và điều đó mâu thuẫn với D5.

`sharing_policy` **không tồn tại** cho tri thức BA: nó luôn `internal_only`, không có ngoại lệ
per-item. Memory là preference cá nhân nên người dùng có quyền quyết định gửi ra ngoài; tri thức
nghiệp vụ là tài sản tổ chức, và một hộp chọn per-item ở đây là một sự cố rò rỉ đang chờ xảy ra.

### D7. Vision hoãn, nửa có giá trị của ask #3 làm ngay mà không cần vision

Mô tả gốc yêu cầu "đọc ảnh, mô tả validate các trường theo hình ảnh và common validate chung, biết
trường nào cần validate trường nào không".

Đọc kỹ thì phần khó và phần có giá trị **không nằm ở ảnh**. Nó nằm ở tri thức "field kiểu này thì
cần những validate nào". Cái đó là một **rulebook**: mỗi `field_type` (email, số điện thoại, số
tiền, ngày, mã định danh, free text, enum, boolean) có một tập common validate đã được tổ chức
chốt. Có rulebook rồi thì `R-FLD-02` chạy được ngay trên field lấy từ **bất kỳ** nguồn nào — văn
xuôi, bảng trong DOCX, hay sau này là ảnh.

**Rulebook ship như resource, không nằm trong KB.** Bản đầu của tài liệu này ghi "một rulebook
trong KB". Khi làm G2 thì rõ ra là nó cùng loại với template: đây là **chuẩn của tổ chức**, không
phải tri thức dạng văn xuôi mà một BA ghi lại. Nên nó đi đúng đường D12 —
`apps/desktop/resources/ba-rulebook.json`, IT ghi đè lúc phân phối. Để mỗi máy tự sửa được chuẩn
validate thì nó thôi là chuẩn. KB vẫn giữ nguyên vai trò cho tri thức nghiệp vụ dạng câu chữ.

Field khai validate đã có bằng **khoá** của rulebook, không bằng câu mô tả: câu chữ thì phải so
khớp mờ mới biết "kiểm tra định dạng email" và "email phải đúng chuẩn" là một, còn khoá thì so
bằng `===`. Đó là điều kiện để câu trả lời "field này còn thiếu validate nào" là xác định.

Ảnh chỉ đóng góp một việc: liệt kê field từ một screenshot form. Việc đó cần một hợp đồng mà Nexa
đang cố ý đóng — DESIGN.md nêu "File và image attachment stay disabled for `chatgpt` selections
until Nexa has a reviewed, explicit external-data consent and media transport contract", và ảnh
màn hình sản phẩm nội bộ đụng thẳng F1. Mở nó là một change riêng với review ATTT riêng, không
phải một dòng trong change này.

Giai đoạn 3 sẽ mở với phạm vi hẹp: **ảnh → danh sách field, chỉ thế**. Validate vẫn do rulebook
sinh. Model không suy luận nghiệp vụ từ ảnh.

### D8. Sơ đồ là phép chiếu ra text, không phải trình vẽ

`flow_step` + `ba_doc_links` đã là một đồ thị. Mermaid là một hàm thuần trên đồ thị đó. Đổi lại:
sơ đồ luôn khớp tài liệu (vì cùng một nguồn), diff được trong Git, và không thêm dependency UI nào
— điều DESIGN.md yêu cầu quyết định tường minh mới được làm.

Giai đoạn 2 xuất ra code block Mermaid kèm nút sao chép. Render inline trong renderer là một quyết
định riêng cần ADR vì nó thêm dependency; không gộp vào đây.

### D9. Chứa BA trong một vòng khép kín

Yêu cầu "quản lý chặt để sau này phát triển thêm nhiều cái khác" được thực hiện bằng sáu ranh giới
cụ thể, không phải bằng quy ước:

| Ranh giới | Hình thức |
| --- | --- |
| Logic | `packages/ba-kit` — không import Electron, không import `llm-client`, không import `local-store`. Test được không cần model, không cần DB |
| Dữ liệu | Mọi bảng tiền tố `ba_`, một migration duy nhất, cascade theo `profile_id` |
| IPC | Namespace `ba:*`, không kênh BA nào nằm ngoài namespace |
| Setting | Một nhóm `ba` trong `AppSettings`, một công tắc tổng `baWorkbenchEnabled` mặc định tắt, khoá được bằng `forcedFeatures` |
| Tool | `createBaToolRegistry()`, tên tiền tố `nexa_ba_`, ngoài preset Atlassian, chỉ nối vào specs khi chế độ BA bật |
| UI | Một đích **Nghiệp vụ**. BA không rò vào Chat/Today/Goals, trừ một link "mở trong Nghiệp vụ" |

Một test khẳng định `ba-kit` không có dependency nào ngoài `zod` và `@nexa/shared-types`. Ranh giới
không có test là ranh giới sẽ bị vượt.

### D10. Tool BA giữ tập prefix hữu hạn của ADR 0009

Sáu tool cục bộ, tất cả nối vào specs **cùng lúc** khi `baWorkbenchEnabled` bật:

| Tool | Risk | Ghi chú |
| --- | --- | --- |
| `nexa_ba_tra_cuu_tri_thuc` | READ | Tìm trong KB; tăng `use_count` |
| `nexa_ba_de_xuat_tri_thuc` | WRITE | Đề xuất item `draft`; preview + approval mới ghi. **Không** đặt được `confirmed` |
| `nexa_ba_trich_xuat_tai_lieu` | WRITE | Văn xuôi → doc items, qua đúng hàm của `ba-kit` |
| `nexa_ba_soan_theo_mau` | WRITE | Sinh bản nháp theo template |
| `nexa_ba_kiem_tra_tai_lieu` | READ | Chạy rule pack, trả finding |
| `nexa_ba_tong_hop_ma_loi` | READ | Trang mã lỗi |

Vì tập tool BA bật/tắt theo một cờ chứ không theo câu hỏi, số prefix `tools` khả dĩ vẫn là một
hằng số nhỏ: 6 preset × 2 trạng thái BA. Đây là ràng buộc quan trọng nhất phải giữ nếu sau này
thêm tool BA — **thêm tool vào tập cố định thì được, chọn tool theo ngữ cảnh thì không**.

Ba giới hạn cố ý, cùng tinh thần với commitment tools: không có tool xoá tri thức hay tài liệu;
agent không đặt được `confirmed` (chỉ người dùng chốt tri thức của tổ chức); agent không hạ mức
hay bỏ qua được finding của review.

### D11. Không có project ở G1 — tri thức gắn thẳng vào profile

Quyết định của product owner. Bỏ `ba_projects` khỏi migration v9; `ba_knowledge` và `ba_documents`
chỉ mang `profile_id`. Trục nhóm duy nhất là `category` của item.

Điều này rẻ để đảo ngược, và nói rõ vì sao: thêm project sau này là `ALTER TABLE ... ADD COLUMN
project_id TEXT` với `NULL` nghĩa là "chưa phân loại", cộng một bảng mới. Không phải viết lại dòng
nào, không phải đổi ngữ nghĩa cột nào — đúng dạng migration mà v8 đã làm với `created_by`.

Cái phải giữ để lời hứa đó còn giá trị: **không được coi việc thiếu project là lý do để nhét scope
vào chỗ khác**. Không thêm tiền tố vào tiêu đề tri thức, không tách profile để giả làm project,
không dùng `category` như một trục scope. Ba cách đó đều tạo dữ liệu phải dọn khi project xuất hiện
thật.

Hệ quả ở G1: khối context lấy tri thức `confirmed` của cả profile (D6), và `R-KB-01` đối chiếu với
toàn bộ tri thức `confirmed` của profile chứ không lọc theo project.

### D12. Template ship sẵn như resource, không phải dữ liệu người dùng

Quyết định của product owner: Nexa ship một bộ template chuẩn, người dùng chọn chứ không dựng.

Hệ quả là bỏ được nhiều hơn một hộp chọn — **bỏ luôn bảng `ba_templates`, repository, IPC
`ba:template:*` và editor template**. Template thành dữ liệu chỉ đọc trong
`apps/desktop/resources/ba-templates.json`, IT ghi đè lúc phân phối đúng như `policy.json` đang làm.
Đây là đường có sẵn cho "chuẩn của tổ chức" và nó đặt quyền định nghĩa chuẩn vào đúng chỗ: IT, chứ
không phải từng máy.

Ràng buộc kèm theo:

- File resource được kiểm bằng Zod lúc khởi động. Template hỏng thì bị loại kèm log, các template
  còn lại vẫn dùng được; không bao giờ làm hỏng khởi động app.
- Mỗi template có `id` và `version`. `ba_documents` lưu `template_id` + `template_version` đã dùng,
  nên khi IT đổi chuẩn thì tài liệu cũ vẫn biết nó được viết theo bản nào.
- Trích cấu trúc template từ một tài liệu mẫu bất kỳ **bị hoãn**, không phải bị bỏ. Khi có nhu cầu
  thật, nó thêm một nguồn template thứ hai bên cạnh resource — thời điểm đó bảng `ba_templates` mới
  có lý do tồn tại.

## Risks / Trade-offs

- **Trích xuất sai thì mọi thứ phía sau sai.** Giảm bằng: Zod chặn, `needs_review` hiển thị riêng,
  và người dùng sửa được item trực tiếp trong UI. Chấp nhận rằng lần trích xuất đầu cần người
  soát — nhưng soát một danh sách có cấu trúc nhanh hơn soát văn xuôi rất nhiều.
- **Bộ luật tạo cảm giác an toàn giả.** "Đã kiểm 15/15 luật" có thể bị đọc thành "tài liệu đúng".
  Giảm bằng: UI luôn ghi rõ đã kiểm **cái gì**, và không bao giờ dùng chữ "đầy đủ" cho toàn tài liệu.
- **Chi phí trích xuất token.** Một US dài chạy nhiều chunk. Giảm bằng: cache theo hash nội dung —
  tài liệu không đổi thì không trích xuất lại; và trích xuất là thao tác người dùng chủ động bấm,
  không chạy nền.
- **Phạm vi lớn.** Bốn capability là nhiều cho một change. Giảm bằng ba giai đoạn có ranh giới rõ,
  mỗi giai đoạn tự nó dùng được: G1 đã cho ra trang mã lỗi và KB tra cứu được.
- **`ba-kit` có thể phình thành một Nexa thứ hai.** Giảm bằng test ranh giới dependency ở D9 và
  quy tắc: hàm nào cần LLM, DB hay Electron thì không thuộc `ba-kit`.

## Migration Plan

Ba giai đoạn, mỗi giai đoạn là một lát cắt dùng được ngay:

**G1 — Nền.** `ba-kit` (schema + trang mã lỗi + dò trùng), migration v9, repository KB + document,
IPC `ba:*`, đích Nghiệp vụ với tab Tri thức và Tài liệu, job trích xuất, tool `tra_cuu_tri_thuc` và
`tong_hop_ma_loi`. Kết quả người dùng thấy: *đưa US vào, ra một trang mã lỗi đếm được; ghi và tra
được tri thức đã confirm.*

**G2 — Soạn thảo.** Nạp bộ template chuẩn từ resource, sinh tài liệu theo template đã chọn, chuẩn
hoá UC/rule, rulebook common validate, projection Mermaid, ma trận truy vết flow↔UC. Kết quả: *đưa
nghiệp vụ vào, ra tài liệu đúng format, kèm sơ đồ và ma trận khớp nhau.*

**Chiều của mỗi loại link là cố định** và được test khẳng định: `next` là flow_step → flow_step,
`covers` là use_case → flow_step, `raises` là use_case|flow_step → error_code, `validates` là
rule → field|use_case. Đọc sai chiều thì ma trận vẫn ra bảng, chỉ là bảng nói ngược — đúng loại lỗi
im lặng mà cả change này được viết ra để tránh.

**G3 — Kiểm tra và ảnh.** Rule pack v1 đầy đủ, báo cáo review, `R-KB-01`, và — sau một quyết định
riêng về consent/transport — trích field từ ảnh. Kết quả: *review nói rõ đã kiểm gì, thiếu ở đâu,
sửa thế nào.*

Rollback: tắt `baWorkbenchEnabled` là mất đường vào; migration v9 có `down` xoá trọn các bảng `ba_`.
Không bảng nào hiện có bị sửa cột.

## Open Questions

- [x] ~~Product owner: `ba_projects` có cần thiết ở G1 không?~~ **Không.** Tri thức gắn thẳng vào
      profile; xem D11 và đường thêm project về sau.
- [x] ~~Product owner: template do người dùng dựng hay Nexa ship sẵn bộ chuẩn?~~ **Ship sẵn.** Bộ
      chuẩn nằm trong resource, IT ghi đè lúc phân phối; xem D12.
- [ ] Security owner: cho phép người dùng nhập tri thức nghiệp vụ và tài liệu từ file ngoài
      workspace không, hay chỉ qua `FileBroker` như hiện tại? Ảnh hưởng: bề mặt tấn công của ingest.
- [ ] Security owner + ATTT: điều kiện gì để mở vision cho ảnh nội bộ (D7)? Ảnh hưởng: G3 có làm
      được ask #3 đầy đủ hay dừng ở rulebook. **Dự thảo hợp đồng đã soạn để duyệt:**
      `docs/security/ba-vision-consent-contract.md` (bảy điều khoản duyệt/bác riêng lẻ, kèm bốn câu
      hỏi cần ATTT trả lời dứt khoát). Cũng có trong `docs/OPEN-QUESTIONS.md` mục I1.
- [ ] Product owner + BA lead: bộ template chuẩn ship kèm gồm những mẫu nào, và ai duyệt nội dung
      của chúng? Ảnh hưởng: nội dung `ba-templates.json` ở G2, không ảnh hưởng schema.
- [ ] Design owner: báo cáo review hiển thị thế nào để không bị đọc thành "tài liệu đã đúng"?
      Ảnh hưởng: microcopy và bố cục của G3.
