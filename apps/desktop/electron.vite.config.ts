import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const workspace = (name: string): string =>
  resolve(__dirname, `../../packages/${name}/src/index.ts`)

const WORKSPACE_PACKAGES = [
  'shared-types',
  'observability',
  'security',
  'local-store',
  'llm-client',
  'mcp-client',
  'atlassian-mcp-manager',
  'connection-config',
  'document-processor',
  'agent-runtime',
] as const

/**
 * Alias tới mã nguồn TypeScript của workspace package.
 *
 * Các package trong repo này không có bước build riêng — chúng là source-only. Bundler của
 * ứng dụng biên dịch chúng cùng lúc, nên không có vòng lặp "sửa package → build → link".
 */
const alias: Record<string, string> = Object.fromEntries(
  WORKSPACE_PACKAGES.map((name) => [`@nexa/${name}`, workspace(name)]),
)

/**
 * Preload nạp danh sách channel từ module KHÔNG có zod.
 *
 * Nếu để nó import `@nexa/shared-types` (index), rollup kéo theo toàn bộ zod — preload phình
 * lên hơn 100 kB và mang một thư viện parser vào ngay ranh giới sandbox. Alias hẹp này giữ
 * preload ở mức vài kB.
 */
const preloadAlias: Record<string, string> = {
  '@nexa/shared-types': resolve(__dirname, '../../packages/shared-types/src/channels.ts'),
}

/**
 * `@nexa/*` PHẢI nằm trong bundle: chúng là source TypeScript, Node không nạp trực tiếp được.
 * Chỉ các native module và thư viện nặng thật sự mới được để ngoài.
 */
const externalizeExcept = externalizeDepsPlugin({
  exclude: WORKSPACE_PACKAGES.map((name) => `@nexa/${name}`),
})

export default defineConfig({
  main: {
    plugins: [externalizeExcept],
    resolve: { alias },
    build: {
      outDir: resolve(__dirname, 'out/main'),
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          // Worker trích xuất tài liệu là entry riêng (§14.1) — WorkerThreadRunner nạp file này.
          'extraction-worker': resolve(
            __dirname,
            '../../packages/document-processor/src/extraction-worker.ts',
          ),
        },
        output: { entryFileNames: '[name].js' },
      },
    },
  },

  preload: {
    // Không externalize: preload chạy trong sandbox, không có module resolver, nên mọi thứ
    // nó dùng phải nằm sẵn trong bundle. `electron` là ngoại lệ do runtime cung cấp.
    resolve: { alias: preloadAlias },
    build: {
      outDir: resolve(__dirname, 'out/preload'),
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
        // Preload chạy trong context bị cô lập; CJS là định dạng an toàn nhất với sandbox.
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },

  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react()],
    resolve: {
      // Renderer CHỈ được dùng shared-types. Mọi package khác chạm vào Node hoặc secret
      // (§13.1) — eslint chặn lúc lint, còn ở đây không khai alias để chặn cả lúc build.
      alias: { '@nexa/shared-types': workspace('shared-types') },
    },
    build: {
      outDir: resolve(__dirname, 'out/renderer'),
      emptyOutDir: true,
      rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } },
    },
  },
})
