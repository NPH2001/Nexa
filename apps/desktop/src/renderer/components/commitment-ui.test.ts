import { describe, expect, it } from 'vitest'
import type { Commitment } from '@nexa/shared-types/renderer'
import {
  dateTimeLocalToIso,
  getCommitmentAttention,
  sortCommitmentsForToday,
  toDateTimeLocalValue,
} from './commitment-ui.js'

const makeCommitment = (overrides: Partial<Commitment> = {}): Commitment => ({
  id: '00000000-0000-4000-8000-000000000111',
  profileId: 'profile-test',
  title: 'Commitment',
  nextAction: null,
  status: 'active',
  dueAt: null,
  checkInAt: null,
  completedAt: null,
  sourceConversationId: null,
  createdBy: 'user',
  createdAt: '2026-08-26T00:00:00.000Z',
  updatedAt: '2026-08-26T00:00:00.000Z',
  ...overrides,
})

describe('commitment attention', () => {
  const now = new Date('2026-08-27T10:00:00.000Z')

  it('explains overdue due dates without an opaque score', () => {
    expect(
      getCommitmentAttention(
        makeCommitment({ dueAt: '2026-08-27T09:59:00.000Z' }),
        now,
      ),
    ).toMatchObject({ tone: 'overdue', label: 'Đã quá hạn', sortRank: 0 })
  })

  it('prioritizes overdue, check-in and blocked work while hiding paused/completed items', () => {
    const sorted = sortCommitmentsForToday(
      [
        makeCommitment({ id: 'normal', updatedAt: '2026-08-27T09:00:00.000Z' }),
        makeCommitment({
          id: 'check-in',
          checkInAt: '2026-08-27T09:00:00.000Z',
        }),
        makeCommitment({ id: 'blocked', status: 'blocked' }),
        makeCommitment({ id: 'overdue', dueAt: '2026-08-26T10:00:00.000Z' }),
        makeCommitment({ id: 'paused', status: 'paused' }),
        makeCommitment({ id: 'completed', status: 'completed' }),
      ],
      now,
    )

    expect(sorted.map((item) => item.id)).toEqual(['overdue', 'check-in', 'blocked', 'normal'])
  })

  it('round-trips datetime-local values through an ISO timestamp', () => {
    const iso = '2026-08-27T10:30:00.000Z'
    expect(dateTimeLocalToIso(toDateTimeLocalValue(iso))).toBe(iso)
    expect(dateTimeLocalToIso('')).toBeNull()
  })
})
