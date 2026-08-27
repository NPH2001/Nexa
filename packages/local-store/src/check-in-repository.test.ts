import { afterEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { CheckInRepository, CommitmentRepository, ProfileRepository } from './index.js'
import { makeTempStore, type TempStore } from '../../../tests/support/factories.js'

let ctx: TempStore | null = null
afterEach(() => {
  ctx?.cleanup()
  ctx = null
})

describe('commitment check-ins', () => {
  it('creates migration v7 table and indexes', () => {
    ctx = makeTempStore()

    const columns = ctx.store.handle.prepare('PRAGMA table_info(commitment_check_ins)').all()
    expect(columns.map((column) => String(column['name']))).toEqual([
      'id',
      'profile_id',
      'commitment_id',
      'trigger_kind',
      'trigger_at',
      'state',
      'snoozed_until',
      'created_at',
      'updated_at',
    ])

    const indexes = ctx.store.handle.prepare('PRAGMA index_list(commitment_check_ins)').all()
    expect(indexes.map((index) => String(index['name']))).toEqual(
      expect.arrayContaining([
        'sqlite_autoindex_commitment_check_ins_2',
        'idx_commitment_check_ins_profile_state_trigger',
        'idx_commitment_check_ins_commitment',
      ]),
    )
  })

  it('reconciles triggers idempotently, preserves mute, and releases snoozes deterministically', () => {
    const nowValues = [
      '2026-08-27T08:00:00.000Z',
      '2026-08-27T08:01:00.000Z',
      '2026-08-27T08:02:00.000Z',
      '2026-08-27T08:03:00.000Z',
      '2026-08-27T08:04:00.000Z',
      '2026-08-27T08:05:00.000Z',
      '2026-08-27T08:06:00.000Z',
    ]
    let index = 0
    ctx = makeTempStore({
      now: () =>
        new Date(
          nowValues[Math.min(index++, nowValues.length - 1)] ?? nowValues[nowValues.length - 1]!,
        ),
    })
    const commitments = new CommitmentRepository(ctx.store)
    const repo = new CheckInRepository(ctx.store)
    const first = commitments.create({ profileId: ctx.profileId, title: 'A' })
    const second = commitments.create({ profileId: ctx.profileId, title: 'B' })

    const created = repo.reconcileTrigger(
      ctx.profileId,
      first.id,
      'due',
      '2026-08-28T09:00:00.000Z',
    )
    expect(created.changed).toBe(true)
    expect(created.record.state).toBe('pending')

    const same = repo.reconcileTrigger(ctx.profileId, first.id, 'due', '2026-08-28T09:00:00.000Z')
    expect(same.changed).toBe(false)
    expect(same.record.id).toBe(created.record.id)

    const snoozed = repo.respond(
      ctx.profileId,
      created.record.id,
      'snoozed',
      '2026-08-27T09:00:00.000Z',
    )
    expect(snoozed.state).toBe('snoozed')

    const resetPending = repo.reconcileTrigger(
      ctx.profileId,
      first.id,
      'check_in',
      '2026-08-29T09:00:00.000Z',
    )
    expect(resetPending.record.state).toBe('pending')
    expect(resetPending.record.snoozedUntil).toBeNull()

    const muted = repo.respond(ctx.profileId, created.record.id, 'muted')
    expect(muted.state).toBe('muted')

    const keptMuted = repo.reconcileTrigger(
      ctx.profileId,
      first.id,
      'due',
      '2026-08-30T09:00:00.000Z',
    )
    expect(keptMuted.record.state).toBe('muted')
    expect(keptMuted.record.triggerAt).toBe('2026-08-30T09:00:00.000Z')

    const secondCreated = repo.reconcileTrigger(
      ctx.profileId,
      second.id,
      'check_in',
      '2026-08-27T08:30:00.000Z',
    )
    repo.respond(ctx.profileId, secondCreated.record.id, 'snoozed', '2026-08-27T08:45:00.000Z')

    const released = repo.releaseSnoozed(ctx.profileId, '2026-08-27T08:50:00.000Z')
    expect(released.map((record) => record.id)).toEqual([secondCreated.record.id])
    expect(repo.listPending(ctx.profileId).map((record) => record.id)).toEqual([
      secondCreated.record.id,
    ])

    const unmuted = repo.unmute(ctx.profileId, first.id)
    expect(unmuted.state).toBe('pending')

    expect(repo.list(ctx.profileId).map((record) => record.id)).toEqual([
      secondCreated.record.id,
      created.record.id,
    ])
  })

  it('enforces profile ownership and cascades on purge', () => {
    ctx = makeTempStore()
    const commitments = new CommitmentRepository(ctx.store)
    const repo = new CheckInRepository(ctx.store)
    const first = commitments.create({ profileId: ctx.profileId, title: 'A' })
    repo.reconcileTrigger(ctx.profileId, first.id, 'due', '2026-08-28T09:00:00.000Z')

    const otherProfile = new ProfileRepository(ctx.store).ensure(
      `other-${randomUUID()}`,
      'Other profile',
    )
    const otherCommitment = commitments.create({ profileId: otherProfile.id, title: 'B' })

    const activeCtx = ctx
    expect(() =>
      repo.reconcileTrigger(
        activeCtx.profileId,
        otherCommitment.id,
        'due',
        '2026-08-28T10:00:00.000Z',
      ),
    ).toThrow('Dữ liệu gửi lên không hợp lệ.')

    activeCtx.store.purgeProfile(activeCtx.profileId)
    expect(
      Number(
        activeCtx.store.handle.prepare('SELECT COUNT(*) AS c FROM commitment_check_ins').get()?.[
          'c'
        ],
      ),
    ).toBe(0)
  })
})
