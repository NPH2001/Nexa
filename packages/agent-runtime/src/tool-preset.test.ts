import { describe, expect, it } from 'vitest'
import {
  DEFAULT_APP_SETTINGS,
  TOOL_PRESETS,
  TOOL_PRESET_FLAGS,
  type FeatureFlags,
  type ToolPreset,
} from '@nexa/shared-types'
import { buildToolRegistry } from '@nexa/atlassian-mcp-manager'
import { buildRedmineTools, buildXwikiTools } from '@nexa/work-mcp-servers'
import { clampPreset } from './tool-preset-selector.js'

/**
 * Bảng preset (ADR 0009) là một bản sao thủ công của cách 12 feature flag chia 98 tool. Bản sao
 * thủ công thì trôi. Các test dưới đây là chốt chống trôi — chúng đỏ khi có người thêm cờ tool
 * mới, đổi tên cờ, hoặc gán một tool sang cờ chưa nằm trong preset nào.
 */

/** Toàn bộ danh mục MCP của Nexa: Atlassian + Redmine + XWiki (ADR 0010). */
const registry = [
  ...buildToolRegistry({
    jiraBaseUrl: 'https://jira.internal',
    confluenceBaseUrl: 'https://confluence.internal',
  }),
  ...buildRedmineTools('https://redmine.internal'),
  ...buildXwikiTools('https://wiki.internal'),
]

/** Tập cờ mà registry THẬT SỰ dùng — nguồn sự thật, không phải danh sách viết tay. */
const flagsUsedByRegistry = new Set<keyof FeatureFlags>(registry.map((d) => d.requiredFeature))

describe('ADR 0009 — bảng preset phủ trọn danh mục tool', () => {
  it('preset `all` chứa đúng tập cờ mà registry dùng, không thừa không thiếu', () => {
    const allPreset = new Set(TOOL_PRESET_FLAGS.all)

    const thieu = [...flagsUsedByRegistry].filter((f) => !allPreset.has(f))
    const thua = [...allPreset].filter((f) => !flagsUsedByRegistry.has(f))

    // Thiếu = tool im lặng biến mất khỏi mọi preset. Thừa = cờ chết trong bảng.
    expect({ thieu, thua }).toEqual({ thieu: [], thua: [] })
  })

  it('preset `all` gửi đúng toàn bộ registry khi mọi cờ đều bật', () => {
    const allPreset = new Set(TOOL_PRESET_FLAGS.all)
    const covered = registry.filter((d) => allPreset.has(d.requiredFeature))
    expect(covered).toHaveLength(registry.length)
  })

  it('mỗi tool thuộc đúng một cờ — điều kiện để preset là hợp của các nhóm', () => {
    const byName = new Map<string, keyof FeatureFlags>()
    for (const d of registry) {
      const seen = byName.get(d.name)
      expect(seen === undefined || seen === d.requiredFeature).toBe(true)
      byName.set(d.name, d.requiredFeature)
    }
    expect(byName.size).toBe(registry.length)
  })

  it('mọi cờ trong mọi preset là cờ tồn tại trong FeatureFlags', () => {
    const known = new Set(Object.keys(DEFAULT_APP_SETTINGS.features))
    for (const preset of TOOL_PRESETS) {
      for (const flag of TOOL_PRESET_FLAGS[preset]) {
        expect(known.has(flag), `${preset} tham chiếu cờ không tồn tại: ${flag}`).toBe(true)
      }
    }
  })
})

describe('ADR 0009 — quan hệ bao hàm giữa các preset', () => {
  const flagsOf = (p: ToolPreset): Set<string> => new Set(TOOL_PRESET_FLAGS[p])
  const chuaTrong = (con: ToolPreset, cha: ToolPreset): boolean => {
    const parent = flagsOf(cha)
    return [...flagsOf(con)].every((f) => parent.has(f))
  }

  it('preset read là tập con của preset full tương ứng', () => {
    expect(chuaTrong('jira-read', 'jira-full')).toBe(true)
    expect(chuaTrong('confluence-read', 'confluence-full')).toBe(true)
    expect(chuaTrong('redmine-read', 'redmine-full')).toBe(true)
    expect(chuaTrong('xwiki-read', 'xwiki-full')).toBe(true)
  })

  it('preset read không chứa cờ nào của tool ghi', () => {
    const writeFlags = new Set(
      registry.filter((d) => d.riskLevel !== 'READ').map((d) => d.requiredFeature),
    )
    for (const preset of [
      'jira-read',
      'confluence-read',
      'redmine-read',
      'xwiki-read',
      'all-read',
    ] as const) {
      for (const flag of TOOL_PRESET_FLAGS[preset]) {
        expect(writeFlags.has(flag), `${preset} chứa cờ ghi ${flag}`).toBe(false)
      }
    }
  })

  it('`all-read` là hợp của bốn preset read', () => {
    expect(flagsOf('all-read')).toEqual(
      new Set([
        ...TOOL_PRESET_FLAGS['jira-read'],
        ...TOOL_PRESET_FLAGS['confluence-read'],
        ...TOOL_PRESET_FLAGS['redmine-read'],
        ...TOOL_PRESET_FLAGS['xwiki-read'],
      ]),
    )
  })

  it('mọi preset là tập con của `all`', () => {
    for (const preset of TOOL_PRESETS) {
      expect(chuaTrong(preset, 'all'), `${preset} không nằm trong all`).toBe(true)
    }
  })

  it('số preset khả dĩ là hữu hạn và nhỏ — tập prefix prompt cache bị chặn', () => {
    // Con số này là một cam kết thiết kế, không phải chi tiết cài đặt: xem ADR 0009. Tăng nó
    // nghĩa là tăng số prefix mà prompt cache phải giữ, nên phải là quyết định có ý thức.
    // 6 → 10 ở ADR 0010 (thêm read/full cho Redmine và XWiki).
    expect(TOOL_PRESETS).toHaveLength(10)
  })
})

describe('add-custom-agents — clampPreset chỉ thu hẹp trong tập preset đóng', () => {
  const flagsOf = (preset: ToolPreset): ReadonlySet<string> => new Set(TOOL_PRESET_FLAGS[preset])

  it('trần `all` không đổi preset nào', () => {
    for (const preset of TOOL_PRESETS) expect(clampPreset(preset, 'all')).toBe(preset)
  })

  it('preset nằm trong trần được giữ nguyên', () => {
    expect(clampPreset('jira-read', 'all-read')).toBe('jira-read')
    expect(clampPreset('redmine-read', 'redmine-full')).toBe('redmine-read')
    expect(clampPreset('all-read', 'all-read')).toBe('all-read')
  })

  it('preset vượt trần rơi về trần', () => {
    expect(clampPreset('redmine-full', 'jira-read')).toBe('jira-read')
    expect(clampPreset('all', 'all-read')).toBe('all-read')
    expect(clampPreset('jira-full', 'jira-read')).toBe('jira-read')
  })

  it('với mọi cặp: kết quả là preset có sẵn và không có cờ nào ngoài trần', () => {
    for (const ceiling of TOOL_PRESETS) {
      for (const selected of TOOL_PRESETS) {
        const result = clampPreset(selected, ceiling)
        expect(TOOL_PRESETS).toContain(result)
        const allowed = flagsOf(ceiling)
        for (const flag of TOOL_PRESET_FLAGS[result]) expect(allowed.has(flag)).toBe(true)
      }
    }
  })
})
