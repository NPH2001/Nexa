import { describe, expect, it } from 'vitest'
import {
  DEFAULT_APP_SETTINGS,
  TOOL_PRESETS,
  TOOL_PRESET_FLAGS,
  type FeatureFlags,
  type ToolPreset,
} from '@nexa/shared-types'
import { buildToolRegistry } from '@nexa/atlassian-mcp-manager'

/**
 * Bảng preset (ADR 0009) là một bản sao thủ công của cách 12 feature flag chia 98 tool. Bản sao
 * thủ công thì trôi. Các test dưới đây là chốt chống trôi — chúng đỏ khi có người thêm cờ tool
 * mới, đổi tên cờ, hoặc gán một tool sang cờ chưa nằm trong preset nào.
 */

const registry = buildToolRegistry({
  jiraBaseUrl: 'https://jira.internal',
  confluenceBaseUrl: 'https://confluence.internal',
})

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
  })

  it('`all-read` là hợp của hai preset read', () => {
    expect(flagsOf('all-read')).toEqual(
      new Set([...TOOL_PRESET_FLAGS['jira-read'], ...TOOL_PRESET_FLAGS['confluence-read']]),
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
    expect(TOOL_PRESETS).toHaveLength(6)
  })
})
