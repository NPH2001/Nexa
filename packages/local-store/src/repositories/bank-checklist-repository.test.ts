import { afterEach, describe, expect, it } from 'vitest'
import { runBankChecklistReview, type BankChecklistTemplate } from '@nexa/document-checklist'
import { makeTempStore, type TempStore } from '../../../../tests/support/factories.js'
import { BankChecklistRepository } from './bank-checklist-repository.js'

let ctx: TempStore | null = null
afterEach(() => {
  ctx?.cleanup()
  ctx = null
})

const template: BankChecklistTemplate = {
  id: 'retail-kyc-basic',
  version: '1.0',
  name: 'KYC cơ bản',
  caseType: 'retail_kyc',
  requirements: [
    {
      id: 'identity-document',
      label: 'Giấy tờ định danh',
      acceptedDocumentTypes: ['national_id'],
      requiredFields: ['full_name', 'identity_number', 'expiry_date'],
      expiryField: 'expiry_date',
    },
  ],
  crossChecks: [],
}

describe('BankChecklistRepository', () => {
  it('mã hóa metadata nghiệp vụ và đọc lại đúng schema', () => {
    ctx = makeTempStore()
    const repo = new BankChecklistRepository(ctx.store)
    const item = repo.create({
      profileId: ctx.profileId,
      title: 'KYC khách hàng tuyệt mật',
      templateId: template.id,
      templateVersion: template.version,
    })
    const evidence = repo.addDocument({
      caseId: item.id,
      fileName: 'CCCD Nguyen Van A.pdf',
      sourcePathHash: 'a'.repeat(64),
      output: {
        documentType: 'national_id',
        needsReview: false,
        fields: [
          { key: 'full_name', value: 'Nguyễn Văn A', sourceLabel: 'trang 1', needsReview: false },
          {
            key: 'identity_number',
            value: '012345678901',
            sourceLabel: 'trang 1',
            needsReview: false,
          },
          { key: 'expiry_date', value: '2030-01-01', sourceLabel: 'trang 1', needsReview: false },
        ],
      },
      suspectedScan: false,
      truncated: false,
    })

    const rawCase = ctx.store.handle
      .prepare('SELECT title_ciphertext FROM bank_checklist_cases WHERE id = ?')
      .get(item.id)
    const rawDocument = ctx.store.handle
      .prepare(
        'SELECT file_name_ciphertext, payload_ciphertext FROM bank_case_documents WHERE id = ?',
      )
      .get(evidence.id)
    const raw = JSON.stringify({ rawCase, rawDocument })
    expect(raw).not.toContain('KYC khách hàng tuyệt mật')
    expect(raw).not.toContain('CCCD Nguyen Van A.pdf')
    expect(raw).not.toContain('Nguyễn Văn A')
    expect(repo.get(item.id)?.documentCount).toBe(1)
    expect(repo.listDocuments(item.id)[0]?.fields[0]?.value).toBe('Nguyễn Văn A')
  })

  it('lưu báo cáo theo phiên bản và cascade khi xóa hồ sơ', () => {
    ctx = makeTempStore()
    const repo = new BankChecklistRepository(ctx.store)
    const item = repo.create({
      profileId: ctx.profileId,
      title: 'KYC-01',
      templateId: template.id,
      templateVersion: template.version,
    })
    repo.addDocument({
      caseId: item.id,
      fileName: 'id.pdf',
      sourcePathHash: 'b'.repeat(64),
      output: { documentType: 'national_id', needsReview: true, fields: [] },
      suspectedScan: false,
      truncated: false,
    })
    const report = runBankChecklistReview(
      template,
      repo.listDocuments(item.id),
      new Date('2026-08-30T00:00:00.000Z'),
    )
    const saved = repo.saveReview(item.id, report)

    expect(repo.latestReview(item.id)?.id).toBe(saved.id)
    expect(repo.get(item.id)?.status).toBe('reviewed')
    repo.delete(item.id)
    expect(
      Number(
        ctx.store.handle
          .prepare('SELECT COUNT(*) AS c FROM bank_case_documents WHERE case_id = ?')
          .get(item.id)?.['c'],
      ),
    ).toBe(0)
    expect(
      Number(
        ctx.store.handle
          .prepare('SELECT COUNT(*) AS c FROM bank_checklist_reviews WHERE case_id = ?')
          .get(item.id)?.['c'],
      ),
    ).toBe(0)
  })
})
