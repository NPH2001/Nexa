import { z } from 'zod'

/**
 * Mô hình tài liệu BA — nguồn sự thật, còn văn xuôi là phép chiếu (D1).
 *
 * Vì sao mọi giới hạn độ dài nằm ở đây chứ không nằm trong prompt: ask #6 ("viết khá miên man và
 * nhiều ý trùng nhau") là vấn đề cấu trúc. Một use case 15 bước hay một rule ghép ba mệnh đề phải
 * là **không hợp lệ**, không phải là thứ ta xin model đừng làm. Zod từ chối; không cắt bớt im lặng.
 *
 * Xem `openspec/changes/add-ba-workbench/design.md` D1 và D5.
 */

// ═══════════════════════════════════════════════════════════════════════════
// Giới hạn — hằng số công khai để test và UI dùng chung một con số
// ═══════════════════════════════════════════════════════════════════════════

export const LIMITS = {
  /** Tên use case, field, actor. */
  name: 120,
  /** Một bước trong luồng, một mệnh đề rule, một lý do. */
  statement: 200,
  /** Precondition, postcondition, mô tả. */
  prose: 500,
  /** Số bước tối đa của luồng chính. Vượt nghĩa là use case cần được tách. */
  mainFlowSteps: 12,
  /** Mã lỗi và thông điệp của nó. */
  errorCode: 50,
  errorMessage: 300,
} as const

const name = z.string().trim().min(1).max(LIMITS.name)
const statement = z.string().trim().min(1).max(LIMITS.statement)
const prose = z.string().trim().min(1).max(LIMITS.prose)

/** Id item — do bước trích xuất hoặc repository sinh, không phải người dùng gõ. */
const itemId = z.string().trim().min(1).max(64)

// ═══════════════════════════════════════════════════════════════════════════
// Phần chung của mọi item
// ═══════════════════════════════════════════════════════════════════════════

const baseItem = {
  id: itemId,
  /** Thứ tự hiển thị trong nhóm cùng kiểu. Bộ hợp nhất gán lại sau khi dò trùng. */
  ordinal: z.number().int().nonnegative(),
  /**
   * `true` khi bước trích xuất không xác định được. Item như vậy hiển thị tách riêng và
   * KHÔNG được dùng làm căn cứ kết luận trong review (D4).
   */
  needsReview: z.boolean().default(false),
  /**
   * Vị trí nguồn đã sinh ra item — id chunk hoặc anchor heading. Nhiều phần tử nghĩa là item
   * xuất hiện ở nhiều chunk và đã được hợp nhất.
   */
  sources: z.array(z.string().trim().min(1).max(200)).default([]),
}

// ═══════════════════════════════════════════════════════════════════════════
// Field
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Kiểu field — trục tra cứu của rulebook common validate (ask #3, phần không cần vision).
 * `unknown` là giá trị thật, không phải giá trị mặc định để lấp chỗ trống: nó buộc item mang
 * `needsReview` và người dùng phải nhìn tới.
 */
export const FIELD_TYPES = [
  'email',
  'phone',
  'money',
  'date',
  'identifier',
  'number',
  'boolean',
  'enum',
  'free_text',
  'unknown',
] as const
export const fieldTypeSchema = z.enum(FIELD_TYPES)
export type BaFieldType = z.infer<typeof fieldTypeSchema>

export const baFieldSchema = z.object({
  ...baseItem,
  itemType: z.literal('field'),
  name,
  fieldType: fieldTypeSchema,
  required: z.boolean(),
  description: prose.optional(),
  /**
   * Khoá của các validate đã có, tra theo rulebook (`rulebook.ts`).
   *
   * Là danh sách KHOÁ chứ không phải câu mô tả có chủ ý: câu chữ thì phải so khớp mờ mới biết
   * "kiểm tra định dạng email" và "email phải đúng chuẩn" là một, còn khoá thì so bằng `===`.
   * Đó là điều kiện để `R-FLD-02` trả lời được "field này còn thiếu validate nào" một cách xác
   * định thay vì đoán.
   */
  validations: z.array(z.string().trim().min(1).max(64)).default([]),
  /**
   * Đánh dấu field cố ý không cần validate. Có lý do thì `R-FLD-01` im lặng; không có lý do thì
   * không được đánh dấu — "không cần validate" mà không nói vì sao là đúng thứ review phải bắt.
   */
  noValidationReason: statement.optional(),
})

// ═══════════════════════════════════════════════════════════════════════════
// Use case
// ═══════════════════════════════════════════════════════════════════════════

export const DATA_EFFECTS = ['create', 'update', 'delete', 'read', 'none'] as const
export const dataEffectSchema = z.enum(DATA_EFFECTS)
export type BaDataEffect = z.infer<typeof dataEffectSchema>

const flowBranchSchema = z.object({
  name,
  steps: z.array(statement).min(1),
  /** Mã lỗi mà nhánh này phát sinh, nếu có. Nguồn tham chiếu của `R-ERR-01`. */
  errorCode: z.string().trim().min(1).max(LIMITS.errorCode).optional(),
})
export type BaFlowBranch = z.infer<typeof flowBranchSchema>

export const baUseCaseSchema = z.object({
  ...baseItem,
  itemType: z.literal('use_case'),
  name,
  actor: name,
  precondition: prose,
  /**
   * Vượt `LIMITS.mainFlowSteps` là tín hiệu use case đang gộp nhiều việc, không phải tín hiệu
   * giới hạn quá chặt. Thông báo lỗi phải nói "tách use case", không nói "rút gọn".
   */
  mainFlow: z.array(statement).min(1).max(LIMITS.mainFlowSteps),
  alternateFlows: z.array(flowBranchSchema).default([]),
  exceptionFlows: z.array(flowBranchSchema).default([]),
  postcondition: prose,
  /** Role/quyền được thực hiện use case — căn cứ của `R-UC-04`. */
  role: name,
  dataEffects: z.array(dataEffectSchema).min(1),
  /** Lý do không có luồng thay thế. Bắt buộc với `R-UC-02` khi `alternateFlows` rỗng. */
  noAlternateReason: statement.optional(),
  /** Use case cố ý không nằm trong flow nào — miễn trừ của `R-FLOW-02`. */
  standalone: z.boolean().default(false),
})

// ═══════════════════════════════════════════════════════════════════════════
// Rule
// ═══════════════════════════════════════════════════════════════════════════

export const baRuleSchema = z.object({
  ...baseItem,
  itemType: z.literal('rule'),
  /** MỘT mệnh đề nguyên tử. Bộ chuẩn hoá (G2) tách mệnh đề ghép trước khi tới đây. */
  statement,
  /**
   * Id use case hoặc field mà rule ràng buộc.
   *
   * Cố ý cho phép rỗng ở tầng schema: lúc trích xuất, rule thường xuất hiện trước khi biết nó
   * gắn vào đâu. Rule mồ côi là **finding của `R-RULE-02`**, không phải lỗi lưu trữ — biến nó
   * thành lỗi schema sẽ làm mọi lần trích xuất thất bại và người dùng mất luôn nội dung.
   */
  appliesTo: z.array(itemId).default([]),
})

// ═══════════════════════════════════════════════════════════════════════════
// Flow step
// ═══════════════════════════════════════════════════════════════════════════

export const FLOW_STEP_KINDS = ['start', 'step', 'decision', 'end'] as const
export const flowStepKindSchema = z.enum(FLOW_STEP_KINDS)

export const baFlowStepSchema = z.object({
  ...baseItem,
  itemType: z.literal('flow_step'),
  label: statement,
  kind: flowStepKindSchema,
  actor: name.optional(),
  /** Mã lỗi bước này phát sinh, nếu có. Nguồn tham chiếu thứ hai của `R-ERR-01`. */
  errorCode: z.string().trim().min(1).max(LIMITS.errorCode).optional(),
})

// ═══════════════════════════════════════════════════════════════════════════
// Error code
// ═══════════════════════════════════════════════════════════════════════════

export const baErrorCodeSchema = z.object({
  ...baseItem,
  itemType: z.literal('error_code'),
  code: z.string().trim().min(1).max(LIMITS.errorCode),
  message: z.string().trim().min(1).max(LIMITS.errorMessage),
  meaning: prose.optional(),
  httpStatus: z.number().int().min(100).max(599).optional(),
})

// ═══════════════════════════════════════════════════════════════════════════
// Actor
// ═══════════════════════════════════════════════════════════════════════════

export const baActorSchema = z.object({
  ...baseItem,
  itemType: z.literal('actor'),
  name,
  description: prose.optional(),
})

// ═══════════════════════════════════════════════════════════════════════════
// Item, link và mô hình
// ═══════════════════════════════════════════════════════════════════════════

export const baDocItemSchema = z.discriminatedUnion('itemType', [
  baFieldSchema,
  baUseCaseSchema,
  baRuleSchema,
  baFlowStepSchema,
  baErrorCodeSchema,
  baActorSchema,
])

export type BaDocItem = z.infer<typeof baDocItemSchema>
export type BaField = z.infer<typeof baFieldSchema>
export type BaUseCase = z.infer<typeof baUseCaseSchema>
export type BaRule = z.infer<typeof baRuleSchema>
export type BaFlowStep = z.infer<typeof baFlowStepSchema>
export type BaErrorCode = z.infer<typeof baErrorCodeSchema>
export type BaActor = z.infer<typeof baActorSchema>

export const ITEM_TYPES = [
  'actor',
  'field',
  'use_case',
  'rule',
  'flow_step',
  'error_code',
] as const satisfies readonly BaDocItem['itemType'][]
export type BaItemType = (typeof ITEM_TYPES)[number]

/**
 * Quan hệ giữa hai item.
 *
 * **Chiều của mỗi quan hệ là cố định** và phải giữ đúng, vì ma trận truy vết và sơ đồ đều đọc
 * theo chiều:
 *   - `next`:       flow_step → flow_step
 *   - `covers`:     use_case  → flow_step   ("use case này phủ bước kia")
 *   - `raises`:     use_case | flow_step → error_code
 *   - `validates`:  rule      → field | use_case
 *   - `references`: bất kỳ → bất kỳ, dùng cho quan hệ không thuộc bốn loại trên
 *
 * `next` là cạnh của đồ thị flow. Nó nằm ở đây chứ không nằm thành mảng `nextIds` trên
 * `flow_step` vì hai cách biểu diễn cùng một cạnh chắc chắn sẽ lệch nhau. Sơ đồ Mermaid (D8) và
 * ma trận truy vết đều đọc từ đúng danh sách này.
 */
export const LINK_KINDS = ['next', 'covers', 'raises', 'validates', 'references'] as const
export const linkKindSchema = z.enum(LINK_KINDS)
export type BaLinkKind = z.infer<typeof linkKindSchema>

export const baDocLinkSchema = z.object({
  from: itemId,
  to: itemId,
  kind: linkKindSchema,
  /** Nhãn cạnh — dùng cho nhánh của `decision` trong sơ đồ. */
  label: statement.optional(),
})
export type BaDocLink = z.infer<typeof baDocLinkSchema>

export const baDocModelSchema = z.object({
  items: z.array(baDocItemSchema),
  links: z.array(baDocLinkSchema).default([]),
})
export type BaDocModel = z.infer<typeof baDocModelSchema>

export const EMPTY_MODEL: BaDocModel = { items: [], links: [] }

// ═══════════════════════════════════════════════════════════════════════════
// Truy vấn tiện dụng
// ═══════════════════════════════════════════════════════════════════════════

/** Lọc item theo kiểu, giữ nguyên kiểu TypeScript của nhánh tương ứng. */
export function itemsOfType<K extends BaItemType>(
  model: BaDocModel,
  itemType: K,
): Extract<BaDocItem, { itemType: K }>[] {
  return model.items.filter(
    (item): item is Extract<BaDocItem, { itemType: K }> => item.itemType === itemType,
  )
}

/**
 * Item được dùng làm căn cứ kết luận — tức là đã bỏ phần `needsReview` (D4).
 *
 * Mọi luật review và mọi phép tổng hợp đều phải đi qua hàm này thay vì đọc thẳng `model.items`,
 * để không có chỗ nào lỡ dùng dữ liệu chưa ai soát làm bằng chứng.
 */
export function reviewedItems(model: BaDocModel): BaDocItem[] {
  return model.items.filter((item) => !item.needsReview)
}

/**
 * Mô hình rút còn phần dùng làm căn cứ được, kèm số item đã bỏ.
 *
 * Bỏ item thôi chưa đủ: một link `covers` trỏ tới một bước đã bị loại sẽ khiến ma trận truy vết
 * tưởng bước đó còn tồn tại và được phủ. Nên link mồ côi bị bỏ cùng lúc, và bộ chạy review chỉ
 * nhìn thấy một đồ thị nhất quán.
 *
 * Số bị loại được trả về chứ không nuốt: nó phải hiện trên báo cáo (D4).
 */
export function reviewedModel(model: BaDocModel): {
  readonly model: BaDocModel
  readonly excluded: number
} {
  const items = reviewedItems(model)
  const alive = new Set(items.map((item) => item.id))
  return {
    model: {
      items,
      links: model.links.filter((link) => alive.has(link.from) && alive.has(link.to)),
    },
    excluded: model.items.length - items.length,
  }
}
