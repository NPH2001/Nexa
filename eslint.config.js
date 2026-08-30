// @ts-check
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/out/**', '**/node_modules/**', '**/coverage/**', '**/release/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      eqeqeq: ['error', 'always'],
      'no-console': 'error',
    },
  },

  // §13.1 — renderer MUST NOT import main-process code.
  // §5.3 — renderer MUST NOT touch node builtins or electron directly.
  {
    files: ['apps/desktop/src/renderer/**/*.{ts,tsx}', 'packages/ui-components/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^@nexa/shared-types$',
              message:
                'Renderer must use the explicit @nexa/shared-types/renderer boundary entrypoint.',
            },
            {
              group: ['**/main/**', '@nexa/security', '@nexa/local-store', '@nexa/llm-client'],
              message:
                'Renderer must not import main-process code (§13.1). Go through the preload IPC bridge.',
            },
            {
              group: ['electron', 'node:*', 'fs', 'path', 'child_process', 'crypto'],
              message:
                'Renderer has no Node access (§5.3). Use window.nexa from the preload bridge.',
            },
          ],
        },
      ],
    },
  },

  // ba-kit là logic thuần (add-ba-workbench D9). Ranh giới có test runtime trong
  // packages/ba-kit/src/boundary.test.ts; luật này bắt vi phạm ngay lúc gõ code.
  {
    files: ['packages/ba-kit/**/*.ts'],
    // Chính test ranh giới phải đọc được file bằng node:fs, nên nó đứng ngoài luật này.
    ignores: ['packages/ba-kit/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'electron',
                'node:*',
                '@nexa/local-store',
                '@nexa/llm-client',
                '@nexa/security',
                '@nexa/observability',
                '**/main/**',
              ],
              message:
                'ba-kit phải là logic thuần: không Electron, không DB, không LLM, không Node builtin (D9).',
            },
          ],
        },
      ],
    },
  },

  // Secrets must never reach a logger or the console (§11.1, §15.1).
  {
    files: ['packages/**/*.ts', 'apps/desktop/src/main/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'console', message: 'Use @nexa/observability logger — it enforces redaction.' },
      ],
    },
  },

  // Fixture chạy bằng Node thuần (không qua bundler) nên cần global của Node.
  {
    files: ['tests/fixtures/**/*.mjs', 'scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        __dirname: 'readonly',
      },
    },
    rules: { 'no-console': 'off' },
  },

  // Tests and tooling get to be looser.
  {
    files: [
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/*.e2e.ts',
      'tests/**/*.ts',
      '*.config.ts',
      'eslint.config.js',
    ],
    rules: {
      'no-console': 'off',
      'no-restricted-globals': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
)
