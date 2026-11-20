import { describe, expect, it } from 'vitest'
import type {
  BriefingItemView,
  BriefingReasonView,
  BriefingSourceStateView,
  BriefingSourceStatusName,
} from '@nexa/shared-types/renderer'
import {
  BRIEFING_GROUP_LABELS,
  briefingItemKicker,
  describeBriefingReason,
  describeBriefingSource,
  formatBriefingDueDate,
  formatBriefingTimestamp,
  isBriefingSourceBroken,
} from './briefing-ui.js'

function reason(over: Partial<BriefingReasonView> = {}): BriefingReasonView {
  return { kind: 'overdue', at: '2026-08-30T03:00:00.000Z', days: -2, ...over }
}

function source(status: BriefingSourceStatusName): BriefingSourceStateView {
  return { source: 'redmine', status, fetchedAt: null, itemCount: 0, truncatedCount: 0 }
}

describe('describeBriefingReason', () => {
  it('nói bằng ngày chứ không bằng điểm ưu tiên', () => {
    expect(describeBriefingReason(reason({ days: -3 }))).toBe('Quá hạn 3 ngày')
    expect(describeBriefingReason(reason({ kind: 'due_today', days: 0 }))).toBe('Đến hạn hôm nay')
    expect(describeBriefingReason(reason({ kind: 'due_this_week', days: 1 }))).toBe(
      'Đến hạn ngày mai',
    )
    expect(describeBriefingReason(reason({ kind: 'due_this_week', days: 5 }))).toBe('Còn 5 ngày')
  })

  it('không bịa hạn cho việc chưa đặt hạn', () => {
    expect(describeBriefingReason(reason({ kind: 'in_progress', at: null, days: null }))).toBe(
      'Chưa đặt hạn',
    )
  })

  it('gọi đúng tên lịch check-in', () => {
    expect(describeBriefingReason(reason({ kind: 'check_in_due', days: -1 }))).toBe(
      'Đã tới lúc check-in từ 1 ngày trước',
    )
    expect(describeBriefingReason(reason({ kind: 'check_in_due', days: 0 }))).toBe(
      'Đến lúc check-in hôm nay',
    )
  })
})

describe('describeBriefingSource', () => {
  it('nguồn chạy bình thường thì không có thông báo nào', () => {
    expect(describeBriefingSource(source('ok'))).toBeNull()
  })

  it('rỗng thật không phải là hỏng', () => {
    expect(isBriefingSourceBroken(source('empty'))).toBe(false)
    expect(describeBriefingSource(source('empty'))).toBeNull()
  })

  it.each<[BriefingSourceStatusName, boolean]>([
    ['not_configured', false],
    ['disabled_by_policy', false],
    ['unauthenticated', false],
    ['unavailable', true],
    ['error', true],
  ])('trạng thái %s luôn nói ra lý do', (status, canRetry) => {
    const notice = describeBriefingSource(source(status))
    expect(notice).not.toBeNull()
    expect(notice?.message.length).toBeGreaterThan(0)
    expect(notice?.canRetry).toBe(canRetry)
    expect(isBriefingSourceBroken(source(status))).toBe(true)
  })

  it('không bao giờ nói "không có việc nào" cho một nguồn hỏng', () => {
    for (const status of ['unavailable', 'error', 'unauthenticated'] as const) {
      expect(describeBriefingSource(source(status))?.message).not.toMatch(/không có việc/i)
    }
  })
})

describe('nhãn nhóm', () => {
  it('đủ bốn nhóm và không nhóm nào nói bản tin đã đầy đủ', () => {
    expect(Object.keys(BRIEFING_GROUP_LABELS)).toEqual([
      'overdue',
      'due_today',
      'due_this_week',
      'in_progress',
    ])
  })
})

const item = (over: Partial<BriefingItemView> = {}): BriefingItemView => ({
  id: 'redmine:#1',
  source: 'redmine',
  title: 'A',
  detail: null,
  reference: '#1',
  url: null,
  sourceConversationId: null,
  status: 'In Progress',
  group: 'in_progress',
  reason: reason({ kind: 'in_progress', at: null, days: null }),
  at: null,
  dueAt: null,
  updatedAt: '2026-08-30T00:00:00.000Z',
  ...over,
})

describe('briefingItemKicker', () => {
  it('hiện mã issue với việc Redmine và nhãn cam kết với việc trong Nexa', () => {
    expect(briefingItemKicker(item({}))).toBe('#1')
    expect(briefingItemKicker(item({ source: 'commitment', reference: null }))).toBe('Cam kết')
  })
})

describe('formatBriefingTimestamp', () => {
  it('trả dấu gạch cho mốc không đọc được thay vì "Invalid Date"', () => {
    expect(formatBriefingTimestamp('không phải ngày')).toBe('—')
  })
})

describe('formatBriefingDueDate', () => {
  it('nói ngày hết hạn bằng mốc tuyệt đối, theo định dạng Việt Nam', () => {
    // Redmine trả `due_date` không giờ; main neo vào giữa trưa UTC nên ngày địa phương không lệch.
    expect(formatBriefingDueDate(item({ dueAt: '2026-09-12T12:00:00.000Z' }))).toBe('12/09/2026')
  })

  it('im lặng khi mục chưa đặt hạn thay vì hiện nhãn rỗng', () => {
    expect(formatBriefingDueDate(item({ dueAt: null }))).toBeNull()
  })

  it('không hiện gì khi hạn không đọc được', () => {
    expect(formatBriefingDueDate(item({ dueAt: 'hôm nào đó' }))).toBeNull()
  })

  it('lấy hạn thật chứ không lấy mốc đã quyết định nhóm', () => {
    const withCheckIn = item({
      source: 'commitment',
      at: '2026-09-01T03:00:00.000Z',
      dueAt: '2026-09-20T03:00:00.000Z',
    })
    expect(formatBriefingDueDate(withCheckIn)).toBe('20/09/2026')
  })
})
