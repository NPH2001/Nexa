# ADR 0003 — Tách lớp driver SQLite

**Trạng thái:** Đề xuất
**Ngày:** 2026-08-01 · **Cập nhật:** 2026-08-01 sau khi chạy thử app thật

## Bối cảnh

§5.1 chọn SQLite cho local database. Lựa chọn mặc định trong hệ sinh thái Electron là
`better-sqlite3` — nhanh, API đồng bộ, ổn định.

Vấn đề: `better-sqlite3` là native module. Nó cần prebuild khớp phiên bản Node/Electron, hoặc
cần toolchain C++ để build từ nguồn. Trong quá trình phát triển, máy dev không có toolchain và
Node 24 chưa có prebuild — `better-sqlite3` không nạp được.

Nếu để nguyên, hệ quả là **không chạy được test nào của tầng lưu trữ**, tức là mất luôn khả năng
kiểm chứng phần mã hoá và migration — đúng những chỗ rủi ro nhất.

## Quyết định

Đưa vào một interface mỏng (`packages/local-store/src/driver.ts`) với hai implementation:

| Driver | Dùng ở đâu | Lý do |
|---|---|---|
| `better-sqlite3` | Bản phát hành Electron | Nhanh, đã kiểm chứng trong hệ sinh thái Electron |
| `node:sqlite` | Test và máy dev không có toolchain | Có sẵn từ Node 22.5+, không cần build |

`openDatabase(path, preferred)` thử driver ưu tiên trước, rơi xuống driver còn lại nếu không nạp
được. Cả hai đều nạp bằng `createRequire` chứ không `import()` — nếu dùng `import()` thì Vite
làm rụng tiền tố `node:` và electron-vite cố kéo `.node` binary vào bundle.

## Ràng buộc để hai driver không lệch hành vi

Chỉ dùng mẫu số chung, được ghi rõ trong `driver.ts`:

- chỉ tham số vị trí `?`, không dùng named parameter
- không truyền `boolean` hay `undefined` — chuẩn hoá về `0/1` và `null` bằng helper `b()` và `n()`
- transaction bằng `BEGIN`/`SAVEPOINT` tường minh, không dùng `.transaction()` của better-sqlite3

## Cập nhật sau khi chạy thử app thật

Khi chạy Electron lần đầu, app dừng ở `LOCAL_DB_LOCKED`: Electron 33 mang Node 20, mà Node 20
không có `node:sqlite`. Cả hai driver đều không nạp được.

Kiểm tra lại các bản Electron mới cho kết quả quan trọng:

```
Electron 43.2.0 → Node 24.18.0 → node:sqlite CÓ SẴN (đã bỏ cờ experimental)
```

Điều này đổi bản chất của quyết định. `node:sqlite` không còn là "driver chỉ dùng cho test" —
nó chạy được cả trong bản phát hành. Vì vậy:

1. **Nâng lên Electron 43.**
2. **`better-sqlite3` chuyển thành `optionalDependency`.** App chạy đầy đủ khi không có nó.
3. **Bước rebuild native trong CI thành `continue-on-error`.** Nó là tối ưu hiệu năng, không
   còn là điều kiện để phát hành.

App đã được chạy thật và xác nhận: `local-db-opened {"driver":"node:sqlite"}`, migration v1 áp
dụng, `window-ready` sau 304 ms.

## Hệ quả

**Tích cực**
- Test tầng lưu trữ chạy ở mọi nơi, kể cả CI không có toolchain C++.
- **Bộ cài không còn phụ thuộc bắt buộc vào native module.** Bỏ được một mắt xích hay gãy nhất
  trong packaging Electron: không cần toolchain trên máy build, không cần asarUnpack để chạy.
- Test và bản phát hành có thể chạy **cùng một driver**, nên rủi ro "hành vi lệch giữa hai driver"
  giảm mạnh so với đánh giá ban đầu.

**Tiêu cực**
- `node:sqlite` vẫn được Node đánh dấu experimental. Nếu Electron tắt nó ở bản sau, đường lui là
  better-sqlite3 — vẫn còn nguyên, chỉ là tuỳ chọn.
- Chậm hơn better-sqlite3. Số đo hiện tại (`tests/performance.test.ts`): ghi 2.400 message đã mã
  hoá mất 343 ms, liệt kê 100 hội thoại mất 4 ms. Ở quy mô một app desktop đơn người dùng, chênh
  lệch này không đáng kể.
- Log khởi động ghi rõ driver nào đang dùng (`local-db-opened`), nên khi điều tra sự cố luôn biết
  mình đang chạy trên cái nào.
