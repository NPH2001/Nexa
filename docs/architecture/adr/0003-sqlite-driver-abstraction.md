# ADR 0003 — Tách lớp driver SQLite

**Trạng thái:** Đề xuất
**Ngày:** 2026-08-01

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

## Hệ quả

**Tích cực**
- Test tầng lưu trữ chạy ở mọi nơi, kể cả CI không có toolchain C++.
- Nếu `better-sqlite3` gặp vấn đề với một phiên bản Electron nào đó, có đường lui.

**Tiêu cực**
- Test chạy trên `node:sqlite`, production chạy trên `better-sqlite3` — **hai driver khác nhau**.
  Rủi ro có hành vi lệch mà test không bắt được là thật. Giảm thiểu: bề mặt API dùng tới rất hẹp,
  và job `build-windows` trong CI chạy `@electron/rebuild` rồi chạy lại toàn bộ test trên
  Windows với driver thật.
- `node:sqlite` còn được đánh dấu experimental trong Node. Nó chỉ nằm ở đường test, không nằm
  ở đường phát hành.
