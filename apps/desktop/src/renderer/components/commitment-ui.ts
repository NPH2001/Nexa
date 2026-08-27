import type { Commitment } from '@nexa/shared-types/renderer'

export type CommitmentAttentionTone = 'overdue' | 'soon' | 'blocked' | 'normal' | 'paused'

export interface CommitmentAttention {
  readonly tone: CommitmentAttentionTone
  readonly label: string
  readonly sortRank: number
  readonly timestamp: number
}

const HOUR_MS = 60 * 60 * 1000

export function getCommitmentAttention(
  commitment: Commitment,
  now = new Date(),
): CommitmentAttention {
  const nowMs = now.getTime()
  const dueMs = parseTime(commitment.dueAt)
  const checkInMs = parseTime(commitment.checkInAt)

  if (dueMs !== null && dueMs <= nowMs) {
    return { tone: 'overdue', label: 'Đã quá hạn', sortRank: 0, timestamp: dueMs }
  }
  if (checkInMs !== null && checkInMs <= nowMs) {
    return { tone: 'overdue', label: 'Đến lúc check-in', sortRank: 1, timestamp: checkInMs }
  }
  if (commitment.status === 'blocked') {
    return {
      tone: 'blocked',
      label: 'Đang bị chặn',
      sortRank: 2,
      timestamp: Math.min(dueMs ?? Number.POSITIVE_INFINITY, checkInMs ?? Number.POSITIVE_INFINITY),
    }
  }
  if (checkInMs !== null && checkInMs - nowMs <= 24 * HOUR_MS) {
    return { tone: 'soon', label: 'Check-in trong 24 giờ', sortRank: 3, timestamp: checkInMs }
  }
  if (dueMs !== null && dueMs - nowMs <= 48 * HOUR_MS) {
    return { tone: 'soon', label: 'Đến hạn trong 48 giờ', sortRank: 4, timestamp: dueMs }
  }
  if (commitment.status === 'paused') {
    return {
      tone: 'paused',
      label: 'Đang tạm dừng',
      sortRank: 6,
      timestamp: Math.min(dueMs ?? Number.POSITIVE_INFINITY, checkInMs ?? Number.POSITIVE_INFINITY),
    }
  }
  return {
    tone: 'normal',
    label: 'Đang thực hiện',
    sortRank: 5,
    timestamp: Math.min(dueMs ?? Number.POSITIVE_INFINITY, checkInMs ?? Number.POSITIVE_INFINITY),
  }
}

export function sortCommitmentsForToday(
  commitments: readonly Commitment[],
  now = new Date(),
): Commitment[] {
  return commitments
    .filter((commitment) => commitment.status !== 'completed' && commitment.status !== 'paused')
    .map((commitment) => ({ commitment, attention: getCommitmentAttention(commitment, now) }))
    .sort((left, right) => {
      const rankDiff = left.attention.sortRank - right.attention.sortRank
      if (rankDiff !== 0) return rankDiff
      const timeDiff = left.attention.timestamp - right.attention.timestamp
      if (Number.isFinite(timeDiff) && timeDiff !== 0) return timeDiff
      return Date.parse(right.commitment.updatedAt) - Date.parse(left.commitment.updatedAt)
    })
    .map(({ commitment }) => commitment)
}

export function toDateTimeLocalValue(iso: string | null): string {
  if (iso === null) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const offsetMs = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16)
}

export function dateTimeLocalToIso(value: string): string | null {
  if (value.trim() === '') return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

export function formatCommitmentDate(value: string | null): string {
  return value === null
    ? 'Không đặt'
    : new Date(value).toLocaleString('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
}

function parseTime(value: string | null): number | null {
  if (value === null) return null
  const time = Date.parse(value)
  return Number.isNaN(time) ? null : time
}
