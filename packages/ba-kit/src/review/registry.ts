import { R_ERR_01 } from './rules/r-err-01.js'
import { R_ERR_02 } from './rules/r-err-02.js'
import { R_FLD_01 } from './rules/r-fld-01.js'
import { R_FLD_02 } from './rules/r-fld-02.js'
import { R_FLOW_01 } from './rules/r-flow-01.js'
import { R_FLOW_02 } from './rules/r-flow-02.js'
import { R_KB_01 } from './rules/r-kb-01.js'
import { R_RULE_01 } from './rules/r-rule-01.js'
import { R_RULE_02 } from './rules/r-rule-02.js'
import { R_TPL_01 } from './rules/r-tpl-01.js'
import { R_UC_01 } from './rules/r-uc-01.js'
import { R_UC_02 } from './rules/r-uc-02.js'
import { R_UC_03 } from './rules/r-uc-03.js'
import { R_UC_04 } from './rules/r-uc-04.js'
import { R_UC_05 } from './rules/r-uc-05.js'
import type { RulePack } from './types.js'

/**
 * Rule pack là **dữ liệu**, không phải một chuỗi if-else (D3).
 *
 * Thêm một luật cho domain mới = thêm một file trong `rules/`, thêm một dòng vào mảng dưới đây,
 * thêm một test. Bộ chạy (`run.ts`) không có chỗ nào biết tên một luật cụ thể, nên nó không cần
 * đổi — và một test khẳng định điều đó bằng cách chạy review với một pack tự dựng.
 *
 * Thứ tự trong mảng là **thứ tự báo cáo**: đi từ khung (luồng, use case) tới chi tiết (trường, mã
 * lỗi, quy tắc) rồi tới đối chiếu ngoài tài liệu (mẫu, tri thức). Nó cũng là khoá sắp xếp thứ nhất
 * của danh sách finding, nên đổi thứ tự ở đây là đổi thứ tự hiển thị — cố ý, và có test canh.
 */
export const RULE_PACK_V1: RulePack = {
  id: 'nexa-ba',
  version: '1',
  name: 'Bộ luật kiểm tài liệu BA v1',
  rules: [
    R_FLOW_01,
    R_FLOW_02,
    R_UC_01,
    R_UC_02,
    R_UC_03,
    R_UC_04,
    R_UC_05,
    R_FLD_01,
    R_FLD_02,
    R_ERR_01,
    R_ERR_02,
    R_RULE_01,
    R_RULE_02,
    R_TPL_01,
    R_KB_01,
  ],
}

export const RULE_PACKS: readonly RulePack[] = [RULE_PACK_V1]

/**
 * Tra một pack theo id và phiên bản.
 *
 * Có mặt để một báo cáo lưu ba tháng trước vẫn nói được nó đã chạy bộ luật nào. Không tìm thấy
 * thì trả `null` chứ không rơi về pack hiện hành: hiển thị báo cáo cũ bằng thước đo mới là đúng
 * loại lệch âm thầm mà `rule_pack_version` sinh ra để tránh.
 */
export function findRulePack(id: string, version: string): RulePack | null {
  return RULE_PACKS.find((pack) => pack.id === id && pack.version === version) ?? null
}
