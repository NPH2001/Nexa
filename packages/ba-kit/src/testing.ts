import {
  baDocItemSchema,
  type BaActor,
  type BaDocItem,
  type BaDocModel,
  type BaErrorCode,
  type BaField,
  type BaFlowStep,
  type BaRule,
  type BaUseCase,
} from './model.js'
import type { BaRulebook } from './rulebook.js'
import type { BaTemplate } from './template.js'
import type { BaKnowledgeFact, RuleInput } from './review/types.js'

/**
 * Factory cho test.
 *
 * CỐ Ý không export từ `index.ts`: đây là tiện ích dựng dữ liệu mẫu, không phải một phần hợp đồng
 * của package. Mọi factory đi qua `baDocItemSchema.parse` để test không bao giờ chạy trên một
 * object mà schema thật sẽ từ chối — nếu không, test xanh trong khi sản phẩm đỏ.
 */

function parse(input: unknown): BaDocItem {
  return baDocItemSchema.parse(input)
}

export function makeUseCase(overrides: Partial<BaUseCase> & Pick<BaUseCase, 'id'>): BaUseCase {
  return parse({
    itemType: 'use_case',
    ordinal: 0,
    name: 'Khách hàng đặt đơn',
    actor: 'Khách hàng',
    precondition: 'Khách hàng đã đăng nhập',
    mainFlow: ['Chọn sản phẩm', 'Xác nhận đơn'],
    postcondition: 'Đơn được tạo',
    role: 'customer',
    dataEffects: ['create'],
    ...overrides,
  }) as BaUseCase
}

export function makeRule(overrides: Partial<BaRule> & Pick<BaRule, 'id'>): BaRule {
  return parse({
    itemType: 'rule',
    ordinal: 0,
    statement: 'Đơn hàng phải có ít nhất một sản phẩm',
    ...overrides,
  }) as BaRule
}

export function makeErrorCode(
  overrides: Partial<BaErrorCode> & Pick<BaErrorCode, 'id'>,
): BaErrorCode {
  return parse({
    itemType: 'error_code',
    ordinal: 0,
    code: 'E001',
    message: 'Đơn hàng rỗng',
    ...overrides,
  }) as BaErrorCode
}

export function makeFlowStep(overrides: Partial<BaFlowStep> & Pick<BaFlowStep, 'id'>): BaFlowStep {
  return parse({
    itemType: 'flow_step',
    ordinal: 0,
    label: 'Kiểm tra tồn kho',
    kind: 'step',
    ...overrides,
  }) as BaFlowStep
}

export function makeField(overrides: Partial<BaField> & Pick<BaField, 'id'>): BaField {
  return parse({
    itemType: 'field',
    ordinal: 0,
    name: 'Email',
    fieldType: 'email',
    required: true,
    ...overrides,
  }) as BaField
}

export function makeActor(overrides: Partial<BaActor> & Pick<BaActor, 'id'>): BaActor {
  return parse({
    itemType: 'actor',
    ordinal: 0,
    name: 'Khách hàng',
    ...overrides,
  }) as BaActor
}

export function makeModel(
  items: readonly BaDocItem[],
  links: BaDocModel['links'] = [],
): BaDocModel {
  return { items: [...items], links: [...links] }
}

export function makeKnowledge(
  overrides: Partial<BaKnowledgeFact> & Pick<BaKnowledgeFact, 'id'>,
): BaKnowledgeFact {
  return {
    title: 'Ngưỡng miễn phí giao hàng',
    body: 'Đơn hàng trên 500k được miễn phí giao hàng',
    status: 'confirmed',
    ...overrides,
  }
}

export const TEST_RULEBOOK: BaRulebook = {
  id: 'test-rulebook',
  version: '1',
  name: 'Rulebook test',
  byFieldType: [
    {
      fieldType: 'email',
      validations: [
        { key: 'email-format', label: 'Đúng định dạng email' },
        { key: 'max-length', label: 'Giới hạn độ dài' },
      ],
    },
  ],
}

export const TEST_TEMPLATE: BaTemplate = {
  id: 'us-test',
  version: '1',
  name: 'US test',
  documentKind: 'us',
  sections: [
    { key: 'use-cases', title: 'Use case', required: true, itemTypes: ['use_case'] },
    { key: 'errors', title: 'Mã lỗi', required: true, itemTypes: ['error_code'] },
    { key: 'rules', title: 'Quy tắc', required: false, itemTypes: ['rule'] },
  ],
}

/** Đầu vào luật với mặc định "không có gì" — mỗi test chỉ dựng đúng phần nó nói tới. */
export function makeRuleInput(overrides: Partial<RuleInput> = {}): RuleInput {
  return {
    doc: { items: [], links: [] },
    knowledge: [],
    rulebook: null,
    template: null,
    ...overrides,
  }
}
