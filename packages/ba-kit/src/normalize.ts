import { LIMITS, baRuleSchema, baUseCaseSchema, type BaRule, type BaUseCase } from './model.js'
import { normalizeText } from './text.js'

/**
 * Chuẩn hoá use case và rule — nơi ask #6 ("viết khá miên man và nhiều ý trùng nhau") được giải.
 *
 * Giải bằng **cấu trúc**, không bằng prompt (D5). Một use case 15 bước không phải là văn phong
 * dài dòng, nó là nhiều use case bị gộp; một rule chứa hai mệnh đề độc lập không phải câu phức,
 * nó là hai rule. Ở đây cả hai đều là kết quả kiểm tra được, kèm lời khuyên nói đúng việc phải làm.
 */

export interface NormalizationProblem {
  /** Trường gây lỗi, dạng đường dẫn: `mainFlow`, `alternateFlows.0.steps`. */
  readonly field: string
  readonly message: string
  /** Việc người dùng cần làm. Cố ý tách khỏi `message` để UI hiển thị được riêng. */
  readonly suggestion: string
}

export type Normalization<T> =
  | { readonly ok: true; readonly item: T }
  | { readonly ok: false; readonly problems: readonly NormalizationProblem[] }

/**
 * Đổi lỗi Zod thành lời khuyên nói đúng việc phải làm.
 *
 * Vì sao không dùng thẳng message của Zod: "Array must contain at most 12 element(s)" nói đúng
 * ràng buộc nhưng nói sai cách sửa. Người đọc sẽ đi cắt bớt bước, trong khi việc đúng là **tách
 * use case**. Một thông báo lỗi dẫn người dùng đi làm sai là tệ hơn không có thông báo.
 */
function adviseUseCase(path: string, code: string): string {
  if (path === 'mainFlow' && code === 'too_big') {
    return `Luồng chính quá ${String(LIMITS.mainFlowSteps)} bước thường là dấu hiệu use case đang gộp nhiều việc. Hãy TÁCH thành nhiều use case, đừng rút gọn bước.`
  }
  if (path.startsWith('mainFlow') && code === 'too_big') {
    return `Một bước dài quá ${String(LIMITS.statement)} ký tự thường chứa nhiều hành động. Hãy tách thành nhiều bước.`
  }
  if (code === 'too_big') return 'Nội dung vượt giới hạn — hãy tách ý thay vì cắt chữ.'
  if (code === 'too_small' || code === 'invalid_type') {
    return 'Trường này bắt buộc. Tài liệu chưa nói thì để người soát bổ sung, đừng đoán.'
  }
  return 'Sửa lại cho khớp cấu trúc use case.'
}

export function normalizeUseCase(input: unknown): Normalization<BaUseCase> {
  const parsed = baUseCaseSchema.safeParse(input)
  if (parsed.success) return { ok: true, item: parsed.data }

  const problems = parsed.error.issues.map((issue) => {
    const field = issue.path.join('.')
    return {
      field,
      message: issue.message,
      suggestion: adviseUseCase(field, issue.code),
    }
  })
  return { ok: false, problems }
}

// ═══════════════════════════════════════════════════════════════════════════
// Rule
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Từ chỉ nghĩa vụ. Sự có mặt của một trong số này ở CẢ HAI vế là bằng chứng mỗi vế tự nó đã là
 * một quy tắc trọn vẹn — điều kiện duy nhất để đề xuất tách.
 */
const DEONTIC = ['phai', 'bat buoc', 'khong duoc', 'duoc phep', 'can', 'nen', 'chi duoc']

/** Liên từ nối hai mệnh đề độc lập. Dấu chấm phẩy tách chắc chắn; " và " thì phải xét thêm. */
const HARD_SEPARATOR = /;|\n/
const SOFT_SEPARATOR = /\s+(?:và|đồng thời)\s+/i

function hasDeontic(fragment: string): boolean {
  const normalized = normalizeText(fragment)
  return DEONTIC.some((word) => normalized.includes(word))
}

export interface RuleSplitSuggestion {
  /** Các mệnh đề tách được. Một phần tử nghĩa là không nên tách. */
  readonly parts: readonly string[]
  readonly shouldSplit: boolean
  readonly reason: string
}

/**
 * Đề xuất tách một rule ghép — **đề xuất**, không tự làm.
 *
 * Hai mức, khác nhau về độ chắc chắn:
 *   - Dấu chấm phẩy hoặc xuống dòng: tách. Trong tài liệu nghiệp vụ đây gần như luôn là ranh giới
 *     giữa hai quy tắc.
 *   - " và " / " đồng thời ": chỉ tách khi **cả hai vế đều mang từ chỉ nghĩa vụ**. Không có điều
 *     kiện đó thì "và" nhiều khả năng đang nối hai tân ngữ ("đơn phải có mã và ngày tạo"), và
 *     tách ra sẽ đẻ ra một rule cụt nghĩa.
 *
 * Nghiêng về KHÔNG tách là có chủ ý: một rule ghép còn đọc được, còn một rule cụt thì sai.
 */
export function suggestRuleSplit(statement: string): RuleSplitSuggestion {
  const trimmed = statement.trim()

  const hard = trimmed
    .split(HARD_SEPARATOR)
    .map((part) => part.trim())
    .filter((part) => part !== '')
  if (hard.length > 1) {
    return {
      parts: hard,
      shouldSplit: true,
      reason: 'Dấu chấm phẩy hoặc xuống dòng đang ngăn hai quy tắc độc lập.',
    }
  }

  const soft = trimmed
    .split(SOFT_SEPARATOR)
    .map((part) => part.trim())
    .filter((part) => part !== '')
  if (soft.length > 1 && soft.every(hasDeontic)) {
    return {
      parts: soft,
      shouldSplit: true,
      reason: 'Cả hai vế đều nêu một nghĩa vụ riêng, nên mỗi vế là một quy tắc.',
    }
  }

  return {
    parts: [trimmed],
    shouldSplit: false,
    reason:
      soft.length > 1
        ? 'Có liên từ nhưng chỉ một vế nêu nghĩa vụ — nhiều khả năng đây là một quy tắc có hai tân ngữ.'
        : 'Đây đã là một mệnh đề đơn.',
  }
}

export interface RuleNormalization {
  readonly result: Normalization<BaRule>
  readonly split: RuleSplitSuggestion
  /** Rule chưa gắn với use case hay field nào — đầu vào của `R-RULE-02`. */
  readonly orphan: boolean
}

export function normalizeRule(input: unknown): RuleNormalization {
  const parsed = baRuleSchema.safeParse(input)
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
      suggestion:
        issue.code === 'too_big'
          ? `Một quy tắc chỉ nên là MỘT mệnh đề, tối đa ${String(LIMITS.statement)} ký tự. Hãy tách thành nhiều quy tắc.`
          : 'Sửa lại cho khớp cấu trúc quy tắc.',
    }))
    const statement = typeof input === 'object' && input !== null ? String(Reflect.get(input, 'statement') ?? '') : ''
    return {
      result: { ok: false, problems },
      split: suggestRuleSplit(statement),
      orphan: true,
    }
  }

  return {
    result: { ok: true, item: parsed.data },
    split: suggestRuleSplit(parsed.data.statement),
    orphan: parsed.data.appliesTo.length === 0,
  }
}
