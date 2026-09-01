import { describe, expect, it } from 'vitest'
import { buildBriefing } from './build.js'
import {
  BRIEFING_GROUPS,
  type BriefingCommitmentInput,
  type BriefingGroup,
  type BriefingInput,
  type BriefingIssueInput,
} from './model.js'

const VN_OFFSET = 420
const NOW = new Date('2026-09-01T03:00:00.000Z') // 10:00 ngày 01/09 giờ Việt Nam

function commitment(over: Partial<BriefingCommitmentInput> = {}): BriefingCommitmentInput {
  return {
    id: 'c1',
    title: 'Chốt hợp đồng ABBANK',
    nextAction: 'Gửi bản cuối cho pháp chế',
    status: 'active',
    dueAt: null,
    checkInAt: null,
    sourceConversationId: null,
    updatedAt: '2026-08-30T02:00:00.000Z',
    ...over,
  }
}

function issue(over: Partial<BriefingIssueInput> = {}): BriefingIssueInput {
  return {
    key: 'DT-1',
    summary: 'Sửa lỗi đăng nhập',
    statusName: 'In Progress',
    dueAt: null,
    updatedAt: '2026-08-31T02:00:00.000Z',
    inActiveSprint: false,
    ...over,
  }
}

function build(over: Partial<BriefingInput> = {}) {
  return buildBriefing({
    now: NOW,
    timeZoneOffsetMinutes: VN_OFFSET,
    commitments: [],
    issues: [],
    ...over,
  })
}

function groupOf(briefing: ReturnType<typeof build>, id: string): BriefingGroup | undefined {
  return briefing.groups.find((g) => g.items.some((item) => item.id === id))?.group
}

function itemOf(briefing: ReturnType<typeof build>, id: string) {
  return briefing.groups.flatMap((g) => g.items).find((item) => item.id === id)
}

describe('buildBriefing — nhóm theo mức khẩn', () => {
  it('luôn trả đủ bốn nhóm theo đúng thứ tự, kể cả khi rỗng', () => {
    const briefing = build()
    expect(briefing.groups.map((g) => g.group)).toEqual([...BRIEFING_GROUPS])
    expect(briefing.totalItems).toBe(0)
  })

  it('xếp cam kết quá hạn từ hôm qua vào overdue kèm số ngày âm', () => {
    const briefing = build({
      commitments: [commitment({ dueAt: '2026-08-31T03:00:00.000Z' })],
    })
    expect(groupOf(briefing, 'commitment:c1')).toBe('overdue')
    expect(itemOf(briefing, 'commitment:c1')?.reason).toMatchObject({ kind: 'overdue', days: -1 })
  })

  it('xếp việc đến hạn hôm nay vào due_today', () => {
    const briefing = build({
      commitments: [commitment({ dueAt: '2026-09-01T09:00:00.000Z' })],
    })
    expect(groupOf(briefing, 'commitment:c1')).toBe('due_today')
    expect(itemOf(briefing, 'commitment:c1')?.reason.days).toBe(0)
  })

  it('xếp việc trong bảy ngày tới vào due_this_week', () => {
    const briefing = build({ commitments: [commitment({ dueAt: '2026-09-05T03:00:00.000Z' })] })
    expect(groupOf(briefing, 'commitment:c1')).toBe('due_this_week')
    expect(itemOf(briefing, 'commitment:c1')?.reason.days).toBe(4)
  })

  it('đưa việc có hạn xa hơn bảy ngày về in_progress nhưng giữ nguyên mốc', () => {
    const briefing = build({ commitments: [commitment({ dueAt: '2026-10-01T03:00:00.000Z' })] })
    expect(groupOf(briefing, 'commitment:c1')).toBe('in_progress')
    expect(itemOf(briefing, 'commitment:c1')?.at).toBe('2026-10-01T03:00:00.000Z')
  })

  it('cam kết không có mốc nào nằm ở in_progress và không bị gán hạn giả', () => {
    const briefing = build({ commitments: [commitment()] })
    expect(groupOf(briefing, 'commitment:c1')).toBe('in_progress')
    const item = itemOf(briefing, 'commitment:c1')
    expect(item?.at).toBeNull()
    expect(item?.reason).toMatchObject({ kind: 'in_progress', at: null, days: null })
  })
})

describe('buildBriefing — check-in', () => {
  it('gọi tên check_in_due khi lịch quay lại đã tới hạn', () => {
    const briefing = build({
      commitments: [commitment({ checkInAt: '2026-08-30T03:00:00.000Z' })],
    })
    expect(groupOf(briefing, 'commitment:c1')).toBe('overdue')
    expect(itemOf(briefing, 'commitment:c1')?.reason.kind).toBe('check_in_due')
  })

  it('lấy mốc tới trước khi có cả hạn lẫn lịch check-in', () => {
    const briefing = build({
      commitments: [
        commitment({ dueAt: '2026-08-28T03:00:00.000Z', checkInAt: '2026-09-08T03:00:00.000Z' }),
      ],
    })
    expect(groupOf(briefing, 'commitment:c1')).toBe('overdue')
    // Hạn tới trước nên nó mới là lý do, không phải lịch check-in tuần sau.
    expect(itemOf(briefing, 'commitment:c1')?.reason.kind).toBe('overdue')
  })

  it('không gọi là check_in_due khi lịch quay lại còn xa', () => {
    const briefing = build({
      commitments: [commitment({ checkInAt: '2026-09-04T03:00:00.000Z' })],
    })
    expect(itemOf(briefing, 'commitment:c1')?.reason.kind).toBe('due_this_week')
  })
})

describe('buildBriefing — ranh giới ngày địa phương', () => {
  it('tính hôm nay theo giờ máy chứ không theo UTC', () => {
    // 2026-09-01T18:00Z là 01:00 ngày 02/09 ở Việt Nam ⇒ đã sang ngày mới.
    const late = new Date('2026-09-01T18:00:00.000Z')
    const briefing = buildBriefing({
      now: late,
      timeZoneOffsetMinutes: VN_OFFSET,
      commitments: [commitment({ dueAt: '2026-09-01T15:00:00.000Z' })],
      issues: [],
    })
    expect(briefing.localDate).toBe('2026-09-02')
    expect(groupOf(briefing, 'commitment:c1')).toBe('overdue')
  })

  it('cùng một mốc rơi vào nhóm khác nhau ở hai múi giờ khác nhau', () => {
    const due = '2026-09-01T20:00:00.000Z' // 03:00 ngày 02/09 giờ VN, còn 20:00 ngày 01/09 giờ UTC
    const vn = buildBriefing({
      now: NOW,
      timeZoneOffsetMinutes: VN_OFFSET,
      commitments: [commitment({ dueAt: due })],
      issues: [],
    })
    const utc = buildBriefing({
      now: NOW,
      timeZoneOffsetMinutes: 0,
      commitments: [commitment({ dueAt: due })],
      issues: [],
    })
    expect(groupOf(vn, 'commitment:c1')).toBe('due_this_week')
    expect(groupOf(utc, 'commitment:c1')).toBe('due_today')
  })

  it('xử lý được offset âm', () => {
    const briefing = buildBriefing({
      now: NOW, // 2026-08-31T22:00 giờ New York (UTC-5)
      timeZoneOffsetMinutes: -300,
      commitments: [commitment({ dueAt: '2026-09-01T02:00:00.000Z' })],
      issues: [],
    })
    expect(briefing.localDate).toBe('2026-08-31')
    expect(groupOf(briefing, 'commitment:c1')).toBe('due_today')
  })
})

describe('buildBriefing — thứ tự', () => {
  it('xếp mốc gần nhất lên trước trong nhóm có hạn', () => {
    const briefing = build({
      commitments: [
        commitment({ id: 'muon', dueAt: '2026-08-25T03:00:00.000Z' }),
        commitment({ id: 'gan', dueAt: '2026-08-31T03:00:00.000Z' }),
      ],
    })
    const overdue = briefing.groups.find((g) => g.group === 'overdue')
    expect(overdue?.items.map((i) => i.id)).toEqual(['commitment:muon', 'commitment:gan'])
  })

  it('đưa issue thuộc sprint đang chạy lên trước trong in_progress', () => {
    const briefing = build({
      issues: [
        issue({ key: 'DT-2', inActiveSprint: false, updatedAt: '2026-08-31T09:00:00.000Z' }),
        issue({ key: 'DT-3', inActiveSprint: true, updatedAt: '2026-08-20T09:00:00.000Z' }),
      ],
    })
    const inProgress = briefing.groups.find((g) => g.group === 'in_progress')
    expect(inProgress?.items.map((i) => i.id)).toEqual(['jira:DT-3', 'jira:DT-2'])
  })

  it('trong in_progress, việc có hạn đứng trước việc không có hạn', () => {
    const briefing = build({
      issues: [
        issue({ key: 'DT-4', dueAt: null }),
        issue({ key: 'DT-5', dueAt: '2026-10-01T03:00:00.000Z' }),
      ],
    })
    const inProgress = briefing.groups.find((g) => g.group === 'in_progress')
    expect(inProgress?.items.map((i) => i.id)).toEqual(['jira:DT-5', 'jira:DT-4'])
  })

  it('deterministic: dựng hai lần cho cùng một kết quả', () => {
    const input: BriefingInput = {
      now: NOW,
      timeZoneOffsetMinutes: VN_OFFSET,
      commitments: [
        commitment({ id: 'a', dueAt: '2026-08-31T03:00:00.000Z' }),
        commitment({ id: 'b' }),
      ],
      issues: [issue({ key: 'DT-9', dueAt: '2026-09-01T03:00:00.000Z' }), issue({ key: 'DT-8' })],
    }
    expect(buildBriefing(input)).toEqual(buildBriefing(input))
  })

  it('mục ngang điểm vẫn có thứ tự ổn định theo id', () => {
    const sameUpdate = '2026-08-31T02:00:00.000Z'
    const first = build({
      issues: [
        issue({ key: 'DT-7', updatedAt: sameUpdate }),
        issue({ key: 'DT-6', updatedAt: sameUpdate }),
      ],
    })
    const second = build({
      issues: [
        issue({ key: 'DT-6', updatedAt: sameUpdate }),
        issue({ key: 'DT-7', updatedAt: sameUpdate }),
      ],
    })
    const ids = (b: typeof first) =>
      b.groups.find((g) => g.group === 'in_progress')?.items.map((i) => i.id)
    expect(ids(first)).toEqual(['jira:DT-6', 'jira:DT-7'])
    expect(ids(second)).toEqual(ids(first))
  })
})

describe('buildBriefing — trần số mục', () => {
  it('cắt theo trần từng nhóm và đếm phần bị cắt', () => {
    const briefing = build({
      maxItemsPerGroup: 2,
      issues: [
        issue({ key: 'DT-1', dueAt: '2026-09-01T01:00:00.000Z' }),
        issue({ key: 'DT-2', dueAt: '2026-09-01T02:00:00.000Z' }),
        issue({ key: 'DT-3', dueAt: '2026-09-01T03:00:00.000Z' }),
      ],
    })
    const dueToday = briefing.groups.find((g) => g.group === 'due_today')
    expect(dueToday?.items.map((i) => i.id)).toEqual(['jira:DT-1', 'jira:DT-2'])
    expect(dueToday?.truncatedCount).toBe(1)
    expect(briefing.totalItems).toBe(2)
    expect(briefing.truncatedTotal).toBe(1)
  })

  it('giữ mục khẩn nhất khi phải cắt', () => {
    const briefing = build({
      maxItemsPerGroup: 1,
      commitments: [
        commitment({ id: 'cu', dueAt: '2026-08-20T03:00:00.000Z' }),
        commitment({ id: 'moi', dueAt: '2026-08-31T03:00:00.000Z' }),
      ],
    })
    const overdue = briefing.groups.find((g) => g.group === 'overdue')
    expect(overdue?.items.map((i) => i.id)).toEqual(['commitment:cu'])
    expect(overdue?.truncatedCount).toBe(1)
  })
})

describe('buildBriefing — chuẩn hoá hai nguồn', () => {
  it('giữ hội thoại nguồn của cam kết và issue key của Jira', () => {
    const briefing = build({
      commitments: [commitment({ sourceConversationId: 'conv-1' })],
      issues: [issue({ key: 'DT-42' })],
    })
    expect(itemOf(briefing, 'commitment:c1')).toMatchObject({
      source: 'commitment',
      sourceConversationId: 'conv-1',
      reference: null,
      detail: 'Gửi bản cuối cho pháp chế',
    })
    expect(itemOf(briefing, 'jira:DT-42')).toMatchObject({
      source: 'jira',
      reference: 'DT-42',
      sourceConversationId: null,
      detail: 'In Progress',
    })
  })

  it('bỏ qua mốc thời gian không parse được thay vì ném lỗi', () => {
    const briefing = build({ commitments: [commitment({ dueAt: 'hôm nào đó' })] })
    expect(groupOf(briefing, 'commitment:c1')).toBe('in_progress')
    expect(itemOf(briefing, 'commitment:c1')?.reason.days).toBeNull()
  })
})
