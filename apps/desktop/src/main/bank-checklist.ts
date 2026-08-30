import {
  bankChecklistTemplateSchema,
  bankExtractionOutputSchema,
  runBankChecklistReview,
  type BankChecklistReport,
  type BankChecklistTemplate,
  type BankExtractionOutput,
} from '@nexa/document-checklist'
import type { BankChecklistRepository } from '@nexa/local-store'
import type { ProcessedDocument } from '@nexa/document-processor'
import type { ChatRequest, ChatResult, RequestContext } from '@nexa/llm-client'
import { newRequestId, type Logger } from '@nexa/observability'
import { ERROR_CODES, NexaError, type AppSettings, type LlmProvider } from '@nexa/shared-types'
import { z } from 'zod'
import type { ResourceReader } from './ba-standards.js'

const templateFileSchema = z.object({ templates: z.array(z.unknown()) })
export const MAX_BANK_EXTRACTION_ATTEMPTS = 3

const SYSTEM_PROMPT = `Bạn là bộ trích xuất dữ liệu từ chứng từ ngân hàng.

Chỉ trả JSON đúng schema, không markdown và không giải thích.
- documentType là một trong: national_id, passport, application_form, proof_of_residence, proof_of_income, bank_statement, other.
- fields chỉ dùng các key chuẩn khi có bằng chứng: full_name, identity_number, date_of_birth, expiry_date, address, issued_date, account_number, period_start, period_end, employer_name, income_amount.
- Ngày phải theo YYYY-MM-DD. Không chắc thì giữ giá trị thấy được và đặt needsReview=true; không nhìn thấy thì không tạo trường.
- sourceLabel phải là nhãn nguồn có trong ngoặc vuông ở đầu khối.
- Không được kết luận hồ sơ đạt, thiếu, hết hạn hay không khớp. Code cục bộ sẽ quyết định checklist.`

export interface BankExtractionLlm {
  complete(request: ChatRequest, ctx: RequestContext): Promise<ChatResult>
}

export interface BankChecklistDeps {
  readonly repository: BankChecklistRepository
  readonly templates: readonly BankChecklistTemplate[]
  readonly resolveModel: () => { readonly modelId: string; readonly provider: LlmProvider }
  readonly buildLlmClient: (provider: LlmProvider, timeoutMs: number) => BankExtractionLlm
  readonly settings: () => AppSettings
  readonly logger: Logger
  readonly now?: () => Date
}

export function loadBankChecklistTemplates(
  read: ResourceReader,
  logger: Logger,
): BankChecklistTemplate[] {
  const raw = read('bank-checklist-templates.json')
  const file = templateFileSchema.safeParse(raw)
  if (!file.success) {
    logger.warn('bank-checklist-templates-file-invalid', {
      issueCount: file.error.issues.length,
    })
    return []
  }

  const templates: BankChecklistTemplate[] = []
  const seen = new Set<string>()
  for (const [index, entry] of file.data.templates.entries()) {
    const parsed = bankChecklistTemplateSchema.safeParse(entry)
    if (!parsed.success) {
      logger.warn('bank-checklist-template-invalid-skipped', {
        index,
        invalidFields: parsed.error.issues.map((issue) => issue.path.join('.')),
      })
      continue
    }
    const key = `${parsed.data.id}@${parsed.data.version}`
    if (seen.has(key)) continue
    seen.add(key)
    templates.push(parsed.data)
  }
  logger.info('bank-checklist-templates-loaded', { count: templates.length })
  return templates
}

function stripFence(raw: string): string {
  const trimmed = raw.trim()
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/.exec(trimmed)
  return fenced?.[1]?.trim() ?? trimmed
}

export class BankChecklistService {
  private readonly now: () => Date

  constructor(private readonly deps: BankChecklistDeps) {
    this.now = deps.now ?? (() => new Date())
  }

  findTemplate(id: string, version?: string): BankChecklistTemplate {
    const template = this.deps.templates.find(
      (item) => item.id === id && (version === undefined || item.version === version),
    )
    if (template === undefined) {
      throw new NexaError(ERROR_CODES.VALIDATION_FAILED, {
        safeDetail: 'bank checklist template not found',
      })
    }
    return template
  }

  async extract(document: ProcessedDocument): Promise<BankExtractionOutput> {
    if (document.suspectedScan === true) {
      return { documentType: 'other', fields: [], needsReview: true }
    }

    const config = this.deps.resolveModel()
    if (config.provider !== 'litellm') {
      throw new NexaError(ERROR_CODES.VALIDATION_FAILED, {
        safeDetail: 'bank document extraction requires a configured LiteLLM model',
      })
    }
    const llm = this.deps.buildLlmClient('litellm', this.deps.settings().llmTimeoutMs)
    const body = document.chunks
      .map((chunk) => `[${chunk.locationLabel}]\n${chunk.text}`)
      .join('\n\n')
    let lastIssue = ''

    for (let attempt = 1; attempt <= MAX_BANK_EXTRACTION_ATTEMPTS; attempt += 1) {
      const result = await llm.complete(
        {
          model: config.modelId,
          temperature: 0,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: body },
            ...(lastIssue === ''
              ? []
              : [
                  {
                    role: 'user' as const,
                    content: `JSON trước không hợp lệ: ${lastIssue}. Trả lại JSON đúng schema.`,
                  },
                ]),
          ],
        },
        { requestId: newRequestId() },
      )

      let json: unknown
      try {
        json = JSON.parse(stripFence(result.text))
      } catch {
        lastIssue = 'không phải JSON hợp lệ'
        continue
      }
      const parsed = bankExtractionOutputSchema.safeParse(json)
      if (parsed.success) return parsed.data
      lastIssue = parsed.error.issues
        .slice(0, 5)
        .map((issue) => `${issue.path.join('.')}: ${issue.code}`)
        .join('; ')
      this.deps.logger.warn('bank-document-extraction-invalid-output', { attempt, lastIssue })
    }

    throw new NexaError(ERROR_CODES.VALIDATION_FAILED, {
      safeDetail: `bank extraction output failed schema validation after ${MAX_BANK_EXTRACTION_ATTEMPTS} attempts`,
    })
  }

  review(caseId: string): { reviewId: string; report: BankChecklistReport } {
    const item = this.deps.repository.get(caseId)
    if (item === null) {
      throw new NexaError(ERROR_CODES.VALIDATION_FAILED, {
        safeDetail: 'bank checklist case not found',
      })
    }
    const template = this.findTemplate(item.templateId, item.templateVersion)
    const report = runBankChecklistReview(
      template,
      this.deps.repository.listDocuments(caseId),
      this.now(),
    )
    const saved = this.deps.repository.saveReview(caseId, report)
    this.deps.logger.info('bank-checklist-reviewed', {
      caseId,
      rulePackVersion: report.rulePackVersion,
      itemCount: report.items.length,
    })
    return { reviewId: saved.id, report }
  }
}
