import { z } from 'zod'

/**
 * Khai báo một tham số tool MỘT lần, sinh ra cả zod schema (cổng validate) lẫn JSON Schema (gửi
 * cho model). Danh mục Atlassian viết hai thứ đó bằng tay song song; với Redmine/XWiki, bảng này
 * khiến hai bên không thể lệch nhau — lệch nhau nghĩa là model được bảo gửi một trường mà cổng
 * validate âm thầm bỏ đi.
 *
 * Tên tham số PHẢI khớp `inputSchema` thật của server (`mcp-redmine-tools.json`,
 * `mcp-xwiki-tools.json`); test đối chiếu khẳng định điều đó.
 */
export type ParamSpec =
  | {
      readonly type: 'string'
      readonly description: string
      readonly required?: boolean
      readonly max?: number
      readonly enum?: readonly string[]
    }
  | {
      readonly type: 'integer' | 'number'
      readonly description: string
      readonly required?: boolean
      readonly min?: number
      readonly max?: number
    }
  | { readonly type: 'boolean'; readonly description: string; readonly required?: boolean }
  | {
      /** Object tự do (ví dụ `custom_fields` của search_issues). */
      readonly type: 'object'
      readonly description: string
      readonly required?: boolean
    }
  | {
      readonly type: 'array'
      readonly description: string
      readonly required?: boolean
      readonly items: Record<string, unknown>
      readonly itemSchema: z.ZodTypeAny
      readonly maxItems?: number
    }

export type ParamTable = Readonly<Record<string, ParamSpec>>

/** Trần mặc định cho chuỗi — chặn model nhồi cả một tài liệu vào một tham số lọc. */
const DEFAULT_STRING_MAX = 2_000

function zodFor(spec: ParamSpec): z.ZodTypeAny {
  switch (spec.type) {
    case 'string': {
      if (spec.enum !== undefined) {
        const [first, ...rest] = spec.enum
        if (first === undefined) throw new Error('enum must not be empty')
        return z.enum([first, ...rest])
      }
      return z.string().max(spec.max ?? DEFAULT_STRING_MAX)
    }
    case 'integer': {
      let schema = z.number().int()
      if (spec.min !== undefined) schema = schema.min(spec.min)
      if (spec.max !== undefined) schema = schema.max(spec.max)
      return schema
    }
    case 'number': {
      let schema = z.number()
      if (spec.min !== undefined) schema = schema.min(spec.min)
      if (spec.max !== undefined) schema = schema.max(spec.max)
      return schema
    }
    case 'boolean':
      return z.boolean()
    case 'object':
      return z.record(z.union([z.string(), z.number(), z.boolean()]))
    case 'array':
      return z.array(spec.itemSchema).max(spec.maxItems ?? 50)
  }
}

function jsonFor(spec: ParamSpec): Record<string, unknown> {
  switch (spec.type) {
    case 'string':
      return {
        type: 'string',
        description: spec.description,
        ...(spec.enum !== undefined ? { enum: [...spec.enum] } : {}),
      }
    case 'integer':
    case 'number':
      return {
        type: spec.type,
        description: spec.description,
        ...(spec.min !== undefined ? { minimum: spec.min } : {}),
        ...(spec.max !== undefined ? { maximum: spec.max } : {}),
      }
    case 'boolean':
      return { type: 'boolean', description: spec.description }
    case 'object':
      return { type: 'object', description: spec.description }
    case 'array':
      return { type: 'array', description: spec.description, items: spec.items }
  }
}

/**
 * Zod object cho bảng tham số.
 *
 * Không dùng `.strict()`: trường lạ (ví dụ `uploads` mà Nexa cố ý không mở) bị LOẠI khỏi payload
 * thay vì làm hỏng cả lời gọi — giống cách danh mục Atlassian đang xử lý. Điều quan trọng là
 * payload tới server không bao giờ chứa trường ngoài bảng, và zod mặc định đảm bảo đúng điều đó.
 */
export function paramsSchema(table: ParamTable): z.ZodType<Record<string, unknown>> {
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const [name, spec] of Object.entries(table)) {
    const base = zodFor(spec)
    shape[name] = spec.required === true ? base : base.optional()
  }
  return z.object(shape) as unknown as z.ZodType<Record<string, unknown>>
}

export function paramsJsonSchema(table: ParamTable): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const [name, spec] of Object.entries(table)) {
    properties[name] = jsonFor(spec)
    if (spec.required === true) required.push(name)
  }
  return { type: 'object', properties, required, additionalProperties: false }
}

// ── Viết tắt cho bảng tham số ─────────────────────────────────────────────

export const str = (description: string, extra: { max?: number; required?: boolean } = {}): ParamSpec => ({
  type: 'string',
  description,
  ...extra,
})
export const int = (
  description: string,
  extra: { min?: number; max?: number; required?: boolean } = {},
): ParamSpec => ({ type: 'integer', description, ...extra })
export const num = (
  description: string,
  extra: { min?: number; max?: number; required?: boolean } = {},
): ParamSpec => ({ type: 'number', description, ...extra })
export const bool = (description: string): ParamSpec => ({ type: 'boolean', description })
export const req = <T extends ParamSpec>(spec: T): T => ({ ...spec, required: true })

/** `limit`/`offset` phân trang chung của server Redmine. */
export const PAGING: ParamTable = {
  limit: int('Số kết quả tối đa mỗi trang (mặc định 25)', { min: 1, max: 100 }),
  offset: int('Bỏ qua bao nhiêu kết quả đầu (phân trang)', { min: 0 }),
}
