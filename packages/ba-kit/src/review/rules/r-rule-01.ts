import { analyzeSimilarity, fingerprint, type SimilarPair } from '../../dedupe.js'
import { itemsOfType } from '../../model.js'
import { makeFinding, type ReviewRule } from '../types.js'

/**
 * Xếp một cặp theo id, không theo thứ tự nó rơi ra từ vòng lặp.
 *
 * `analyzeSimilarity` duyệt theo thứ tự mảng, nên đảo thứ tự item trong mô hình sẽ đảo `a` với `b`
 * và câu chữ của finding đổi theo. Với một tính năng bán lời hứa "cùng tài liệu ⇒ cùng kết quả"
 * thì đó là một khác biệt thật, dù nội dung nói cùng một điều — nên nó được chuẩn hoá ở đây và có
 * test canh.
 */
function orient(pair: SimilarPair): readonly [string, string] {
  return pair.a.localeCompare(pair.b) <= 0 ? [pair.a, pair.b] : [pair.b, pair.a]
}

/**
 * `R-RULE-01` — không có quy tắc trùng lặp hoặc mâu thuẫn trực tiếp.
 *
 * Ba nhóm, dùng đúng bộ dò trùng của G1 chứ không đo lại:
 *   - **Trùng khít** (cùng khoá đã chuẩn hoá): `analyzeSimilarity` cố ý bỏ qua nhóm này vì bộ hợp
 *     nhất đã xử lý lúc trích xuất. Nhưng review chạy trên tài liệu người dùng đã sửa tay, nên nó
 *     xuất hiện lại được — và ở đây thì phải báo.
 *   - **Gần trùng**: warning, gợi ý gộp.
 *   - **Nghi ngược nhau**: blocker. Hai câu gần cùng từ ngữ nhưng lệch ở phủ định là ứng viên số
 *     một cho một mâu thuẫn nghiệp vụ thật, và cũng là cặp mà một cú bấm "gộp" nhầm sẽ xoá mất
 *     một nửa nghiệp vụ.
 */
export const R_RULE_01: ReviewRule = {
  id: 'R-RULE-01',
  description: 'Không có quy tắc trùng lặp hoặc mâu thuẫn trực tiếp với nhau.',
  defaultSeverity: 'warning',
  evaluate: ({ doc }) => {
    const rules = itemsOfType(doc, 'rule')
    const byId = new Map(rules.map((rule) => [rule.id, rule.statement] as const))

    const exact = new Map<string, string[]>()
    for (const rule of rules) {
      const key = fingerprint(rule)
      const bucket = exact.get(key)
      if (bucket === undefined) exact.set(key, [rule.id])
      else bucket.push(rule.id)
    }

    const duplicates = [...exact.values()]
      .filter((ids) => ids.length > 1)
      .map((ids) => [...ids].sort())
      .sort((a, b) => (a[0] ?? '').localeCompare(b[0] ?? ''))
      .map((ids) => {
        const [keep, ...rest] = ids
        return makeFinding(R_RULE_01, {
          itemId: keep ?? null,
          message: `Quy tắc "${byId.get(keep ?? '') ?? ''}" xuất hiện ${String(ids.length)} lần với cùng nội dung.`,
          fix: 'Giữ một bản và xoá các bản còn lại, hoặc viết lại cho khác nhau nếu chúng thật sự nói hai điều.',
          evidence: rest,
        })
      })

    const similarity = analyzeSimilarity(rules)

    const near = similarity.nearDuplicates.map((pair) => {
      const [first, second] = orient(pair)
      return makeFinding(R_RULE_01, {
        itemId: first,
        message: `Hai quy tắc giống nhau ${String(Math.round(pair.similarity * 100))}%: "${byId.get(first) ?? ''}" và "${byId.get(second) ?? ''}".`,
        fix: 'Gộp thành một quy tắc nếu chúng nói cùng một điều, hoặc viết rõ điểm khác nhau nếu không.',
        evidence: [second],
      })
    })

    const contradictions = similarity.potentialContradictions.map((pair) => {
      const [first, second] = orient(pair)
      return makeFinding(R_RULE_01, {
        severity: 'blocker',
        itemId: first,
        message: `Hai quy tắc dùng gần cùng từ ngữ nhưng lệch nhau ở phủ định: "${byId.get(first) ?? ''}" và "${byId.get(second) ?? ''}".`,
        fix: 'Xác định quy tắc nào đúng rồi bỏ hoặc sửa quy tắc còn lại. KHÔNG gộp hai quy tắc này — chúng ngược nghĩa nhau, không phải trùng lặp.',
        evidence: [second],
      })
    })

    return [...duplicates, ...near, ...contradictions]
  },
}
