import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { baDocItemSchema, type BaDocModel } from '@nexa/ba-kit'
import {
  BaDocumentRepository,
  BaKnowledgeRepository,
  BaReviewRepository,
  ConversationRepository,
  LATEST_SCHEMA_VERSION,
} from './index.js'
import { makeTempStore, type TempStore } from '../../../tests/support/factories.js'

let ctx: TempStore | null = null
afterEach(() => {
  ctx?.cleanup()
  ctx = null
})

const BA_TABLES = [
  'ba_knowledge',
  'ba_knowledge_links',
  'ba_documents',
  'ba_doc_items',
  'ba_doc_links',
  'ba_reviews',
]

function tableNames(store: TempStore['store']): string[] {
  return store.handle
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
    .all()
    .map((row) => String(row['name']))
}

function knowledgeInput(profileId: string, overrides: Record<string, unknown> = {}) {
  return {
    profileId,
    title: 'Quy tắc tính phí giao hàng',
    body: 'Đơn trên 500k được miễn phí giao hàng nội thành',
    category: 'rule' as const,
    sourceKind: 'manual' as const,
    createdBy: 'user' as const,
    ...overrides,
  }
}

function makeModel(): BaDocModel {
  const useCase = baDocItemSchema.parse({
    itemType: 'use_case',
    id: 'uc-1',
    ordinal: 0,
    name: 'Khách hàng đặt đơn',
    actor: 'Khách hàng',
    precondition: 'Đã đăng nhập',
    mainFlow: ['Chọn sản phẩm', 'Xác nhận đơn'],
    postcondition: 'Đơn được tạo',
    role: 'customer',
    dataEffects: ['create'],
  })
  const errorCode = baDocItemSchema.parse({
    itemType: 'error_code',
    id: 'e-1',
    ordinal: 0,
    code: 'E001',
    message: 'Giỏ hàng trống',
  })
  return {
    items: [useCase, errorCode],
    links: [{ from: 'uc-1', to: 'e-1', kind: 'raises', label: 'khi giỏ rỗng' }],
  }
}

describe('migration v9', () => {
  it('tạo đủ bảng ba_ và không tạo ba_projects hay ba_templates', () => {
    ctx = makeTempStore()
    const names = tableNames(ctx.store)
    for (const table of BA_TABLES) expect(names).toContain(table)
    expect(names).not.toContain('ba_projects')
    expect(names).not.toContain('ba_templates')
    expect(ctx.store.schemaVersion).toBe(LATEST_SCHEMA_VERSION)
  })

  it('rollback xoá trọn các bảng ba_', () => {
    ctx = makeTempStore()
    ctx.store.rollbackTo(8)
    const names = tableNames(ctx.store)
    for (const table of BA_TABLES) expect(names).not.toContain(table)
  })

  it('không có cột plaintext nào chứa nội dung nghiệp vụ', () => {
    ctx = makeTempStore()
    const contentColumns = ctx.store.handle
      .prepare(`PRAGMA table_info(ba_doc_items)`)
      .all()
      .map((row) => String(row['name']))
    expect(contentColumns).toContain('payload_ciphertext')
    expect(contentColumns).not.toContain('payload')
    expect(contentColumns).not.toContain('anchor_key')
  })
})

describe('kho tri thức', () => {
  it('mã hoá tiêu đề và nội dung — không đọc được bằng công cụ SQLite thường', () => {
    ctx = makeTempStore()
    const repo = new BaKnowledgeRepository(ctx.store)
    const item = repo.create(knowledgeInput(ctx.profileId))

    expect(item.title).toBe('Quy tắc tính phí giao hàng')
    expect(repo.get(item.id)?.body).toBe('Đơn trên 500k được miễn phí giao hàng nội thành')

    const raw = ctx.store.handle.prepare('SELECT * FROM ba_knowledge WHERE id = ?').get(item.id)
    expect(String(raw?.['title_ciphertext'])).not.toContain('Quy tắc')

    ctx.store.close()
    const bytes = readFileSync(ctx.dbPath).toString('utf8')
    expect(bytes).not.toContain('Quy tắc tính phí giao hàng')
    expect(bytes).not.toContain('miễn phí giao hàng nội thành')
  })

  it('tạo mặc định ở trạng thái draft', () => {
    ctx = makeTempStore()
    const repo = new BaKnowledgeRepository(ctx.store)
    const item = repo.create(knowledgeInput(ctx.profileId, { createdBy: 'agent' }))
    expect(item.status).toBe('draft')
    expect(item.confirmedAt).toBeNull()
  })

  it('confirm đóng dấu thời điểm xác nhận', () => {
    ctx = makeTempStore()
    const repo = new BaKnowledgeRepository(ctx.store)
    const item = repo.confirm(repo.create(knowledgeInput(ctx.profileId)).id)
    expect(item.status).toBe('confirmed')
    expect(item.confirmedAt).not.toBeNull()
  })

  it('thay thế giữ lại item cũ và nối quan hệ supersedes', () => {
    ctx = makeTempStore()
    const repo = new BaKnowledgeRepository(ctx.store)
    const old = repo.confirm(repo.create(knowledgeInput(ctx.profileId)).id)
    const fresh = repo.confirm(
      repo.create(knowledgeInput(ctx.profileId, { title: 'Quy tắc phí mới' })).id,
    )

    const superseded = repo.supersede(old.id, fresh.id)
    expect(superseded.status).toBe('outdated')
    expect(superseded.supersededBy).toBe(fresh.id)
    expect(repo.get(old.id)).not.toBeNull()
    expect(repo.listLinks(ctx.profileId).map((link) => link.kind)).toContain('supersedes')
  })

  it('không cho confirm lại item đã outdated', () => {
    ctx = makeTempStore()
    const repo = new BaKnowledgeRepository(ctx.store)
    const old = repo.create(knowledgeInput(ctx.profileId))
    const fresh = repo.create(knowledgeInput(ctx.profileId, { title: 'Bản mới' }))
    repo.supersede(old.id, fresh.id)
    expect(() => repo.confirm(old.id)).toThrow()
  })

  it('chỉ trả item confirmed cho context, mới nhất trước', () => {
    ctx = makeTempStore()
    const repo = new BaKnowledgeRepository(ctx.store)
    const first = repo.confirm(repo.create(knowledgeInput(ctx.profileId, { title: 'Một' })).id)
    const second = repo.confirm(repo.create(knowledgeInput(ctx.profileId, { title: 'Hai' })).id)
    repo.create(knowledgeInput(ctx.profileId, { title: 'Còn nháp' }))

    const forContext = repo.listForContext(ctx.profileId, 30)
    expect(forContext.map((item) => item.id)).toEqual([second.id, first.id])
  })

  it('tôn trọng giới hạn số item của context', () => {
    ctx = makeTempStore()
    const repo = new BaKnowledgeRepository(ctx.store)
    for (let i = 0; i < 5; i += 1) {
      repo.confirm(repo.create(knowledgeInput(ctx.profileId, { title: `Item ${i}` })).id)
    }
    expect(repo.listForContext(ctx.profileId, 3)).toHaveLength(3)
  })

  it('đếm lượt dùng và thống kê được tri thức chưa ai dùng', () => {
    ctx = makeTempStore()
    const repo = new BaKnowledgeRepository(ctx.store)
    const used = repo.confirm(repo.create(knowledgeInput(ctx.profileId, { title: 'Có dùng' })).id)
    repo.confirm(repo.create(knowledgeInput(ctx.profileId, { title: 'Chưa dùng' })).id)

    repo.recordUsage([used.id, used.id])

    const stats = repo.stats(ctx.profileId)
    expect(repo.get(used.id)?.useCount).toBe(2)
    expect(repo.get(used.id)?.lastUsedAt).not.toBeNull()
    expect(stats.unusedConfirmed).toBe(1)
    expect(stats.mostUsed[0]).toEqual({ id: used.id, title: 'Có dùng', useCount: 2 })
  })

  it('thống kê theo category và đếm cặp mâu thuẫn', () => {
    ctx = makeTempStore()
    const repo = new BaKnowledgeRepository(ctx.store)
    const a = repo.confirm(repo.create(knowledgeInput(ctx.profileId, { title: 'A' })).id)
    const b = repo.confirm(
      repo.create(knowledgeInput(ctx.profileId, { title: 'B', category: 'domain' })).id,
    )
    repo.link(a.id, b.id, 'conflicts')

    const stats = repo.stats(ctx.profileId)
    expect(stats.total).toEqual({ draft: 0, confirmed: 2, outdated: 0 })
    expect(stats.byCategory.find((row) => row.category === 'rule')?.confirmed).toBe(1)
    expect(stats.byCategory.find((row) => row.category === 'domain')?.confirmed).toBe(1)
    expect(stats.conflictPairs).toBe(1)
  })

  it('không nối quan hệ với chính nó', () => {
    ctx = makeTempStore()
    const repo = new BaKnowledgeRepository(ctx.store)
    const item = repo.create(knowledgeInput(ctx.profileId))
    expect(() => repo.link(item.id, item.id, 'conflicts')).toThrow()
  })

  it('giữ tri thức khi hội thoại nguồn bị xoá', () => {
    ctx = makeTempStore()
    const conversations = new ConversationRepository(ctx.store)
    const conversation = conversations.create(ctx.profileId, 'Phiên phân tích', null)
    const repo = new BaKnowledgeRepository(ctx.store)
    const item = repo.create(
      knowledgeInput(ctx.profileId, {
        sourceKind: 'conversation',
        sourceConversationId: conversation.id,
      }),
    )

    conversations.delete(conversation.id)

    expect(repo.get(item.id)?.sourceConversationId).toBeNull()
    expect(repo.get(item.id)?.title).toBe('Quy tắc tính phí giao hàng')
  })

  it('xoá sạch khi purge profile', () => {
    ctx = makeTempStore()
    const repo = new BaKnowledgeRepository(ctx.store)
    const a = repo.create(knowledgeInput(ctx.profileId))
    const b = repo.create(knowledgeInput(ctx.profileId, { title: 'Khác' }))
    repo.link(a.id, b.id, 'conflicts')

    ctx.store.purgeProfile(ctx.profileId)

    expect(ctx.store.handle.prepare('SELECT COUNT(*) AS c FROM ba_knowledge').get()?.['c']).toBe(0)
    expect(
      ctx.store.handle.prepare('SELECT COUNT(*) AS c FROM ba_knowledge_links').get()?.['c'],
    ).toBe(0)
  })
})

describe('tài liệu BA', () => {
  it('ghi và đọc lại trọn mô hình', () => {
    ctx = makeTempStore()
    const repo = new BaDocumentRepository(ctx.store)
    const document = repo.create({ profileId: ctx.profileId, title: 'US-01', kind: 'us' })

    repo.replaceModel(document.id, makeModel())
    const model = repo.readModel(document.id)

    expect(model.items.map((item) => item.id).sort()).toEqual(['e-1', 'uc-1'])
    expect(model.links).toEqual([{ from: 'uc-1', to: 'e-1', kind: 'raises', label: 'khi giỏ rỗng' }])
  })

  it('mã hoá payload item — mã lỗi không đọc được trong file DB', () => {
    ctx = makeTempStore()
    const repo = new BaDocumentRepository(ctx.store)
    const document = repo.create({ profileId: ctx.profileId, title: 'US-01', kind: 'us' })
    repo.replaceModel(document.id, makeModel())

    ctx.store.close()
    const bytes = readFileSync(ctx.dbPath).toString('utf8')
    expect(bytes).not.toContain('Giỏ hàng trống')
    expect(bytes).not.toContain('Khách hàng đặt đơn')
  })

  it('thay mô hình là thay trọn gói, không merge', () => {
    ctx = makeTempStore()
    const repo = new BaDocumentRepository(ctx.store)
    const document = repo.create({ profileId: ctx.profileId, title: 'US-01', kind: 'us' })
    repo.replaceModel(document.id, makeModel())

    repo.replaceModel(document.id, { items: [], links: [] })

    expect(repo.readModel(document.id).items).toEqual([])
    expect(
      ctx.store.handle.prepare('SELECT COUNT(*) AS c FROM ba_doc_links').get()?.['c'],
    ).toBe(0)
  })

  it('từ chối link trỏ tới item ngoài mô hình', () => {
    ctx = makeTempStore()
    const repo = new BaDocumentRepository(ctx.store)
    const document = repo.create({ profileId: ctx.profileId, title: 'US-01', kind: 'us' })
    const model = makeModel()

    expect(() =>
      repo.replaceModel(document.id, {
        items: model.items,
        links: [{ from: 'uc-1', to: 'khong-co', kind: 'raises' }],
      }),
    ).toThrow()
  })

  it('đếm được item cần soát mà không phải giải mã', () => {
    ctx = makeTempStore()
    const repo = new BaDocumentRepository(ctx.store)
    const document = repo.create({ profileId: ctx.profileId, title: 'US-01', kind: 'us' })
    const model = makeModel()
    const flagged = baDocItemSchema.parse({
      itemType: 'rule',
      id: 'r-1',
      ordinal: 0,
      statement: 'Chưa rõ ngưỡng miễn phí',
      needsReview: true,
    })

    repo.replaceModel(document.id, { items: [...model.items, flagged], links: model.links })

    expect(repo.countNeedsReview(document.id)).toBe(1)
  })

  it('cột needs_review luôn khớp payload vì repository là người ghi duy nhất', () => {
    ctx = makeTempStore()
    const repo = new BaDocumentRepository(ctx.store)
    const document = repo.create({ profileId: ctx.profileId, title: 'US-01', kind: 'us' })
    const flagged = baDocItemSchema.parse({
      itemType: 'rule',
      id: 'r-1',
      ordinal: 0,
      statement: 'Chưa rõ ngưỡng miễn phí',
      needsReview: true,
    })
    repo.replaceModel(document.id, { items: [flagged], links: [] })

    const row = ctx.store.handle.prepare('SELECT needs_review FROM ba_doc_items WHERE id = ?').get('r-1')
    expect(Number(row?.['needs_review'])).toBe(1)
    expect(repo.readModel(document.id).items[0]?.needsReview).toBe(true)
  })

  it('hai tài liệu dùng được cùng một id item', () => {
    ctx = makeTempStore()
    const repo = new BaDocumentRepository(ctx.store)
    const first = repo.create({ profileId: ctx.profileId, title: 'US-01', kind: 'us' })
    const second = repo.create({ profileId: ctx.profileId, title: 'US-02', kind: 'us' })

    // Id item do bước trích xuất sinh, chỉ duy nhất trong một tài liệu. Khoá chính ghép
    // (document_id, id) là thứ làm điều này chạy được.
    repo.replaceModel(first.id, makeModel())
    repo.replaceModel(second.id, makeModel())

    expect(repo.readModel(first.id).items).toHaveLength(2)
    expect(repo.readModel(second.id).items).toHaveLength(2)
  })

  it('link không nối được sang item của tài liệu khác', () => {
    ctx = makeTempStore()
    const repo = new BaDocumentRepository(ctx.store)
    const first = repo.create({ profileId: ctx.profileId, title: 'US-01', kind: 'us' })
    const second = repo.create({ profileId: ctx.profileId, title: 'US-02', kind: 'us' })
    repo.replaceModel(first.id, makeModel())

    // uc-1 tồn tại ở tài liệu kia, nhưng không thuộc mô hình đang ghi.
    expect(() =>
      repo.replaceModel(second.id, {
        items: [],
        links: [{ from: 'uc-1', to: 'e-1', kind: 'raises' }],
      }),
    ).toThrow()
  })

  it('xoá tài liệu kéo theo item và link', () => {
    ctx = makeTempStore()
    const repo = new BaDocumentRepository(ctx.store)
    const document = repo.create({ profileId: ctx.profileId, title: 'US-01', kind: 'us' })
    repo.replaceModel(document.id, makeModel())

    repo.delete(document.id)

    expect(ctx.store.handle.prepare('SELECT COUNT(*) AS c FROM ba_doc_items').get()?.['c']).toBe(0)
    expect(ctx.store.handle.prepare('SELECT COUNT(*) AS c FROM ba_doc_links').get()?.['c']).toBe(0)
  })

  it('purge profile xoá cả tài liệu lẫn item', () => {
    ctx = makeTempStore()
    const repo = new BaDocumentRepository(ctx.store)
    const document = repo.create({ profileId: ctx.profileId, title: 'US-01', kind: 'us' })
    repo.replaceModel(document.id, makeModel())

    ctx.store.purgeProfile(ctx.profileId)

    expect(ctx.store.handle.prepare('SELECT COUNT(*) AS c FROM ba_documents').get()?.['c']).toBe(0)
    expect(ctx.store.handle.prepare('SELECT COUNT(*) AS c FROM ba_doc_items').get()?.['c']).toBe(0)
  })
})

describe('báo cáo review', () => {
  const finding = {
    ruleId: 'R-UC-03',
    severity: 'warning' as const,
    itemId: 'uc-1',
    message: 'Use case "Khách hàng đặt đơn" chưa có luồng ngoại lệ nào.',
    fix: 'Bổ sung ít nhất một luồng ngoại lệ.',
    evidence: [],
  }

  function seed(store: TempStore) {
    const documents = new BaDocumentRepository(store.store)
    const document = documents.create({ profileId: store.profileId, title: 'US-01', kind: 'us' })
    return { reviews: new BaReviewRepository(store.store), documentId: document.id }
  }

  function input(documentId: string) {
    return {
      documentId,
      rulePackId: 'nexa-ba',
      rulePackVersion: '1',
      rulesRun: 12,
      rulesPassed: 11,
      excludedNeedsReview: 2,
      knowledgeConsidered: 3,
      findings: [finding],
      skippedRules: [{ ruleId: 'R-TPL-01', missing: 'template' as const }],
    }
  }

  it('lưu id và phiên bản rule pack cùng mỗi báo cáo', () => {
    ctx = makeTempStore()
    const { reviews, documentId } = seed(ctx)

    const review = reviews.create(input(documentId))

    expect(review.rulePackId).toBe('nexa-ba')
    expect(review.rulePackVersion).toBe('1')
    expect(review.rulesRun).toBe(12)
    expect(review.rulesPassed).toBe(11)
    expect(review.excludedNeedsReview).toBe(2)
  })

  it('đọc lại đúng finding và danh sách luật bị bỏ qua', () => {
    ctx = makeTempStore()
    const { reviews, documentId } = seed(ctx)
    const created = reviews.create(input(documentId))

    const read = reviews.get(created.id)

    expect(read?.findings).toEqual([finding])
    expect(read?.skippedRules).toEqual([{ ruleId: 'R-TPL-01', missing: 'template' }])
    expect(read?.knowledgeConsidered).toBe(3)
  })

  it('nội dung finding được mã hoá — không đọc được bằng truy vấn SQLite thường', () => {
    ctx = makeTempStore()
    const { reviews, documentId } = seed(ctx)
    reviews.create(input(documentId))

    const raw = ctx.store.handle.prepare('SELECT * FROM ba_reviews').get()
    expect(String(raw?.['findings_ciphertext'])).not.toContain('luồng ngoại lệ')
    // Nhưng id và phiên bản pack thì để rõ — đó là thứ dùng để so hai báo cáo với nhau.
    expect(String(raw?.['rule_pack_version'])).toBe('1')

    ctx.store.close()
    expect(readFileSync(ctx.dbPath).toString('utf8')).not.toContain('Khách hàng đặt đơn')
  })

  it('trả báo cáo mới nhất trước', () => {
    ctx = makeTempStore()
    const { reviews, documentId } = seed(ctx)
    const first = reviews.create(input(documentId))
    const second = reviews.create({ ...input(documentId), rulePackVersion: '2' })

    expect(reviews.latest(documentId)?.id).toBe(second.id)
    expect(reviews.list(documentId).map((entry) => entry.id)).toContain(first.id)
  })

  it('xoá tài liệu xoá luôn báo cáo của nó', () => {
    ctx = makeTempStore()
    const documents = new BaDocumentRepository(ctx.store)
    const document = documents.create({ profileId: ctx.profileId, title: 'US-01', kind: 'us' })
    new BaReviewRepository(ctx.store).create(input(document.id))

    documents.delete(document.id)

    expect(ctx.store.handle.prepare('SELECT COUNT(*) AS c FROM ba_reviews').get()?.['c']).toBe(0)
  })

  it('log của repository chỉ có id và số đếm, không có nội dung finding', () => {
    ctx = makeTempStore()
    const { reviews, documentId } = seed(ctx)
    reviews.create(input(documentId))

    const logged = ctx.sink.asText()
    expect(logged).toContain('ba-review-recorded')
    expect(logged).not.toContain('luồng ngoại lệ')
    expect(logged).not.toContain('R-UC-03')
  })
})
