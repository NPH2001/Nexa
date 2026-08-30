import type { BaDocItem } from './model.js'
import { jaccard, normalizeText, tokenSet } from './text.js'

/**
 * Dò trùng xác định — không embedding, không gọi model (D5).
 *
 * Hai mức, cố ý khác hẳn nhau về hệ quả:
 *   - **Trùng khít**: cùng kiểu, cùng khoá đã chuẩn hoá. Bộ hợp nhất gộp tự động, chỉ cộng dồn
 *     `sources`. An toàn vì hai item nói đúng một câu.
 *   - **Gần-trùng**: Jaccard vượt ngưỡng. **Chỉ gắn cờ**, không bao giờ tự gộp. Ngưỡng nào cũng
 *     có thể sai, và gộp nhầm hai rule khác nhau là mất nghiệp vụ chứ không phải mất thời gian.
 */

/**
 * Ngưỡng gắn cờ gần-trùng. Hằng số, không phải tham số cấu hình — kết quả phải lặp lại được.
 *
 * Con số này được **đo rồi mới chốt**, không phải chọn cho tròn. Thiết kế ban đầu ghi 0.8; chạy
 * thật trên cặp mà ask #6 nhắm tới thì trượt:
 *
 *   "Đơn hàng phải có ít nhất một sản phẩm"  →  {don, hang, phai, co, it, nhat, san, pham}
 *   "Đơn hàng cần có ít nhất một sản phẩm"   →  {don, hang, can,  co, it, nhat, san, pham}
 *   giao 7, hợp 9  ⇒  0.78
 *
 * Rule nghiệp vụ là câu ngắn, nên **một từ khác nhau đã kéo Jaccard xuống gần 0.1**. Giữ 0.8 thì
 * đúng loại trùng lặp cần bắt lại lọt lưới. 0.7 bắt được cặp trên và vẫn cách rất xa cặp không
 * liên quan (đo được 0.0), nên khoảng an toàn còn rộng.
 */
export const NEAR_DUPLICATE_THRESHOLD = 0.7

/**
 * Token phủ định. Hai câu chỉ khác nhau ở đây thì **không phải trùng lặp** — chúng ngược nghĩa.
 *
 * Đây là hàng rào thứ hai sau việc giữ `khong` khỏi danh sách từ dừng (`text.ts`). Hàng rào thứ
 * nhất giữ cho chúng không trùng khít; hàng rào này giữ cho chúng không bị đề xuất gộp. Thiếu nó,
 * "cho phép sửa đơn" và "không cho phép sửa đơn" đo được 0.83 và sẽ nằm ngay đầu danh sách gợi ý
 * gộp — một cú bấm nhầm là mất một nửa nghiệp vụ.
 */
const NEGATION_TOKENS: ReadonlySet<string> = new Set(['khong', 'chua', 'cam'])

/**
 * Text đại diện của item khi so sánh.
 *
 * Chỉ lấy phần định danh nghiệp vụ, không lấy toàn bộ nội dung: hai use case cùng tên nhưng khác
 * một bước ở luồng chính vẫn là cùng một use case bị trích xuất hai lần từ hai chunk, và cách xử
 * lý đúng là hợp nhất chứ không phải giữ cả hai.
 */
export function comparableText(item: BaDocItem): string {
  switch (item.itemType) {
    case 'use_case':
    case 'field':
    case 'actor':
      return item.name
    case 'rule':
      return item.statement
    case 'flow_step':
      return item.label
    case 'error_code':
      return item.code
  }
}

/**
 * Khoá trùng khít: kiểu item + text đại diện đã chuẩn hoá.
 *
 * Đây chính là "băm" trong tasks.md — một `Map` khoá theo chuỗi này là bảng băm, và dùng thẳng
 * chuỗi thay vì SHA có chủ đích: nội dung ở tầng này đã được giải mã trong main process, khoá
 * không rời khỏi RAM, nên băm mật mã chỉ thêm chi phí mà không thêm tính chất nào cần tới.
 */
export function fingerprint(item: BaDocItem): string {
  return `${item.itemType}:${normalizeText(comparableText(item))}`
}

export interface SimilarPair {
  readonly a: string
  readonly b: string
  readonly similarity: number
}

export interface SimilarityReport {
  /** Nghi là cùng một ý — gợi ý gộp, người dùng quyết định. */
  readonly nearDuplicates: readonly SimilarPair[]
  /**
   * Giống nhau về từ ngữ nhưng lệch nhau ở phủ định — nghi là **ngược nhau**, không phải trùng.
   * Đây là đầu vào của `R-RULE-01` (mâu thuẫn) chứ không phải của luồng gộp.
   */
  readonly potentialContradictions: readonly SimilarPair[]
}

function negationProfile(tokens: ReadonlySet<string>): string {
  return [...tokens]
    .filter((token) => NEGATION_TOKENS.has(token))
    .sort()
    .join(',')
}

export interface StatementComparison {
  readonly similarity: number
  /** Đủ giống để nói về cùng một chuyện, nhưng lệch nhau ở token phủ định. */
  readonly contradictory: boolean
  /** Đủ giống và cùng chiều phủ định — hai câu nói cùng một điều. */
  readonly equivalent: boolean
}

/**
 * So hai câu và nói chúng **trùng nhau** hay **ngược nhau**.
 *
 * Cùng một phép đo với `analyzeSimilarity`, tách ra thành hàm công khai để `R-KB-01` đối chiếu
 * một khẳng định trong tài liệu với một item tri thức — hai chuỗi không thuộc cùng một mô hình nên
 * không đi qua đường `SimilarPair` được.
 *
 * Tách ra chứ không viết lại là điểm chính: nếu `R-KB-01` tự định nghĩa "thế nào là mâu thuẫn"
 * thì Nexa sẽ có hai định nghĩa, và ngày nào đó chúng lệch nhau mà không ai biết.
 */
export function compareStatements(
  a: string,
  b: string,
  threshold: number = NEAR_DUPLICATE_THRESHOLD,
): StatementComparison {
  const left = tokenSet(a)
  const right = tokenSet(b)
  const similarity = jaccard(left, right)
  if (similarity < threshold) {
    return { similarity, contradictory: false, equivalent: false }
  }
  const opposed = negationProfile(left) !== negationProfile(right)
  return { similarity, contradictory: opposed, equivalent: !opposed }
}

function sortPairs(pairs: SimilarPair[]): SimilarPair[] {
  // Sắp ổn định để hai lần chạy trên cùng dữ liệu cho ra đúng một thứ tự — điều kiện để test được
  // và để danh sách người dùng nhìn không nhảy loạn giữa các lần mở.
  return pairs.sort(
    (x, y) => y.similarity - x.similarity || x.a.localeCompare(y.a) || x.b.localeCompare(y.b),
  )
}

/**
 * So mọi cặp item cùng kiểu, tách kết quả thành "nghi trùng" và "nghi ngược nhau".
 *
 * Một lượt duyệt cho cả hai vì chúng chỉ khác nhau ở một điều kiện, và tách làm hai hàm duyệt
 * riêng sẽ mở đường cho hai ngưỡng lệch nhau.
 */
export function analyzeSimilarity(
  items: readonly BaDocItem[],
  threshold: number = NEAR_DUPLICATE_THRESHOLD,
): SimilarityReport {
  const prepared = items.map((item) => {
    const tokens = tokenSet(comparableText(item))
    return {
      id: item.id,
      itemType: item.itemType,
      key: fingerprint(item),
      tokens,
      negation: negationProfile(tokens),
    }
  })

  const nearDuplicates: SimilarPair[] = []
  const potentialContradictions: SimilarPair[] = []

  for (let i = 0; i < prepared.length; i += 1) {
    for (let j = i + 1; j < prepared.length; j += 1) {
      const left = prepared[i]
      const right = prepared[j]
      if (left === undefined || right === undefined) continue
      if (left.itemType !== right.itemType) continue
      // Trùng khít đã được bộ hợp nhất xử lý; báo lại ở đây chỉ làm nhiễu danh sách người dùng.
      if (left.key === right.key) continue
      const similarity = jaccard(left.tokens, right.tokens)
      if (similarity < threshold) continue
      const pair: SimilarPair = { a: left.id, b: right.id, similarity }
      if (left.negation === right.negation) nearDuplicates.push(pair)
      else potentialContradictions.push(pair)
    }
  }

  return {
    nearDuplicates: sortPairs(nearDuplicates),
    potentialContradictions: sortPairs(potentialContradictions),
  }
}

/** Chỉ phần "nghi trùng" của `analyzeSimilarity`. */
export function findNearDuplicates(
  items: readonly BaDocItem[],
  threshold: number = NEAR_DUPLICATE_THRESHOLD,
): readonly SimilarPair[] {
  return analyzeSimilarity(items, threshold).nearDuplicates
}
