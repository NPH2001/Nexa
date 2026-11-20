import { describe, expect, it } from 'vitest'
import type { Connection } from '@nexa/shared-types/renderer'
import {
  SETTINGS_GROUPS,
  SETTINGS_TAB_ORDER,
  connectionStatusOf,
  groupOfTab,
  nextSettingsTab,
  onboardingSteps,
} from './settings-groups-ui.js'

const conn = (over: Partial<Connection>): Connection => ({
  id: 'c1',
  type: 'litellm',
  baseUrl: 'https://llm.local',
  username: null,
  enabled: true,
  hasCredential: true,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  ...over,
})

describe('nhóm cài đặt', () => {
  it('đủ 12 mục, mỗi mục thuộc đúng một nhóm, gom trong 4 nhóm', () => {
    expect(SETTINGS_GROUPS).toHaveLength(4)
    expect(SETTINGS_TAB_ORDER).toHaveLength(12)
    expect(new Set(SETTINGS_TAB_ORDER).size).toBe(12)
    expect(groupOfTab('jira').label).toBe('Công cụ làm việc')
  })
})

describe('nextSettingsTab', () => {
  it('đi xuống, đi lên và vòng ở hai đầu', () => {
    expect(nextSettingsTab('litellm', 'ArrowDown')).toBe('openai')
    expect(nextSettingsTab('models', 'ArrowDown')).toBe('jira')
    expect(nextSettingsTab('litellm', 'ArrowUp')).toBe('about')
    expect(nextSettingsTab('about', 'ArrowRight')).toBe('litellm')
  })

  it('Home/End tới đầu/cuối; phím khác không làm gì', () => {
    expect(nextSettingsTab('jira', 'Home')).toBe('litellm')
    expect(nextSettingsTab('jira', 'End')).toBe('about')
    expect(nextSettingsTab('jira', 'Enter')).toBeNull()
  })
})

describe('connectionStatusOf', () => {
  it('mục không phải kết nối thì không có trạng thái', () => {
    expect(connectionStatusOf('appearance', [])).toBeNull()
  })

  it('phân biệt chưa cấu hình, đã lưu chưa kiểm tra, lỗi và đã kết nối', () => {
    const checkedAt = '2026-11-02T00:00:00.000Z'
    expect(connectionStatusOf('litellm', [])).toBe('none')
    expect(connectionStatusOf('litellm', [conn({ hasCredential: false })])).toBe('none')
    expect(connectionStatusOf('litellm', [conn({})])).toBe('untested')
    expect(connectionStatusOf('litellm', [conn({ lastTest: { ok: false, checkedAt } })])).toBe(
      'error',
    )
    expect(connectionStatusOf('litellm', [conn({ lastTest: { ok: true, checkedAt } })])).toBe(
      'ok',
    )
  })
})

describe('onboardingSteps', () => {
  const checkedAt = '2026-11-02T00:00:00.000Z'

  it('lần đầu: chưa bước nào xong', () => {
    expect(onboardingSteps([], false)).toEqual({ saved: false, tested: false })
  })

  it('đã lưu nhưng chưa kiểm tra thành công thì còn bước 2', () => {
    expect(onboardingSteps([conn({})], false)).toEqual({ saved: true, tested: false })
  })

  it('ẩn khi đã có kết nối AI chạy được hoặc có model ChatGPT', () => {
    expect(onboardingSteps([conn({ lastTest: { ok: true, checkedAt } })], false)).toBeNull()
    expect(onboardingSteps([], true)).toBeNull()
  })

  it('kết nối Jira không tính là nhà cung cấp AI', () => {
    expect(onboardingSteps([conn({ type: 'jira', lastTest: { ok: true, checkedAt } })], false))
      .toEqual({ saved: false, tested: false })
  })
})
