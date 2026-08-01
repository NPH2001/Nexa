import { randomUUID } from 'node:crypto'
import type {
  Connection,
  ConnectionTestResult,
  ConnectionType,
  ModelConfig,
} from '@nexa/shared-types'
import { b, n } from '../driver.js'
import type { LocalStore } from '../store.js'

const CTX_SETTING = 'settings.value'

/**
 * §8.1 `connections` + `credential_refs` + `models` + `settings`.
 *
 * Bảng `connections` KHÔNG chứa API key/PAT. `credential_refs` chỉ giữ khoá tra cứu tới
 * secure storage — đúng mô hình Phụ lục A (`credentialRef: "secure://jira/default"`).
 */
export class ConfigRepository {
  constructor(private readonly store: LocalStore) {}

  // ── Connections ─────────────────────────────────────────────────────────

  upsertConnection(
    profileId: string,
    input: {
      type: ConnectionType
      baseUrl: string
      username: string | null
      enabled: boolean
      credentialRef?: string
    },
  ): Connection {
    return this.store.transaction(() => {
      const now = this.store.nowIso()
      const existing = this.findConnection(profileId, input.type)
      const id = existing?.id ?? randomUUID()

      if (existing === null) {
        this.store.handle
          .prepare(
            `INSERT INTO connections (id, profile_id, type, base_url, username, enabled, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(id, profileId, input.type, input.baseUrl, n(input.username), b(input.enabled), now, now)
      } else {
        this.store.handle
          .prepare(
            `UPDATE connections SET base_url = ?, username = ?, enabled = ?, updated_at = ? WHERE id = ?`,
          )
          .run(input.baseUrl, n(input.username), b(input.enabled), now, id)
      }

      if (input.credentialRef !== undefined) {
        this.store.handle
          .prepare(
            `INSERT INTO credential_refs (connection_id, secret_kind, secure_storage_key, created_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(connection_id, secret_kind)
             DO UPDATE SET secure_storage_key = excluded.secure_storage_key`,
          )
          .run(id, input.type === 'litellm' ? 'api_key' : 'pat', input.credentialRef, now)
      }

      const saved = this.findConnection(profileId, input.type)
      if (saved === null) {
        throw new Error('connection disappeared immediately after write')
      }
      return saved
    })
  }

  findConnection(profileId: string, type: ConnectionType): Connection | null {
    const row = this.store.handle
      .prepare(
        `SELECT c.*, (SELECT COUNT(*) FROM credential_refs r WHERE r.connection_id = c.id) AS ref_count
         FROM connections c WHERE c.profile_id = ? AND c.type = ?`,
      )
      .get(profileId, type)
    return row === undefined ? null : mapConnection(row)
  }

  listConnections(profileId: string): Connection[] {
    return this.store.handle
      .prepare(
        `SELECT c.*, (SELECT COUNT(*) FROM credential_refs r WHERE r.connection_id = c.id) AS ref_count
         FROM connections c WHERE c.profile_id = ? ORDER BY c.type`,
      )
      .all(profileId)
      .map(mapConnection)
  }

  recordConnectionTest(profileId: string, type: ConnectionType, result: ConnectionTestResult): void {
    this.store.handle
      .prepare('UPDATE connections SET last_test_json = ?, updated_at = ? WHERE profile_id = ? AND type = ?')
      .run(JSON.stringify(result), this.store.nowIso(), profileId, type)
  }

  /** §8.2: xoá kết nối phải xoá cả credential_ref. Secret thật do SecurityService xoá riêng. */
  deleteConnection(profileId: string, type: ConnectionType): void {
    this.store.handle
      .prepare('DELETE FROM connections WHERE profile_id = ? AND type = ?')
      .run(profileId, type)
  }

  // ── Models (EPIC-03) ────────────────────────────────────────────────────

  addModel(
    profileId: string,
    input: { modelId: string; displayName: string; contextWindowTokens: number },
  ): ModelConfig {
    return this.store.transaction(() => {
      const existing = this.store.handle
        .prepare('SELECT id FROM models WHERE profile_id = ? AND model_id = ?')
        .get(profileId, input.modelId)
      if (existing !== undefined) {
        return this.getModel(String(existing['id'])) as ModelConfig
      }

      const isFirst =
        Number(
          this.store.handle
            .prepare('SELECT COUNT(*) AS c FROM models WHERE profile_id = ?')
            .get(profileId)?.['c'] ?? 0,
        ) === 0

      const id = randomUUID()
      const now = this.store.nowIso()
      this.store.handle
        .prepare(
          `INSERT INTO models (id, profile_id, model_id, display_name, is_default, verified, context_window_tokens, created_at)
           VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
        )
        .run(
          id,
          profileId,
          input.modelId,
          input.displayName,
          b(isFirst),
          input.contextWindowTokens,
          now,
        )
      return {
        id,
        modelId: input.modelId,
        displayName: input.displayName,
        isDefault: isFirst,
        verified: false,
        contextWindowTokens: input.contextWindowTokens,
        createdAt: now,
      }
    })
  }

  getModel(id: string): ModelConfig | null {
    const row = this.store.handle.prepare('SELECT * FROM models WHERE id = ?').get(id)
    return row === undefined ? null : mapModel(row)
  }

  findModelByModelId(profileId: string, modelId: string): ModelConfig | null {
    const row = this.store.handle
      .prepare('SELECT * FROM models WHERE profile_id = ? AND model_id = ?')
      .get(profileId, modelId)
    return row === undefined ? null : mapModel(row)
  }

  listModels(profileId: string): ModelConfig[] {
    return this.store.handle
      .prepare('SELECT * FROM models WHERE profile_id = ? ORDER BY is_default DESC, created_at')
      .all(profileId)
      .map(mapModel)
  }

  removeModel(profileId: string, id: string): void {
    this.store.transaction(() => {
      const model = this.getModel(id)
      this.store.handle.prepare('DELETE FROM models WHERE id = ? AND profile_id = ?').run(id, profileId)
      // Xoá model mặc định thì phải chỉ định model mặc định mới, nếu không người dùng
      // sẽ gặp MODEL_NOT_CONFIGURED ở lần chat kế tiếp mà không hiểu vì sao.
      if (model?.isDefault === true) {
        const next = this.store.handle
          .prepare('SELECT id FROM models WHERE profile_id = ? ORDER BY created_at LIMIT 1')
          .get(profileId)
        if (next !== undefined) this.setDefaultModel(profileId, String(next['id']))
      }
    })
  }

  setDefaultModel(profileId: string, id: string): void {
    this.store.transaction(() => {
      this.store.handle.prepare('UPDATE models SET is_default = 0 WHERE profile_id = ?').run(profileId)
      this.store.handle
        .prepare('UPDATE models SET is_default = 1 WHERE id = ? AND profile_id = ?')
        .run(id, profileId)
    })
  }

  setModelVerified(id: string, verified: boolean): void {
    this.store.handle.prepare('UPDATE models SET verified = ? WHERE id = ?').run(b(verified), id)
  }

  getDefaultModel(profileId: string): ModelConfig | null {
    const row = this.store.handle
      .prepare('SELECT * FROM models WHERE profile_id = ? AND is_default = 1')
      .get(profileId)
    return row === undefined ? null : mapModel(row)
  }

  // ── Settings ────────────────────────────────────────────────────────────

  /** Lưu một cụm cấu hình dưới dạng JSON đã mã hoá. */
  putSetting(profileId: string, key: string, value: unknown): void {
    this.store.handle
      .prepare(
        `INSERT INTO settings (profile_id, key, value_ciphertext, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(profile_id, key)
         DO UPDATE SET value_ciphertext = excluded.value_ciphertext, updated_at = excluded.updated_at`,
      )
      .run(
        profileId,
        key,
        this.store.cipher.encrypt(CTX_SETTING, JSON.stringify(value)),
        this.store.nowIso(),
      )
  }

  getSetting<T>(profileId: string, key: string): T | null {
    const row = this.store.handle
      .prepare('SELECT value_ciphertext FROM settings WHERE profile_id = ? AND key = ?')
      .get(profileId, key)
    if (row === undefined) return null
    return JSON.parse(this.store.cipher.decrypt(CTX_SETTING, String(row['value_ciphertext']))) as T
  }
}

function mapConnection(row: Record<string, unknown>): Connection {
  const lastTestRaw = row['last_test_json']
  return {
    id: String(row['id']),
    type: String(row['type']) as ConnectionType,
    baseUrl: String(row['base_url']),
    username: row['username'] === null ? null : String(row['username']),
    enabled: Number(row['enabled']) === 1,
    hasCredential: Number(row['ref_count'] ?? 0) > 0,
    createdAt: String(row['created_at']),
    updatedAt: String(row['updated_at']),
    ...(lastTestRaw === null || lastTestRaw === undefined
      ? {}
      : { lastTest: JSON.parse(String(lastTestRaw)) as ConnectionTestResult }),
  }
}

function mapModel(row: Record<string, unknown>): ModelConfig {
  return {
    id: String(row['id']),
    modelId: String(row['model_id']),
    displayName: String(row['display_name']),
    isDefault: Number(row['is_default']) === 1,
    verified: Number(row['verified']) === 1,
    contextWindowTokens: Number(row['context_window_tokens']),
    createdAt: String(row['created_at']),
  }
}
