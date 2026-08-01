import { z } from 'zod'
import { ERROR_CATALOG, NexaError, type ErrorCode } from './errors.js'

/** Nguồn của kết quả (§9.2 `meta.source`). */
export const RESULT_SOURCES = ['litellm', 'jira', 'confluence', 'local', 'mcp'] as const
export type ResultSource = (typeof RESULT_SOURCES)[number]

/**
 * Envelope chuẩn hoá của §9.2.
 *
 * Dùng snake_case cho `request_id` vì tài liệu ghi thế và nó là hợp đồng đối chiếu với log
 * LiteLLM/Atlassian — đổi sang camelCase sẽ phá mất khả năng grep chéo (§15.2).
 */
export interface SuccessEnvelope<T> {
  readonly request_id: string
  readonly data: T
  readonly meta: { readonly source: ResultSource }
}

export interface ErrorEnvelope {
  readonly request_id: string
  readonly error: {
    readonly code: ErrorCode
    readonly message: string
    readonly retryable: boolean
    readonly hint?: string
    /** Chỉ có khi lỗi gắn với một thao tác write (§10.3). */
    readonly operation_id?: string
  }
}

export type Envelope<T> = SuccessEnvelope<T> | ErrorEnvelope

export function isError<T>(e: Envelope<T>): e is ErrorEnvelope {
  return 'error' in e
}

export function ok<T>(requestId: string, data: T, source: ResultSource): SuccessEnvelope<T> {
  return { request_id: requestId, data, meta: { source } }
}

/**
 * Chuyển bất kỳ lỗi nào thành ErrorEnvelope.
 *
 * Cố ý KHÔNG serialize `error.cause` hay stack trace: envelope này đi qua IPC tới renderer,
 * và upstream error thường echo lại payload hoặc URL có token (§11.1).
 */
export function fail(requestId: string, error: unknown): ErrorEnvelope {
  const e = NexaError.wrap(error)
  const meta = ERROR_CATALOG[e.code]
  return {
    request_id: e.requestId ?? requestId,
    error: {
      code: e.code,
      message: meta.message,
      retryable: e.retryable,
      ...(meta.hint !== undefined ? { hint: meta.hint } : {}),
      ...(e.operationId !== undefined ? { operation_id: e.operationId } : {}),
    },
  }
}

export const errorEnvelopeSchema = z.object({
  request_id: z.string(),
  error: z.object({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
    hint: z.string().optional(),
    operation_id: z.string().optional(),
  }),
})
