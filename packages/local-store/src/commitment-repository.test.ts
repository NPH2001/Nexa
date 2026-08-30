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
      'created_by',
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

  it('adds commitment provenance in v8 without touching encrypted content', () => {
    ctx = makeTempStore()
    const store = ctx.store

    const createdBy = store.handle
      .prepare('PRAGMA table_info(commitments)')
      .all()
      .find((column) => String(column['name']) === 'created_by')
    expect(createdBy).toMatchObject({ notnull: 1, dflt_value: "'user'" })

    const actor = store.handle
      .prepare('PRAGMA table_info(local_audit)')
      .all()
      .find((column) => String(column['name']) === 'actor')
    expect(actor).toBeDefined()

    // Record ghi theo schema cũ (không nêu created_by) phải rơi về 'user' — trước v8 agent
    // không có đường nào tạo commitment, nên đó là sự thật lịch sử chứ không phải phỏng đoán.
    const id = randomUUID()
    const now = new Date().toISOString()
    store.handle
      .prepare(
        `INSERT INTO commitments (id, profile_id, title_ciphertext, status, created_at, updated_at)
         VALUES (?, ?, ?, 'active', ?, ?)`,
      )
      .run(id, ctx.profileId, 'ciphertext', now, now)
    const row = store.handle.prepare('SELECT created_by FROM commitments WHERE id = ?').get(id)
    expect(String(row?.['created_by'])).toBe('user')
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

  it('records provenance and keeps user as the default creator', () => {
    ctx = makeTempStore()
    const commitments = new CommitmentRepository(ctx.store)

    expect(commitments.create({ profileId: ctx.profileId, title: 'Tay' }).createdBy).toBe('user')
    expect(
      commitments.create({ profileId: ctx.profileId, title: 'Đề xuất', createdBy: 'agent' })
        .createdBy,
    ).toBe('agent')
  })

  it('orders context commitments by overdue, then nearest deadline, then undated', () => {
    ctx = makeTempStore()
    const commitments = new CommitmentRepository(ctx.store)
    const nowIso = '2026-08-30T10:00:00.000Z'

    const undated = commitments.create({ profileId: ctx.profileId, title: 'Không có mốc' })
    const soon = commitments.create({
      profileId: ctx.profileId,
      title: 'Sắp tới',
      dueAt: '2026-08-31T10:00:00.000Z',
    })
    const later = commitments.create({
      profileId: ctx.profileId,
      title: 'Xa hơn',
      checkInAt: '2026-09-05T10:00:00.000Z',
    })
    const overdue = commitments.create({
      profileId: ctx.profileId,
      title: 'Quá hạn',
      dueAt: '2026-08-28T10:00:00.000Z',
    })
    // paused/completed là việc người dùng đã gác lại — không được lọt vào context.
    const paused = commitments.create({
      profileId: ctx.profileId,
      title: 'Tạm dừng',
      status: 'paused',
      dueAt: '2026-08-27T10:00:00.000Z',
    })

    const ordered = commitments.listForContext(ctx.profileId, { limit: 10, nowIso })
    expect(ordered.map((item) => item.id)).toEqual([overdue.id, soon.id, later.id, undated.id])
    expect(ordered.map((item) => item.id)).not.toContain(paused.id)

    // Trần cắt từ đuôi: cái ít cấp bách nhất rụng trước.
    expect(
      commitments.listForContext(ctx.profileId, { limit: 2, nowIso }).map((item) => item.id),
    ).toEqual([overdue.id, soon.id])
    expect(commitments.listForContext(ctx.profileId, { limit: 0, nowIso })).toEqual([])
  })

  it('rejects empty repository updates even outside IPC', () => {
    ctx = makeTempStore()
    const commitments = new CommitmentRepository(ctx.store)
    const created = commitments.create({ profileId: ctx.profileId, title: 'Cam kết' })

    expect(() => commitments.update(created.id, {})).toThrow('Dữ liệu gửi lên không hợp lệ.')
  })
})
