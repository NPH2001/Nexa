import { afterEach, describe, expect, it } from 'vitest'
import { ActivityRepository, CommitmentRepository, ConversationRepository } from '@nexa/local-store'
import type { LocalToolDefinition } from '@nexa/shared-types'
import { makeTempStore, testLogger, type TempStore } from '../../../../tests/support/factories.js'
import {
  COMMITMENT_CREATE_TOOL,
  COMMITMENT_UPDATE_TOOL,
  createCommitmentToolRegistry,
} from './commitment-tools.js'

let ctx: TempStore | null = null
afterEach(() => {
  ctx?.cleanup()
  ctx = null
})

const NOW = new Date(2026, 8, 2, 10, 0, 0, 0) // thứ 4

function setup(): {
  registry: ReturnType<typeof createCommitmentToolRegistry>
  commitments: CommitmentRepository
  activity: ActivityRepository
  store: TempStore
  conversationId: string
} {
  const store = makeTempStore()
  ctx = store
  const commitments = new CommitmentRepository(store.store)
  const activity = new ActivityRepository(store.store)
  const conversations = new ConversationRepository(store.store)
  const conversation = conversations.create(store.profileId, 'Hội thoại nguồn', null)
  const { logger } = testLogger()

  return {
    registry: createCommitmentToolRegistry({
      profileId: store.profileId,
      conversationId: conversation.id,
      commitments,
      activity,
      logger,
      now: () => NOW,
    }),
    commitments,
    activity,
    store,
    conversationId: conversation.id,
  }
}

const tool = (
  registry: ReturnType<typeof createCommitmentToolRegistry>,
  name: string,
): LocalToolDefinition => {
  const definition = registry.get(name)
  if (definition === undefined) throw new Error(`missing tool ${name}`)
  return definition
}

const PREVIEW_CTX = { actingAccount: 'profile-hiện-tại' }

describe('commitment tools', () => {
  it('exposes exactly the create and update tools — no delete', () => {
    const { registry } = setup()
    expect(registry.list().map((t) => t.name).sort()).toEqual(
      [COMMITMENT_CREATE_TOOL, COMMITMENT_UPDATE_TOOL].sort(),
    )
  })

  it('creates an agent-attributed commitment bound to the source conversation', async () => {
    const { registry, commitments, store, conversationId } = setup()
    const create = tool(registry, COMMITMENT_CREATE_TOOL)

    const input = create.inputSchema.parse({
      title: 'Xong báo cáo quý',
      next_action: 'Gửi bản nháp cho sếp',
      due_at: 'thứ 6 tuần sau',
    })
    await create.execute(input)

    const [saved] = commitments.list(store.profileId)
    expect(saved).toMatchObject({
      title: 'Xong báo cáo quý',
      nextAction: 'Gửi bản nháp cho sếp',
      status: 'active',
      createdBy: 'agent',
      sourceConversationId: conversationId,
    })
    // "thứ 6 tuần sau" tính từ thứ 4 2026-09-02 là 2026-09-11, cuối giờ làm.
    expect(new Date(String(saved?.dueAt)).getDate()).toBe(11)
  })

  it('shows the resolved absolute deadline in the preview, on the local system', async () => {
    const { registry } = setup()
    const create = tool(registry, COMMITMENT_CREATE_TOOL)
    const input = create.inputSchema.parse({ title: 'Chốt hợp đồng', due_at: 'ngày mai' })

    const preview = await create.buildPreview?.(input, PREVIEW_CTX)

    expect(preview?.targetSystem).toBe('local')
    expect(preview?.targetSystemUrl).toBe('')
    expect(preview?.reversible).toBe(true)
    const due = preview?.payloadFields.find((f) => f.label === 'Hạn hoàn thành')
    expect(due?.value).toContain('2026')
    expect(due?.value).not.toContain('ngày mai')
  })

  it('refuses a deadline it cannot resolve instead of guessing one', () => {
    const { registry } = setup()
    const create = tool(registry, COMMITMENT_CREATE_TOOL)
    const input = create.inputSchema.parse({ title: 'Việc gì đó', due_at: 'khi nào rảnh' })

    expect(() => create.buildPreview?.(input, PREVIEW_CTX)).toThrow()
  })

  it('rejects completed status at the schema boundary', () => {
    const { registry } = setup()
    expect(() =>
      tool(registry, COMMITMENT_UPDATE_TOOL).inputSchema.parse({
        commitment_id: '00000000-0000-4000-8000-000000000001',
        status: 'completed',
      }),
    ).toThrow()
  })

  it('shows before and after values read from the stored record', async () => {
    const { registry, commitments, store } = setup()
    const existing = commitments.create({
      profileId: store.profileId,
      title: 'Cam kết cũ',
      nextAction: 'Bước cũ',
    })
    const update = tool(registry, COMMITMENT_UPDATE_TOOL)
    const input = update.inputSchema.parse({
      commitment_id: existing.id,
      next_action: 'Bước mới',
    })

    const preview = await update.buildPreview?.(input, PREVIEW_CTX)

    expect(preview?.changes).toEqual([
      { field: 'Bước tiếp theo', before: 'Bước cũ', after: 'Bước mới' },
    ])
  })

  it('refuses to touch a commitment from another profile', () => {
    const { registry } = setup()
    const foreignStore = makeTempStore()
    const foreign = new CommitmentRepository(foreignStore.store).create({
      profileId: foreignStore.profileId,
      title: 'Của người khác',
    })

    const update = tool(registry, COMMITMENT_UPDATE_TOOL)
    const input = update.inputSchema.parse({ commitment_id: foreign.id, next_action: 'Đổi' })

    expect(() => update.buildPreview?.(input, PREVIEW_CTX)).toThrow()
    foreignStore.cleanup()
  })

  it('records the mutation as agent activity without leaking commitment content', async () => {
    const { registry, activity, store } = setup()
    const create = tool(registry, COMMITMENT_CREATE_TOOL)
    const input = create.inputSchema.parse({ title: 'Bí mật nội bộ không được lộ' })

    await create.execute(input)

    const [event] = activity.list(store.profileId, { limit: 10, offset: 0 })
    expect(event).toMatchObject({
      type: 'commitment_mutation',
      action: 'created',
      status: 'success',
      subjectType: 'commitment',
      actor: 'agent',
    })
    expect(JSON.stringify(event)).not.toContain('Bí mật nội bộ')
  })
})
