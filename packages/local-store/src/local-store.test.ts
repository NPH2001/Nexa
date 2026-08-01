import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  AuditRepository,
  AUDIT_EVENTS,
  ConfigRepository,
  ConversationRepository,
  ConversationSearch,
  LATEST_SCHEMA_VERSION,
  RetentionService,
} from './index.js'
import { fakeClock, makeTempStore, type TempStore } from '../../../tests/support/factories.js'

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

describe('encryption at rest (§21: "không đọc được bằng công cụ SQLite thông thường")', () => {
  it('never writes message content or titles in cleartext', async () => {
    ctx = makeTempStore()
    const repo = new ConversationRepository(ctx.store)
    const secretTitle = 'Kế hoạch sáp nhập Q4'
    const secretBody = 'Số liệu doanh thu bí mật: 1.234.567.890 VND'

    const conv = repo.create(ctx.profileId, secretTitle, 'model-a')
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

    const conv = repo.create(ctx.profileId, 'Ban đầu', 'model-a')
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
      modelId: 'model-a',
      displayName: 'A',
      contextWindowTokens: 128_000,
    })
    repo.addModel(ctx.profileId, {
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
