import { afterEach, describe, expect, it } from 'vitest'
import { baDocItemSchema, type BaDocModel } from '@nexa/ba-kit'
import {
  ActivityRepository,
  BaDocumentRepository,
  BaKnowledgeRepository,
  BaReviewRepository,
} from '@nexa/local-store'
import { DEFAULT_APP_SETTINGS } from '@nexa/shared-types'
import type { ChatRequest, ChatResult } from '@nexa/llm-client'
import { BaReviewService, type ReviewLlm } from './ba-review.js'
import { EMPTY_BA_STANDARDS, type BaStandards } from './ba-standards.js'
import { makeTempStore, type TempStore } from '../../../../tests/support/factories.js'

let ctx: TempStore | null = null
afterEach(() => {
  ctx?.cleanup()
  ctx = null
})

class FakeLlm implements ReviewLlm {
  readonly requests: ChatRequest[] = []
  constructor(private readonly reply: string) {}

  complete(request: ChatRequest): Promise<ChatResult> {
    this.requests.push(request)
    return Promise.resolve({ text: this.reply, toolCalls: [], finishReason: 'stop' })
  }
}

/** Một use case thiếu luồng ngoại lệ — đủ để `R-UC-03` có việc làm. */
function model(): BaDocModel {
  return {
    items: [
      baDocItemSchema.parse({
        itemType: 'use_case',
        id: 'uc-1',
        ordinal: 0,
        name: 'Khách hàng đặt đơn',
        actor: 'Khách hàng',
        precondition: 'Đã đăng nhập',
        mainFlow: ['Chọn sản phẩm'],
        postcondition: 'Đơn được tạo',
        role: 'customer',
        dataEffects: ['create'],
        standalone: true,
        noAlternateReason: 'Chỉ có một đường duyệt',
      }),
    ],
    links: [],
  }
}

function setup(
  store: TempStore,
  opts: { llm?: FakeLlm; standards?: BaStandards } = {},
) {
  const documents = new BaDocumentRepository(store.store)
  const knowledge = new BaKnowledgeRepository(store.store)
  const reviews = new BaReviewRepository(store.store)
  const activity = new ActivityRepository(store.store)
  const llm = opts.llm ?? new FakeLlm('{"goi_y":"Bổ sung luồng ngoại lệ khi hết hàng."}')

  const service = new BaReviewService({
    profileId: store.profileId,
    documents,
    knowledge,
    reviews,
    activity,
    standards: () => opts.standards ?? EMPTY_BA_STANDARDS,
    resolveModel: () => ({ modelId: 'model-a', provider: 'litellm' }),
    buildLlmClient: () => llm,
    settings: () => DEFAULT_APP_SETTINGS,
    logger: store.store.log,
  })

  const document = documents.create({ profileId: store.profileId, title: 'US-01', kind: 'us' })
  documents.replaceModel(document.id, model())

  return { service, documents, knowledge, reviews, activity, llm, documentId: document.id }
}

describe('chạy review', () => {
  it('không gọi model lần nào — phán quyết do code trả', () => {
    ctx = makeTempStore()
    const { service, llm, documentId } = setup(ctx)

    const report = service.run(documentId)

    expect(llm.requests).toEqual([])
    expect(report.findings.some((finding) => finding.ruleId === 'R-UC-03')).toBe(true)
  })

  it('báo cáo nêu rule pack, phiên bản, số luật đã chạy và số luật đạt', () => {
    ctx = makeTempStore()
    const { service, documentId } = setup(ctx)

    const report = service.run(documentId)

    expect(report.rulePackId).toBe('nexa-ba')
    expect(report.rulePackVersion).toBe('1')
    expect(report.rulesTotal).toBe(15)
    expect(report.rules).toHaveLength(15)
    expect(report.rules.filter((rule) => rule.status === 'skipped').map((rule) => rule.id)).toEqual([
      'R-FLD-02',
      'R-TPL-01',
      'R-KB-01',
    ])
  })

  it('lưu báo cáo lại được, đọc ra đúng finding đã sinh', () => {
    ctx = makeTempStore()
    const { service, reviews, documentId } = setup(ctx)

    const report = service.run(documentId)

    expect(reviews.latest(documentId)?.id).toBe(report.reviewId)
    expect(reviews.latest(documentId)?.findings).toEqual(
      report.findings.map((finding) => ({ ...finding })),
    )
  })

  it('chạy hai lần trên cùng dữ liệu cho cùng tập finding', () => {
    ctx = makeTempStore()
    const { service, documentId } = setup(ctx)

    const first = service.run(documentId)
    const second = service.run(documentId)

    expect(second.findings).toEqual(first.findings)
    expect(second.rulesPassed).toBe(first.rulesPassed)
  })

  it('nêu rõ báo cáo trước chạy bằng phiên bản pack khác', () => {
    ctx = makeTempStore()
    const { service, reviews, documentId } = setup(ctx)
    reviews.create({
      documentId,
      rulePackId: 'nexa-ba',
      rulePackVersion: '0',
      rulesRun: 3,
      rulesPassed: 3,
      excludedNeedsReview: 0,
      knowledgeConsidered: 0,
      findings: [],
      skippedRules: [],
    })

    expect(service.run(documentId).previousRulePackVersion).toBe('0')
  })

  it('tăng use_count cho tri thức mà R-KB-01 dùng làm căn cứ', () => {
    ctx = makeTempStore()
    const { service, knowledge, documents, documentId } = setup(ctx)
    const fact = knowledge.confirm(
      knowledge.create({
        profileId: ctx.profileId,
        title: 'Sửa đơn sau xác nhận',
        body: 'Cho phép sửa đơn sau khi xác nhận',
        category: 'rule',
        sourceKind: 'manual',
        createdBy: 'user',
      }).id,
    )
    documents.replaceModel(documentId, {
      items: [
        ...model().items,
        baDocItemSchema.parse({
          itemType: 'rule',
          id: 'r-1',
          ordinal: 0,
          statement: 'Không cho phép sửa đơn sau khi xác nhận',
          appliesTo: ['uc-1'],
        }),
      ],
      links: [],
    })

    const report = service.run(documentId)

    expect(report.findings.some((finding) => finding.ruleId === 'R-KB-01')).toBe(true)
    expect(knowledge.get(fact.id)?.useCount).toBe(1)
  })

  it('log chỉ có id và số đếm, không có nội dung finding', () => {
    ctx = makeTempStore()
    const { service, documentId } = setup(ctx)

    service.run(documentId)

    const logged = ctx.sink.asText()
    expect(logged).toContain('ba-review-completed')
    expect(logged).not.toContain('luồng ngoại lệ')
    expect(logged).not.toContain('Khách hàng đặt đơn')
    expect(logged).not.toContain('R-UC-03')
  })
})

describe('gợi ý câu chữ', () => {
  it('trả về đúng finding do code sinh ra, cộng một chuỗi gợi ý', async () => {
    ctx = makeTempStore()
    const { service, documentId } = setup(ctx)
    const report = service.run(documentId)
    const target = report.findings.find((finding) => finding.ruleId === 'R-UC-03')

    const result = await service.suggestWording(documentId, {
      ruleId: 'R-UC-03',
      itemId: target?.itemId ?? null,
    })

    expect(result.finding).toEqual(target)
    expect(result.suggestion).toBe('Bổ sung luồng ngoại lệ khi hết hàng.')
  })

  /**
   * Đây là test giữ D2 đứng vững.
   *
   * Model được cho cơ hội làm cả ba việc bị cấm cùng lúc: xoá finding (`"bo_qua": true`), thay tập
   * finding (`"findings": []`), và hạ mức (`"severity": "info"`). Kết quả phải y hệt bản do code
   * sinh ra.
   */
  it('model KHÔNG thêm, KHÔNG xoá, KHÔNG hạ mức được finding', async () => {
    ctx = makeTempStore()
    const hostile = new FakeLlm(
      JSON.stringify({
        goi_y: 'Câu chữ đề xuất',
        bo_qua: true,
        severity: 'info',
        findings: [],
        them_finding: [{ ruleId: 'R-BIA-01', severity: 'blocker', message: 'Finding bịa' }],
      }),
    )
    const { service, documentId } = setup(ctx, { llm: hostile })
    const report = service.run(documentId)
    const target = report.findings.find((finding) => finding.ruleId === 'R-UC-03')

    const result = await service.suggestWording(documentId, {
      ruleId: 'R-UC-03',
      itemId: target?.itemId ?? null,
    })

    expect(result.finding).toEqual(target)
    expect(result.finding.severity).toBe('warning')
    expect(result.suggestion).toBe('Câu chữ đề xuất')
    // Báo cáo đã lưu cũng không suy suyển.
    expect(service.history(documentId)[0]?.findings).toEqual(report.findings)
  })

  it('từ chối con trỏ tới một finding không có trong báo cáo', async () => {
    ctx = makeTempStore()
    const { service, documentId } = setup(ctx)
    service.run(documentId)

    await expect(
      service.suggestWording(documentId, { ruleId: 'R-BIA-01', itemId: 'uc-1' }),
    ).rejects.toThrow()
  })

  it('từ chối output không phải JSON đúng schema thay vì ép kiểu', async () => {
    ctx = makeTempStore()
    const { service, documentId } = setup(ctx, { llm: new FakeLlm('xin lỗi tôi không chắc') })
    const report = service.run(documentId)
    const target = report.findings.find((finding) => finding.ruleId === 'R-UC-03')

    await expect(
      service.suggestWording(documentId, { ruleId: 'R-UC-03', itemId: target?.itemId ?? null }),
    ).rejects.toThrow()
  })

  it('chỉ gửi tóm tắt hai dòng của item, không gửi payload đầy đủ', async () => {
    ctx = makeTempStore()
    const { service, llm, documentId } = setup(ctx)
    const report = service.run(documentId)
    const target = report.findings.find((finding) => finding.ruleId === 'R-UC-03')

    await service.suggestWording(documentId, {
      ruleId: 'R-UC-03',
      itemId: target?.itemId ?? null,
    })

    const sent = JSON.stringify(llm.requests[0]?.messages ?? [])
    expect(sent).toContain('Khách hàng đặt đơn')
    // Bước của luồng chính không phải thứ cần để đề xuất một câu chữ.
    expect(sent).not.toContain('Chọn sản phẩm')
  })
})

describe('áp dụng một finding', () => {
  it('sửa đúng item đó và ghi một dòng activity', () => {
    ctx = makeTempStore()
    const { service, documents, activity, documentId } = setup(ctx)

    service.applyFinding({
      documentId,
      itemId: 'uc-1',
      field: 'role',
      value: 'order_admin',
    })

    expect(documents.readModel(documentId).items[0]).toMatchObject({ role: 'order_admin' })

    const events = activity.list(ctx.profileId, { limit: 10, offset: 0 })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'ba_document_mutation',
      action: 'updated',
      subjectType: 'ba_document',
      subjectId: documentId,
      actor: 'user',
    })
  })

  it('từ chối ô không thuộc kiểu item và KHÔNG ghi activity', () => {
    ctx = makeTempStore()
    const { service, activity, documentId } = setup(ctx)

    expect(() =>
      service.applyFinding({
        documentId,
        itemId: 'uc-1',
        field: 'message',
        value: 'Đơn hàng rỗng',
      }),
    ).toThrow()

    expect(activity.list(ctx.profileId, { limit: 10, offset: 0 })).toHaveLength(0)
  })

  it('dòng activity chỉ có id và enum — không có nội dung đã sửa', () => {
    ctx = makeTempStore()
    const { service, documentId } = setup(ctx)

    service.applyFinding({
      documentId,
      itemId: 'uc-1',
      field: 'postcondition',
      value: 'Đơn được ghi vào sổ và gửi thông báo cho kho',
    })

    const logged = ctx.sink.asText()
    expect(logged).toContain('ba-review-finding-applied')
    expect(logged).not.toContain('gửi thông báo cho kho')
  })
})
