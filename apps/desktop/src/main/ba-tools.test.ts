import { afterEach, describe, expect, it } from 'vitest'
import { BaDocumentRepository, BaKnowledgeRepository } from '@nexa/local-store'
import { baDocItemSchema, baTemplateSchema, type BaTemplate } from '@nexa/ba-kit'
import type {
  BaReviewReportView,
  LocalToolDefinition,
  LocalToolRegistry,
  ToolResultSummary,
} from '@nexa/shared-types'
import {
  BA_APPLY_TEMPLATE_TOOL,
  BA_ERROR_CODES_TOOL,
  BA_EXTRACT_TOOL,
  BA_KNOWLEDGE_SEARCH_TOOL,
  BA_REVIEW_TOOL,
  composeLocalToolRegistries,
  createBaToolRegistry,
} from './ba-tools.js'
import { makeTempStore, type TempStore } from '../../../../tests/support/factories.js'

let ctx: TempStore | null = null
afterEach(() => {
  ctx?.cleanup()
  ctx = null
})

const TEMPLATE: BaTemplate = baTemplateSchema.parse({
  id: 'us-standard',
  version: '1',
  name: 'User Story chuẩn',
  documentKind: 'us',
  sections: [
    { key: 'use-cases', title: 'Use case', required: true, itemTypes: ['use_case'] },
    { key: 'errors', title: 'Mã lỗi', required: true, itemTypes: ['error_code'] },
    { key: 'rules', title: 'Quy tắc', required: true, itemTypes: ['rule'] },
  ],
})

function makeReport(overrides: Partial<BaReviewReportView> = {}): BaReviewReportView {
  return {
    reviewId: 'rev-1',
    documentId: 'doc-1',
    rulePackId: 'nexa-ba',
    rulePackVersion: '1',
    rulesTotal: 15,
    rulesRun: 14,
    rulesPassed: 13,
    excludedNeedsReview: 0,
    knowledgeConsidered: 2,
    countsBySeverity: { blocker: 0, warning: 1, info: 0 },
    findings: [
      {
        ruleId: 'R-UC-03',
        severity: 'warning',
        itemId: 'uc-1',
        message: 'Use case "Đặt đơn" chưa có luồng ngoại lệ nào.',
        fix: 'Bổ sung ít nhất một luồng ngoại lệ.',
        evidence: [],
      },
    ],
    rules: [
      { id: 'R-UC-03', description: 'Luồng ngoại lệ', status: 'failed', findingCount: 1 },
      { id: 'R-TPL-01', description: 'Mục bắt buộc', status: 'skipped', findingCount: 0, missing: 'template' },
    ],
    createdAt: '2026-08-30T00:00:00.000Z',
    ...overrides,
  }
}

function setup(store: TempStore, reviewReport: BaReviewReportView = makeReport()) {
  const knowledge = new BaKnowledgeRepository(store.store)
  const documents = new BaDocumentRepository(store.store)
  const extractCalls: { documentId: string; text: string }[] = []
  const reviewCalls: string[] = []
  const registry = createBaToolRegistry({
    profileId: store.profileId,
    knowledge,
    documents,
    templates: [TEMPLATE],
    extract: (documentId, text) => {
      extractCalls.push({ documentId, text })
      return Promise.resolve({ itemCount: 3, needsReviewCount: 1, cached: false })
    },
    review: (documentId) => {
      reviewCalls.push(documentId)
      return reviewReport
    },
    logger: store.store.log,
  })
  return { knowledge, documents, registry, extractCalls, reviewCalls }
}

async function run(
  registry: LocalToolRegistry,
  name: string,
  input: unknown,
): Promise<ToolResultSummary> {
  const definition = registry.get(name) as LocalToolDefinition<unknown> | undefined
  if (definition === undefined) throw new Error(`tool not found: ${name}`)
  return definition.execute(definition.inputSchema.parse(input))
}

function addKnowledge(
  knowledge: BaKnowledgeRepository,
  profileId: string,
  title: string,
  body: string,
  confirm = true,
) {
  const item = knowledge.create({
    profileId,
    title,
    body,
    category: 'rule',
    sourceKind: 'manual',
    createdBy: 'user',
  })
  return confirm ? knowledge.confirm(item.id) : item
}

describe('danh mục tool BA', () => {
  it('gồm đúng năm tool đã đăng ký', () => {
    ctx = makeTempStore()
    const { registry } = setup(ctx)
    expect(registry.list().map((tool) => tool.name).sort()).toEqual(
      [
        BA_APPLY_TEMPLATE_TOOL,
        BA_ERROR_CODES_TOOL,
        BA_EXTRACT_TOOL,
        BA_KNOWLEDGE_SEARCH_TOOL,
        BA_REVIEW_TOOL,
      ].sort(),
    )
  })

  it('tool tra cứu và tổng hợp là READ, không cần xác nhận', () => {
    ctx = makeTempStore()
    const { registry } = setup(ctx)
    for (const name of [BA_KNOWLEDGE_SEARCH_TOOL, BA_ERROR_CODES_TOOL, BA_REVIEW_TOOL]) {
      expect(registry.get(name)?.riskLevel).toBe('READ')
      expect(registry.get(name)?.buildPreview).toBeUndefined()
    }
  })

  it('mọi tool ghi đều có preview — không có preview thì không có xác nhận có nghĩa', () => {
    ctx = makeTempStore()
    const { registry } = setup(ctx)
    for (const tool of registry.list()) {
      if (tool.riskLevel === 'READ') continue
      expect(tool.buildPreview, `${tool.name} thiếu preview`).toBeDefined()
    }
  })

  it('không có tool nào xoá tri thức hay tài liệu', () => {
    ctx = makeTempStore()
    const { registry } = setup(ctx)
    for (const tool of registry.list()) {
      expect(tool.riskLevel).not.toBe('DESTRUCTIVE')
      expect(tool.name).not.toContain('xoa')
    }
  })

  it('mọi tool đều mang tiền tố nexa_ba_', () => {
    ctx = makeTempStore()
    const { registry } = setup(ctx)
    for (const tool of registry.list()) expect(tool.name.startsWith('nexa_ba_')).toBe(true)
  })
})

describe('tra cứu tri thức', () => {
  it('trả về mục đã xác nhận khớp câu hỏi', async () => {
    ctx = makeTempStore()
    const { knowledge, registry } = setup(ctx)
    addKnowledge(knowledge, ctx.profileId, 'Ngưỡng miễn phí giao hàng', 'Đơn trên 500k miễn phí')

    const result = await run(registry, BA_KNOWLEDGE_SEARCH_TOOL, {
      cau_hoi: 'ngưỡng miễn phí giao hàng là bao nhiêu',
    })

    expect(result.forModel).toContain('Ngưỡng miễn phí giao hàng')
  })

  it('không trả mục còn draft', async () => {
    ctx = makeTempStore()
    const { knowledge, registry } = setup(ctx)
    addKnowledge(knowledge, ctx.profileId, 'Ngưỡng miễn phí giao hàng', 'Đơn trên 500k', false)

    const result = await run(registry, BA_KNOWLEDGE_SEARCH_TOOL, {
      cau_hoi: 'ngưỡng miễn phí giao hàng',
    })

    expect(result.forModel).toContain('Không có tri thức')
  })

  it('nói rõ "không tìm thấy" không có nghĩa là tổ chức chưa quy định', async () => {
    ctx = makeTempStore()
    const { registry } = setup(ctx)
    const result = await run(registry, BA_KNOWLEDGE_SEARCH_TOOL, { cau_hoi: 'điều gì đó' })
    expect(result.forModel).toContain('đừng kết luận là tổ chức chưa quy định')
  })

  it('tăng lượt dùng cho mục được trả về', async () => {
    ctx = makeTempStore()
    const { knowledge, registry } = setup(ctx)
    const item = addKnowledge(knowledge, ctx.profileId, 'Quy tắc huỷ đơn', 'Huỷ trong 24 giờ')

    await run(registry, BA_KNOWLEDGE_SEARCH_TOOL, { cau_hoi: 'quy tắc huỷ đơn' })

    expect(knowledge.get(item.id)?.useCount).toBe(1)
  })

  it('không tăng lượt dùng khi không mục nào khớp', async () => {
    ctx = makeTempStore()
    const { knowledge, registry } = setup(ctx)
    const item = addKnowledge(knowledge, ctx.profileId, 'Quy tắc huỷ đơn', 'Huỷ trong 24 giờ')

    await run(registry, BA_KNOWLEDGE_SEARCH_TOOL, { cau_hoi: 'chính sách nhân sự nghỉ phép' })

    expect(knowledge.get(item.id)?.useCount).toBe(0)
  })

  it('báo kết quả chưa đầy đủ khi có mục bị lọc ra', async () => {
    ctx = makeTempStore()
    const { knowledge, registry } = setup(ctx)
    addKnowledge(knowledge, ctx.profileId, 'Quy tắc huỷ đơn', 'Huỷ trong 24 giờ')
    addKnowledge(knowledge, ctx.profileId, 'Chính sách nghỉ phép', 'Mười hai ngày mỗi năm')

    const result = await run(registry, BA_KNOWLEDGE_SEARCH_TOOL, { cau_hoi: 'quy tắc huỷ đơn' })

    expect(result.incomplete).toBe(true)
    expect(result.completenessNote).toContain('2')
  })

  it('không log câu hỏi hay nội dung tri thức', async () => {
    ctx = makeTempStore()
    const { knowledge, registry } = setup(ctx)
    addKnowledge(knowledge, ctx.profileId, 'Ngưỡng miễn phí giao hàng', 'Đơn trên 500k miễn phí')

    await run(registry, BA_KNOWLEDGE_SEARCH_TOOL, { cau_hoi: 'ngưỡng miễn phí giao hàng' })

    const logged = ctx.sink.asText()
    expect(logged).toContain('ba-knowledge-search')
    expect(logged).not.toContain('Đơn trên 500k miễn phí')
    expect(logged).not.toContain('ngưỡng miễn phí giao hàng')
  })
})

describe('tổng hợp mã lỗi', () => {
  function seedDocument(documents: BaDocumentRepository, profileId: string, title: string) {
    const document = documents.create({ profileId, title, kind: 'us' })
    documents.replaceModel(document.id, {
      items: [
        baDocItemSchema.parse({
          itemType: 'error_code',
          id: 'e-1',
          ordinal: 0,
          code: 'E001',
          message: 'Giỏ hàng trống',
        }),
        baDocItemSchema.parse({
          itemType: 'use_case',
          id: 'uc-1',
          ordinal: 0,
          name: 'Đặt đơn',
          actor: 'Khách hàng',
          precondition: 'Đã đăng nhập',
          mainFlow: ['Chọn sản phẩm'],
          postcondition: 'Đơn được tạo',
          role: 'customer',
          dataEffects: ['create'],
          exceptionFlows: [{ name: 'Hết hàng', steps: ['Báo lỗi'], errorCode: 'E404' }],
        }),
      ],
      links: [],
    })
    return document
  }

  it('liệt kê mã đã khai báo và mã còn thiếu khai báo', async () => {
    ctx = makeTempStore()
    const { documents, registry } = setup(ctx)
    seedDocument(documents, ctx.profileId, 'US-01 Đặt đơn')

    const result = await run(registry, BA_ERROR_CODES_TOOL, {})

    expect(result.forModel).toContain('E001: Giỏ hàng trống')
    expect(result.forModel).toContain('CHƯA khai báo')
    expect(result.forModel).toContain('E404')
  })

  it('không tự chọn khi nhiều tài liệu cùng khớp', async () => {
    ctx = makeTempStore()
    const { documents, registry } = setup(ctx)
    seedDocument(documents, ctx.profileId, 'US-01 Đặt đơn')
    seedDocument(documents, ctx.profileId, 'US-02 Đặt lịch')

    const result = await run(registry, BA_ERROR_CODES_TOOL, { tieu_de_tai_lieu: 'Đặt' })

    expect(result.forModel).toContain('Hãy hỏi người dùng chọn tài liệu nào')
  })

  it('liệt kê tài liệu hiện có khi tiêu đề không khớp', async () => {
    ctx = makeTempStore()
    const { documents, registry } = setup(ctx)
    seedDocument(documents, ctx.profileId, 'US-01 Đặt đơn')

    const result = await run(registry, BA_ERROR_CODES_TOOL, { tieu_de_tai_lieu: 'không có' })

    expect(result.forModel).toContain('US-01 Đặt đơn')
  })

  it('báo lỗi rõ khi profile chưa có tài liệu nào', async () => {
    ctx = makeTempStore()
    const { registry } = setup(ctx)
    await expect(run(registry, BA_ERROR_CODES_TOOL, {})).rejects.toThrow()
  })
})

describe('áp mẫu chuẩn', () => {
  function seedDocument(documents: BaDocumentRepository, profileId: string, title = 'US-01') {
    const document = documents.create({ profileId, title, kind: 'us' })
    documents.replaceModel(document.id, {
      items: [
        baDocItemSchema.parse({
          itemType: 'use_case',
          id: 'uc-1',
          ordinal: 0,
          name: 'Đặt đơn',
          actor: 'Khách hàng',
          precondition: 'Đã đăng nhập',
          mainFlow: ['Chọn sản phẩm'],
          postcondition: 'Đơn được tạo',
          role: 'customer',
          dataEffects: ['create'],
        }),
      ],
      links: [],
    })
    return document
  }

  async function preview(registry: LocalToolRegistry, name: string, input: unknown) {
    const definition = registry.get(name) as LocalToolDefinition<unknown> | undefined
    if (definition?.buildPreview === undefined) throw new Error(`tool thiếu preview: ${name}`)
    return definition.buildPreview(definition.inputSchema.parse(input), {
      actingAccount: 'tester',
    })
  }

  it('preview nêu rõ tài liệu đích, mẫu và mục bắt buộc còn trống', async () => {
    ctx = makeTempStore()
    const { documents, registry } = setup(ctx)
    seedDocument(documents, ctx.profileId)

    const result = await preview(registry, BA_APPLY_TEMPLATE_TOOL, { ma_mau: 'us-standard' })

    expect(result.targetSystem).toBe('local')
    const labels = Object.fromEntries(result.payloadFields.map((f) => [f.label, f.value]))
    expect(labels['Tài liệu']).toBe('US-01')
    // Tài liệu chỉ có use case ⇒ hai mục bắt buộc còn lại phải được nêu TRƯỚC khi người dùng duyệt.
    expect(labels['Mục bắt buộc còn trống']).toContain('errors')
    expect(labels['Mục bắt buộc còn trống']).toContain('rules')
  })

  it('ghi lại cả id lẫn phiên bản mẫu', async () => {
    ctx = makeTempStore()
    const { documents, registry } = setup(ctx)
    const document = seedDocument(documents, ctx.profileId)

    await run(registry, BA_APPLY_TEMPLATE_TOOL, { ma_mau: 'us-standard' })

    const updated = documents.get(document.id)
    expect(updated?.templateId).toBe('us-standard')
    expect(updated?.templateVersion).toBe('1')
  })

  it('trả về Markdown sinh từ nội dung đã có, không thêm nội dung mới', async () => {
    ctx = makeTempStore()
    const { documents, registry } = setup(ctx)
    seedDocument(documents, ctx.profileId)

    const result = await run(registry, BA_APPLY_TEMPLATE_TOOL, { ma_mau: 'us-standard' })

    expect(result.forModel).toContain('Đặt đơn')
    expect(result.forModel).toContain('## Mã lỗi')
  })

  it('từ chối mã mẫu không có trong bộ chuẩn', async () => {
    ctx = makeTempStore()
    const { documents, registry } = setup(ctx)
    seedDocument(documents, ctx.profileId)

    await expect(run(registry, BA_APPLY_TEMPLATE_TOOL, { ma_mau: 'mau-tu-che' })).rejects.toThrow()
  })
})

describe('trích xuất từ chat', () => {
  it('preview cảnh báo rõ rằng mô hình hiện có sẽ bị thay trọn gói', async () => {
    ctx = makeTempStore()
    const { documents, registry } = setup(ctx)
    documents.create({ profileId: ctx.profileId, title: 'US-01', kind: 'us' })

    const definition = registry.get(BA_EXTRACT_TOOL) as LocalToolDefinition<unknown>
    const result = await definition.buildPreview?.(
      definition.inputSchema.parse({ noi_dung: 'Khách hàng đặt đơn.' }),
      { actingAccount: 'tester' },
    )

    expect(result?.impactWarning).toContain('THAY TOÀN BỘ')
    expect(result?.reversible).toBe(false)
  })

  it('gọi đúng job trích xuất chung, không có đường thứ hai', async () => {
    ctx = makeTempStore()
    const { documents, registry, extractCalls } = setup(ctx)
    const document = documents.create({ profileId: ctx.profileId, title: 'US-01', kind: 'us' })

    await run(registry, BA_EXTRACT_TOOL, { noi_dung: 'Khách hàng đặt đơn.' })

    expect(extractCalls).toEqual([{ documentId: document.id, text: 'Khách hàng đặt đơn.' }])
  })

  it('báo kết quả chưa đầy đủ khi còn mục cần soát', async () => {
    ctx = makeTempStore()
    const { documents, registry } = setup(ctx)
    documents.create({ profileId: ctx.profileId, title: 'US-01', kind: 'us' })

    const result = await run(registry, BA_EXTRACT_TOOL, { noi_dung: 'Khách hàng đặt đơn.' })

    expect(result.incomplete).toBe(true)
    expect(result.completenessNote).toContain('1 mục')
  })

  it('không tự chọn tài liệu khi có nhiều tài liệu khớp', async () => {
    ctx = makeTempStore()
    const { documents, registry } = setup(ctx)
    documents.create({ profileId: ctx.profileId, title: 'US-01 Đặt đơn', kind: 'us' })
    documents.create({ profileId: ctx.profileId, title: 'US-02 Đặt lịch', kind: 'us' })

    await expect(
      run(registry, BA_EXTRACT_TOOL, { tieu_de_tai_lieu: 'Đặt', noi_dung: 'Nội dung.' }),
    ).rejects.toThrow()
  })
})

describe('ghép registry tool cục bộ', () => {
  it('trả null khi không registry nào bật', () => {
    expect(composeLocalToolRegistries([null, null])).toBeNull()
  })

  it('ghép được nhiều registry', () => {
    ctx = makeTempStore()
    const { registry } = setup(ctx)
    const merged = composeLocalToolRegistries([null, registry])
    expect(merged?.list()).toHaveLength(5)
    expect(merged?.get(BA_KNOWLEDGE_SEARCH_TOOL)).toBeDefined()
  })

  it('từ chối hai tool trùng tên thay vì để cái sau thắng', () => {
    ctx = makeTempStore()
    const { registry } = setup(ctx)
    expect(() => composeLocalToolRegistries([registry, registry])).toThrow()
  })

  /**
   * ADR 0009: khối `tools` là prefix của prompt, nên số prefix khả dĩ phải là hằng số nhỏ.
   *
   * Danh mục tool cục bộ chỉ phụ thuộc hai CỜ, không phụ thuộc câu hỏi — nên hai cờ cho đúng bốn
   * danh sách khả dĩ, nhân với 6 preset Atlassian. Test này đỏ ngay nếu có người làm danh mục BA
   * thành động theo ngữ cảnh.
   */
  it('danh mục tool cục bộ chỉ phụ thuộc cờ, cho đúng bốn tổ hợp', () => {
    ctx = makeTempStore()
    const { registry } = setup(ctx)
    const fakeCommitmentRegistry: LocalToolRegistry = {
      list: () => [{ name: 'nexa_tao_cam_ket' } as LocalToolDefinition],
      get: () => undefined,
    }

    const combos = [
      [null, null],
      [fakeCommitmentRegistry, null],
      [null, registry],
      [fakeCommitmentRegistry, registry],
    ] as const

    const shapes = combos.map((combo) =>
      (composeLocalToolRegistries(combo)?.list() ?? [])
        .map((tool) => tool.name)
        .sort()
        .join(','),
    )

    expect(new Set(shapes).size).toBe(4)
    expect(shapes[0]).toBe('')
  })
})

describe('tool kiểm tra tài liệu', () => {
  function seedDocument(store: TempStore, documents: BaDocumentRepository) {
    return documents.create({ profileId: store.profileId, title: 'US-01 Đặt đơn', kind: 'us' })
  }

  it('nêu rule pack, phiên bản và số luật đã kiểm', async () => {
    ctx = makeTempStore()
    const { registry, documents } = setup(ctx)
    seedDocument(ctx, documents)

    const result = await run(registry, BA_REVIEW_TOOL, {})

    expect(result.forModel).toContain('nexa-ba')
    expect(result.forModel).toContain('phiên bản 1')
    expect(result.forModel).toContain('14/15 luật')
  })

  it('mỗi phát hiện đi kèm mã luật', async () => {
    ctx = makeTempStore()
    const { registry, documents } = setup(ctx)
    seedDocument(ctx, documents)

    const result = await run(registry, BA_REVIEW_TOOL, {})

    expect(result.forModel).toContain('[R-UC-03]')
  })

  it('nói rõ luật nào chưa kiểm được và đánh dấu kết quả là chưa trọn vẹn', async () => {
    ctx = makeTempStore()
    const { registry, documents } = setup(ctx)
    seedDocument(ctx, documents)

    const result = await run(registry, BA_REVIEW_TOOL, {})

    expect(result.forModel).toContain('R-TPL-01')
    expect(result.forModel).toContain('thiếu template')
    expect(result.incomplete).toBe(true)
  })

  it('KHÔNG dùng chữ "đầy đủ" cho toàn tài liệu, kể cả khi mọi luật đều đạt', async () => {
    ctx = makeTempStore()
    const clean = makeReport({
      rulesRun: 15,
      rulesPassed: 15,
      excludedNeedsReview: 0,
      countsBySeverity: { blocker: 0, warning: 0, info: 0 },
      findings: [],
      rules: [{ id: 'R-UC-03', description: 'Luồng ngoại lệ', status: 'passed', findingCount: 0 }],
    })
    const { registry, documents } = setup(ctx, clean)
    seedDocument(ctx, documents)

    const result = await run(registry, BA_REVIEW_TOOL, {})

    expect(result.forModel).not.toContain('đầy đủ')
    expect(result.forUser).not.toContain('đầy đủ')
    // Và nói thẳng giới hạn thay vì để model tự suy ra.
    expect(result.forModel).toContain('KHÔNG có nghĩa tài liệu đã đủ')
  })

  it('mô tả tool dặn model không được thêm, bớt hay hạ mức phát hiện', () => {
    ctx = makeTempStore()
    const { registry } = setup(ctx)
    const description = registry.get(BA_REVIEW_TOOL)?.description ?? ''
    expect(description).toContain('đừng thêm')
    expect(description).toContain('hạ mức')
  })

  it('chạy đúng bộ luật của tài liệu được chọn, không tự chọn hộ khi có nhiều tài liệu khớp', async () => {
    ctx = makeTempStore()
    const { registry, documents, reviewCalls } = setup(ctx)
    const document = seedDocument(ctx, documents)
    documents.create({ profileId: ctx.profileId, title: 'US-02 Huỷ đơn', kind: 'us' })

    await run(registry, BA_REVIEW_TOOL, { tieu_de_tai_lieu: 'US-01' })
    expect(reviewCalls).toEqual([document.id])

    const ambiguous = await run(registry, BA_REVIEW_TOOL, { tieu_de_tai_lieu: 'US-0' })
    expect(ambiguous.forModel).toContain('Hãy hỏi người dùng')
    expect(reviewCalls).toHaveLength(1)
  })

  it('log của tool chỉ có id và số đếm, không có nội dung phát hiện', async () => {
    ctx = makeTempStore()
    const { registry, documents } = setup(ctx)
    seedDocument(ctx, documents)

    await run(registry, BA_REVIEW_TOOL, {})

    const logged = ctx.sink.asText()
    expect(logged).toContain('ba-review-tool')
    expect(logged).not.toContain('luồng ngoại lệ')
    expect(logged).not.toContain('Đặt đơn')
  })
})
