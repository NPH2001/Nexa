import { z } from 'zod'
import {
  buildErrorCodePage,
  evaluateTemplate,
  jaccard,
  renderMarkdown,
  tokenSet,
  type BaTemplate,
} from '@nexa/ba-kit'
import {
  ERROR_CODES,
  NexaError,
  type BaReviewReportView,
  type LocalToolDefinition,
  type LocalToolRegistry,
  type PreviewField,
  type ToolPreview,
  type ToolResultSummary,
} from '@nexa/shared-types'
import type { BaDocument, BaDocumentRepository, BaKnowledgeRepository } from '@nexa/local-store'
import type { Logger } from '@nexa/observability'

/**
 * Tool BA trong chat (openspec `add-ba-workbench` D10).
 *
 * Bốn tool: hai READ (tra cứu tri thức, tổng hợp mã lỗi) và hai WRITE_LOW (áp mẫu, trích xuất).
 * Hai tool ghi đi qua đúng tám bước của §7.4 như tool write ngoài — preview, approval, payload
 * hash — dù đích đến chỉ là ổ đĩa của chính người dùng.
 *
 * Bốn giới hạn cố ý, cùng tinh thần với commitment tools:
 *   1. Không có tool xoá tri thức hay tài liệu.
 *   2. Agent không đặt được `confirmed` — chỉ người dùng chốt tri thức của tổ chức.
 *   3. Agent không tạo được tài liệu mới; nó chỉ thao tác lên tài liệu người dùng đã lập.
 *   4. Tool chỉ chạm dữ liệu của profile hiện tại; `profileId` do main bơm vào, không phải tham số.
 */

export const BA_KNOWLEDGE_SEARCH_TOOL = 'nexa_ba_tra_cuu_tri_thuc'
export const BA_ERROR_CODES_TOOL = 'nexa_ba_tong_hop_ma_loi'
export const BA_APPLY_TEMPLATE_TOOL = 'nexa_ba_soan_theo_mau'
export const BA_EXTRACT_TOOL = 'nexa_ba_trich_xuat_tai_lieu'
export const BA_REVIEW_TOOL = 'nexa_ba_kiem_tra_tai_lieu'

/** Ngưỡng liên quan cho tra cứu. Thấp hơn ngưỡng dò trùng vì đây là truy hồi, không phải so khớp. */
const RELEVANCE_THRESHOLD = 0.12
const MAX_SEARCH_RESULTS = 5

export interface BaToolDeps {
  readonly profileId: string
  readonly knowledge: BaKnowledgeRepository
  readonly documents: BaDocumentRepository
  /** Bộ mẫu chuẩn do IT phân phối. Rỗng nghĩa là tool soạn-theo-mẫu không có gì để chọn. */
  readonly templates: readonly BaTemplate[]
  /** Chạy đúng job trích xuất mà màn hình Nghiệp vụ dùng — không có đường thứ hai (D4). */
  readonly extract: (documentId: string, sourceText: string) => Promise<{ itemCount: number; needsReviewCount: number; cached: boolean }>
  /** Chạy đúng bộ luật mà màn hình Nghiệp vụ dùng. Hàm thuần bên dưới, không gọi model. */
  readonly review: (documentId: string) => BaReviewReportView
  readonly logger: Logger
}

const searchInputSchema = z.object({
  cau_hoi: z.string().trim().min(1).max(500),
})

const SEARCH_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    cau_hoi: {
      type: 'string',
      description:
        'Nội dung nghiệp vụ cần tra, viết như người dùng hỏi. Ví dụ: "ngưỡng miễn phí giao hàng".',
    },
  },
  required: ['cau_hoi'],
  additionalProperties: false,
}

const errorCodesInputSchema = z.object({
  tieu_de_tai_lieu: z.string().trim().min(1).max(200).optional(),
})

const ERROR_CODES_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    tieu_de_tai_lieu: {
      type: 'string',
      description:
        'Một phần tiêu đề tài liệu cần tổng hợp mã lỗi. Bỏ trống nếu chỉ có một tài liệu.',
    },
  },
  required: [],
  additionalProperties: false,
}

const applyTemplateInputSchema = z.object({
  tieu_de_tai_lieu: z.string().trim().min(1).max(200).optional(),
  ma_mau: z.string().trim().min(1).max(64),
})

const APPLY_TEMPLATE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    tieu_de_tai_lieu: {
      type: 'string',
      description: 'Một phần tiêu đề tài liệu. Bỏ trống nếu chỉ có một tài liệu.',
    },
    ma_mau: {
      type: 'string',
      description: 'Mã của mẫu chuẩn, lấy từ danh sách mẫu tổ chức đã ban hành.',
    },
  },
  required: ['ma_mau'],
  additionalProperties: false,
}

const extractInputSchema = z.object({
  tieu_de_tai_lieu: z.string().trim().min(1).max(200).optional(),
  noi_dung: z.string().trim().min(1).max(200_000),
})

const EXTRACT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    tieu_de_tai_lieu: {
      type: 'string',
      description: 'Một phần tiêu đề tài liệu đích. Bỏ trống nếu chỉ có một tài liệu.',
    },
    noi_dung: {
      type: 'string',
      description: 'Nội dung nghiệp vụ dạng văn xuôi cần chuyển thành mô hình có cấu trúc.',
    },
  },
  required: ['noi_dung'],
  additionalProperties: false,
}

const reviewInputSchema = z.object({
  tieu_de_tai_lieu: z.string().trim().min(1).max(200).optional(),
})

const REVIEW_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    tieu_de_tai_lieu: {
      type: 'string',
      description: 'Một phần tiêu đề tài liệu cần kiểm. Bỏ trống nếu chỉ có một tài liệu.',
    },
  },
  required: [],
  additionalProperties: false,
}

type SearchInput = z.infer<typeof searchInputSchema>
type ErrorCodesInput = z.infer<typeof errorCodesInputSchema>
type ApplyTemplateInput = z.infer<typeof applyTemplateInputSchema>
type ExtractInput = z.infer<typeof extractInputSchema>
type ReviewInput = z.infer<typeof reviewInputSchema>

/** Preview cho tool BA. Đích luôn là `local` — không byte nào rời máy. */
function localPreview(opts: {
  toolName: string
  action: string
  actingAccount: string
  fields: readonly PreviewField[]
  changes: readonly { field: string; before: string | null; after: string }[]
  impactWarning: string
  reversible: boolean
}): ToolPreview {
  return {
    toolName: opts.toolName,
    targetSystem: 'local',
    targetSystemUrl: '',
    action: opts.action,
    actingAccount: opts.actingAccount,
    payloadFields: opts.fields,
    changes: opts.changes,
    impactWarning: opts.impactWarning,
    reversible: opts.reversible,
    riskLevel: 'WRITE_LOW',
  }
}

export function createBaToolRegistry(deps: BaToolDeps): LocalToolRegistry {
  const searchTool: LocalToolDefinition<SearchInput> = {
    kind: 'local',
    name: BA_KNOWLEDGE_SEARCH_TOOL,
    riskLevel: 'READ',
    description:
      'Tra cứu tri thức nghiệp vụ đã được người dùng xác nhận. Dùng khi câu hỏi liên quan tới quy tắc, thuật ngữ hoặc quyết định nghiệp vụ của tổ chức, thay vì suy đoán.',
    inputSchema: searchInputSchema,
    jsonSchema: SEARCH_JSON_SCHEMA,
    execute: (input) => Promise.resolve(searchKnowledge(deps, input.cau_hoi)),
  }

  const errorCodesTool: LocalToolDefinition<ErrorCodesInput> = {
    kind: 'local',
    name: BA_ERROR_CODES_TOOL,
    riskLevel: 'READ',
    description:
      'Tổng hợp toàn bộ mã lỗi của một tài liệu BA, kèm mã được nhắc trong luồng nhưng chưa khai báo và mã mang hai thông điệp khác nhau.',
    inputSchema: errorCodesInputSchema,
    jsonSchema: ERROR_CODES_JSON_SCHEMA,
    execute: (input) => Promise.resolve(summarizeErrorCodes(deps, input.tieu_de_tai_lieu)),
  }

  const applyTemplateTool: LocalToolDefinition<ApplyTemplateInput> = {
    kind: 'local',
    name: BA_APPLY_TEMPLATE_TOOL,
    riskLevel: 'WRITE_LOW',
    description:
      'Áp một mẫu tài liệu chuẩn của tổ chức lên tài liệu BA đang có, rồi trả về bản Markdown sinh từ nội dung đã có. Không thêm nội dung nghiệp vụ mới.',
    inputSchema: applyTemplateInputSchema,
    jsonSchema: APPLY_TEMPLATE_JSON_SCHEMA,
    buildPreview: (input, ctx) => {
      const { document, template } = requireDocumentAndTemplate(deps, input)
      const evaluation = evaluateTemplate(deps.documents.readModel(document.id), template)
      const missing =
        evaluation.missingRequired.length === 0
          ? 'không có'
          : evaluation.missingRequired.join(', ')

      return Promise.resolve(
        localPreview({
          toolName: BA_APPLY_TEMPLATE_TOOL,
          action: `Áp mẫu "${template.name}" lên tài liệu "${document.title}"`,
          actingAccount: ctx.actingAccount,
          fields: [
            { label: 'Tài liệu', value: document.title },
            { label: 'Mẫu', value: `${template.name} (phiên bản ${template.version})` },
            // Nói trước cái sẽ thiếu, chứ không để người dùng phát hiện sau khi đã duyệt.
            { label: 'Mục bắt buộc còn trống', value: missing },
            {
              label: 'Nội dung ngoài mẫu',
              value: `${String(evaluation.unplaced.length)} mục`,
            },
          ],
          changes: [
            {
              field: 'Mẫu của tài liệu',
              before: document.templateId,
              after: `${template.id}@${template.version}`,
            },
          ],
          impactWarning:
            'Chỉ đổi mẫu của tài liệu trên máy bạn. Không sửa, không xoá item nghiệp vụ nào, và không gửi gì ra ngoài.',
          reversible: true,
        }),
      )
    },
    execute: (input) => {
      const { document, template } = requireDocumentAndTemplate(deps, input)
      deps.documents.update(document.id, {
        templateId: template.id,
        templateVersion: template.version,
      })
      const markdown = renderMarkdown(deps.documents.readModel(document.id), template, {
        title: document.title,
      })
      deps.logger.info('ba-template-applied', {
        documentId: document.id,
        templateId: template.id,
        templateVersion: template.version,
      })
      return Promise.resolve({
        forModel: `Đã áp mẫu "${template.name}" cho tài liệu "${document.title}". Bản Markdown:\n\n${markdown}`,
        forUser: `Đã áp mẫu "${template.name}" cho "${document.title}".`,
      })
    },
  }

  const extractTool: LocalToolDefinition<ExtractInput> = {
    kind: 'local',
    name: BA_EXTRACT_TOOL,
    riskLevel: 'WRITE_LOW',
    description:
      'Chuyển một đoạn nghiệp vụ dạng văn xuôi thành mô hình có cấu trúc (use case, quy tắc, trường, mã lỗi) cho một tài liệu BA. Ghi đè toàn bộ mô hình hiện có của tài liệu đó.',
    inputSchema: extractInputSchema,
    jsonSchema: EXTRACT_JSON_SCHEMA,
    buildPreview: (input, ctx) => {
      const lookup = resolveDocument(deps, input.tieu_de_tai_lieu)
      if (!lookup.ok) {
        throw new NexaError(ERROR_CODES.VALIDATION_FAILED, {
          safeDetail: 'ba document could not be resolved for extraction',
        })
      }
      const existing = deps.documents.readModel(lookup.document.id)

      return Promise.resolve(
        localPreview({
          toolName: BA_EXTRACT_TOOL,
          action: `Trích xuất nội dung thành mô hình cho tài liệu "${lookup.document.title}"`,
          actingAccount: ctx.actingAccount,
          fields: [
            { label: 'Tài liệu', value: lookup.document.title },
            { label: 'Độ dài nội dung', value: `${String(input.noi_dung.length)} ký tự` },
          ],
          changes: [
            {
              field: 'Mô hình tài liệu',
              before: `${String(existing.items.length)} mục hiện có`,
              after: 'thay bằng kết quả trích xuất mới',
            },
          ],
          // Ghi đè trọn gói là điều người dùng PHẢI biết trước khi bấm duyệt.
          impactWarning:
            'Thao tác này THAY TOÀN BỘ mô hình hiện có của tài liệu. Mục đã sửa tay sẽ mất. Dữ liệu chỉ nằm trên máy bạn.',
          reversible: false,
        }),
      )
    },
    execute: async (input) => {
      const lookup = resolveDocument(deps, input.tieu_de_tai_lieu)
      if (!lookup.ok) {
        throw new NexaError(ERROR_CODES.VALIDATION_FAILED, {
          safeDetail: 'ba document could not be resolved for extraction',
        })
      }
      const result = await deps.extract(lookup.document.id, input.noi_dung)
      const note =
        result.needsReviewCount === 0
          ? ''
          : ` ${String(result.needsReviewCount)} mục Nexa chưa chắc và đã tách riêng để người dùng soát.`

      return {
        forModel: `Đã trích xuất ${String(result.itemCount)} mục cho tài liệu "${lookup.document.title}".${note}`,
        forUser: `Đã trích xuất ${String(result.itemCount)} mục cho "${lookup.document.title}".`,
        ...(result.needsReviewCount > 0
          ? {
              incomplete: true,
              completenessNote: `${String(result.needsReviewCount)} mục còn cần người soát, chưa được dùng làm căn cứ.`,
            }
          : {}),
      }
    },
  }

  const reviewTool: LocalToolDefinition<ReviewInput> = {
    kind: 'local',
    name: BA_REVIEW_TOOL,
    riskLevel: 'READ',
    description:
      'Chạy bộ luật kiểm tài liệu BA và trả về từng phát hiện kèm mã luật. Kết quả do bộ luật xác định sinh ra, không phải nhận xét của bạn — hãy trình bày lại đúng như nhận được, đừng thêm, đừng bớt, đừng hạ mức phát hiện nào.',
    inputSchema: reviewInputSchema,
    jsonSchema: REVIEW_JSON_SCHEMA,
    execute: (input) => Promise.resolve(reviewDocument(deps, input.tieu_de_tai_lieu)),
  }

  const byName = new Map<string, LocalToolDefinition>([
    [searchTool.name, searchTool as LocalToolDefinition],
    [errorCodesTool.name, errorCodesTool as LocalToolDefinition],
    [applyTemplateTool.name, applyTemplateTool as LocalToolDefinition],
    [extractTool.name, extractTool as LocalToolDefinition],
    [reviewTool.name, reviewTool as LocalToolDefinition],
  ])

  return {
    list: () => [...byName.values()],
    get: (name) => byName.get(name),
  }
}

/**
 * Tra cứu bằng độ phủ token, không bằng embedding.
 *
 * Cùng lý do với bộ dò trùng (D5): kết quả phải xác định, test được và chạy được không mạng. Đổi
 * lại, nó không hiểu từ đồng nghĩa — nên tool mô tả rõ cho model rằng "không tìm thấy" nghĩa là
 * chưa có tri thức nào khớp CHỮ, không phải tổ chức chưa từng chốt điều đó.
 */
function searchKnowledge(deps: BaToolDeps, question: string): ToolResultSummary {
  const queryTokens = tokenSet(question)
  const candidates = deps.knowledge.list(deps.profileId, { status: 'confirmed' })

  const ranked = candidates
    .map((item) => ({
      item,
      score: Math.max(
        jaccard(queryTokens, tokenSet(item.title)),
        jaccard(queryTokens, tokenSet(item.body)),
      ),
    }))
    .filter((entry) => entry.score >= RELEVANCE_THRESHOLD)
    .sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title))
    .slice(0, MAX_SEARCH_RESULTS)

  deps.logger.info('ba-knowledge-search', {
    // Số lượng, không phải câu hỏi hay nội dung tri thức.
    candidateCount: candidates.length,
    matchCount: ranked.length,
  })

  if (ranked.length === 0) {
    return {
      forModel:
        'Không có tri thức nghiệp vụ nào đã xác nhận khớp với câu hỏi này. Điều đó chỉ có nghĩa là kho chưa có mục nào dùng từ ngữ tương tự — đừng kết luận là tổ chức chưa quy định.',
      forUser: 'Không tìm thấy tri thức đã xác nhận nào khớp.',
    }
  }

  // Đếm lượt dùng: đây là nguồn của thống kê "tri thức chết" trong màn hình Nghiệp vụ.
  deps.knowledge.recordUsage(ranked.map((entry) => entry.item.id))

  const lines = ranked.map((entry) => `- [${entry.item.category}] ${entry.item.title}: ${entry.item.body}`)
  return {
    forModel: `Tri thức nghiệp vụ đã xác nhận, liên quan nhất trước:\n${lines.join('\n')}`,
    forUser: `Đã tra ${String(ranked.length)} mục tri thức đã xác nhận.`,
    ...(candidates.length > ranked.length
      ? {
          incomplete: true,
          completenessNote: `Kho có ${String(candidates.length)} mục đã xác nhận; chỉ ${String(ranked.length)} mục khớp từ khoá được đưa vào.`,
        }
      : {}),
  }
}

function requireDocumentAndTemplate(
  deps: BaToolDeps,
  input: ApplyTemplateInput,
): { document: BaDocument; template: BaTemplate } {
  const lookup = resolveDocument(deps, input.tieu_de_tai_lieu)
  if (!lookup.ok) {
    throw new NexaError(ERROR_CODES.VALIDATION_FAILED, {
      safeDetail: 'ba document could not be resolved',
    })
  }
  const template = deps.templates.find((entry) => entry.id === input.ma_mau)
  if (template === undefined) {
    throw new NexaError(ERROR_CODES.VALIDATION_FAILED, {
      safeDetail: `unknown ba template: ${input.ma_mau}`,
    })
  }
  return { document: lookup.document, template }
}

/**
 * Tra một tài liệu theo một phần tiêu đề.
 *
 * Không bao giờ chọn hộ khi có nhiều tài liệu khớp: chọn hộ là đoán, và đoán sai ở đây nghĩa là
 * agent thao tác lên nhầm tài liệu. Trả lại danh sách để model hỏi lại người dùng.
 */
type DocumentLookup =
  | { readonly ok: true; readonly document: BaDocument }
  | { readonly ok: false; readonly summary: ToolResultSummary }

function resolveDocument(deps: BaToolDeps, titleQuery: string | undefined): DocumentLookup {
  const documents = deps.documents.list(deps.profileId)
  if (documents.length === 0) {
    throw new NexaError(ERROR_CODES.VALIDATION_FAILED, {
      safeDetail: 'no ba documents for current profile',
    })
  }

  const matches =
    titleQuery === undefined
      ? documents
      : documents.filter((document) =>
          document.title.toLowerCase().includes(titleQuery.toLowerCase()),
        )

  if (matches.length === 0) {
    return {
      ok: false,
      summary: {
        forModel: `Không có tài liệu nào khớp. Các tài liệu hiện có: ${documents.map((d) => d.title).join(', ')}.`,
        forUser: 'Không tìm thấy tài liệu khớp tiêu đề.',
      },
    }
  }
  if (matches.length > 1) {
    return {
      ok: false,
      summary: {
        forModel: `Có ${String(matches.length)} tài liệu khớp: ${matches.map((d) => d.title).join(', ')}. Hãy hỏi người dùng chọn tài liệu nào.`,
        forUser: 'Có nhiều tài liệu khớp — cần chọn một.',
      },
    }
  }

  const document = matches[0]
  if (document === undefined) {
    throw new NexaError(ERROR_CODES.VALIDATION_FAILED, { safeDetail: 'document lookup failed' })
  }
  return { ok: true, document }
}

function summarizeErrorCodes(deps: BaToolDeps, titleQuery: string | undefined): ToolResultSummary {
  const lookup = resolveDocument(deps, titleQuery)
  if (!lookup.ok) return lookup.summary
  const document = lookup.document

  const page = buildErrorCodePage(deps.documents.readModel(document.id))
  deps.logger.info('ba-error-code-summary', {
    documentId: document.id,
    ...page.counts,
  })

  const sections = [
    `Trang mã lỗi của tài liệu "${document.title}":`,
    page.declared.length === 0
      ? '- Chưa khai báo mã lỗi nào.'
      : page.declared.map((entry) => `- ${entry.code}: ${entry.message}`).join('\n'),
  ]

  if (page.undeclared.length > 0) {
    sections.push(
      `Mã được nhắc trong luồng nhưng CHƯA khai báo (${String(page.undeclared.length)}): ${page.undeclared
        .map((entry) => entry.code)
        .join(', ')}`,
    )
  }
  if (page.unreferenced.length > 0) {
    sections.push(
      `Mã đã khai báo nhưng KHÔNG luồng nào dùng (${String(page.unreferenced.length)}): ${page.unreferenced
        .map((entry) => entry.code)
        .join(', ')}`,
    )
  }
  if (page.inconsistent.length > 0) {
    sections.push(
      `Mã mang HAI thông điệp khác nhau (${String(page.inconsistent.length)}): ${page.inconsistent
        .map((entry) => entry.code)
        .join(', ')}`,
    )
  }
  if (page.counts.excludedNeedsReview > 0) {
    sections.push(
      `Đã bỏ ${String(page.counts.excludedNeedsReview)} mục còn cần người soát — chúng không nằm trong tổng hợp này.`,
    )
  }

  return {
    forModel: sections.join('\n'),
    forUser: `Tổng hợp ${String(page.counts.declared)} mã lỗi của "${document.title}".`,
    ...(page.counts.excludedNeedsReview > 0
      ? {
          incomplete: true,
          completenessNote: `${String(page.counts.excludedNeedsReview)} mục còn cần soát đã bị loại khỏi tổng hợp.`,
        }
      : {}),
  }
}

/**
 * Chạy bộ luật và kể lại kết quả.
 *
 * Câu chữ ở đây là một phần của hợp đồng, không phải trang trí. Hai điều nó phải làm và một điều
 * nó không bao giờ được làm:
 *
 *   - Nói rõ **đã kiểm bộ luật nào, phiên bản nào, bao nhiêu luật** — để model không thể trình bày
 *     kết quả như một nhận xét của chính nó.
 *   - Nói rõ **luật nào chưa kiểm được** và bao nhiêu mục bị loại vì còn cần soát.
 *   - **Không bao giờ** dùng chữ "đầy đủ" cho toàn tài liệu, kể cả khi mọi luật đều đạt. Bộ luật
 *     kiểm cấu trúc và đối chiếu KB; nó không biết một yêu cầu chưa ai nghĩ tới (ADR 0010).
 */
function reviewDocument(deps: BaToolDeps, titleQuery: string | undefined): ToolResultSummary {
  const lookup = resolveDocument(deps, titleQuery)
  if (!lookup.ok) return lookup.summary
  const document = lookup.document

  const report = deps.review(document.id)
  const sections = [
    `Kết quả kiểm tài liệu "${document.title}" bằng bộ luật ${report.rulePackId} phiên bản ${report.rulePackVersion}.`,
    `Đã kiểm ${String(report.rulesRun)}/${String(report.rulesTotal)} luật, ${String(report.rulesPassed)} luật đạt. Phát hiện: ${String(report.countsBySeverity.blocker)} chặn, ${String(report.countsBySeverity.warning)} cảnh báo, ${String(report.countsBySeverity.info)} thông tin.`,
  ]

  const skipped = report.rules.filter((rule) => rule.status === 'skipped')
  if (skipped.length > 0) {
    sections.push(
      `Chưa kiểm được ${String(skipped.length)} luật vì thiếu căn cứ: ${skipped
        .map((rule) => `${rule.id} (thiếu ${rule.missing ?? 'căn cứ'})`)
        .join(', ')}.`,
    )
  }
  if (report.excludedNeedsReview > 0) {
    sections.push(
      `Đã loại ${String(report.excludedNeedsReview)} mục còn cần người soát khỏi căn cứ kiểm tra.`,
    )
  }

  sections.push(
    report.findings.length === 0
      ? 'Không có phát hiện nào trong phạm vi các luật đã kiểm. Điều này KHÔNG có nghĩa tài liệu đã đủ mọi trường hợp nghiệp vụ — bộ luật chỉ kiểm cấu trúc và đối chiếu với tri thức đã xác nhận.'
      : report.findings
          .map(
            (finding) =>
              `- [${finding.ruleId}] [${finding.severity}] ${finding.message} → ${finding.fix}`,
          )
          .join('\n'),
  )

  deps.logger.info('ba-review-tool', {
    documentId: document.id,
    rulePackId: report.rulePackId,
    rulePackVersion: report.rulePackVersion,
    rulesRun: report.rulesRun,
    findingCount: report.findings.length,
  })

  return {
    forModel: sections.join('\n'),
    forUser: `Đã kiểm "${document.title}" bằng ${String(report.rulesRun)}/${String(report.rulesTotal)} luật — ${String(report.findings.length)} phát hiện.`,
    ...(skipped.length > 0 || report.excludedNeedsReview > 0
      ? {
          incomplete: true,
          completenessNote: `${String(skipped.length)} luật chưa kiểm được và ${String(report.excludedNeedsReview)} mục còn cần soát đã bị loại.`,
        }
      : {}),
  }
}

/**
 * Ghép nhiều registry tool cục bộ thành một.
 *
 * Tên trùng nhau là lỗi, không phải chuyện để "cái sau thắng": hai tool cùng tên nghĩa là model
 * gọi một cái và chạy cái kia. Thà đỏ lúc dựng registry còn hơn sai lúc chạy.
 */
export function composeLocalToolRegistries(
  registries: readonly (LocalToolRegistry | null)[],
): LocalToolRegistry | null {
  const present = registries.filter((registry): registry is LocalToolRegistry => registry !== null)
  if (present.length === 0) return null

  const byName = new Map<string, LocalToolDefinition>()
  for (const registry of present) {
    for (const definition of registry.list()) {
      if (byName.has(definition.name)) {
        throw new NexaError(ERROR_CODES.VALIDATION_FAILED, {
          safeDetail: `duplicate local tool name: ${definition.name}`,
        })
      }
      byName.set(definition.name, definition)
    }
  }

  return {
    list: () => [...byName.values()],
    get: (name) => byName.get(name),
  }
}
