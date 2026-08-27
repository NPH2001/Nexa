import { afterEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { ActivityRepository, ProfileRepository } from './index.js'
import { makeTempStore, type TempStore } from '../../../tests/support/factories.js'

let ctx: TempStore | null = null
afterEach(() => {
  ctx?.cleanup()
  ctx = null
})

describe('activity timeline repository', () => {
  it('adds v7 local_audit columns and indexes without payload columns', () => {
    ctx = makeTempStore()

    const columns = ctx.store.handle.prepare('PRAGMA table_info(local_audit)').all()
    expect(columns.map((column) => String(column['name']))).toEqual(
      expect.arrayContaining(['activity_type', 'activity_action', 'subject_type', 'subject_id']),
    )
    expect(columns.map((column) => String(column['name']))).not.toEqual(
      expect.arrayContaining(['subject_label', 'payload', 'raw_payload']),
    )

    const indexes = ctx.store.handle.prepare('PRAGMA index_list(local_audit)').all()
    expect(indexes.map((index) => String(index['name']))).toEqual(
      expect.arrayContaining([
        'idx_local_audit_profile_created',
        'idx_local_audit_profile_type_created',
        'idx_local_audit_profile_status_created',
      ]),
    )
  })

  it('records enum-only activity data, filters by profile/type/status, and orders newest first', () => {
    ctx = makeTempStore()
    const repo = new ActivityRepository(ctx.store)
    const otherProfile = new ProfileRepository(ctx.store).ensure(
      `other-${randomUUID()}`,
      'Other profile',
    )

    repo.record({
      profileId: ctx.profileId,
      type: 'suggestion',
      action: 'generated',
      status: 'pending',
      subjectType: 'commitment',
      subjectId: '11111111-1111-4111-8111-111111111111',
      requestId: 'req_1',
    })
    repo.record({
      profileId: ctx.profileId,
      type: 'tool_result',
      action: 'completed',
      status: 'success',
      subjectType: 'tool',
      subjectId: '22222222-2222-4222-8222-222222222222',
      operationId: '33333333-3333-4333-8333-333333333333',
    })
    repo.record({
      profileId: otherProfile.id,
      type: 'memory_mutation',
      action: 'updated',
      status: 'success',
      subjectType: 'memory',
      subjectId: '44444444-4444-4444-8444-444444444444',
    })

    ctx.store.handle
      .prepare(
        `UPDATE local_audit SET created_at = '2026-08-27T08:00:00.000Z' WHERE request_id = 'req_1'`,
      )
      .run()
    ctx.store.handle
      .prepare(
        `UPDATE local_audit
         SET created_at = '2026-08-27T08:01:00.000Z'
         WHERE operation_id = '33333333-3333-4333-8333-333333333333'`,
      )
      .run()

    const all = repo.list(ctx.profileId, { limit: 200, offset: 0 })
    expect(all).toHaveLength(2)
    expect(all.map((event) => event.type)).toEqual(['tool_result', 'suggestion'])
    expect(all[0]).toMatchObject({
      action: 'completed',
      status: 'success',
      subjectType: 'tool',
      subjectLabel: null,
    })

    const filtered = repo.list(ctx.profileId, {
      type: 'suggestion',
      status: 'pending',
      limit: 200,
      offset: 0,
    })
    expect(filtered).toHaveLength(1)
    expect(filtered[0]?.requestId).toBe('req_1')

    const row = ctx.store.handle
      .prepare(
        `SELECT event_type, activity_type, activity_action, subject_type, subject_id
         FROM local_audit WHERE request_id = 'req_1'`,
      )
      .get()
    expect(row).toEqual({
      event_type: 'suggestion.generated',
      activity_type: 'suggestion',
      activity_action: 'generated',
      subject_type: 'commitment',
      subject_id: '11111111-1111-4111-8111-111111111111',
    })
  })
})
