import { randomUUID } from 'node:crypto'
import { reviewPayloadSchema, type Finding, type ReviewPayload } from '@nexa/ba-kit'
import { ERROR_CODES, NexaError } from '@nexa/shared-types'
import type { LocalStore } from '../store.js'

/**
 * Báo cáo review đã lưu.
 *
 * Hai điều đáng nói về hình dạng bảng này:
 *
 * 1. **`rule_pack_id` và `rule_pack_version` nằm ở cột rõ**, cạnh các con số đếm. Chúng không phải
 *    nội dung nghiệp vụ — chúng là thứ để so hai báo cáo cách nhau ba tháng và biết ngay chúng có
 *    đo bằng cùng một thước hay không. Giấu chúng vào ciphertext thì mất luôn khả năng đó.
 *
 * 2. **Nội dung finding thì mã hoá.** Một finding chứa nguyên văn quy tắc nghiệp vụ và tên use
 *    case; nó là dữ liệu người dùng đúng nghĩa và đi cùng đường với mọi nội dung khác (bất biến
 *    §21). Cột rõ ở đây chỉ có id, số đếm và timestamp.
 */

const CTX = {
  findings: 'ba_reviews.findings',
} as const

export interface BaReview {
  readonly id: string
  readonly documentId: string
  readonly rulePackId: string
  readonly rulePackVersion: string
  readonly rulesRun: number
  readonly rulesPassed: number
  readonly excludedNeedsReview: number
  readonly findings: readonly Finding[]
  readonly skippedRules: ReviewPayload['skippedRules']
  readonly knowledgeConsidered: number
  readonly createdAt: string
}

export interface CreateBaReviewInput {
  readonly documentId: string
  readonly rulePackId: string
  readonly rulePackVersion: string
  readonly rulesRun: number
  readonly rulesPassed: number
  readonly excludedNeedsReview: number
  readonly knowledgeConsidered: number
  readonly findings: readonly Finding[]
  readonly skippedRules: ReviewPayload['skippedRules']
}

export class BaReviewRepository {
  constructor(private readonly store: LocalStore) {}

  create(input: CreateBaReviewInput): BaReview {
    const id = randomUUID()
    const createdAt = this.store.nowIso()
    const payload: ReviewPayload = {
      findings: [...input.findings],
      skippedRules: [...input.skippedRules],
      knowledgeConsidered: input.knowledgeConsidered,
    }

    this.store.handle
      .prepare(
        `INSERT INTO ba_reviews
           (id, document_id, rule_pack_id, rule_pack_version, rules_run, rules_passed,
            excluded_needs_review, findings_ciphertext, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.documentId,
        input.rulePackId,
        input.rulePackVersion,
        input.rulesRun,
        input.rulesPassed,
        input.excludedNeedsReview,
        this.store.cipher.encrypt(CTX.findings, JSON.stringify(payload)),
        createdAt,
      )

    // Chỉ id và số đếm — không mức, không nội dung. Xem §8.1 và spec `ba-review`.
    this.store.log.info('ba-review-recorded', {
      reviewId: id,
      documentId: input.documentId,
      rulePackId: input.rulePackId,
      rulePackVersion: input.rulePackVersion,
      rulesRun: input.rulesRun,
      rulesPassed: input.rulesPassed,
      findingCount: input.findings.length,
    })

    return this.getOrThrow(id)
  }

  get(id: string): BaReview | null {
    const row = this.store.handle.prepare('SELECT * FROM ba_reviews WHERE id = ?').get(id)
    return row === undefined ? null : this.mapReview(row)
  }

  /** Báo cáo của một tài liệu, mới nhất trước. */
  list(documentId: string, limit = 20): BaReview[] {
    return this.store.handle
      .prepare(
        `SELECT * FROM ba_reviews WHERE document_id = ?
         ORDER BY created_at DESC, rowid DESC LIMIT ?`,
      )
      .all(documentId, limit)
      .map((row) => this.mapReview(row))
  }

  latest(documentId: string): BaReview | null {
    return this.list(documentId, 1)[0] ?? null
  }

  private getOrThrow(id: string): BaReview {
    const review = this.get(id)
    if (review !== null) return review
    throw new NexaError(ERROR_CODES.VALIDATION_FAILED, {
      safeDetail: `ba review not found: ${id}`,
    })
  }

  /**
   * Giải mã rồi **kiểm lại bằng schema**, không cast.
   *
   * Cùng lý do với `BaDocumentRepository.readModel`: file database là dữ liệu ngoài process (§11.3).
   * Một bản ghi lưu bằng phiên bản schema cũ phải hỏng ồn ào ở đây thay vì lặng lẽ đi tiếp thành
   * một finding méo mó trên màn hình báo cáo.
   */
  private mapReview(row: Record<string, unknown>): BaReview {
    const raw = this.store.cipher.decrypt(CTX.findings, String(row['findings_ciphertext']))
    const parsed = reviewPayloadSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) {
      throw new NexaError(ERROR_CODES.VALIDATION_FAILED, {
        safeDetail: 'stored review payload does not match the current schema',
      })
    }

    return {
      id: String(row['id']),
      documentId: String(row['document_id']),
      rulePackId: String(row['rule_pack_id']),
      rulePackVersion: String(row['rule_pack_version']),
      rulesRun: Number(row['rules_run']),
      rulesPassed: Number(row['rules_passed']),
      excludedNeedsReview: Number(row['excluded_needs_review']),
      findings: parsed.data.findings,
      skippedRules: parsed.data.skippedRules,
      knowledgeConsidered: parsed.data.knowledgeConsidered,
      createdAt: String(row['created_at']),
    }
  }
}
