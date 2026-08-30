import { itemsOfType } from '../../model.js'
import { normalizeRule } from '../../normalize.js'
import { makeFinding, type ReviewRule } from '../types.js'

/**
 * `R-RULE-02` — không có quy tắc mồ côi.
 *
 * "Mồ côi" nghĩa là không gắn với use case hay trường nào. Một quy tắc như thế không sai, nó chỉ
 * **không kiểm chứng được**: không ai biết phải áp nó ở màn hình nào, và nó không xuất hiện trong
 * bất kỳ ma trận truy vết nào.
 *
 * Hai đường gắn đều tính: `appliesTo` của chính quy tắc (do `normalizeRule` trả) và liên kết
 * `validates` trong đồ thị. Chỉ đọc một trong hai sẽ báo mồ côi cho đúng những quy tắc đã được nối
 * bằng đường còn lại.
 */
export const R_RULE_02: ReviewRule = {
  id: 'R-RULE-02',
  description: 'Mọi quy tắc gắn với ít nhất một use case hoặc trường dữ liệu.',
  defaultSeverity: 'warning',
  evaluate: ({ doc }) => {
    const linked = new Set(
      doc.links.filter((link) => link.kind === 'validates').map((link) => link.from),
    )

    return itemsOfType(doc, 'rule')
      .filter((rule) => normalizeRule(rule).orphan && !linked.has(rule.id))
      .map((rule) =>
        makeFinding(R_RULE_02, {
          itemId: rule.id,
          message: `Quy tắc "${rule.statement}" chưa gắn với use case hay trường dữ liệu nào.`,
          fix: 'Nối quy tắc này tới use case hoặc trường mà nó ràng buộc. Không nối được thì nhiều khả năng đây là ghi chú, không phải quy tắc.',
        }),
      )
  },
}
