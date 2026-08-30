import { describe, expect, it } from 'vitest'
import { IPC_CHANNEL_NAMES, NEXA_EVENTS } from './channels.js'
import { DEFAULT_APP_SETTINGS } from './settings.js'
import {
  activityListSchema,
  checkInRespondSchema,
  commitmentCreateSchema,
  commitmentUpdateSchema,
  memoryCreateSchema,
  memoryUpdateSchema,
} from './ipc.js'

describe('memory IPC schemas', () => {
  it('áp default an toàn cho memory create', () => {
    expect(memoryCreateSchema.parse({ content: 'Gọi tôi là Hoàng' })).toEqual({
      content: 'Gọi tôi là Hoàng',
      kind: 'preference',
      scope: 'global',
      sharingPolicy: 'internal_only',
    })
  })

  it('bắt sourceConversationId khi scope là conversation', () => {
    expect(() =>
      memoryCreateSchema.parse({
        content: 'Dùng hội thoại này làm bối cảnh',
        scope: 'conversation',
      }),
    ).toThrow(/sourceConversationId/i)
  })

  it('từ chối update không có thay đổi', () => {
    expect(() => memoryUpdateSchema.parse({ id: '91f4f2a1-46a7-4ab4-b596-c0d53bb8708d' })).toThrow(
      /At least one editable memory field/i,
    )
  })

  it('cho phép update khi có ít nhất một thay đổi hợp lệ', () => {
    expect(
      memoryUpdateSchema.parse({
        id: '91f4f2a1-46a7-4ab4-b596-c0d53bb8708d',
        expiresAt: '2026-09-01T00:00:00.000Z',
      }),
    ).toEqual({
      id: '91f4f2a1-46a7-4ab4-b596-c0d53bb8708d',
      expiresAt: '2026-09-01T00:00:00.000Z',
    })
  })
})

describe('commitment IPC schemas', () => {
  it('applies safe defaults and trims user-authored content', () => {
    expect(commitmentCreateSchema.parse({ title: '  Hoàn tất pilot  ' })).toEqual({
      title: 'Hoàn tất pilot',
      nextAction: null,
      status: 'active',
      dueAt: null,
      checkInAt: null,
      sourceConversationId: null,
    })
  })

  it('rejects an empty update', () => {
    expect(() =>
      commitmentUpdateSchema.parse({ id: '91f4f2a1-46a7-4ab4-b596-c0d53bb8708d' }),
    ).toThrow(/At least one editable commitment field/i)
  })

  it('accepts reversible lifecycle and nullable scheduling changes', () => {
    expect(
      commitmentUpdateSchema.parse({
        id: '91f4f2a1-46a7-4ab4-b596-c0d53bb8708d',
        status: 'completed',
        dueAt: null,
      }),
    ).toEqual({
      id: '91f4f2a1-46a7-4ab4-b596-c0d53bb8708d',
      status: 'completed',
      dueAt: null,
    })
  })
})

describe('check-in IPC schemas', () => {
  it('keeps proactive check-ins opt-in for every new profile', () => {
    expect(DEFAULT_APP_SETTINGS.proactiveCheckInsEnabled).toBe(false)
  })

  it('keeps agent commitment writes opt-in but commitment context on by default', () => {
    // Ghi dữ liệu người dùng là quyền mới ⇒ opt-in. Đọc để trả lời sát hơn thì không.
    expect(DEFAULT_APP_SETTINGS.agentCommitmentToolsEnabled).toBe(false)
    expect(DEFAULT_APP_SETTINGS.commitmentContextEnabled).toBe(true)
  })

  it('requires snoozeMinutes only for snoozed actions', () => {
    expect(
      checkInRespondSchema.parse({
        id: '91f4f2a1-46a7-4ab4-b596-c0d53bb8708d',
        action: 'snoozed',
        snoozeMinutes: 1440,
      }),
    ).toEqual({
      id: '91f4f2a1-46a7-4ab4-b596-c0d53bb8708d',
      action: 'snoozed',
      snoozeMinutes: 1440,
    })

    expect(() =>
      checkInRespondSchema.parse({
        id: '91f4f2a1-46a7-4ab4-b596-c0d53bb8708d',
        action: 'snoozed',
      }),
    ).toThrow(/snoozeMinutes/i)

    expect(() =>
      checkInRespondSchema.parse({
        id: '91f4f2a1-46a7-4ab4-b596-c0d53bb8708d',
        action: 'acted',
        snoozeMinutes: 60,
      }),
    ).toThrow(/snoozeMinutes/i)
  })

  it('applies safe defaults for activity listing', () => {
    expect(activityListSchema.parse({})).toEqual({ limit: 200, offset: 0 })
  })
})

describe('shared IPC allowlists', () => {
  it('publishes check-in and activity channels to preload', () => {
    expect(IPC_CHANNEL_NAMES).toEqual(
      expect.arrayContaining([
        'checkin:list',
        'checkin:setEnabled',
        'checkin:respond',
        'checkin:unmute',
        'activity:list',
      ]),
    )
  })

  it('publishes check-in refresh events to renderer', () => {
    expect(NEXA_EVENTS.checkInsChanged).toBe('nexa:checkins-changed')
  })
})
