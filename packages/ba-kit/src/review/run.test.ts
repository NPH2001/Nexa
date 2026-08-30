import { describe, expect, it } from 'vitest'
import {
  TEST_RULEBOOK,
  TEST_TEMPLATE,
  makeErrorCode,
  makeField,
  makeFlowStep,
  makeKnowledge,
  makeModel,
  makeRule,
  makeUseCase,
} from '../testing.js'
import { RULE_PACK_V1, findRulePack } from './registry.js'
import { runReview } from './run.js'
import { makeFinding, type ReviewRule, type RulePack } from './types.js'

/** Một tài liệu đủ xấu để mọi nhóm luật có việc làm, và đủ nhỏ để đọc được. */
function messyDocument() {
  return makeModel(
    [
      makeUseCase({ id: 'uc-1', name: 'Đặt đơn', actor: 'TBD' }),
      makeFlowStep({ id: 'fs-1', label: 'Kiểm tồn kho', errorCode: 'E404' }),
      makeField({ id: 'f-1', name: 'Email', validations: [] }),
      makeErrorCode({ id: 'ec-1', code: 'E001' }),
      makeRule({ id: 'r-1', statement: 'Cho phép sửa đơn sau khi xác nhận' }),
      makeRule({ id: 'r-2', statement: 'Không cho phép sửa đơn sau khi xác nhận' }),
    ],
    [],
  )
}

describe('bộ chạy review', () => {
  it('báo cáo nêu rule pack, số luật đã chạy và số luật đạt', () => {
    const report = runReview(RULE_PACK_V1, { model: messyDocument() })

    expect(report.rulePackId).toBe(RULE_PACK_V1.id)
    expect(report.rulePackVersion).toBe(RULE_PACK_V1.version)
    expect(report.rulesTotal).toBe(15)
    expect(report.rulesRun + report.skippedRules.length).toBe(report.rulesTotal)
    expect(report.rulesPassed).toBeLessThanOrEqual(report.rulesRun)
  })

  it('không có finding nào thiếu rule id', () => {
    const report = runReview(RULE_PACK_V1, { model: messyDocument() })
    expect(report.findings.length).toBeGreaterThan(0)
    for (const finding of report.findings) {
      expect(finding.ruleId).not.toBe('')
      expect(finding.fix).not.toBe('')
    }
  })

  it('luật thiếu căn cứ bị BỎ QUA và báo rõ, không bị tính là đã đạt', () => {
    const report = runReview(RULE_PACK_V1, { model: messyDocument() })
    expect(report.skippedRules.map((entry) => entry.ruleId).sort()).toEqual([
      'R-FLD-02',
      'R-KB-01',
      'R-TPL-01',
    ])
    expect(report.skippedRules.find((entry) => entry.ruleId === 'R-TPL-01')?.missing).toBe(
      'template',
    )
    expect(report.findings.some((finding) => finding.ruleId === 'R-TPL-01')).toBe(false)
  })

  it('có đủ mẫu, rulebook và tri thức thì cả 15 luật đều chạy', () => {
    const report = runReview(RULE_PACK_V1, {
      model: messyDocument(),
      template: TEST_TEMPLATE,
      rulebook: TEST_RULEBOOK,
      knowledge: [makeKnowledge({ id: 'k-1' })],
    })
    expect(report.skippedRules).toEqual([])
    expect(report.rulesRun).toBe(15)
  })

  it('loại item còn cần soát khỏi căn cứ và báo số bị loại', () => {
    const report = runReview(RULE_PACK_V1, {
      model: makeModel([
        makeUseCase({ id: 'uc-1', standalone: true, exceptionFlows: [{ name: 'X', steps: ['Y'] }], noAlternateReason: 'Chỉ một đường' }),
        makeErrorCode({ id: 'ec-1', code: 'E001', needsReview: true }),
      ]),
    })

    expect(report.excludedNeedsReview).toBe(1)
    // Mã lỗi chưa soát không được dùng làm căn cứ, nên nó cũng không sinh finding "mã thừa".
    expect(report.findings.some((finding) => finding.itemId === 'ec-1')).toBe(false)
  })

  it('chỉ tri thức confirmed được đếm là căn cứ', () => {
    const report = runReview(RULE_PACK_V1, {
      model: messyDocument(),
      knowledge: [
        makeKnowledge({ id: 'k-1' }),
        makeKnowledge({ id: 'k-2', status: 'draft' }),
        makeKnowledge({ id: 'k-3', status: 'outdated' }),
      ],
    })
    expect(report.knowledgeConsidered).toBe(1)
  })

  it('đếm finding theo mức', () => {
    const report = runReview(RULE_PACK_V1, { model: messyDocument() })
    const total =
      report.countsBySeverity.blocker +
      report.countsBySeverity.warning +
      report.countsBySeverity.info
    expect(total).toBe(report.findings.length)
    expect(report.countsBySeverity.blocker).toBeGreaterThan(0)
  })
})

describe('tính lặp lại', () => {
  it('cùng tài liệu + cùng phiên bản pack ⇒ cùng tập finding, kể cả thứ tự', () => {
    const first = runReview(RULE_PACK_V1, { model: messyDocument() })
    const second = runReview(RULE_PACK_V1, { model: messyDocument() })
    expect(second).toEqual(first)
  })

  it('đổi thứ tự item trong mô hình không đổi kết quả', () => {
    const model = messyDocument()
    const reversed = { items: [...model.items].reverse(), links: model.links }

    expect(runReview(RULE_PACK_V1, { model: reversed }).findings).toEqual(
      runReview(RULE_PACK_V1, { model }).findings,
    )
  })

  it('finding được gom theo luật, theo đúng thứ tự đăng ký trong pack', () => {
    const report = runReview(RULE_PACK_V1, { model: messyDocument() })
    const order = new Map(RULE_PACK_V1.rules.map((rule, index) => [rule.id, index] as const))
    const seen = report.findings.map((finding) => order.get(finding.ruleId) ?? -1)
    expect(seen).toEqual([...seen].sort((a, b) => a - b))
  })
})

describe('luật là registry, không phải if-else', () => {
  it('thêm một luật mới chỉ cần đăng ký — bộ chạy không đổi', () => {
    const R_DEMO_01: ReviewRule = {
      id: 'R-DEMO-01',
      description: 'Luật của một domain mới.',
      defaultSeverity: 'info',
      evaluate: ({ doc }) =>
        doc.items.length === 0
          ? []
          : [makeFinding(R_DEMO_01, { message: 'có item', fix: 'không cần làm gì' })],
    }
    const pack: RulePack = {
      id: 'demo',
      version: '1',
      name: 'Pack demo',
      rules: [...RULE_PACK_V1.rules, R_DEMO_01],
    }

    const report = runReview(pack, { model: messyDocument() })
    expect(report.rulesTotal).toBe(16)
    expect(report.findings.some((finding) => finding.ruleId === 'R-DEMO-01')).toBe(true)
  })

  it('mọi luật trong pack có id duy nhất và mô tả', () => {
    const ids = RULE_PACK_V1.rules.map((rule) => rule.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const rule of RULE_PACK_V1.rules) {
      expect(rule.description).not.toBe('')
    }
  })

  it('tra được pack theo id và phiên bản, không rơi về pack hiện hành khi tra hụt', () => {
    expect(findRulePack(RULE_PACK_V1.id, RULE_PACK_V1.version)).toBe(RULE_PACK_V1)
    expect(findRulePack(RULE_PACK_V1.id, '99')).toBeNull()
  })
})
