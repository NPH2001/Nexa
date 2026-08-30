import { randomUUID } from 'node:crypto'
import {
  bankChecklistReportSchema,
  bankDocumentEvidenceSchema,
  type BankChecklistReport,
  type BankDocumentEvidence,
  type BankExtractionOutput,
} from '@nexa/document-checklist'
import { ERROR_CODES, NexaError } from '@nexa/shared-types'
import type { LocalStore } from '../store.js'

const CTX = {
  title: 'bank_checklist_cases.title',
  fileName: 'bank_case_documents.file_name',
  evidence: 'bank_case_documents.evidence',
  report: 'bank_checklist_reviews.report',
} as const

export interface BankChecklistCase {
  readonly id: string
  readonly profileId: string
  readonly title: string
  readonly templateId: string
  readonly templateVersion: string
  readonly status: 'draft' | 'reviewed'
  readonly documentCount: number
  readonly createdAt: string
  readonly updatedAt: string
}

export interface BankChecklistReview {
  readonly id: string
  readonly caseId: string
  readonly report: BankChecklistReport
  readonly createdAt: string
}

export interface AddBankDocumentInput {
  readonly caseId: string
  readonly fileName: string
  readonly sourcePathHash: string
  readonly output: BankExtractionOutput
  readonly suspectedScan: boolean
  readonly truncated: boolean
}

export class BankChecklistRepository {
  constructor(private readonly store: LocalStore) {}

  create(input: {
    profileId: string
    title: string
    templateId: string
    templateVersion: string
  }): BankChecklistCase {
    const id = randomUUID()
    const now = this.store.nowIso()
    this.store.handle
      .prepare(
        `INSERT INTO bank_checklist_cases
           (id, profile_id, title_ciphertext, template_id, template_version, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)`,
      )
      .run(
        id,
        input.profileId,
        this.store.cipher.encrypt(CTX.title, input.title),
        input.templateId,
        input.templateVersion,
        now,
        now,
      )
    return this.getOrThrow(id)
  }

  get(id: string): BankChecklistCase | null {
    const row = this.store.handle
      .prepare(
        `SELECT c.*,
                (SELECT COUNT(*) FROM bank_case_documents d WHERE d.case_id = c.id) AS document_count
         FROM bank_checklist_cases c WHERE c.id = ?`,
      )
      .get(id)
    return row === undefined ? null : this.mapCase(row)
  }

  list(profileId: string): BankChecklistCase[] {
    return this.store.handle
      .prepare(
        `SELECT c.*,
                (SELECT COUNT(*) FROM bank_case_documents d WHERE d.case_id = c.id) AS document_count
         FROM bank_checklist_cases c WHERE c.profile_id = ?
         ORDER BY c.updated_at DESC, c.created_at DESC`,
      )
      .all(profileId)
      .map((row) => this.mapCase(row))
  }

  delete(id: string): void {
    this.getOrThrow(id)
    this.store.handle.prepare('DELETE FROM bank_checklist_cases WHERE id = ?').run(id)
  }

  addDocument(input: AddBankDocumentInput): BankDocumentEvidence {
    this.getOrThrow(input.caseId)
    const id = randomUUID()
    const evidence = bankDocumentEvidenceSchema.parse({
      id,
      fileName: input.fileName,
      sourcePathHash: input.sourcePathHash,
      suspectedScan: input.suspectedScan,
      truncated: input.truncated,
      ...input.output,
    })
    const now = this.store.nowIso()
    this.store.transaction(() => {
      this.store.handle
        .prepare(
          `INSERT INTO bank_case_documents
             (id, case_id, file_name_ciphertext, source_path_hash, document_type, needs_review,
              suspected_scan, truncated, payload_ciphertext, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.caseId,
          this.store.cipher.encrypt(CTX.fileName, evidence.fileName),
          evidence.sourcePathHash,
          evidence.documentType,
          evidence.needsReview ? 1 : 0,
          evidence.suspectedScan ? 1 : 0,
          evidence.truncated ? 1 : 0,
          this.store.cipher.encrypt(CTX.evidence, JSON.stringify(evidence)),
          now,
          now,
        )
      this.store.handle
        .prepare("UPDATE bank_checklist_cases SET status = 'draft', updated_at = ? WHERE id = ?")
        .run(now, input.caseId)
    })
    return evidence
  }

  listDocuments(caseId: string): BankDocumentEvidence[] {
    this.getOrThrow(caseId)
    return this.store.handle
      .prepare(
        `SELECT payload_ciphertext FROM bank_case_documents
         WHERE case_id = ? ORDER BY created_at ASC, id ASC`,
      )
      .all(caseId)
      .map((row) =>
        bankDocumentEvidenceSchema.parse(
          JSON.parse(this.store.cipher.decrypt(CTX.evidence, String(row['payload_ciphertext']))),
        ),
      )
  }

  saveReview(caseId: string, report: BankChecklistReport): BankChecklistReview {
    this.getOrThrow(caseId)
    const validated = bankChecklistReportSchema.parse(report)
    const id = randomUUID()
    const now = this.store.nowIso()
    this.store.transaction(() => {
      this.store.handle
        .prepare(
          `INSERT INTO bank_checklist_reviews
             (id, case_id, rule_pack_id, rule_pack_version, template_id, template_version,
              result_ciphertext, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          caseId,
          validated.rulePackId,
          validated.rulePackVersion,
          validated.templateId,
          validated.templateVersion,
          this.store.cipher.encrypt(CTX.report, JSON.stringify(validated)),
          now,
        )
      this.store.handle
        .prepare("UPDATE bank_checklist_cases SET status = 'reviewed', updated_at = ? WHERE id = ?")
        .run(now, caseId)
    })
    return { id, caseId, report: validated, createdAt: now }
  }

  latestReview(caseId: string): BankChecklistReview | null {
    this.getOrThrow(caseId)
    const row = this.store.handle
      .prepare(
        `SELECT id, result_ciphertext, created_at FROM bank_checklist_reviews
         WHERE case_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      )
      .get(caseId)
    if (row === undefined) return null
    return {
      id: String(row['id']),
      caseId,
      report: bankChecklistReportSchema.parse(
        JSON.parse(this.store.cipher.decrypt(CTX.report, String(row['result_ciphertext']))),
      ),
      createdAt: String(row['created_at']),
    }
  }

  private getOrThrow(id: string): BankChecklistCase {
    const item = this.get(id)
    if (item === null) {
      throw new NexaError(ERROR_CODES.VALIDATION_FAILED, {
        safeDetail: 'bank checklist case not found',
      })
    }
    return item
  }

  private mapCase(row: Record<string, unknown>): BankChecklistCase {
    return {
      id: String(row['id']),
      profileId: String(row['profile_id']),
      title: this.store.cipher.decrypt(CTX.title, String(row['title_ciphertext'])),
      templateId: String(row['template_id']),
      templateVersion: String(row['template_version']),
      status: String(row['status']) as BankChecklistCase['status'],
      documentCount: Number(row['document_count']),
      createdAt: String(row['created_at']),
      updatedAt: String(row['updated_at']),
    }
  }
}
