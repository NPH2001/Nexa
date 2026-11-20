# AGENTS.md

Quy tắc phát triển cho mọi agent (và lập trình viên) làm việc trong repo này.

## Nguyên tắc thiết kế

### SOLID

- **S – Single Responsibility**: mỗi module, class, hàm, component chỉ có một lý do để thay đổi. Tách logic nghiệp vụ khỏi UI, IO, và IPC.
- **O – Open/Closed**: mở rộng hành vi bằng cách thêm code mới (strategy, adapter, đăng ký handler), không sửa code đã ổn định.
- **L – Liskov Substitution**: mọi implementation của một interface phải thay thế được nhau mà không làm vỡ hành vi của nơi gọi.
- **I – Interface Segregation**: interface nhỏ, tập trung. Không bắt nơi dùng phụ thuộc vào method nó không cần.
- **D – Dependency Inversion**: phụ thuộc vào abstraction (interface/type), không phụ thuộc vào implementation cụ thể. Inject dependency qua tham số/constructor để dễ test.

### DRY – Don't Repeat Yourself

- Mỗi tri thức/logic chỉ có một nơi duy nhất định nghĩa.
- Chỉ gộp khi hai đoạn code giống nhau **vì cùng một lý do nghiệp vụ**. Code giống nhau ngẫu nhiên thì để riêng; trùng lặp tạm thời tốt hơn một abstraction sai.
- Ưu tiên dùng lại helper/package có sẵn trong `packages/` trước khi viết mới.

### KISS – Keep It Simple, Stupid

- Chọn giải pháp đơn giản nhất đáp ứng yêu cầu hiện tại.
- Ưu tiên code dễ đọc hơn code "thông minh". Tránh lồng sâu, tránh trừu tượng không cần thiết.
- Hàm ngắn, tên rõ nghĩa, một mức trừu tượng trong mỗi hàm.

### YAGNI – You Aren't Gonna Need It

- Không thêm tính năng, tham số, cấu hình, hay lớp trừu tượng cho nhu cầu "có thể sẽ cần".
- Chỉ làm những gì yêu cầu/spec hiện tại đòi hỏi. Khi nhu cầu thật xuất hiện thì mới refactor.
- Không để lại code chết, code bị comment, hay hook/extension point chưa ai dùng.

## Cách áp dụng

- Khi các nguyên tắc xung đột, thứ tự ưu tiên: **KISS / YAGNI trước, rồi DRY, rồi SOLID**. Không áp SOLID máy móc nếu làm code phức tạp hơn mức vấn đề đòi hỏi.
- Thay đổi nhỏ, tập trung, đúng phạm vi yêu cầu; không refactor lan man ngoài phạm vi.
- Mỗi thay đổi hành vi phải có test đi kèm (xem `CONTRIBUTING.md` và `openspec/` cho quy trình).
- Khi review hoặc tự kiểm tra, rà lại bằng 4 câu hỏi: Có làm quá nhiều việc? Có lặp lại? Có đơn giản hơn được không? Có cần ngay bây giờ không?
