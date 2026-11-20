import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

/**
 * Giữ danh sách này khớp với `WORKSPACE_PACKAGES` trong `apps/desktop/electron.vite.config.ts`
 * và với `paths` trong `tsconfig.base.json`. Thiếu một tên ở đây thì test không fail vì logic mà
 * fail lúc nạp module ("Failed to load url @nexa/..."), rất dễ đọc sai thành lỗi thật.
 */
const WORKSPACE_PACKAGES = [
  'shared-types',
  'ba-kit',
  'observability',
  'security',
  'local-store',
  'llm-client',
  'mcp-client',
  'atlassian-mcp-manager',
  'work-mcp-servers',
  'connection-config',
  'daily-briefing',
  'document-checklist',
  'document-processor',
  'agent-runtime',
] as const

/**
 * Subpath phải đứng TRƯỚC alias gốc: alias dạng chuỗi của Vite khớp cả tiền tố, nên
 * `@nexa/shared-types` đặt trước sẽ biến `@nexa/shared-types/renderer` thành
 * `.../src/index.ts/renderer`.
 */
const alias: Record<string, string> = {
  '@nexa/shared-types/renderer': r('./packages/shared-types/src/renderer.ts'),
  '@nexa/shared-types/channels': r('./packages/shared-types/src/channels.ts'),
  ...Object.fromEntries(
    WORKSPACE_PACKAGES.map((name) => [`@nexa/${name}`, r(`./packages/${name}/src/index.ts`)]),
  ),
}

export default defineConfig({
  resolve: { alias },
  test: {
    globals: true,
    // Nhiều test dựng SQLite + mã hoá; chạy song song cả bộ trên máy tải cao dễ vượt 5s mặc định.
    testTimeout: 15_000,
    environment: 'node',
    include: ['packages/**/*.test.ts', 'tests/**/*.test.ts', 'apps/**/*.test.ts'],
    // E2E chạy bằng Playwright (`pnpm test:e2e`), không phải vitest.
    exclude: ['**/node_modules/**', 'tests/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['packages/*/src/**', 'apps/desktop/src/main/**'],
    },
  },
})
