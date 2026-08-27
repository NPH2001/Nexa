import { afterEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import {
  CommitmentRepository,
  ConversationRepository,
  ProfileRepository,
} from './index.js'
import { makeTempStore, type TempStore } from '../../../tests/support/factories.js'

let ctx: TempStore | null = null
afterEach(() => {
  ctx?.cleanup()
  ctx = null
})

describe('commitment migration', () => {
  it('creates the encrypted commitment schema and ownership indexes in v6', () => {
    ctx = makeTempStore()

    const columns = ctx.store.handle.prepare('PRAGMA table_info(commitments)').all()
    expect(columns.map((column) => String(column['name']))).toEqual([
      'id',
      'profile_id',
      'title_ciphertext',
      'next_action_ciphertext',
      'status',
      'due_at',
      'check_in_at',
      'completed_at',
      'source_conversation_id',
      'created_at',
      'updated_at',
    ])

    const indexes = ctx.store.handle.prepare('PRAGMA index_list(commitments)').all()
    expect(indexes.map((index) => String(index['name']))).toEqual(
      expect.arrayContaining([
        'idx_commitments_profile_status_updated',
        'idx_commitments_profile_attention',
        'idx_commitments_source_conversation',
      ]),
    )

    const sourceFk = ctx.store.handle
      .prepare('PRAGMA foreign_key_list(commitments)')
      .all()
      .find((foreignKey) => String(foreignKey['from']) === 'source_conversation_id')
    expect(sourceFk).toMatchObject({ table: 'conversations', on_delete: 'SET NULL' })
  })
})

describe('commitments', () => {
  it('creates encrypted content and completes then reopens the same record', () => {
    ctx = makeTempStore()
    const repository = new CommitmentRepository(ctx.store)
    const created = repository.create({
      profileId: ctx.profileId,
      title: 'Hoàn tất kế hoạch pilot bí mật',
      nextAction: 'Chốt danh sách người dùng thử nghiệm',
      dueAt: '2026-09-01T02:00:00.000Z',
      checkInAt: '2026-08-28T02:00:00.000Z',
    })

    const raw = ctx.store.handle
      .prepare(
        'SELECT title_ciphertext, next_action_ciphertext FROM commitments WHERE id = ?',
      )
      .get(created.id)
    expect(String(raw?.['title_ciphertext'])).not.toContain('kế hoạch pilot')
    expect(String(raw?.['next_action_ciphertext'])).not.toContain('danh sách người dùng')
    expect(repository.get(created.id)).toMatchObject({
      title: 'Hoàn tất kế hoạch pilot bí mật',
      nextAction: 'Chốt danh sách người dùng thử nghiệm',
      status: 'active',
      completedAt: null,
    })

    const completed = repository.update(created.id, { status: 'completed' })
    expect(completed.status).toBe('completed')
    expect(completed.completedAt).not.toBeNull()
    expect(repository.list(ctx.profileId)).toEqual([])
    expect(repository.list(ctx.profileId, { includeCompleted: true })).toHaveLength(1)

    const reopened = repository.update(created.id, { status: 'active' })
    expect(reopened).toMatchObject({ id: created.id, status: 'active', completedAt: null })
  })

  it('validates source ownership and keeps the commitment when its source is deleted', () => {
    ctx = makeTempStore()
    const conversations = new ConversationRepository(ctx.store)
    const commitments = new CommitmentRepository(ctx.store)
    const source = conversations.create(ctx.profileId, 'Nguồn', null)
    const created = commitments.create({
      profileId: ctx.profileId,
      title: 'Theo dõi kết quả từ hội thoại',
      sourceConversationId: source.id,
    })

    conversations.delete(source.id)
    expect(commitments.get(created.id)?.sourceConversationId).toBeNull()

    const otherProfile = new ProfileRepository(ctx.store).ensure(
      `other-${randomUUID()}`,
      'Other profile',
    )
    const foreignSource = conversations.create(otherProfile.id, 'Nguồn khác profile', null)
    expect(() =>
      commitments.update(created.id, { sourceConversationId: foreignSource.id }),
    ).toThrow('Dữ liệu gửi lên không hợp lệ.')
  })

  it('purges commitments with their profile', () => {
    ctx = makeTempStore()
    const commitments = new CommitmentRepository(ctx.store)
    commitments.create({ profileId: ctx.profileId, title: 'Sẽ bị purge' })

    ctx.store.purgeProfile(ctx.profileId)

    const count = Number(
      ctx.store.handle.prepare('SELECT COUNT(*) AS c FROM commitments').get()?.['c'],
    )
    expect(count).toBe(0)
  })

  it('rejects empty repository updates even outside IPC', () => {
    ctx = makeTempStore()
    const commitments = new CommitmentRepository(ctx.store)
    const created = commitments.create({ profileId: ctx.profileId, title: 'Cam kết' })

    expect(() => commitments.update(created.id, {})).toThrow('Dữ liệu gửi lên không hợp lệ.')
  })
})
