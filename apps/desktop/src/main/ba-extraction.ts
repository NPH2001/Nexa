import { createHash } from 'node:crypto'
import {
  DEFAULT_SECTION_MAX_CHARS,
  baDocItemSchema,
  baDocLinkSchema,
  mergeChunkModels,
  splitSections,
  type BaDocItem,
  type BaDocModel,
  type SimilarPair,
} from '@nexa/ba-kit'
import type { BaDocumentRepository } from '@nexa/local-store'
import { newRequestId, type Logger } from '@nexa/observability'
import { ERROR_CODES, NexaError, type AppSettings, type LlmProvider } from '@nexa/shared-types'
import type { ChatRequest, ChatResult, RequestContext } from '@nexa/llm-client'
import { z } from 'zod'

/**
 * Trích xuất văn xuôi thành mô hình tài liệu (D4).
 *
 * Đây là một **job có schema**, không phải một lượt chat. Ba quy tắc quyết định hình dạng của nó:
 *
 *   1. Output không khớp schema thì bị từ chối, không ép kiểu. Model được nói lại tối đa hai lần.
 *   2. Item không chắc được đánh `needsReview` và không bao giờ được suy đoán cho đầy.
 *   3. Tài liệu dài cắt theo heading, trích xuất từng phần, rồi hợp nhất bằng `ba-kit`.
 *
 * Tool `nexa_ba_trich_xuat_tai_lieu` trong chat gọi đúng hàm này. Không có hai đường trích xuất
 * với hai hành vi.
 */

/** Một lần gọi đầu + tối đa hai lần nói lại. Xem `ba-document-model` spec. */
export const MAX_EXTRACTION_ATTEMPTS = 3

const chunkResultSchema = z.object({
  items: z.array(baDocItemSchema),
  links: z.array(baDocLinkSchema).default([]),
})

const SYSTEM_PROMPT = `Bạn là bộ trích xuất tài liệu nghiệp vụ. Nhiệm vụ duy nhất: chuyển đoạn tài liệu người dùng đưa thành JSON đúng schema.

Quy tắc bắt buộc:
- Chỉ trả về JSON, không giải thích, không markdown fence.
- CHỈ ghi lại điều tài liệu đã nói. Không suy luận, không bổ sung, không "làm cho đầy đủ".
- Không chắc trường nào thì đặt "needsReview": true cho item đó, đừng đoán giá trị.
- Mỗi rule là MỘT mệnh đề, tối đa 200 ký tự. Mệnh đề ghép thì tách thành nhiều rule.
- Luồng chính của use case tối đa 12 bước. Dài hơn nghĩa là có nhiều use case — hãy tách ra.
- Giữ nguyên mã lỗi đúng như tài liệu viết.
- "id" đặt theo dạng "<loại>-<số>", duy nhất trong đoạn này.`

function userPrompt(anchor: string, text: string): string {
  const where = anchor === '' ? 'phần mở đầu' : anchor
  return `Mục: ${where}\n\nNội dung:\n${text}`
}

/**
 * Phần của LLM client mà job này dùng.
 *
 * Hẹp có chủ ý: job không stream, không gọi tool, không cần gì khác. Nhận cả `ConnectionService`
 * vào đây sẽ buộc mọi test phải dựng nguyên một service chỉ để trả về một chuỗi JSON.
 */
export interface ExtractionLlm {
  complete(request: ChatRequest, ctx: RequestContext): Promise<ChatResult>
}

export interface BaExtractionDeps {
  readonly documents: BaDocumentRepository
  readonly resolveModel: () => { readonly modelId: string; readonly provider: LlmProvider }
  readonly buildLlmClient: (provider: LlmProvider, timeoutMs: number) => ExtractionLlm
  readonly settings: () => AppSettings
  readonly logger: Logger
}

export interface BaExtractionResult {
  readonly model: BaDocModel
  readonly nearDuplicates: readonly SimilarPair[]
  readonly potentialContradictions: readonly SimilarPair[]
  readonly mergedCount: number
  readonly needsReviewCount: number
  readonly sectionCount: number
  /** `true` khi nội dung không đổi nên không gọi model lần nào. */
  readonly cached: boolean
}

export function hashSource(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * Gỡ hàng rào ```json mà model hay thêm dù đã được dặn.
 *
 * Đây là dọn dẹp định dạng, KHÔNG phải sửa nội dung: nếu bên trong không phải JSON hợp lệ hay
 * không khớp schema thì vẫn bị từ chối như thường.
 */
function stripFence(raw: string): string {
  const trimmed = raw.trim()
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/.exec(trimmed)
  return fenced?.[1]?.trim() ?? trimmed
}

export class BaExtractionJob {
  constructor(private readonly deps: BaExtractionDeps) {}

  async run(documentId: string, sourceText: string): Promise<BaExtractionResult> {
    const document = this.deps.documents.get(documentId)
    if (document === null) {
      throw new NexaError(ERROR_CODES.VALIDATION_FAILED, {
        safeDetail: `ba document not found: ${documentId}`,
      })
    }

    const hash = hashSource(sourceText)
    if (document.sourceHash === hash) {
      // Nội dung không đổi ⇒ không gọi model. Trích xuất là thao tác tốn token, và chạy lại một
      // tài liệu y hệt vừa tốn tiền vừa có thể cho ra kết quả khác lần trước.
      const model = this.deps.documents.readModel(documentId)
      this.deps.logger.info('ba-extraction-cache-hit', {
        documentId,
        itemCount: model.items.length,
      })
      return {
        model,
        nearDuplicates: [],
        potentialContradictions: [],
        mergedCount: 0,
        needsReviewCount: this.deps.documents.countNeedsReview(documentId),
        sectionCount: 0,
        cached: true,
      }
    }

    const sections = splitSections(sourceText, DEFAULT_SECTION_MAX_CHARS)
    if (sections.length === 0) {
      throw new NexaError(ERROR_CODES.VALIDATION_FAILED, {
        safeDetail: 'source text has no extractable content',
      })
    }

    const config = this.deps.resolveModel()
    const llm = this.deps.buildLlmClient(config.provider, this.deps.settings().llmTimeoutMs)

    const chunks: BaDocModel[] = []
    for (const [index, section] of sections.entries()) {
      const parsed = await this.extractSection(llm, config.modelId, section, index)
      chunks.push(
        this.namespaceSection(parsed, index, section.anchor === '' ? `#${index}` : section.anchor),
      )
    }

    const merged = mergeChunkModels(chunks)
    this.deps.documents.replaceModel(documentId, merged.model)
    this.deps.documents.update(documentId, { sourceHash: hash })

    const needsReviewCount = this.deps.documents.countNeedsReview(documentId)
    this.deps.logger.info('ba-extraction-completed', {
      documentId,
      sectionCount: sections.length,
      itemCount: merged.model.items.length,
      linkCount: merged.model.links.length,
      mergedCount: merged.mergedCount,
      nearDuplicateCount: merged.nearDuplicates.length,
      contradictionCount: merged.potentialContradictions.length,
      needsReviewCount,
    })

    return {
      model: merged.model,
      nearDuplicates: merged.nearDuplicates,
      potentialContradictions: merged.potentialContradictions,
      mergedCount: merged.mergedCount,
      needsReviewCount,
      sectionCount: sections.length,
      cached: false,
    }
  }

  /**
   * Gọi model cho một section, kiểm bằng schema, nói lại khi sai.
   *
   * Thông báo lỗi gửi lại cho model chỉ chứa **đường dẫn trường và mã lỗi của Zod**, không chứa
   * lại nội dung tài liệu — nếu không, mỗi lần thử lại sẽ nhân đôi lượng dữ liệu nghiệp vụ đi ra
   * ngoài mà không thêm thông tin gì cho model.
   */
  private async extractSection(
    llm: ExtractionLlm,
    modelId: string,
    section: { anchor: string; text: string },
    index: number,
  ): Promise<BaDocModel> {
    let lastIssue = ''

    for (let attempt = 1; attempt <= MAX_EXTRACTION_ATTEMPTS; attempt += 1) {
      const messages = [
        { role: 'system' as const, content: SYSTEM_PROMPT },
        { role: 'user' as const, content: userPrompt(section.anchor, section.text) },
        ...(lastIssue === ''
          ? []
          : [
              {
                role: 'user' as const,
                content: `JSON lần trước không hợp lệ: ${lastIssue}. Trả lại JSON đúng schema.`,
              },
            ]),
      ]

      const result = await llm.complete(
        { model: modelId, messages, temperature: 0 },
        { requestId: newRequestId() },
      )

      const outcome = this.parse(result.text)
      if (outcome.ok) return outcome.model

      lastIssue = outcome.issue
      this.deps.logger.warn('ba-extraction-invalid-output', {
        sectionIndex: index,
        attempt,
        // Chỉ đường dẫn trường sai; không log nội dung model trả về.
        issue: outcome.issue,
      })
    }

    throw new NexaError(ERROR_CODES.VALIDATION_FAILED, {
      safeDetail: `extraction output failed schema validation after ${MAX_EXTRACTION_ATTEMPTS} attempts`,
    })
  }

  private parse(raw: string): { ok: true; model: BaDocModel } | { ok: false; issue: string } {
    let json: unknown
    try {
      json = JSON.parse(stripFence(raw))
    } catch {
      return { ok: false, issue: 'không phải JSON hợp lệ' }
    }

    const parsed = chunkResultSchema.safeParse(json)
    if (!parsed.success) {
      const issues = parsed.error.issues
        .slice(0, 5)
        .map((issue) => `${issue.path.join('.')}: ${issue.code}`)
        .join('; ')
      return { ok: false, issue: issues }
    }
    return { ok: true, model: parsed.data }
  }

  /**
   * Gắn tiền tố section vào id và ghi lại vị trí nguồn.
   *
   * Tiền tố là bắt buộc, không phải cho gọn: model đánh id theo từng section nên section 0 và
   * section 1 đều sinh ra `uc-1` cho hai use case KHÁC nhau. Bộ hợp nhất khoá theo nội dung chứ
   * không theo id, nên hai item đó đi qua được và cùng mang id `uc-1` — vỡ khoá chính lúc ghi.
   * Đây là loại lỗi chỉ xuất hiện với tài liệu nhiều mục, tức là đúng tài liệu thật.
   */
  private namespaceSection(model: BaDocModel, index: number, anchor: string): BaDocModel {
    const rename = (id: string): string => `s${index}-${id}`
    return {
      items: model.items.map(
        (item) => ({ ...item, id: rename(item.id), sources: [anchor] }) as BaDocItem,
      ),
      links: model.links.map((link) => ({
        ...link,
        from: rename(link.from),
        to: rename(link.to),
      })),
    }
  }
}
