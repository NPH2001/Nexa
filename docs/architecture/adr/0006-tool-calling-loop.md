# ADR 0006 — Ràng buộc vòng lặp tool-calling

**Trạng thái:** Đề xuất (xem OPEN-QUESTIONS B3)
**Ngày:** 2026-08-01

## Bối cảnh

§5.2 nói Agent Runtime *"quyết định gọi model/tool, ghép kết quả vào hội thoại"* nhưng không
đặc tả: bao nhiêu vòng tối đa? tool chạy song song không? lỗi tool thì làm gì?

Đây là những chỗ mà mặc định sai sẽ gây ra hành vi khó chịu hoặc nguy hiểm, nên cần chốt rõ.

## Quyết định

| Ràng buộc | Giá trị | Lý do |
|---|---|---|
| Số vòng tool tối đa mỗi lượt | 5 (cấu hình được) | Chặn vòng lặp vô hạn khi model kẹt. Vượt ⇒ `MAX_TOOL_ITERATIONS`, thông báo rõ, không trả lời cụt lủn |
| Tool chạy song song | **Không** — tuần tự | Nếu song song, hai hộp thoại xác nhận có thể chồng nhau và người dùng không biết mình đang duyệt cái nào |
| Tool write mỗi lượt | **Tối đa 1** | Xem bên dưới |
| Tool lỗi | Trả lỗi lại cho model như một tool result | Model tự sửa được lỗi tên tool hoặc tham số ở vòng sau |
| Lỗi auth/config/MCP-down | **Dừng hẳn lượt** | §3 fail closed. Model không sửa được, thử lại chỉ tốn quota |
| Kết quả write không rõ | **Dừng hẳn lượt** | §9.3 cấm tự retry. Để model chạy tiếp là mời nó thử lại |

## Vì sao chỉ một tool write mỗi lượt

Nếu model đề xuất "tạo 3 issue", người dùng sẽ thấy ba hộp thoại liên tiếp. Thực tế người ta
sẽ bấm Xác nhận theo quán tính từ cái thứ hai — đúng thứ mà §10.2 muốn tránh khi cấm nhãn nút
mơ hồ.

Chặn cái thứ hai bằng một tool result nói rõ *"mỗi lượt chỉ được một thao tác thay đổi dữ liệu,
hãy đề xuất từng cái để người dùng xác nhận riêng"*. Model sẽ đề xuất lại từng cái một.

**Đánh đổi đã biết:** khó chịu khi người dùng thật sự muốn tạo nhiều issue cùng lúc. Đây là
lựa chọn thiên về an toàn; nếu pilot cho thấy nó cản trở công việc thì có thể nới thành
"nhiều write nhưng một hộp thoại xác nhận gộp", chứ không nên nới thành "nhiều hộp thoại".

## Quản lý ngữ cảnh

Cửa sổ trượt: giữ system prompt + tài liệu đính kèm của lượt hiện tại + N message gần nhất vừa
ngân sách. Message cũ bị **bỏ**, không tóm tắt.

Không tóm tắt vì đó là thêm một lần gọi LLM ⇒ thêm chi phí, thêm độ trễ, và thêm một lần nội
dung nhạy cảm rời khỏi máy. Nếu tổ chức muốn có tóm tắt, đó là scope bổ sung cần quyết định riêng.

Số message bị lược được báo cho người dùng — không im lặng cắt bối cảnh.

**Ước lượng token dùng heuristic ~4 ký tự/token**, vì Nexa không biết model nào nằm sau LiteLLM.
Với tiếng Việt có dấu, sai số có thể tới ±25%. Bù bằng `safetyMargin = 0.8`. Đây là rủi ro thật
của lỗi context-length-exceeded — cần theo dõi ở pilot.
