# ADR 0004 — Chỉ dùng MCP stdio, không dùng localhost HTTP

**Trạng thái:** Đề xuất (xem OPEN-QUESTIONS D1)
**Ngày:** 2026-08-01

## Bối cảnh

§4.2 cho phép hai lựa chọn: *"MCP stdio hoặc localhost chỉ bind loopback"*.

MCP server Atlassian giữ URL, username và **PAT của người dùng** trong bộ nhớ tiến trình của nó.

## Quyết định

**Chỉ triển khai stdio.** Không viết transport HTTP, kể cả loopback.

Credential truyền vào process con qua **biến môi trường**, không qua `argv`.

## Lý do

### Vì sao không dùng localhost HTTP

Một cổng nghe trên loopback không có cơ chế xác thực nào theo mặc định. Mọi tiến trình khác
đang chạy dưới cùng tài khoản người dùng — kể cả một extension trình duyệt độc hại, một script
cài kèm phần mềm khác — đều gọi được nó và dùng PAT của người dùng để đọc/ghi Jira. Không có
gì phân biệt được request từ Nexa với request từ tiến trình khác.

stdio không có vấn đề đó: chỉ tiến trình cha nắm được ống dẫn.

Tài liệu để ngỏ cả hai lựa chọn, nhưng lựa chọn HTTP không mang lại lợi ích nào mà Nexa cần
(không có multi-client, không có server chạy sẵn), trong khi mở thêm một bề mặt tấn công thật.

### Vì sao credential đi qua environment, không qua argv

`argv` của một tiến trình hiển thị cho **mọi** tiến trình khác trên máy: `ps` trên Unix,
Task Manager / WMI trên Windows. Environment của một tiến trình thì chỉ chủ sở hữu đọc được.

§11.1 cấm secret nằm ở nơi đọc được; argv là một nơi như thế.

## Hệ quả

- `McpStdioClient` không có nhánh transport nào khác — muốn thêm HTTP sau này là viết mới, và
  đó là chủ ý: quyết định phải được xem lại một cách tường minh.
- Nexa không khai báo capability `sampling` hay `roots` trong `initialize`. Hai năng lực đó cho
  phép server yêu cầu ngược client gọi LLM hoặc đọc file cục bộ. Nexa không cấp quyền đó, và
  bỏ qua mọi request đến từ server.
- Nếu package MCP được chốt (OPEN-QUESTIONS A4 🔴) chỉ hỗ trợ HTTP, quyết định này phải xem
  lại — cùng với biện pháp bù (token dùng một lần trong header, kiểm tra PID của client…).
