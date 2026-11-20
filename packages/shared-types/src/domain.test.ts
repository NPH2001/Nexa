import { describe, expect, it } from 'vitest'
import { CONNECTION_TYPES, isLlmConnection, requiresUsername } from './domain.js'
import { DEFAULT_APP_SETTINGS } from './settings.js'
import { TOOL_PRESET_FLAGS } from './tools.js'

describe('loại kết nối Redmine/XWiki', () => {
  it('có trong CONNECTION_TYPES', () => {
    expect(CONNECTION_TYPES).toContain('redmine')
    expect(CONNECTION_TYPES).toContain('xwiki')
  })

  it('không phải LLM provider và không bắt nhập username', () => {
    for (const type of ['redmine', 'xwiki'] as const) {
      expect(isLlmConnection(type)).toBe(false)
      // Redmine xác thực bằng API key, XWiki bằng bearer token — không có username.
      expect(requiresUsername(type)).toBe(false)
    }
  })

  it('Jira/Confluence vẫn bắt nhập username', () => {
    expect(requiresUsername('jira')).toBe(true)
    expect(requiresUsername('confluence')).toBe(true)
  })
})

describe('cờ tool Redmine/XWiki', () => {
  it('settings cũ không có cờ mới vẫn nhận giá trị mặc định', () => {
    const f = DEFAULT_APP_SETTINGS.features
    expect(f.redmineRead).toBe(true)
    expect(f.redmineWrite).toBe(true)
    expect(f.redmineUpdate).toBe(true)
    expect(f.xwikiRead).toBe(true)
    expect(f.xwikiWrite).toBe(true)
  })

  it('preset read không chứa cờ ghi', () => {
    expect(TOOL_PRESET_FLAGS['redmine-read']).toEqual(['redmineRead'])
    expect(TOOL_PRESET_FLAGS['xwiki-read']).toEqual(['xwikiRead'])
    expect(TOOL_PRESET_FLAGS['all-read']).not.toContain('redmineWrite')
    expect(TOOL_PRESET_FLAGS['all-read']).not.toContain('xwikiWrite')
  })

  it('preset all chứa mọi cờ Redmine/XWiki', () => {
    for (const flag of [
      'redmineRead',
      'redmineWrite',
      'redmineUpdate',
      'xwikiRead',
      'xwikiWrite',
    ] as const) {
      expect(TOOL_PRESET_FLAGS.all).toContain(flag)
    }
  })
})
