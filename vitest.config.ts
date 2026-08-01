import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@nexa/shared-types': r('./packages/shared-types/src/index.ts'),
      '@nexa/security': r('./packages/security/src/index.ts'),
      '@nexa/local-store': r('./packages/local-store/src/index.ts'),
      '@nexa/llm-client': r('./packages/llm-client/src/index.ts'),
      '@nexa/mcp-client': r('./packages/mcp-client/src/index.ts'),
      '@nexa/atlassian-mcp-manager': r('./packages/atlassian-mcp-manager/src/index.ts'),
      '@nexa/connection-config': r('./packages/connection-config/src/index.ts'),
      '@nexa/document-processor': r('./packages/document-processor/src/index.ts'),
      '@nexa/agent-runtime': r('./packages/agent-runtime/src/index.ts'),
      '@nexa/observability': r('./packages/observability/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/**/*.test.ts', 'tests/**/*.test.ts', 'apps/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['packages/*/src/**', 'apps/desktop/src/main/**'],
    },
  },
})
