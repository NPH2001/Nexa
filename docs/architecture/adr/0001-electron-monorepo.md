# ADR 0001 — Electron + React + monorepo source-only

**Trạng thái:** Đề xuất
**Ngày:** 2026-08-01

## Bối cảnh

§5.1 khuyến nghị Electron + React + TypeScript, và §22.3 chốt lại điều đó cho MVP. §22.2 để ngỏ
việc đánh giá Tauri nếu có ràng buộc RAM cứng.

§13 đề xuất cây thư mục monorepo với `apps/desktop` và một loạt `packages/*`.

## Quyết định

1. **Electron 43 + React 19 + TypeScript strict**, build bằng `electron-vite`.
2. **Monorepo pnpm workspaces**, các package là **source-only**: `main`/`types` trỏ thẳng vào
   `src/index.ts`, không có bước build riêng cho từng package.
3. Bundler của ứng dụng (electron-vite) biên dịch tất cả trong một lần.

## Lý do cho "source-only"

Cách thông thường là mỗi package tự `tsc` ra `dist/`. Với 10 package thì mỗi lần sửa một dòng
ở `shared-types` phải build lại chuỗi phụ thuộc trước khi app thấy thay đổi. Điều đó làm chậm
vòng lặp phát triển mà không đổi lại lợi ích gì — các package này không được publish ra ngoài,
chỉ có đúng một consumer.

Đánh đổi: `tsc --noEmit` ở root phải kiểm tra toàn bộ cây cùng lúc (chậm hơn project references),
và không có "API surface" được đóng băng giữa các package. Với quy mô một app desktop thì
chấp nhận được.

## Ranh giới được thực thi bằng công cụ

Nguyên tắc §13.1 _"Không import trực tiếp code main process vào renderer"_ được thực thi ở
**hai** tầng, không chỉ bằng quy ước:

- **eslint** (`eslint.config.js`): renderer bị cấm import `@nexa/security`, `@nexa/local-store`,
  `@nexa/llm-client`, `electron`, và mọi `node:*`.
- **entrypoint + bundler** (`packages/shared-types/package.json`, `electron.vite.config.ts`):
  renderer phải import `@nexa/shared-types/renderer`, preload phải import
  `@nexa/shared-types/channels`; bare specifier đầy đủ chỉ dành cho main/package nội bộ.
  Import package main-process khác vẫn lỗi ngay lúc build, kể cả khi ai đó tắt eslint.
- **protocol** (`renderer-protocol.ts`): production chỉ phục vụ asset nằm trong renderer root qua
  origin `nexa://app`; không tải trang bằng `file://`.

## Hệ quả

- RAM cao hơn Tauri. §12.1 đặt mục tiêu idle < 500 MB, chat < 800 MB. Chưa đo được trên máy
  thật (xem OPEN-QUESTIONS C1) — cần đo ở pilot trước khi khẳng định đạt.
- Bộ cài **không chứa native module nào** — xem [ADR 0003](0003-sqlite-driver-abstraction.md).
  Nhờ đó CI không cần `@electron/rebuild`, và không cần toolchain C++ trên máy build.
  Nhưng bộ cài Windows vẫn **phải build trên Windows**: bước nhúng icon/version info vào .exe
  cần công cụ Windows. Job `build-windows` trong CI làm việc đó.
