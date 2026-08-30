import { describe, expect, it } from 'vitest'
import { checklistStatusClass, summarizeBankChecklist } from './bank-checklist-ui.js'

describe('bank checklist UI helpers', () => {
  it('does not present passed rules as an approval', () => {
    const summary = summarizeBankChecklist({
      reviewId: 'review-1',
      rulePackId: 'bank-document-checklist',
      rulePackVersion: '1',
      templateId: 'retail-kyc-basic',
      templateVersion: '1.0',
      reviewedAt: '2026-08-30T00:00:00.000Z',
      items: [],
      counts: { passed: 2, missing: 1, expired: 0, mismatch: 1, unreadable: 0, needs_review: 1 },
    })
    expect(summary).toBe('2 đạt luật đã chạy · 3 cần xử lý')
    expect(summary.toLowerCase()).not.toContain('phê duyệt')
  })

  it('keeps uncertain and failing states visually distinct', () => {
    expect(checklistStatusClass('needs_review')).toBe('tag-warning')
    expect(checklistStatusClass('missing')).toBe('tag-danger')
    expect(checklistStatusClass('passed')).toBe('tag-success')
  })
})
