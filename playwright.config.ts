import { defineConfig } from '@playwright/test'

/**
 * E2E desktop (T-13-13).
 *
 * Tách khỏi vitest có chủ ý: E2E khởi chạy Electron thật, chậm hơn unit test hai bậc độ lớn,
 * và cần một display. `pnpm verify` không chạy nó — dùng `pnpm test:e2e`.
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.e2e.ts',
  // Electron chỉ chạy một instance mỗi user-data-dir, và mỗi test tự dựng dir riêng.
  // Chạy tuần tự để không tranh nhau display và cổng.
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // Test nào cũng phải xanh ổn định; retry chỉ để lọc nhiễu hạ tầng trên CI.
  retries: process.env['CI'] === undefined ? 0 : 1,
  reporter: process.env['CI'] === undefined ? [['list']] : [['list'], ['github']],
  use: { trace: 'retain-on-failure' },
})
