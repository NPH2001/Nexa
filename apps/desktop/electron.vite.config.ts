import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const workspace = (name: string): string =>
  resolve(__dirname, `../../packages/${name}/src/index.ts`)

const WORKSPACE_PACKAGES = [
  'shared-types',
  'ba-kit',
  'observability',
  'security',
  'local-store',
  'llm-client',
  'mcp-client',
  'atlassian-mcp-manager',
  'connection-config',
  'document-checklist',
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
 * Preload nạp entrypoint channel tường minh, KHÔNG có zod.
 *
 * Nếu để nó import `@nexa/shared-types` (index), rollup kéo theo toàn bộ zod — preload phình
 * lên hơn 100 kB và mang một thư viện parser vào ngay ranh giới sandbox. Subpath tường minh
 * khiến ranh giới này nhìn thấy ngay tại call site và giữ preload ở mức vài kB.
 */
const preloadAlias: Record<string, string> = {
  '@nexa/shared-types/channels': resolve(__dirname, '../../packages/shared-types/src/channels.ts'),
}

/** Renderer chỉ cần type và helper UI thuần; entry này cố ý không import Zod/schema IPC. */
const rendererAlias: Record<string, string> = {
  '@nexa/shared-types/renderer': resolve(__dirname, '../../packages/shared-types/src/renderer.ts'),
}

/**
 * `@nexa/*` PHẢI nằm trong bundle: chúng là source TypeScript, Node không nạp trực tiếp được.
 * Chỉ các native module và thư viện nặng thật sự mới được để ngoài.
 */
export default defineConfig({
  main: {
    resolve: { alias },
    build: {
      externalizeDeps: {
        exclude: WORKSPACE_PACKAGES.map((name) => `@nexa/${name}`),
      },
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
      externalizeDeps: false,
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
      alias: rendererAlias,
    },
    build: {
      outDir: resolve(__dirname, 'out/renderer'),
      emptyOutDir: true,
      rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } },
    },
  },
})
