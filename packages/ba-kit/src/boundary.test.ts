import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Ranh giới không có test là ranh giới sẽ bị vượt (D9).
 *
 * Test này không kiểm hành vi, nó kiểm một quyết định kiến trúc: `ba-kit` phải chạy được không
 * Electron, không DB, không LLM. Ngày nào đó sẽ có người cần "chỉ đọc một giá trị từ store thôi mà"
 * — đây là chỗ nói không.
 */

const SRC = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = dirname(SRC)

const ALLOWED_DEPENDENCIES = new Set(['zod', '@nexa/shared-types'])

const FORBIDDEN_IMPORT = /^(electron|node:|@nexa\/(local-store|llm-client|security|observability))/

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    if (!full.endsWith('.ts') || full.endsWith('.test.ts')) return []
    return [full]
  })
}

describe('ranh giới của ba-kit', () => {
  it('chỉ khai báo dependency được phép', () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
    }
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      expect(ALLOWED_DEPENDENCIES).toContain(dependency)
    }
  })

  it('không import Electron, DB, LLM hay node builtin trong mã nguồn', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(SRC)) {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(/from\s+'([^']+)'/g)) {
        const specifier = match[1]
        if (specifier !== undefined && FORBIDDEN_IMPORT.test(specifier)) {
          offenders.push(`${file}: ${specifier}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('có ít nhất một file nguồn để test này không tự đúng một cách rỗng tuếch', () => {
    expect(sourceFiles(SRC).length).toBeGreaterThan(3)
  })
})
