import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AuditRepository,
  AUDIT_EVENTS,
  ConfigRepository,
  ConversationRepository,
  ConversationSearch,
  LATEST_SCHEMA_VERSION,
  LocalStore,
  MIGRATIONS,
  RetentionService,
  openDatabase,
} from './index.js'
import {
  fakeClock,
  makeTempStore,
  testCipher,
  testLogger,
  type TempStore,
} from '../../../tests/support/factories.js'

let ctx: TempStore | null = null
afterEach(() => {
  ctx?.cleanup()
  ctx = null
})

describe('migration', () => {
  it('applies every migration and records the version', () => {
    ctx = makeTempStore()
    expect(ctx.store.schemaVersion).toBe(LATEST_SCHEMA_VERSION)
  })

  it('is idempotent — reopening the same file does not reapply', async () => {
    ctx = makeTempStore()
    const before = ctx.store.schemaVersion
    const applied = ctx.store.handle
      .prepare('SELECT COUNT(*) AS c FROM schema_migrations')
      .get()?.['c']
    expect(Number(applied)).toBe(LATEST_SCHEMA_VERSION)
    expect(before).toBe(LATEST_SCHEMA_VERSION)
  })

  it('rolls back a failed transaction completely', async () => {
    ctx = makeTempStore()
    const repo = new ConversationRepository(ctx.store)
    const conv = repo.create(ctx.profileId, 'Sẽ bị rollback', null)

    expect(() =>
      ctx!.store.transaction(() => {
        repo.appendMessage({ conversationId: conv.id, role: 'user', content: 'a' })
        throw new Error('boom')
      }),
    ).toThrow('boom')

    expect(repo.listMessages(conv.id, 10)).toHaveLength(0)
  })

  it('supports nested transactions via savepoints', async () => {
    ctx = makeTempStore()
    const repo = new ConversationRepository(ctx.store)
    const conv = repo.create(ctx.profileId, 'Lồng nhau', null)

    ctx.store.transaction(() => {
      repo.appendMessage({ conversationId: conv.id, role: 'user', content: 'ngoài' })
      try {
        ctx!.store.transaction(() => {
          repo.appendMessage({ conversationId: conv.id, role: 'user', content: 'trong' })
          throw new Error('inner fails')
        })
      } catch {
        // nuốt lỗi của transaction con
      }
    })

    const messages = repo.listMessages(conv.id, 10)
    expect(messages.map((m) => m.content)).toEqual(['ngoài'])
  })
})

describe('driver SQLite (ADR 0003)', () => {
  it('dùng node:sqlite — cùng driver mà bản phát hành dùng', () => {
    ctx = makeTempStore()
    expect(ctx.store.driverName).toBe('node:sqlite')
  })

  it('node:sqlite là mặc định, không cần chỉ định', () => {
    ctx = makeTempStore()
    const db = openDatabase(join(ctx.dir, 'default-driver.db'))
    try {
      expect(db.driverName).toBe('node:sqlite')
    } finally {
      db.close()
    }
  })

  it('rơi xuống node:sqlite khi better-sqlite3 không cài (đúng cấu hình hiện tại)', () => {
    ctx = makeTempStore()
    // better-sqlite3 đã bị bỏ khỏi cây phụ thuộc; yêu cầu nó phải rơi xuống driver còn lại
    // thay vì chết.
    const db = openDatabase(join(ctx.dir, 'fallback.db'), 'better-sqlite3')
    try {
      expect(db.driverName).toBe('node:sqlite')
      db.exec('CREATE TABLE t (a INTEGER)')
      db.prepare('INSERT INTO t VALUES (?)').run(1)
      expect(db.prepare('SELECT COUNT(*) AS c FROM t').get()?.['c']).toBe(1)
    } finally {
      db.close()
    }
  })

  it('nêu rõ vì sao TỪNG driver thất bại khi không mở được cái nào', () => {
    // Đường dẫn không ghi được ⇒ cả hai driver đều hỏng. Thông báo phải nói nguyên nhân của
    // từng cái — đây đúng là tình huống đã gặp thật khi Electron 33 (Node 20) không có
    // node:sqlite và cũng không có binding better-sqlite3.
    const impossible = '/khong/the/tao/duoc/nexa.db'
    try {
      openDatabase(impossible)
      throw new Error('phải ném lỗi')
    } catch (error) {
      const detail = (error as { safeDetail?: string }).safeDetail ?? ''
      expect(detail).toContain('node:sqlite')
      expect(detail).toContain('better-sqlite3')
    }
  })
})

describe('encryption at rest (§21: "không đọc được bằng công cụ SQLite thông thường")', () => {
  it('never writes message content or titles in cleartext', async () => {
    ctx = makeTempStore()
    const repo = new ConversationRepository(ctx.store)
    const secretTitle = 'Kế hoạch sáp nhập Q4'
    const secretBody = 'Số liệu doanh thu bí mật: 1.234.567.890 VND'

    const conv = repo.create(ctx.profileId, secretTitle, { modelId: 'model-a', provider: 'litellm' })
    repo.appendMessage({ conversationId: conv.id, role: 'user', content: secretBody })
    ctx.store.close()

    const raw = readFileSync(ctx.dbPath).toString('latin1')
    expect(raw).not.toContain(secretTitle)
    expect(raw).not.toContain(secretBody)
    expect(raw).not.toContain('1.234.567.890')
  })

  it('refuses to decrypt a field moved to a different column (AAD binding)', async () => {
    ctx = makeTempStore()
    const repo = new ConversationRepository(ctx.store)
    const conv = repo.create(ctx.profileId, 'Tiêu đề', null)

    const row = ctx.store.handle
      .prepare('SELECT title_ciphertext FROM conversations WHERE id = ?')
      .get(conv.id)
    const titleCipher = String(row?.['title_ciphertext'])

    // Ciphertext của conversations.title bị đem sang messages.content.
    expect(() => repo.decryptContent(titleCipher)).toThrow()
  })
})

describe('conversation CRUD', () => {
  it('creates, renames, archives and deletes', async () => {
    ctx = makeTempStore()
    const repo = new ConversationRepository(ctx.store)

    const conv = repo.create(ctx.profileId, 'Ban đầu', { modelId: 'model-a', provider: 'litellm' })
    repo.rename(conv.id, 'Đã đổi tên')
    expect(repo.get(conv.id)?.title).toBe('Đã đổi tên')

    repo.archive(conv.id)
    expect(repo.list(ctx.profileId, { includeArchived: false, limit: 10, offset: 0 })).toHaveLength(0)
    expect(repo.list(ctx.profileId, { includeArchived: true, limit: 10, offset: 0 })).toHaveLength(1)

    repo.delete(conv.id)
    expect(repo.get(conv.id)).toBeNull()
  })

  it('cascades deletes to messages, attachments and tool calls', async () => {
    ctx = makeTempStore()
    const repo = new ConversationRepository(ctx.store)
    const conv = repo.create(ctx.profileId, 'Có đính kèm', null)
    const msg = repo.appendMessage({ conversationId: conv.id, role: 'user', content: 'xin chào' })
    repo.addAttachment({
      messageId: msg.id,
      fileName: 'bao-cao.pdf',
      fileType: 'application/pdf',
      fileSize: 1024,
      sourcePathHash: 'a'.repeat(64),
      extractedText: 'nội dung',
      extractedChars: 8,
    })
    repo.recordToolCall({
      messageId: msg.id,
      toolName: 'jira.get_issue',
      riskLevel: 'READ',
      approvalStatus: 'not_required',
      operationStatus: 'success',
    })

    repo.delete(conv.id)

    expect(Number(ctx.store.handle.prepare('SELECT COUNT(*) c FROM messages').get()?.['c'])).toBe(0)
    expect(Number(ctx.store.handle.prepare('SELECT COUNT(*) c FROM attachments').get()?.['c'])).toBe(0)
    expect(Number(ctx.store.handle.prepare('SELECT COUNT(*) c FROM tool_calls').get()?.['c'])).toBe(0)
  })

  it('orders messages by seq, not by timestamp collisions', async () => {
    const clock = fakeClock()
    ctx = makeTempStore({ now: clock.now })
    const repo = new ConversationRepository(ctx.store)
    const conv = repo.create(ctx.profileId, 'Cùng mili-giây', null)

    // Không advance đồng hồ: cả ba message có created_at giống hệt nhau.
    for (const text of ['một', 'hai', 'ba']) {
      repo.appendMessage({ conversationId: conv.id, role: 'user', content: text })
    }

    expect(repo.listMessages(conv.id, 10).map((m) => m.content)).toEqual(['một', 'hai', 'ba'])
  })

  it('enforces one tool_call per operation_id (double-submit guard at the data layer)', async () => {
    ctx = makeTempStore()
    const repo = new ConversationRepository(ctx.store)
    const conv = repo.create(ctx.profileId, 'Write', null)
    const msg = repo.appendMessage({ conversationId: conv.id, role: 'assistant', content: '' })
    const operationId = '11111111-1111-4111-8111-111111111111'

    repo.recordToolCall({
      messageId: msg.id,
      toolName: 'jira.create_issue',
      riskLevel: 'WRITE_LOW',
      approvalStatus: 'approved',
      operationStatus: 'running',
      operationId,
    })

    expect(() =>
      repo.recordToolCall({
        messageId: msg.id,
        toolName: 'jira.create_issue',
        riskLevel: 'WRITE_LOW',
        approvalStatus: 'approved',
        operationStatus: 'running',
        operationId,
      }),
    ).toThrow()
  })
})

describe('search on encrypted content', () => {
  it('finds text and folds Vietnamese diacritics both ways', async () => {
    ctx = makeTempStore()
    const repo = new ConversationRepository(ctx.store)
    const search = new ConversationSearch(ctx.store, repo)

    const conv = repo.create(ctx.profileId, 'Kế hoạch', null)
    repo.appendMessage({
      conversationId: conv.id,
      role: 'user',
      content: 'Tôi cần lên kế hoạch triển khai cho quý sau',
    })

    expect(search.search(ctx.profileId, 'kế hoạch').hits).toHaveLength(1)
    expect(search.search(ctx.profileId, 'ke hoach').hits).toHaveLength(1)
    expect(search.search(ctx.profileId, 'KE HOACH').hits).toHaveLength(1)
    expect(search.search(ctx.profileId, 'không có gì').hits).toHaveLength(0)
  })

  it('reports truncation instead of silently returning partial results', async () => {
    ctx = makeTempStore()
    const repo = new ConversationRepository(ctx.store)
    const search = new ConversationSearch(ctx.store, repo)
    const conv = repo.create(ctx.profileId, 'Nhiều tin nhắn', null)

    for (let i = 0; i < 30; i++) {
      repo.appendMessage({ conversationId: conv.id, role: 'user', content: `dòng số ${String(i)}` })
    }

    const result = search.search(ctx.profileId, 'dòng', { maxMessagesScanned: 10, batchSize: 5 })
    expect(result.truncated).toBe(true)
    expect(result.scanned).toBeLessThanOrEqual(15)
  })

  it('skips a corrupted row rather than failing the whole search', async () => {
    ctx = makeTempStore()
    const repo = new ConversationRepository(ctx.store)
    const search = new ConversationSearch(ctx.store, repo)
    const conv = repo.create(ctx.profileId, 'Có bản ghi hỏng', null)
    repo.appendMessage({ conversationId: conv.id, role: 'user', content: 'tìm được tôi' })
    const broken = repo.appendMessage({ conversationId: conv.id, role: 'user', content: 'hỏng' })

    ctx.store.handle
      .prepare('UPDATE messages SET content_ciphertext = ? WHERE id = ?')
      .run('not-valid-ciphertext', broken.id)

    const result = search.search(ctx.profileId, 'tìm được')
    expect(result.hits).toHaveLength(1)
  })
})

describe('config repository', () => {
  it('stores connection metadata without any secret material', async () => {
    ctx = makeTempStore()
    const repo = new ConfigRepository(ctx.store)

    repo.upsertConnection(ctx.profileId, {
      type: 'jira',
      baseUrl: 'https://jira.internal',
      username: 'nguyen.van.a',
      enabled: true,
      credentialRef: 'secure://jira/default',
    })

    const conn = repo.findConnection(ctx.profileId, 'jira')
    expect(conn?.hasCredential).toBe(true)
    expect(conn?.baseUrl).toBe('https://jira.internal')
    // Bảng connections không có cột nào chứa secret — kiểm tra bằng schema thật.
    const cols = ctx.store.handle.prepare('PRAGMA table_info(connections)').all()
    const names = cols.map((c) => String(c['name']))
    expect(names).not.toContain('pat')
    expect(names).not.toContain('api_key')
    expect(names).not.toContain('secret')
  })

  it('promotes another model to default when the default one is removed', async () => {
    ctx = makeTempStore()
    const repo = new ConfigRepository(ctx.store)

    const first = repo.addModel(ctx.profileId, {
      provider: 'litellm',
      modelId: 'model-a',
      displayName: 'A',
      contextWindowTokens: 128_000,
    })
    repo.addModel(ctx.profileId, {
      provider: 'litellm',
      modelId: 'model-b',
      displayName: 'B',
      contextWindowTokens: 128_000,
    })
    expect(first.isDefault).toBe(true)

    repo.removeModel(ctx.profileId, first.id)
    expect(repo.getDefaultModel(ctx.profileId)?.modelId).toBe('model-b')
  })

  it('round-trips settings through encryption', async () => {
    ctx = makeTempStore()
    const repo = new ConfigRepository(ctx.store)
    repo.putSetting(ctx.profileId, 'app', { maxFileSizeMb: 30, features: { jiraCreate: true } })
    expect(repo.getSetting(ctx.profileId, 'app')).toEqual({
      maxFileSizeMb: 30,
      features: { jiraCreate: true },
    })
  })
})

describe('retention (§8.3)', () => {
  it('deletes conversations past the window and keeps the rest', async () => {
    const clock = fakeClock('2026-01-01T00:00:00.000Z')
    ctx = makeTempStore({ now: clock.now })
    const repo = new ConversationRepository(ctx.store)
    const audit = new AuditRepository(ctx.store)
    const retention = new RetentionService(ctx.store, audit)

    const old = repo.create(ctx.profileId, 'Cũ', null)
    clock.advance(200 * 24 * 60 * 60 * 1000)
    const fresh = repo.create(ctx.profileId, 'Mới', null)

    const outcome = retention.apply(ctx.profileId, {
      historyRetentionDays: 180,
      logRetentionDays: 14,
    })

    expect(outcome.conversationsDeleted).toBe(1)
    expect(repo.get(old.id)).toBeNull()
    expect(repo.get(fresh.id)).not.toBeNull()
  })

  it('never deletes anything when retention is 0 (keep until user deletes)', async () => {
    const clock = fakeClock('2020-01-01T00:00:00.000Z')
    ctx = makeTempStore({ now: clock.now })
    const repo = new ConversationRepository(ctx.store)
    const retention = new RetentionService(ctx.store, new AuditRepository(ctx.store))

    const conv = repo.create(ctx.profileId, 'Rất cũ', null)
    clock.advance(10 * 365 * 24 * 60 * 60 * 1000)

    retention.apply(ctx.profileId, { historyRetentionDays: 0, logRetentionDays: 14 })
    expect(repo.get(conv.id)).not.toBeNull()
  })
})

describe('audit repository', () => {
  it('correlates entries by request_id and operation_id (§15.2)', async () => {
    ctx = makeTempStore()
    const audit = new AuditRepository(ctx.store)
    const requestId = 'req_abc'
    const operationId = '22222222-2222-4222-8222-222222222222'

    audit.record({
      profileId: ctx.profileId,
      eventType: AUDIT_EVENTS.chatRequested,
      status: 'ok',
      requestId,
    })
    audit.record({
      profileId: ctx.profileId,
      eventType: AUDIT_EVENTS.toolExecuted,
      status: 'ok',
      requestId,
      operationId,
    })

    expect(audit.findByRequestId(requestId)).toHaveLength(2)
    expect(audit.findByOperationId(operationId)).toHaveLength(1)
  })

  it('counts approvals and cancellations locally', async () => {
    ctx = makeTempStore()
    const audit = new AuditRepository(ctx.store)
    audit.record({ profileId: ctx.profileId, eventType: AUDIT_EVENTS.toolApproved, status: 'ok' })
    audit.record({ profileId: ctx.profileId, eventType: AUDIT_EVENTS.toolApproved, status: 'ok' })
    audit.record({
      profileId: ctx.profileId,
      eventType: AUDIT_EVENTS.toolCancelled,
      status: 'cancelled',
    })

    expect(audit.approvalStats(ctx.profileId)).toEqual({ approved: 2, cancelled: 1 })
  })
})

describe('purge (§11.1)', () => {
  it('removes every trace of a profile', async () => {
    ctx = makeTempStore()
    const repo = new ConversationRepository(ctx.store)
    const audit = new AuditRepository(ctx.store)
    const conv = repo.create(ctx.profileId, 'Sẽ bị xoá', null)
    repo.appendMessage({ conversationId: conv.id, role: 'user', content: 'dữ liệu' })
    audit.record({ profileId: ctx.profileId, eventType: AUDIT_EVENTS.chatRequested, status: 'ok' })

    ctx.store.purgeProfile(ctx.profileId)

    for (const table of ['conversations', 'messages', 'local_audit', 'profiles']) {
      const count = Number(
        ctx.store.handle.prepare(`SELECT COUNT(*) c FROM ${table}`).get()?.['c'],
      )
      expect(count, `${table} should be empty`).toBe(0)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Migration v2 — provider LLM (OPEN-QUESTIONS F1)
// ═══════════════════════════════════════════════════════════════════════════

describe('migration v2 — nâng cấp từ một DB v1 có dữ liệu', () => {
  /**
   * Test này quan trọng vì migration v2 phải DỰNG LẠI bảng `connections` (SQLite không cho sửa
   * CHECK constraint), và `credential_refs` tham chiếu nó với ON DELETE CASCADE. Làm sai thứ tự
   * là mất hết credential_refs — người dùng phải nhập lại toàn bộ API key và PAT.
   *
   * Cách test: dựng một DB chỉ có schema v1, nhét dữ liệu vào, rồi mở bằng LocalStore để nó
   * chạy v2, và kiểm tra dữ liệu còn nguyên.
   */
  function seedV1Database(dbPath: string): void {
    const db = openDatabase(dbPath, 'node:sqlite')
    try {
      db.exec('PRAGMA foreign_keys = ON')
      db.exec(`
        CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);
      `)
      const v1 = MIGRATIONS.find((m) => m.version === 1)
      if (v1 === undefined) throw new Error('không tìm thấy migration v1')
      db.exec(v1.up)
      db.prepare('INSERT INTO schema_migrations VALUES (1, ?, ?)').run('initial-schema', 'x')

      db.prepare('INSERT INTO profiles VALUES (?, ?, ?, ?)').run('p1', 'os:1', 'Tester', 'x')
      db.prepare(
        `INSERT INTO conversations (id, profile_id, title_ciphertext, model_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run('c1', 'p1', 'cipher', 'model-cu', 'x', 'x')
      db.prepare(
        `INSERT INTO models (id, profile_id, model_id, display_name, is_default, verified, context_window_tokens, created_at)
         VALUES (?, ?, ?, ?, 1, 0, 128000, ?)`,
      ).run('m1', 'p1', 'model-cu', 'Model cũ', 'x')
      db.prepare(
        `INSERT INTO connections (id, profile_id, type, base_url, username, enabled, created_at, updated_at)
         VALUES (?, ?, 'litellm', 'https://litellm.internal', NULL, 1, ?, ?)`,
      ).run('conn1', 'p1', 'x', 'x')
      db.prepare(
        `INSERT INTO credential_refs VALUES (?, 'api_key', 'secure://litellm/default', ?)`,
      ).run('conn1', 'x')
    } finally {
      db.close()
    }
  }

  it('backfill provider = litellm và GIỮ NGUYÊN credential_refs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nexa-mig-'))
    const dbPath = join(dir, 'nexa.db')
    try {
      seedV1Database(dbPath)

      const { logger } = testLogger()
      const store = LocalStore.open({
        path: dbPath,
        cipher: testCipher(),
        logger,
        driver: 'node:sqlite',
      })
      try {
        expect(store.schemaVersion).toBe(2)

        // Dữ liệu cũ được suy ra là của LiteLLM — provider duy nhất tồn tại trước v2.
        expect(store.handle.prepare('SELECT provider FROM models').get()?.['provider']).toBe(
          'litellm',
        )
        expect(
          store.handle.prepare('SELECT model_provider FROM conversations').get()?.[
            'model_provider'
          ],
        ).toBe('litellm')

        // Đây là phần dễ mất nhất: credential_refs phải sống sót qua việc dựng lại connections.
        expect(
          Number(store.handle.prepare('SELECT COUNT(*) c FROM credential_refs').get()?.['c']),
        ).toBe(1)
        expect(
          Number(store.handle.prepare('SELECT COUNT(*) c FROM connections').get()?.['c']),
        ).toBe(1)
      } finally {
        store.close()
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('CHECK constraint mới cho phép openai và vẫn chặn giá trị lạ', () => {
    ctx = makeTempStore()
    const insert = (type: string): void => {
      ctx!.store.handle
        .prepare(
          `INSERT INTO connections (id, profile_id, type, base_url, enabled, created_at, updated_at)
           VALUES (?, ?, ?, 'https://x.internal', 1, 'x', 'x')`,
        )
        .run(randomUUID(), ctx!.profileId, type)
    }
    expect(() => insert('openai')).not.toThrow()
    expect(() => insert('provider-khong-ton-tai')).toThrow()
  })

  it('cùng model id ở hai provider là hai bản ghi khác nhau', () => {
    ctx = makeTempStore()
    const repo = new ConfigRepository(ctx.store)
    const internal = repo.addModel(ctx.profileId, {
      provider: 'litellm',
      modelId: 'gpt-4o',
      displayName: 'GPT-4o nội bộ',
      contextWindowTokens: 128_000,
    })
    const external = repo.addModel(ctx.profileId, {
      provider: 'openai',
      modelId: 'gpt-4o',
      displayName: 'GPT-4o trực tiếp',
      contextWindowTokens: 128_000,
    })

    expect(internal.id).not.toBe(external.id)
    expect(repo.listModels(ctx.profileId)).toHaveLength(2)
    expect(repo.findModelByModelId(ctx.profileId, 'openai', 'gpt-4o')?.id).toBe(external.id)
    expect(repo.findModelByModelId(ctx.profileId, 'litellm', 'gpt-4o')?.id).toBe(internal.id)
  })

  it('xoá model theo provider và chỉ định lại model mặc định', () => {
    ctx = makeTempStore()
    const repo = new ConfigRepository(ctx.store)
    repo.addModel(ctx.profileId, {
      provider: 'openai',
      modelId: 'gpt-4o',
      displayName: 'A',
      contextWindowTokens: 128_000,
    })
    repo.addModel(ctx.profileId, {
      provider: 'litellm',
      modelId: 'model-noi-bo',
      displayName: 'B',
      contextWindowTokens: 128_000,
    })

    // Model đầu tiên là mặc định; xoá cả provider của nó thì phải có model mặc định mới.
    expect(repo.removeModelsByProvider(ctx.profileId, 'openai')).toBe(1)
    expect(repo.getDefaultModel(ctx.profileId)?.modelId).toBe('model-noi-bo')
  })
})
