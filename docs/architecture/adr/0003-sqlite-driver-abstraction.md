# ADR 0003 — Tách lớp driver SQLite

**Trạng thái:** ✅ **Đã chấp nhận** — chủ sở hữu sản phẩm chốt ngày 2026-08-01
**Ngày:** 2026-08-01 · **Cập nhật:** 2026-08-01 sau khi chạy thử app và thử đóng gói

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
| `node:sqlite` | **Test và bản phát hành** | Có sẵn trong Node 24 của Electron 43, không cần build |
| `better-sqlite3` | Không cài, không đóng gói — chỉ là lối thoát | Nhanh hơn, nhưng là native module |

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
nó chạy được cả trong bản phát hành.

Rồi khi thử đóng gói, `better-sqlite3` chặn hẳn đường: **node-gyp không cross-compile được**
native module. Nghĩa là nó vừa khiến không build được bộ cài Windows từ máy nào khác Windows,
vừa buộc CI phải thêm một bước rebuild có thể gãy.

### Quyết định cuối

**Bỏ hẳn `better-sqlite3` khỏi cây phụ thuộc.** `node:sqlite` là driver duy nhất được cài và
đóng gói. Hệ quả:

- không còn native module nào ⇒ `npmRebuild: false`, không cần `asarUnpack`, không cần
  `@electron/rebuild` trong CI
- **test và bản phát hành chạy CÙNG một driver** — rủi ro "hành vi lệch giữa hai driver" biến
  mất hoàn toàn, không chỉ giảm
- `pnpm install` không còn phun lỗi node-gyp

Đường dẫn tới `better-sqlite3` trong `driver.ts` được giữ lại làm lối thoát: nếu một bản Electron
sau này bỏ `node:sqlite`, chỉ cần cài lại package và đổi một tham số. Dữ liệu là file SQLite
chuẩn nên không cần chuyển đổi gì.

App đã được chạy thật và xác nhận: `local-db-opened {"driver":"node:sqlite"}`, migration v1 áp
dụng, `window-ready` sau 304 ms. 8 test E2E chạy Electron thật cũng đi qua đúng driver này.

## Hệ quả

**Tích cực**
- Test tầng lưu trữ chạy ở mọi nơi, kể cả CI không có toolchain C++.
- **Bộ cài không còn phụ thuộc bắt buộc vào native module.** Bỏ được một mắt xích hay gãy nhất
  trong packaging Electron: không cần toolchain trên máy build, không cần asarUnpack để chạy.
- Test và bản phát hành có thể chạy **cùng một driver**, nên rủi ro "hành vi lệch giữa hai driver"
  giảm mạnh so với đánh giá ban đầu.

**Tiêu cực**
- **`node:sqlite` vẫn được Node đánh dấu experimental.** Đây là rủi ro đã được nêu ra rõ ràng và
  chủ sở hữu sản phẩm chấp nhận. Cơ sở đánh giá rủi ro thấp: dữ liệu là file SQLite chuẩn nên đổi
  driver không mất dữ liệu, lối thoát chỉ là một tham số, và hiệu năng đã đo đủ dùng.
  **Việc cần làm:** theo dõi ghi chú phát hành của Node/Electron khi nâng cấp — nếu API đổi hoặc
  bị bỏ, đây là chỗ phải xem lại đầu tiên (gắn với E10, chính sách nâng cấp Electron).
- Chậm hơn better-sqlite3. Số đo hiện tại (`tests/performance.test.ts`): ghi 2.400 message đã mã
  hoá mất 343 ms, liệt kê 100 hội thoại mất 4 ms. Ở quy mô một app desktop đơn người dùng, chênh
  lệch này không đáng kể.
- Log khởi động ghi rõ driver nào đang dùng (`local-db-opened`), nên khi điều tra sự cố luôn biết
  mình đang chạy trên cái nào.
