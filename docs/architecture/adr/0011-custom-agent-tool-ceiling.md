# ADR 0011 — Agent tuỳ biến: trần tool là phép giao trong tập preset đóng

**Trạng thái:** Đề xuất
**Ngày:** 2026-11-20

## Bối cảnh

Openspec `add-custom-agents` cho người dùng tạo agent mức persona: tên, hướng dẫn, phạm vi tool,
model mặc định. Phạm vi tool là chỗ nguy hiểm theo hai hướng:

1. **Phá ADR 0009.** Khối `tools` gửi model phải thuộc một tập hữu hạn, biết trước để prompt cache
   hoạt động. Cho agent chọn tổ hợp tool tự do sinh ra vô số prefix khác nhau.
2. **Nới quyền.** Preset chỉ quyết định model *thấy* gì, còn `guard` quyết định cái gì được *chạy*.
   Một cơ chế "agent được phép thêm tool" sẽ là đường vòng quanh cả hai.

## Quyết định

**Agent lưu một `ToolPreset` làm trần, không lưu danh sách tool.** Preset hiệu lực của mỗi lượt là
`clampPreset(selected, ceiling)`:

- cờ của `selected` là tập con cờ của `ceiling` ⇒ giữ `selected`;
- ngược lại ⇒ dùng `ceiling`.

Kết quả luôn là một trong 10 preset có sẵn, nên không sinh prefix mới. Phép giao chính xác theo
từng cờ bị loại vì nó cho ra tổ hợp ngoài danh sách đóng.

Trần được áp ở **ba chỗ**, vì thiếu bất kỳ chỗ nào là rò quyền:

1. **Khối `tools`:** preset hiệu lực = `clampPreset(...)`.
2. **Đường mở rộng `nexa_mo_rong_tool`:** đích mở rộng là *trần*, không phải `all`; danh mục trả
   cho model chỉ liệt kê tool trong trần; tool meta không được đưa vào khi preset đã bằng trần.
3. **Lúc thực thi:** model đoán tên một tool ngoài khối `tools` vẫn bị từ chối nếu cờ của tool
   không nằm trong trần (fail-closed, không fatal để model tự chuyển hướng).

Hai nhóm tool cục bộ (cam kết, BA) là công tắc chỉ **AND** với setting toàn cục: agent không bật
được thứ setting đã tắt, chỉ tắt thêm được.

Hướng dẫn của agent luôn được nối **sau** `DEFAULT_SYSTEM_PROMPT` trong một khối đánh dấu là cấu
hình người dùng. Không có tham số nào thay thế prompt gốc. Nhánh ChatGPT managed áp cùng nguyên
tắc lên `developerInstructions`.

## Hệ quả

- Agent không thay đổi được Confirmation Guard: mọi tool ghi vẫn cần preview và xác nhận.
- Tập prefix `tools` khả dĩ không đổi: vẫn là 10 preset nhân với các tổ hợp hai cờ local.
- Agent giới hạn có thể làm model thấy *nhiều tool hơn* câu hỏi cần (rơi về trần thay vì về rỗng),
  nhưng luôn trong phạm vi người dùng đã cho phép.
- Persona vẫn ảnh hưởng điều model *đề xuất*; nó không ảnh hưởng điều model được phép *làm*.
- Model mặc định của agent chỉ áp một lần lúc gắn vào hội thoại, để không mâu thuẫn với dropdown.
  Bộ lọc dữ liệu theo provider ngoài tổ chức chạy trên model cuối cùng của lượt, không đổi.

## Phương án đã loại

- **Danh sách tool tự do theo agent:** phá ADR 0009 và mở rộng bề mặt tấn công.
- **Cho agent ghi đè system prompt:** người dùng vô tình xoá quy tắc an toàn.
- **Cho agent cấp thêm quyền ghi:** quyền ghi do setting và feature flag toàn cục quyết định.
