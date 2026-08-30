import { describe, expect, it } from 'vitest'
import type {
  BaErrorCodePageView,
  BaFieldAuditView,
  BaFindingView,
  BaItemSummaryView,
  BaKnowledgeView,
  BaProjectionsView,
  BaReviewReportView,
  BaTraceabilityView,
} from '@nexa/shared-types/renderer'
import {
  REVIEW_SCOPE_NOTE,
  describeRulePackChange,
  describeSkippedRules,
  describeTemplateState,
  fieldsMissingValidation,
  filterKnowledge,
  formatUsage,
  groupFindings,
  groupItems,
  summarizeErrorPage,
  summarizeFieldAudits,
  summarizeMatrix,
  summarizeReview,
} from './ba-ui.js'

function item(overrides: Partial<BaItemSummaryView> = {}): BaItemSummaryView {
  return {
    id: 'i-1',
    itemType: 'rule',
    ordinal: 0,
    needsReview: false,
    title: 'Quy tắc',
    detail: '',
    ...overrides,
  }
}

function knowledge(overrides: Partial<BaKnowledgeView> = {}): BaKnowledgeView {
  return {
    id: 'k-1',
    title: 'Ngưỡng miễn phí',
    body: 'Đơn trên 500k',
    category: 'rule',
    status: 'confirmed',
    sourceKind: 'manual',
    sourceRef: null,
    sourceConversationId: null,
    supersededBy: null,
    createdBy: 'user',
    useCount: 0,
    lastUsedAt: null,
    confirmedAt: null,
    createdAt: '2026-08-30T00:00:00.000Z',
    updatedAt: '2026-08-30T00:00:00.000Z',
    ...overrides,
  }
}

function page(counts: Partial<BaErrorCodePageView['counts']> = {}): BaErrorCodePageView {
  return {
    declared: [],
    undeclared: [],
    unreferenced: [],
    inconsistent: [],
    counts: {
      declared: 0,
      undeclared: 0,
      unreferenced: 0,
      inconsistent: 0,
      excludedNeedsReview: 0,
      ...counts,
    },
  }
}

describe('nhóm item tài liệu', () => {
  it('tách phần cần soát ra khỏi các nhóm', () => {
    const result = groupItems([
      item({ id: 'a' }),
      item({ id: 'b', needsReview: true }),
    ])
    expect(result.groups.flatMap((group) => group.items).map((entry) => entry.id)).toEqual(['a'])
    expect(result.needsReview.map((entry) => entry.id)).toEqual(['b'])
  })

  it('sắp nhóm từ khái quát tới chi tiết, không theo bảng chữ cái', () => {
    const result = groupItems([
      item({ id: 'e', itemType: 'error_code' }),
      item({ id: 'a', itemType: 'actor' }),
      item({ id: 'u', itemType: 'use_case' }),
    ])
    expect(result.groups.map((group) => group.itemType)).toEqual([
      'actor',
      'use_case',
      'error_code',
    ])
  })

  it('bỏ nhóm rỗng', () => {
    const result = groupItems([item({ itemType: 'rule' })])
    expect(result.groups).toHaveLength(1)
  })

  it('sắp item trong nhóm theo ordinal', () => {
    const result = groupItems([
      item({ id: 'b', ordinal: 2 }),
      item({ id: 'a', ordinal: 1 }),
    ])
    expect(result.groups[0]?.items.map((entry) => entry.id)).toEqual(['a', 'b'])
  })
})

describe('tóm tắt trang mã lỗi', () => {
  it('không dùng chữ "đầy đủ" cho toàn tài liệu', () => {
    const headline = summarizeErrorPage(page({ declared: 3 }))
    expect(headline.text).not.toContain('đầy đủ')
    expect(headline.tone).toBe('ok')
  })

  it('cảnh báo khi có mã chưa khai báo', () => {
    const headline = summarizeErrorPage(page({ declared: 2, undeclared: 1 }))
    expect(headline.tone).toBe('warning')
    expect(headline.text).toContain('chưa khai báo')
  })

  it('cảnh báo khi một mã mang hai thông điệp', () => {
    expect(summarizeErrorPage(page({ inconsistent: 1 })).tone).toBe('warning')
  })

  it('nói rõ số mục bị loại vì còn cần soát', () => {
    const headline = summarizeErrorPage(page({ declared: 1, excludedNeedsReview: 2 }))
    expect(headline.text).toContain('2 mục còn cần soát')
  })

  it('mục bị loại không tự biến trang thành cảnh báo', () => {
    expect(summarizeErrorPage(page({ declared: 1, excludedNeedsReview: 2 })).tone).toBe('ok')
  })
})

describe('lọc tri thức', () => {
  const items = [
    knowledge({ id: 'a', status: 'draft', category: 'rule' }),
    knowledge({ id: 'b', status: 'confirmed', category: 'term' }),
  ]

  it('không lọc gì khi chọn tất cả', () => {
    expect(filterKnowledge(items, { status: 'all', category: 'all' })).toHaveLength(2)
  })

  it('lọc đồng thời theo trạng thái và nhóm', () => {
    expect(filterKnowledge(items, { status: 'confirmed', category: 'term' })).toHaveLength(1)
    expect(filterKnowledge(items, { status: 'confirmed', category: 'rule' })).toHaveLength(0)
  })
})

describe('nhãn lượt dùng', () => {
  it('gọi thẳng tên tri thức chưa dùng lần nào', () => {
    expect(formatUsage(knowledge({ useCount: 0 }))).toBe('Chưa dùng lần nào')
  })

  it('đếm lượt dùng khi đã có', () => {
    expect(formatUsage(knowledge({ useCount: 3 }))).toBe('Đã dùng 3 lần')
  })
})

function matrix(overrides: Partial<BaTraceabilityView> = {}): BaTraceabilityView {
  return {
    steps: [],
    useCases: [],
    uncoveredSteps: [],
    unusedUseCases: [],
    excludedNeedsReview: 0,
    ...overrides,
  }
}

function audit(overrides: Partial<BaFieldAuditView> = {}): BaFieldAuditView {
  return {
    fieldId: 'f-1',
    fieldName: 'Email',
    fieldType: 'email',
    expected: [{ key: 'email-format', label: 'Đúng định dạng email' }],
    missing: [],
    unknownKeys: [],
    ...overrides,
  }
}

function projections(overrides: Partial<BaProjectionsView> = {}): BaProjectionsView {
  return {
    mermaid: { code: 'flowchart TD', isolatedSteps: [], stepCount: 0, edgeCount: 0 },
    matrix: matrix(),
    fieldAudits: [],
    nearDuplicates: [],
    potentialContradictions: [],
    template: null,
    markdown: null,
    missingRequired: [],
    unplacedCount: 0,
    ...overrides,
  }
}

describe('tóm tắt ma trận truy vết', () => {
  it('nói đã đối chiếu được gì, không phán tài liệu đúng sai', () => {
    const headline = summarizeMatrix(
      matrix({ steps: [{ id: 'fs-1', label: 'Một', coveredBy: ['uc-1'] }] }),
    )
    expect(headline.text).toContain('Đã đối chiếu')
    expect(headline.text).not.toContain('đầy đủ')
    expect(headline.tone).toBe('ok')
  })

  it('cảnh báo khi có bước chưa được phủ', () => {
    const headline = summarizeMatrix(matrix({ uncoveredSteps: ['fs-1'] }))
    expect(headline.tone).toBe('warning')
    expect(headline.text).toContain('chưa use case nào phủ')
  })

  it('cảnh báo khi có use case không chạm bước nào', () => {
    expect(summarizeMatrix(matrix({ unusedUseCases: ['uc-1'] })).tone).toBe('warning')
  })

  it('mục bị loại vì cần soát không tự biến ma trận thành cảnh báo', () => {
    const headline = summarizeMatrix(matrix({ excludedNeedsReview: 2 }))
    expect(headline.tone).toBe('ok')
    expect(headline.text).toContain('2 mục còn cần soát')
  })
})

describe('tóm tắt đối chiếu validate', () => {
  it('không có trường nào thì nói rõ là chưa có gì để đối chiếu', () => {
    expect(summarizeFieldAudits([]).text).toContain('chưa khai trường dữ liệu nào')
  })

  it('cảnh báo khi có trường thiếu validate', () => {
    const headline = summarizeFieldAudits([
      audit({ missing: [{ key: 'email-format', label: 'Đúng định dạng email' }] }),
    ])
    expect(headline.tone).toBe('warning')
    expect(headline.text).toContain('1 trường còn thiếu validate')
  })

  it('trường được miễn có lý do không bị tính là thiếu', () => {
    const headline = summarizeFieldAudits([audit({ exemptReason: 'Ghi chú nội bộ' })])
    expect(headline.tone).toBe('ok')
    expect(headline.text).toContain('được miễn có lý do')
  })

  it('lọc ra đúng những trường còn thiếu', () => {
    const list = fieldsMissingValidation([
      audit({ fieldId: 'a' }),
      audit({ fieldId: 'b', missing: [{ key: 'max-length', label: 'Giới hạn độ dài' }] }),
    ])
    expect(list.map((entry) => entry.fieldId)).toEqual(['b'])
  })
})

describe('trạng thái mẫu của tài liệu', () => {
  it('chưa chọn mẫu thì không nói gì — chưa chọn không phải lỗi', () => {
    expect(describeTemplateState(projections())).toBeNull()
  })

  it('mẫu khớp và không thiếu gì thì không cảnh báo', () => {
    const state = describeTemplateState(
      projections({ template: { id: 'us-standard', version: '1', name: 'US chuẩn' } }),
    )
    expect(state?.tone).toBe('ok')
    expect(state?.text).toContain('US chuẩn')
  })

  it('cảnh báo khi thiếu mục bắt buộc', () => {
    const state = describeTemplateState(
      projections({
        template: { id: 'us-standard', version: '1', name: 'US chuẩn' },
        missingRequired: ['errors'],
      }),
    )
    expect(state?.tone).toBe('warning')
    expect(state?.text).toContain('1 mục bắt buộc còn trống')
  })

  it('cảnh báo khi tài liệu theo bản mẫu cũ', () => {
    const state = describeTemplateState(
      projections({
        template: { id: 'us-standard', version: '2', name: 'US chuẩn' },
        templateOutdated: true,
      }),
    )
    expect(state?.tone).toBe('warning')
    expect(state?.text).toContain('bản mới hơn')
  })

  it('cảnh báo khi có mục nằm ngoài mẫu', () => {
    const state = describeTemplateState(
      projections({
        template: { id: 'us-standard', version: '1', name: 'US chuẩn' },
        unplacedCount: 3,
      }),
    )
    expect(state?.tone).toBe('warning')
    expect(state?.text).toContain('3 mục nằm ngoài mẫu')
  })
})

function finding(overrides: Partial<BaFindingView> = {}): BaFindingView {
  return {
    ruleId: 'R-UC-03',
    severity: 'warning',
    itemId: 'uc-1',
    message: 'Use case "Đặt đơn" chưa có luồng ngoại lệ nào.',
    fix: 'Bổ sung ít nhất một luồng ngoại lệ.',
    evidence: [],
    ...overrides,
  }
}

function report(overrides: Partial<BaReviewReportView> = {}): BaReviewReportView {
  return {
    reviewId: 'rev-1',
    documentId: 'doc-1',
    rulePackId: 'nexa-ba',
    rulePackVersion: '1',
    rulesTotal: 15,
    rulesRun: 15,
    rulesPassed: 15,
    excludedNeedsReview: 0,
    knowledgeConsidered: 0,
    countsBySeverity: { blocker: 0, warning: 0, info: 0 },
    findings: [],
    rules: [],
    createdAt: '2026-08-30T00:00:00.000Z',
    ...overrides,
  }
}

describe('tóm tắt báo cáo review', () => {
  /**
   * Đây là test quan trọng nhất của màn hình này.
   *
   * "15/15 luật đạt" là đúng lúc mà chữ "đầy đủ" dễ lọt vào nhất, và cũng là lúc nó sai nhất: bộ
   * luật kiểm cấu trúc và đối chiếu KB, nó không biết một yêu cầu chưa ai nghĩ tới.
   */
  it('KHÔNG dùng chữ "đầy đủ" cho toàn tài liệu, kể cả khi 15/15 luật đạt', () => {
    const headline = summarizeReview(report())
    expect(headline.text).not.toContain('đầy đủ')
    expect(headline.text).toContain('15/15 luật')
    expect(headline.text).toContain('không có phát hiện nào')
    expect(headline.tone).toBe('ok')
  })

  it('câu ghi chú phạm vi nói thẳng giới hạn, không rào đón', () => {
    expect(REVIEW_SCOPE_NOTE).not.toContain('đầy đủ')
    expect(REVIEW_SCOPE_NOTE).toContain('không biết một yêu cầu nghiệp vụ chưa ai nghĩ tới')
  })

  it('nêu rule pack và phiên bản — con số "đạt" phải có đơn vị', () => {
    const headline = summarizeReview(report())
    expect(headline.text).toContain('nexa-ba')
    expect(headline.text).toContain('phiên bản 1')
  })

  it('đếm phát hiện theo mức và chuyển sang cảnh báo', () => {
    const headline = summarizeReview(
      report({
        rulesPassed: 13,
        countsBySeverity: { blocker: 1, warning: 2, info: 0 },
        findings: [finding({ severity: 'blocker' }), finding(), finding()],
      }),
    )
    expect(headline.tone).toBe('warning')
    expect(headline.text).toContain('1 chỗ phải sửa')
    expect(headline.text).toContain('2 chỗ nên xem lại')
  })

  it('nói rõ số luật chưa kiểm được và số mục bị loại', () => {
    const headline = summarizeReview(
      report({
        rulesRun: 14,
        rulesPassed: 14,
        excludedNeedsReview: 3,
        rules: [
          { id: 'R-TPL-01', description: 'Mục bắt buộc', status: 'skipped', findingCount: 0, missing: 'template' },
        ],
      }),
    )
    expect(headline.text).toContain('1 luật chưa kiểm được')
    expect(headline.text).toContain('3 mục còn cần soát đã bị loại')
  })

  it('mục bị loại không tự biến báo cáo thành cảnh báo', () => {
    expect(summarizeReview(report({ excludedNeedsReview: 3 })).tone).toBe('ok')
  })
})

describe('luật chưa kiểm được', () => {
  it('không có luật nào bị bỏ thì không hiện dòng nào', () => {
    expect(describeSkippedRules(report())).toBeNull()
  })

  it('gọi tên luật và nói vì sao chưa kiểm được', () => {
    const text = describeSkippedRules(
      report({
        rules: [
          { id: 'R-TPL-01', description: '', status: 'skipped', findingCount: 0, missing: 'template' },
          { id: 'R-KB-01', description: '', status: 'skipped', findingCount: 0, missing: 'knowledge' },
        ],
      }),
    )
    expect(text).toContain('R-TPL-01')
    expect(text).toContain('chưa chọn mẫu')
    expect(text).toContain('chưa có tri thức nào đã xác nhận')
  })
})

describe('gom phát hiện theo mức', () => {
  it('nặng trước, bỏ nhóm rỗng', () => {
    const groups = groupFindings(
      report({
        findings: [finding(), finding({ severity: 'blocker', itemId: 'uc-2' })],
        countsBySeverity: { blocker: 1, warning: 1, info: 0 },
      }),
    )
    expect(groups.map((group) => group.severity)).toEqual(['blocker', 'warning'])
  })

  it('không có phát hiện nào thì không có nhóm nào', () => {
    expect(groupFindings(report())).toEqual([])
  })
})

describe('đổi phiên bản rule pack', () => {
  it('cùng phiên bản thì không nói gì', () => {
    expect(describeRulePackChange(report())).toBeNull()
  })

  it('khác phiên bản thì nói rõ hai báo cáo không so trực tiếp được', () => {
    const text = describeRulePackChange(report({ previousRulePackVersion: '0' }))
    expect(text).toContain('phiên bản 0')
    expect(text).toContain('không so trực tiếp')
  })
})
