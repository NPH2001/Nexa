import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import {
  AgentRepository,
  ConversationRepository,
  ProfileRepository,
  type CreateAgentInput,
} from './index.js'
import { makeTempStore, type TempStore } from '../../../tests/support/factories.js'

let ctx: TempStore | null = null
afterEach(() => {
  ctx?.cleanup()
  ctx = null
})

function setup() {
  ctx = makeTempStore()
  return {
    ctx,
    agents: new AgentRepository(ctx.store),
    conversations: new ConversationRepository(ctx.store),
  }
}

function input(profileId: string, over: Partial<CreateAgentInput> = {}): CreateAgentInput {
  return {
    profileId,
    name: 'Trợ lý BA',
    icon: '📝',
    instructions: 'Luôn trả lời ngắn gọn.',
    toolCeiling: 'redmine-read',
    localGroups: { commitments: true, baWorkbench: false },
    modelId: null,
    modelProvider: null,
    ...over,
  }
}

describe('migration v13', () => {
  it('tạo bảng agents và cột conversations.agent_id với FK SET NULL', () => {
    const { ctx } = setup()
    const fks = ctx.store.handle.prepare('PRAGMA foreign_key_list(conversations)').all()
    expect(fks.find((fk) => String(fk['from']) === 'agent_id')).toMatchObject({
      table: 'agents',
      on_delete: 'SET NULL',
    })
    const agentFks = ctx.store.handle.prepare('PRAGMA foreign_key_list(agents)').all()
    expect(agentFks.find((fk) => String(fk['from']) === 'profile_id')).toMatchObject({
      table: 'profiles',
      on_delete: 'CASCADE',
    })
  })

  it('hội thoại có sẵn giữ nguyên và có agentId = null', () => {
    const { ctx, conversations } = setup()
    const conv = conversations.create(ctx.profileId, 'Cũ', null)
    expect(conversations.get(conv.id)?.agentId).toBeNull()
  })

  it('rollback về v12 bỏ bảng agents và cột agent_id mà không mất hội thoại', () => {
    const { ctx, conversations } = setup()
    const conv = conversations.create(ctx.profileId, 'Giữ lại', null)
    ctx.store.rollbackTo(12)

    const tables = ctx.store.handle
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'agents'`)
      .all()
    expect(tables).toHaveLength(0)
    const columns = ctx.store.handle.prepare('PRAGMA table_info(conversations)').all()
    expect(columns.map((c) => String(c['name']))).not.toContain('agent_id')
    expect(conversations.get(conv.id)?.title).toBe('Giữ lại')
  })
})

describe('AgentRepository', () => {
  it('create/get round-trip giữ nguyên mọi trường', () => {
    const { ctx, agents } = setup()
    const created = agents.create(
      input(ctx.profileId, { modelId: 'gpt-x', modelProvider: 'litellm' }),
    )
    expect(agents.get(created.id)).toEqual(created)
    expect(created).toMatchObject({
      name: 'Trợ lý BA',
      icon: '📝',
      instructions: 'Luôn trả lời ngắn gọn.',
      toolCeiling: 'redmine-read',
      localGroups: { commitments: true, baWorkbench: false },
      modelId: 'gpt-x',
      modelProvider: 'litellm',
      archived: false,
    })
  })

  it('không để lộ tên và hướng dẫn ở dạng plaintext trong file DB hay log', () => {
    const { ctx, agents } = setup()
    agents.create(
      input(ctx.profileId, {
        name: 'Tên-bí-mật-agent',
        instructions: 'Hướng-dẫn-bí-mật-agent',
      }),
    )
    ctx.store.handle.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    const raw = readFileSync(ctx.dbPath).toString('latin1')
    expect(raw).not.toContain('Tên-bí-mật-agent')
    expect(raw).not.toContain('Hướng-dẫn-bí-mật-agent')
    expect(JSON.stringify(ctx.sink.records)).not.toContain('bí-mật-agent')
  })

  it('update chỉ đổi trường được gửi', () => {
    const { ctx, agents } = setup()
    const created = agents.create(input(ctx.profileId))
    const updated = agents.update(created.id, { name: 'Tên mới', toolCeiling: 'all-read' })
    expect(updated).toMatchObject({
      id: created.id,
      name: 'Tên mới',
      toolCeiling: 'all-read',
      instructions: created.instructions,
      localGroups: created.localGroups,
    })
  })

  it('update có thể xoá model bằng cặp null', () => {
    const { ctx, agents } = setup()
    const created = agents.create(
      input(ctx.profileId, { modelId: 'gpt-x', modelProvider: 'litellm' }),
    )
    const updated = agents.update(created.id, { modelId: null, modelProvider: null })
    expect(updated.modelId).toBeNull()
    expect(updated.modelProvider).toBeNull()
  })

  it('archive ẩn khỏi list mặc định, restore đưa về', () => {
    const { ctx, agents } = setup()
    const created = agents.create(input(ctx.profileId))
    expect(agents.archive(created.id).archived).toBe(true)
    expect(agents.list(ctx.profileId)).toHaveLength(0)
    expect(agents.list(ctx.profileId, { includeArchived: true })).toHaveLength(1)
    expect(agents.restore(created.id).archived).toBe(false)
    expect(agents.list(ctx.profileId)).toHaveLength(1)
  })

  it('list chỉ trả agent của profile được hỏi', () => {
    const { ctx, agents } = setup()
    const other = new ProfileRepository(ctx.store).ensure('other:account', 'Khác')
    agents.create(input(ctx.profileId, { name: 'Của tôi' }))
    agents.create(input(other.id, { name: 'Của người khác' }))
    expect(agents.list(ctx.profileId).map((a) => a.name)).toEqual(['Của tôi'])
  })

  it('thao tác trên id không tồn tại bị từ chối', () => {
    const { agents } = setup()
    const rejected = (run: () => unknown): string | undefined => {
      try {
        run()
      } catch (error) {
        return (error as { safeDetail?: string }).safeDetail
      }
      return undefined
    }
    expect(rejected(() => agents.update('khong-co', { name: 'x' }))).toMatch(/agent not found/)
    expect(rejected(() => agents.archive('khong-co'))).toMatch(/agent not found/)
    expect(rejected(() => agents.delete('khong-co'))).toMatch(/agent not found/)
  })

  it('xoá agent đặt agent_id của hội thoại về null và giữ hội thoại', () => {
    const { ctx, agents, conversations } = setup()
    const agent = agents.create(input(ctx.profileId))
    const conv = conversations.create(ctx.profileId, 'Có agent', null)
    conversations.setAgent(conv.id, agent.id)
    expect(conversations.get(conv.id)?.agentId).toBe(agent.id)

    agents.delete(agent.id)

    expect(agents.get(agent.id)).toBeNull()
    expect(conversations.get(conv.id)).not.toBeNull()
    expect(conversations.get(conv.id)?.agentId).toBeNull()
  })

  it('setAgent(null) bỏ agent', () => {
    const { ctx, agents, conversations } = setup()
    const agent = agents.create(input(ctx.profileId))
    const conv = conversations.create(ctx.profileId, 'x', null)
    conversations.setAgent(conv.id, agent.id)
    conversations.setAgent(conv.id, null)
    expect(conversations.get(conv.id)?.agentId).toBeNull()
  })

  it('hội thoại vẫn đọc được agent đã archive qua id', () => {
    const { ctx, agents, conversations } = setup()
    const agent = agents.create(input(ctx.profileId))
    const conv = conversations.create(ctx.profileId, 'x', null)
    conversations.setAgent(conv.id, agent.id)
    agents.archive(agent.id)
    expect(conversations.get(conv.id)?.agentId).toBe(agent.id)
    expect(agents.get(agent.id)?.archived).toBe(true)
  })

  it('purge profile xoá toàn bộ agent của profile đó', () => {
    const { ctx, agents } = setup()
    const other = new ProfileRepository(ctx.store).ensure('other:account', 'Khác')
    agents.create(input(ctx.profileId))
    const kept = agents.create(input(other.id, { name: 'Giữ' }))
    ctx.store.purgeProfile(ctx.profileId)
    expect(agents.list(ctx.profileId, { includeArchived: true })).toHaveLength(0)
    expect(agents.get(kept.id)).not.toBeNull()
  })
})
