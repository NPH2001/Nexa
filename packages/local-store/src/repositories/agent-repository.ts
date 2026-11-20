import { randomUUID } from 'node:crypto'
import {
  ERROR_CODES,
  NexaError,
  type Agent,
  type AgentIcon,
  type AgentLocalGroups,
  type ChatModelProvider,
  type ToolPreset,
} from '@nexa/shared-types'
import { n } from '../driver.js'
import type { LocalStore } from '../store.js'

const CTX = {
  name: 'agents.name',
  instructions: 'agents.instructions',
} as const

export interface CreateAgentInput {
  readonly profileId: string
  readonly name: string
  readonly icon: AgentIcon
  readonly instructions: string
  readonly toolCeiling: ToolPreset
  readonly localGroups: AgentLocalGroups
  readonly modelId: string | null
  readonly modelProvider: ChatModelProvider | null
}

export type UpdateAgentInput = Partial<Omit<CreateAgentInput, 'profileId'>>

export class AgentRepository {
  constructor(private readonly store: LocalStore) {}

  create(input: CreateAgentInput): Agent {
    const id = randomUUID()
    const now = this.store.nowIso()
    this.store.handle
      .prepare(
        `INSERT INTO agents
           (id, profile_id, name_ciphertext, icon, instructions_ciphertext, tool_ceiling,
            local_groups_json, model_id, model_provider, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.profileId,
        this.store.cipher.encrypt(CTX.name, input.name),
        input.icon,
        this.store.cipher.encrypt(CTX.instructions, input.instructions),
        input.toolCeiling,
        JSON.stringify(input.localGroups),
        n(input.modelId),
        n(input.modelProvider),
        now,
        now,
      )
    // Chỉ ghi id: tên và hướng dẫn có thể chứa dữ liệu người dùng, không được vào log.
    this.store.log.info('agent-created', { agentId: id, profileId: input.profileId })
    return this.getOrThrow(id)
  }

  get(id: string): Agent | null {
    const row = this.store.handle.prepare('SELECT * FROM agents WHERE id = ?').get(id)
    return row === undefined ? null : this.mapAgent(row)
  }

  list(profileId: string, opts: { includeArchived?: boolean } = {}): Agent[] {
    const where = opts.includeArchived === true ? '' : 'AND archived_at IS NULL'
    return this.store.handle
      .prepare(
        `SELECT * FROM agents WHERE profile_id = ? ${where}
         ORDER BY updated_at DESC, created_at DESC, rowid DESC`,
      )
      .all(profileId)
      .map((row) => this.mapAgent(row))
  }

  update(id: string, patch: UpdateAgentInput): Agent {
    return this.store.transaction(() => {
      const current = this.getOrThrow(id)
      const updates: string[] = []
      const params: (string | null)[] = []

      if (patch.name !== undefined) {
        updates.push('name_ciphertext = ?')
        params.push(this.store.cipher.encrypt(CTX.name, patch.name))
      }
      if (patch.icon !== undefined) {
        updates.push('icon = ?')
        params.push(patch.icon)
      }
      if (patch.instructions !== undefined) {
        updates.push('instructions_ciphertext = ?')
        params.push(this.store.cipher.encrypt(CTX.instructions, patch.instructions))
      }
      if (patch.toolCeiling !== undefined) {
        updates.push('tool_ceiling = ?')
        params.push(patch.toolCeiling)
      }
      if (patch.localGroups !== undefined) {
        updates.push('local_groups_json = ?')
        params.push(JSON.stringify(patch.localGroups))
      }
      if (patch.modelId !== undefined) {
        updates.push('model_id = ?')
        params.push(n(patch.modelId))
      }
      if (patch.modelProvider !== undefined) {
        updates.push('model_provider = ?')
        params.push(n(patch.modelProvider))
      }

      updates.push('updated_at = ?')
      params.push(this.store.nowIso(), id)
      this.store.handle
        .prepare(`UPDATE agents SET ${updates.join(', ')} WHERE id = ?`)
        .run(...params)
      this.store.log.info('agent-updated', { agentId: id, profileId: current.profileId })
      return this.getOrThrow(id)
    })
  }

  archive(id: string): Agent {
    return this.setArchived(id, this.store.nowIso(), 'agent-archived')
  }

  restore(id: string): Agent {
    return this.setArchived(id, null, 'agent-restored')
  }

  delete(id: string): void {
    const current = this.getOrThrow(id)
    // `conversations.agent_id` là ON DELETE SET NULL: hội thoại còn, về persona mặc định.
    this.store.handle.prepare('DELETE FROM agents WHERE id = ?').run(id)
    this.store.log.info('agent-deleted', { agentId: id, profileId: current.profileId })
  }

  private setArchived(id: string, archivedAt: string | null, event: string): Agent {
    const current = this.getOrThrow(id)
    this.store.handle
      .prepare('UPDATE agents SET archived_at = ?, updated_at = ? WHERE id = ?')
      .run(archivedAt, this.store.nowIso(), id)
    this.store.log.info(event, { agentId: id, profileId: current.profileId })
    return this.getOrThrow(id)
  }

  private getOrThrow(id: string): Agent {
    const agent = this.get(id)
    if (agent !== null) return agent
    throw new NexaError(ERROR_CODES.VALIDATION_FAILED, { safeDetail: `agent not found: ${id}` })
  }

  private mapAgent(row: Record<string, unknown>): Agent {
    return {
      id: String(row['id']),
      profileId: String(row['profile_id']),
      name: this.store.cipher.decrypt(CTX.name, String(row['name_ciphertext'])),
      icon: String(row['icon']) as AgentIcon,
      instructions: this.store.cipher.decrypt(
        CTX.instructions,
        String(row['instructions_ciphertext']),
      ),
      toolCeiling: String(row['tool_ceiling']) as ToolPreset,
      localGroups: JSON.parse(String(row['local_groups_json'])) as AgentLocalGroups,
      modelId: row['model_id'] === null ? null : String(row['model_id']),
      modelProvider:
        row['model_provider'] === null
          ? null
          : (String(row['model_provider']) as ChatModelProvider),
      archived: row['archived_at'] !== null,
      createdAt: String(row['created_at']),
      updatedAt: String(row['updated_at']),
    }
  }
}
