# ADR 0001 — Electron + React + monorepo source-only

**Trạng thái:** Đề xuất
**Ngày:** 2026-08-01

## Bối cảnh

§5.1 khuyến nghị Electron + React + TypeScript, và §22.3 chốt lại điều đó cho MVP. §22.2 để ngỏ
việc đánh giá Tauri nếu có ràng buộc RAM cứng.

§13 đề xuất cây thư mục monorepo với `apps/desktop` và một loạt `packages/*`.

## Quyết định

1. **Electron 33 + React 19 + TypeScript strict**, build bằng `electron-vite`.
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

Nguyên tắc §13.1 *"Không import trực tiếp code main process vào renderer"* được thực thi ở
**hai** tầng, không chỉ bằng quy ước:

- **eslint** (`eslint.config.js`): renderer bị cấm import `@nexa/security`, `@nexa/local-store`,
  `@nexa/llm-client`, `electron`, và mọi `node:*`.
- **bundler** (`electron.vite.config.ts`): cấu hình renderer chỉ khai alias cho
  `@nexa/shared-types`. Import package khác sẽ lỗi ngay lúc build, kể cả khi ai đó tắt eslint.

## Hệ quả

- RAM cao hơn Tauri. §12.1 đặt mục tiêu idle < 500 MB, chat < 800 MB. Chưa đo được trên máy
  thật (xem OPEN-QUESTIONS C1) — cần đo ở pilot trước khi khẳng định đạt.
- Native module (`better-sqlite3`) phải rebuild theo ABI Electron trong CI. Đã có bước
  `@electron/rebuild` trong `.github/workflows/ci.yml`.
