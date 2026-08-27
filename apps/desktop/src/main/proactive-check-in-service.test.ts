import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_APP_SETTINGS, type AppSettings } from '@nexa/shared-types'
import { ActivityRepository, CheckInRepository, CommitmentRepository } from '@nexa/local-store'
import type { SettingsService } from '@nexa/connection-config'
import {
  fakeClock,
  makeTempStore,
  testLogger,
  type TempStore,
} from '../../../../tests/support/factories.js'
import { ProactiveCheckInService } from './proactive-check-in-service.js'

let ctx: TempStore | null = null

afterEach(() => {
  ctx?.cleanup()
  ctx = null
})

function makeSettings(enabled: () => boolean): SettingsService {
  return {
    get: (): AppSettings => ({
      ...DEFAULT_APP_SETTINGS,
      proactiveCheckInsEnabled: enabled(),
    }),
  } as SettingsService
}

describe('ProactiveCheckInService', () => {
  it('khong reconcile hoac tao timer khi opt-in dang tat', () => {
    const clock = fakeClock('2026-08-27T08:00:00.000Z')
    ctx = makeTempStore({ now: clock.now })
    const commitments = new CommitmentRepository(ctx.store)
    commitments.create({
      profileId: ctx.profileId,
      title: 'Gui ban pilot',
      dueAt: '2026-08-27T07:00:00.000Z',
    })
    const setIntervalFn = vi.fn()
    const service = new ProactiveCheckInService({
      profileId: ctx.profileId,
      store: ctx.store,
      repository: new CheckInRepository(ctx.store),
      commitments,
      activity: new ActivityRepository(ctx.store),
      settings: makeSettings(() => false),
      logger: testLogger().logger,
      now: clock.now,
      setIntervalFn,
    })

    service.start()

    expect(setIntervalFn).not.toHaveBeenCalled()
    expect(service.list()).toEqual({ enabled: false, suggestions: [] })
    expect(
      Number(
        ctx.store.handle.prepare('SELECT COUNT(*) AS count FROM commitment_check_ins').get()?.[
          'count'
        ],
      ),
    ).toBe(0)
  })

  it('derive dung trigger hien tai, idempotent va khong mutate commitment', () => {
    const clock = fakeClock('2026-08-27T08:00:00.000Z')
    ctx = makeTempStore({ now: clock.now })
    const commitments = new CommitmentRepository(ctx.store)
    const commitment = commitments.create({
      profileId: ctx.profileId,
      title: 'Chot rollout',
      nextAction: 'Kiem tra UAT',
      dueAt: '2026-08-27T06:00:00.000Z',
      checkInAt: '2026-08-27T07:00:00.000Z',
    })
    commitments.create({
      profileId: ctx.profileId,
      title: 'Viec tuong lai',
      dueAt: '2026-08-28T08:00:00.000Z',
    })
    commitments.create({
      profileId: ctx.profileId,
      title: 'Dang tam dung',
      status: 'paused',
      dueAt: '2026-08-27T07:00:00.000Z',
    })
    const activity = new ActivityRepository(ctx.store)
    const timer = { unref: vi.fn() } as unknown as NodeJS.Timeout
    const setIntervalFn = vi.fn(() => timer)
    const service = new ProactiveCheckInService({
      profileId: ctx.profileId,
      store: ctx.store,
      repository: new CheckInRepository(ctx.store),
      commitments,
      activity,
      settings: makeSettings(() => true),
      logger: testLogger().logger,
      now: clock.now,
      setIntervalFn,
    })
    const before = commitments.get(commitment.id)

    service.start()
    service.reconcile()

    expect(setIntervalFn).toHaveBeenCalledOnce()
    expect(timer.unref).toHaveBeenCalledOnce()
    expect(service.list()).toMatchObject({
      enabled: true,
      suggestions: [
        {
          commitmentId: commitment.id,
          triggerKind: 'check_in',
          triggerAt: '2026-08-27T07:00:00.000Z',
          state: 'pending',
        },
      ],
    })
    expect(activity.list(ctx.profileId, { limit: 20, offset: 0 })).toHaveLength(1)
    expect(commitments.get(commitment.id)).toEqual(before)

    commitments.update(commitment.id, {
      dueAt: '2026-08-28T08:00:00.000Z',
      checkInAt: null,
    })
    service.reconcile()
    expect(service.list().suggestions).toEqual([])
  })

  it('snooze, mute va unmute chi thay doi local suggestion state', () => {
    const clock = fakeClock('2026-08-27T08:00:00.000Z')
    ctx = makeTempStore({ now: clock.now })
    const commitments = new CommitmentRepository(ctx.store)
    const commitment = commitments.create({
      profileId: ctx.profileId,
      title: 'Theo doi pilot',
      dueAt: '2026-08-27T07:00:00.000Z',
    })
    const activity = new ActivityRepository(ctx.store)
    const service = new ProactiveCheckInService({
      profileId: ctx.profileId,
      store: ctx.store,
      repository: new CheckInRepository(ctx.store),
      commitments,
      activity,
      settings: makeSettings(() => true),
      logger: testLogger().logger,
      now: clock.now,
    })
    service.reconcile()
    const initial = service.list().suggestions[0]
    expect(initial).toBeDefined()
    const commitmentBefore = commitments.get(commitment.id)

    expect(service.respond(initial!.id, 'snoozed', 60)).toMatchObject({
      state: 'snoozed',
      snoozedUntil: '2026-08-27T09:00:00.000Z',
    })
    clock.advance(60 * 60 * 1000)
    service.reconcile()
    expect(service.list().suggestions[0]?.state).toBe('pending')

    expect(service.respond(initial!.id, 'muted')).toMatchObject({ state: 'muted' })
    commitments.update(commitment.id, { dueAt: '2026-08-27T08:30:00.000Z' })
    service.reconcile()
    expect(service.list().suggestions[0]?.state).toBe('muted')

    expect(service.unmute(commitment.id)).toMatchObject({ state: 'pending' })
    expect(commitments.get(commitment.id)).toMatchObject({
      title: commitmentBefore?.title,
      nextAction: commitmentBefore?.nextAction,
      status: commitmentBefore?.status,
      sourceConversationId: commitmentBefore?.sourceConversationId,
      dueAt: '2026-08-27T08:30:00.000Z',
    })
    const actions = activity
      .list(ctx.profileId, { limit: 20, offset: 0 })
      .map((event) => event.action)
    expect(actions).toEqual(expect.arrayContaining(['generated', 'snoozed', 'muted', 'unmuted']))
    expect(actions.filter((action) => action === 'generated')).toHaveLength(2)
  })

  it('dung timer ngay khi opt-in bi tat', () => {
    const clock = fakeClock()
    ctx = makeTempStore({ now: clock.now })
    let enabled = true
    const timer = { unref: vi.fn() } as unknown as NodeJS.Timeout
    const clearIntervalFn = vi.fn()
    const service = new ProactiveCheckInService({
      profileId: ctx.profileId,
      store: ctx.store,
      repository: new CheckInRepository(ctx.store),
      commitments: new CommitmentRepository(ctx.store),
      activity: new ActivityRepository(ctx.store),
      settings: makeSettings(() => enabled),
      logger: testLogger().logger,
      now: clock.now,
      setIntervalFn: vi.fn(() => timer),
      clearIntervalFn,
    })

    service.start()
    enabled = false
    service.reconfigure()

    expect(clearIntervalFn).toHaveBeenCalledWith(timer)
  })
})
