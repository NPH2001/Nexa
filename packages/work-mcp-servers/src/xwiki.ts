import { z } from 'zod'
import { sanitizeExternalUrl } from '@nexa/security'
import {
  ERROR_CODES,
  NexaError,
  type FeatureFlags,
  type PreviewContext,
  type PreviewField,
  type RiskLevel,
  type ToolDefinition,
  type ToolPreview,
  type ToolResultSummary,
} from '@nexa/shared-types'
import { summarizeGeneric, truncateField } from '@nexa/atlassian-mcp-manager'
import {
  bool,
  int,
  paramsJsonSchema,
  paramsSchema,
  req,
  str,
  type ParamSpec,
  type ParamTable,
} from './params.js'

// ═══════════════════════════════════════════════════════════════════════════
// Phân loại lỗi
// ═══════════════════════════════════════════════════════════════════════════

/**
 * `safeDetail` đánh dấu "tài liệu không tồn tại". Hằng số chứ không phải mã lỗi mới: với tool
 * đọc đây chỉ là lỗi nghiệp vụ thường, nhưng `prepareWrite` cần phân biệt nó với mọi lỗi khác để
 * biết đang TẠO MỚI (không có `base_version`) hay không đọc được trang đang có (phải dừng).
 */
export const XWIKI_NOT_FOUND_DETAIL = 'xwiki-document-not-found'

/**
 * Câu lỗi quan sát được trên server thật (2026-11-17):
 *   - `No such document: "Sandbox.X".`
 *   - `Version conflict …` (tài liệu `man write_document`)
 */
export function classifyXwikiError(rawText: string, toolName: string): NexaError {
  const lower = rawText.toLowerCase()
  if (lower.includes('no such document')) {
    return new NexaError(ERROR_CODES.UPSTREAM_UNAVAILABLE, {
      safeDetail: XWIKI_NOT_FOUND_DETAIL,
      retryable: false,
    })
  }
  if (lower.includes('version conflict')) {
    return new NexaError(ERROR_CODES.XWIKI_VERSION_CONFLICT, {
      safeDetail: `${toolName}: document changed since it was read`,
    })
  }
  if (/\b401\b/.test(lower) || lower.includes('unauthorized') || lower.includes('invalid token')) {
    return new NexaError(ERROR_CODES.XWIKI_AUTH_FAILED, {
      safeDetail: `${toolName} rejected by XWiki (credential)`,
    })
  }
  if (/\b403\b/.test(lower) || lower.includes('not allowed') || lower.includes('access denied')) {
    return new NexaError(ERROR_CODES.UPSTREAM_UNAVAILABLE, {
      safeDetail: `${toolName}: XWiki account lacks the right for this page`,
      retryable: false,
    })
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return new NexaError(ERROR_CODES.MCP_SERVER_UNAVAILABLE, {
      safeDetail: `${toolName} timed out at XWiki`,
    })
  }
  return new NexaError(ERROR_CODES.UPSTREAM_UNAVAILABLE, {
    safeDetail: `${toolName} failed at XWiki`,
    retryable: false,
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// Rút gọn kết quả
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Output của XWiki là text có header (`Reference:`, `URL:`, `Version:`…), không phải JSON.
 * Lấy link từ dòng `URL:` — chỉ nhận nếu cùng host với endpoint đã cấu hình, chống server trả link
 * lừa đảo.
 */
export function summarizeXwiki(raw: unknown, origin: string): ToolResultSummary {
  const base = summarizeGeneric(raw)
  if (typeof raw !== 'string') return base
  const url = /^URL:\s*(\S+)\s*$/m.exec(raw)?.[1]
  const reference = /^Reference:\s*(\S+)\s*$/m.exec(raw)?.[1]
  const safeUrl = url === undefined || origin === '' ? null : sanitizeExternalUrl(url, origin)
  return {
    ...base,
    ...(reference !== undefined ? { targetKey: reference, forUser: `Trang ${reference}` } : {}),
    ...(safeUrl !== null ? { targetUrl: safeUrl } : {}),
  }
}

/** `Version: 4.3` trong header của `get_document`. */
export function parseXwikiVersion(text: string): string | null {
  return /^Version:\s*(\S+)\s*$/m.exec(text)?.[1] ?? null
}

// ═══════════════════════════════════════════════════════════════════════════
// Danh mục tool
// ═══════════════════════════════════════════════════════════════════════════

const REF = (what: string): ParamSpec =>
  req(str(`${what}, ví dụ "Sales.WebHome" hoặc "xwiki:Help.Foo" (tiền tố wiki-id để sang wiki khác)`, { max: 768 }))
const WIKI = str('Wiki id (xem list_wikis) thay vì wiki hiện tại; một wiki mỗi lần gọi')
const LOCALE = str('Bản dịch cụ thể, ví dụ "fr"; bỏ trống = ngôn ngữ mặc định')

interface XwikiToolSpec {
  readonly mcp: string
  readonly risk: RiskLevel
  readonly flag: keyof FeatureFlags
  readonly description: string
  readonly params: ParamTable
  /** Tham số chỉ Nexa điền (ví dụ `base_version`) — có trong zod, KHÔNG gửi cho model. */
  readonly internalParams?: ParamTable
  readonly buildPreview?: ToolDefinition['buildPreview']
  readonly prepareWrite?: ToolDefinition['prepareWrite']
}

const editItem = z.object({
  old_string: z.string().max(32_000),
  new_string: z.string().max(64_000),
  replace_all: z.boolean().optional(),
})

const WRITE_COMMON: ParamTable = {
  title: str('Tiêu đề mới; bỏ trống = giữ nguyên, chuỗi rỗng = xoá tiêu đề', { max: 255 }),
  hidden: bool('Đánh dấu trang kỹ thuật (ẩn khỏi duyệt và tìm kiếm thường)'),
  locale: LOCALE,
  comment: str('Ghi chú phiên bản trong lịch sử (XWiki thêm tiền tố [AI])', { max: 500 }),
  major: bool('Lưu thành phiên bản lớn (mặc định là phiên bản nhỏ)'),
}

const BASE_VERSION: ParamTable = {
  base_version: str('Phiên bản đã đọc lúc preview — Nexa tự điền', { max: 32 }),
}

const TOOLS: readonly XwikiToolSpec[] = [
  {
    mcp: 'list_wikis',
    risk: 'READ',
    flag: 'xwikiRead',
    description: 'Liệt kê các wiki mà endpoint XWiki này tìm kiếm và thao tác được.',
    params: {},
  },
  {
    mcp: 'man',
    risk: 'READ',
    flag: 'xwikiRead',
    description:
      'Tài liệu hướng dẫn các tool XWiki và trang tham khảo (ví dụ "xwiki-syntax"). Gọi không tham số để xem danh mục.',
    params: { tool: str('Tên tool hoặc trang tham khảo', { max: 100 }) },
  },
  {
    mcp: 'get_tree',
    risk: 'READ',
    flag: 'xwikiRead',
    description:
      'Khảo sát cấu trúc wiki: bỏ trống root để xem tóm tắt từng space; có root để duyệt cây trang con.',
    params: {
      root: str('Trang gốc để duyệt, ví dụ "Sales.WebHome" hoặc "Sales"', { max: 768 }),
      wiki: WIKI,
      depth: int('Số tầng (1–4, mặc định 2)', { min: 1, max: 4 }),
      limit: int('Số trang con tối đa mỗi nút (1–200)', { min: 1, max: 200 }),
      offset: int('Bỏ qua bao nhiêu trang con trực tiếp của root', { min: 0 }),
      showHidden: bool('Gồm cả trang ẩn'),
    },
  },
  {
    mcp: 'query_documents',
    risk: 'READ',
    flag: 'xwikiRead',
    description:
      'Tìm tài liệu XWiki (Solr edismax): "cụm chính xác", +bắt buộc, -loại trừ, OR, wildcard*. Có lọc theo space, tác giả, thời gian sửa.',
    params: {
      query: str('Từ khoá theo cú pháp edismax', { max: 1_000 }),
      wiki: str('Bỏ trống = wiki này; wiki id; hoặc "all" để tìm mọi wiki'),
      space: str('Giới hạn trong một space và các space con, ví dụ "Help"'),
      author: str('Người sửa cuối, ví dụ "XWiki.Admin"'),
      locale: str('Lọc theo ngôn ngữ nội dung'),
      modifiedWithin: { type: 'string', description: 'Cửa sổ thời gian sửa', enum: ['day', 'week', 'month', 'year'] },
      modifiedRange: str('Khoảng Solr, ví dụ "[NOW-7DAY TO NOW]"'),
      sort: {
        type: 'string',
        description: 'Thứ tự kết quả',
        enum: ['relevance', 'newest', 'oldest', 'title'],
      },
      limit: int('Số kết quả tối đa (≤ 25)', { min: 1, max: 25 }),
      offset: int('Vị trí bắt đầu (phân trang)', { min: 0 }),
      includeHidden: bool('Gồm cả trang kỹ thuật ẩn'),
    },
  },
  {
    mcp: 'get_document',
    risk: 'READ',
    flag: 'xwikiRead',
    description:
      'Đọc mã nguồn một tài liệu XWiki (có số dòng). Trang lớn trả outline; đọc tiếp bằng offset/limit. rendered=true để xem bản đã render (chỉ đọc, không dùng để tạo chuỗi sửa). Header có dòng Version dùng cho ghi đè.',
    params: {
      reference: REF('Tài liệu cần đọc'),
      locale: LOCALE,
      offset: int('Dòng bắt đầu (từ 1)', { min: 1 }),
      limit: int('Số dòng cần đọc', { min: 1, max: 2_000 }),
      outline: bool('Chỉ trả outline tiêu đề'),
      rendered: bool('Trả bản đã render thay vì mã nguồn'),
      format: { type: 'string', description: 'Với rendered=true', enum: ['plain', 'html'] },
      section: str('Với rendered+html: anchor một section, ví dụ "#HInstallation"'),
      detail: { type: 'string', description: 'Với rendered+html', enum: ['stripped', 'full'] },
    },
  },
  {
    mcp: 'get_history',
    risk: 'READ',
    flag: 'xwikiRead',
    description:
      'Lịch sử phiên bản của một tài liệu; version= để đọc một bản cũ; from/to để xem diff giữa hai bản.',
    params: {
      reference: REF('Tài liệu'),
      wiki: WIKI,
      locale: LOCALE,
      version: str('Đọc nội dung của phiên bản này, ví dụ "2.1"', { max: 32 }),
      from: str('Diff từ phiên bản này', { max: 32 }),
      to: str('Diff tới phiên bản này (cần from)', { max: 32 }),
      limit: int('Số phiên bản mỗi trang (≤ 100)', { min: 1, max: 100 }),
      offset: int('Phân trang', { min: 0 }),
    },
  },
  {
    mcp: 'get_links',
    risk: 'READ',
    flag: 'xwikiRead',
    description:
      'Đồ thị link quanh một tài liệu: direction="in" (mặc định) là trang trỏ TỚI nó, "out" là link đi ra.',
    params: {
      reference: REF('Tài liệu'),
      wiki: WIKI,
      direction: { type: 'string', description: 'Hướng link', enum: ['in', 'out'] },
      locale: LOCALE,
      limit: int('Số backlink mỗi trang (≤ 200)', { min: 1, max: 200 }),
      offset: int('Phân trang backlink', { min: 0 }),
      showHidden: bool('Gồm cả trang ẩn'),
    },
  },
  {
    mcp: 'get_attachment',
    risk: 'READ',
    flag: 'xwikiRead',
    description:
      'Đọc một file đính kèm của tài liệu (file văn bản trả nội dung; metadata=true chỉ lấy thông tin).',
    params: {
      reference: REF('Tài liệu chứa đính kèm'),
      filename: req(str('Tên file chính xác như get_document liệt kê', { max: 255 })),
      offset: int('Dòng tiếp tục khi nội dung bị cắt', { min: 0 }),
      metadata: bool('Chỉ lấy metadata, không lấy nội dung'),
    },
  },
  {
    mcp: 'get_schema',
    risk: 'READ',
    flag: 'xwikiRead',
    description:
      'Mô tả class XWiki: không tham số = danh sách class kèm số instance; có class = các trường của class đó.',
    params: { class: str('Reference của class, ví dụ "Blog.BlogPostClass"'), wiki: WIKI },
  },
  {
    mcp: 'query_objects',
    risk: 'READ',
    flag: 'xwikiRead',
    description: 'Tìm object có cấu trúc (XObject) theo class và điều kiện trường.',
    params: {
      class: str('Reference của class'),
      filters: {
        type: 'array',
        description: 'Điều kiện "<trường> <toán tử> <giá trị>", ví dụ "status = published"',
        items: { type: 'string' },
        itemSchema: z.string().max(500),
        maxItems: 20,
      },
      select: {
        type: 'array',
        description: 'Tên trường cần hiện (tối đa 10)',
        items: { type: 'string' },
        itemSchema: z.string().max(100),
        maxItems: 10,
      },
      document: str('Chỉ object trên tài liệu này'),
      sort: str('"<trường> asc" hoặc "<trường> desc"'),
      limit: int('Số kết quả tối đa (≤ 25)', { min: 1, max: 25 }),
      offset: int('Phân trang', { min: 0 }),
      wiki: WIKI,
    },
  },
  {
    mcp: 'write_document',
    risk: 'WRITE_HIGH',
    flag: 'xwikiWrite',
    description:
      'Tạo tài liệu XWiki mới hoặc THAY TOÀN BỘ nội dung tài liệu đang có. Viết cú pháp XWiki 2.1 ("= Tiêu đề =", "[[Nhãn>>Đích]]"), KHÔNG phải Markdown. Sửa nhỏ thì dùng xwiki_edit_document. Nexa tự kiểm tra phiên bản; cần người dùng xác nhận.',
    params: {
      reference: REF('Tài liệu cần tạo hoặc ghi đè'),
      content: req(str('Toàn bộ mã nguồn mới của tài liệu', { max: 200_000 })),
      ...WRITE_COMMON,
    },
    internalParams: BASE_VERSION,
    prepareWrite: (input, ctx) => pinBaseVersion(input as Record<string, unknown>, ctx),
    buildPreview: (input, ctx) => previewWriteDocument(input as Record<string, unknown>, ctx),
  },
  {
    mcp: 'edit_document',
    risk: 'WRITE_HIGH',
    flag: 'xwikiWrite',
    description:
      'Sửa tài liệu XWiki bằng tìm-thay chính xác trên mã nguồn (đọc bằng xwiki_get_document trước; chép old_string nguyên văn, không kèm số dòng). Các thay đổi áp dụng theo thứ tự rồi lưu thành một phiên bản. Cần người dùng xác nhận.',
    params: {
      reference: REF('Tài liệu cần sửa'),
      edits: {
        type: 'array',
        description: 'Danh sách {old_string, new_string, replace_all?}',
        items: {
          type: 'object',
          properties: {
            old_string: { type: 'string' },
            new_string: { type: 'string' },
            replace_all: { type: 'boolean' },
          },
          required: ['old_string', 'new_string'],
        },
        itemSchema: editItem,
        maxItems: 30,
      },
      ...WRITE_COMMON,
    },
    internalParams: BASE_VERSION,
    prepareWrite: (input, ctx) => pinBaseVersion(input as Record<string, unknown>, ctx),
    buildPreview: (input, ctx) => previewEditDocument(input as Record<string, unknown>, ctx),
  },
]

export function xwikiToolName(mcp: string): string {
  return `xwiki_${mcp}`
}

/**
 * Danh mục tool XWiki (ADR 0010). Server không công bố annotation readOnly/destructive nào, nên
 * mức rủi ro ở đây hoàn toàn do Nexa quyết.
 *
 * @param origin  `origin` của endpoint MCP — link trong kết quả chỉ được nhận nếu cùng host.
 */
export function buildXwikiTools(origin: string): ToolDefinition[] {
  return TOOLS.map((spec) => ({
    name: xwikiToolName(spec.mcp),
    mcpToolName: spec.mcp,
    targetSystem: 'xwiki' as const,
    riskLevel: spec.risk,
    description: spec.description,
    inputSchema: paramsSchema({ ...spec.params, ...(spec.internalParams ?? {}) }),
    jsonSchema: paramsJsonSchema(spec.params),
    requiredFeature: spec.flag,
    ...(spec.prepareWrite !== undefined ? { prepareWrite: spec.prepareWrite } : {}),
    ...(spec.buildPreview !== undefined ? { buildPreview: spec.buildPreview } : {}),
    summarizeResult: (raw: unknown) => summarizeXwiki(raw, origin),
  }))
}

// ═══════════════════════════════════════════════════════════════════════════
// Khoá phiên bản
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Gắn `base_version` của bản đang có vào payload TRƯỚC preview (ADR 0010, D7).
 *
 * - Đọc được ⇒ `base_version` = phiên bản đó. XWiki sẽ từ chối nếu trang đổi trước lúc thực thi.
 * - Trang chưa tồn tại ⇒ bỏ `base_version` (tạo mới). Nếu ai đó tạo trang ngay sau lúc đọc, XWiki
 *   vẫn từ chối ghi đè vì ghi đè BẮT BUỘC có `base_version` (`man write_document`).
 * - Mọi lỗi khác ⇒ dừng. Không đọc được trang đang có thì không ghi mù lên nó.
 *
 * Giá trị model tự điền vào `base_version` (nếu có) luôn bị thay: model không được chọn phiên bản
 * để ghi đè.
 */
async function pinBaseVersion(
  input: Record<string, unknown>,
  ctx: PreviewContext,
): Promise<Record<string, unknown>> {
  const { base_version: _ignored, ...rest } = input
  void _ignored
  let raw: unknown
  try {
    raw = await ctx.readTool(xwikiToolName('get_document'), {
      reference: input['reference'],
      outline: true,
      ...(typeof input['locale'] === 'string' ? { locale: input['locale'] } : {}),
    })
  } catch (error) {
    if (NexaError.is(error) && error.safeDetail === XWIKI_NOT_FOUND_DETAIL) return rest
    throw new NexaError(ERROR_CODES.UPSTREAM_UNAVAILABLE, {
      cause: error,
      safeDetail: 'could not read the current XWiki document version — refusing a blind write',
      retryable: true,
    })
  }
  const version = parseXwikiVersion(typeof raw === 'string' ? raw : JSON.stringify(raw))
  if (version === null) {
    throw new NexaError(ERROR_CODES.UPSTREAM_UNAVAILABLE, {
      safeDetail: 'XWiki get_document returned no Version line — refusing a blind write',
      retryable: false,
    })
  }
  return { ...rest, base_version: version }
}

// ═══════════════════════════════════════════════════════════════════════════
// Preview
// ═══════════════════════════════════════════════════════════════════════════

function commonFields(input: Record<string, unknown>): PreviewField[] {
  const fields: PreviewField[] = [{ label: 'Tài liệu', value: String(input['reference']) }]
  if (typeof input['locale'] === 'string') fields.push({ label: 'Bản dịch', value: input['locale'] })
  if (typeof input['title'] === 'string') {
    fields.push({ label: 'Tiêu đề mới', value: input['title'] === '' ? '(xoá tiêu đề)' : input['title'] })
  }
  if (typeof input['hidden'] === 'boolean') {
    fields.push({ label: 'Trang ẩn', value: input['hidden'] ? 'Có' : 'Không' })
  }
  if (typeof input['comment'] === 'string') fields.push({ label: 'Ghi chú phiên bản', value: input['comment'] })
  if (typeof input['base_version'] === 'string') {
    fields.push({ label: 'Phiên bản đang có', value: input['base_version'] })
  }
  return fields
}

function previewWriteDocument(input: Record<string, unknown>, ctx: PreviewContext): Promise<ToolPreview> {
  const overwrite = typeof input['base_version'] === 'string'
  const content = String(input['content'] ?? '')
  const lines = content === '' ? 0 : content.split('\n').length
  const reference = String(input['reference'])
  return Promise.resolve({
    toolName: xwikiToolName('write_document'),
    targetSystem: 'xwiki',
    targetSystemUrl: ctx.targetSystemUrl,
    action: overwrite
      ? `GHI ĐÈ toàn bộ nội dung trang ${reference} (đang ở phiên bản ${String(input['base_version'])})`
      : `Tạo trang mới ${reference}`,
    actingAccount: ctx.actingAccount,
    payloadFields: [...commonFields(input), truncateField('Nội dung mới', content, 1_500)],
    changes: [
      {
        field: overwrite ? `Nội dung trang ${reference}` : `Trang mới ${reference}`,
        before: overwrite ? `Phiên bản ${String(input['base_version'])} (sẽ bị thay toàn bộ)` : null,
        after: `${String(lines)} dòng mới`,
      },
    ],
    impactWarning: overwrite
      ? 'Toàn bộ nội dung hiện tại của trang sẽ bị thay. XWiki giữ phiên bản cũ trong lịch sử. Nếu trang bị ai khác sửa trước khi bạn xác nhận, XWiki sẽ từ chối thay vì ghi đè.'
      : 'Trang mới hiện ngay với mọi người có quyền xem space này.',
    reversible: true,
    riskLevel: 'WRITE_HIGH',
  })
}

function previewEditDocument(input: Record<string, unknown>, ctx: PreviewContext): Promise<ToolPreview> {
  const edits = Array.isArray(input['edits'])
    ? (input['edits'] as { old_string: string; new_string: string; replace_all?: boolean }[])
    : []
  const reference = String(input['reference'])
  return Promise.resolve({
    toolName: xwikiToolName('edit_document'),
    targetSystem: 'xwiki',
    targetSystemUrl: ctx.targetSystemUrl,
    action:
      edits.length === 0
        ? `Sửa thuộc tính trang ${reference}`
        : `Sửa ${String(edits.length)} đoạn trong trang ${reference}`,
    actingAccount: ctx.actingAccount,
    payloadFields: commonFields(input),
    changes: edits.map((e, i) => ({
      field: `Đoạn ${String(i + 1)}${e.replace_all === true ? ' (mọi chỗ khớp)' : ''}`,
      before: e.old_string === '' ? null : truncate(e.old_string),
      after: truncate(e.new_string),
    })),
    impactWarning:
      typeof input['base_version'] === 'string'
        ? `Áp dụng trên phiên bản ${input['base_version']}. Nếu trang đổi trước khi bạn xác nhận, XWiki sẽ từ chối. XWiki giữ phiên bản cũ trong lịch sử.`
        : 'Trang chưa tồn tại — thao tác sẽ tạo trang mới.',
    reversible: true,
    riskLevel: 'WRITE_HIGH',
  })
}

function truncate(text: string, max = 600): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`
}
