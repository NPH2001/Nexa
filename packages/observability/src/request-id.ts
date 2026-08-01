import { randomUUID } from 'node:crypto'

/**
 * §9.3: "X-Request-ID/operation_id do desktop tạo và giữ xuyên suốt adapter, local log và
 * thông báo lỗi."
 *
 * Tiền tố giúp phân biệt ngay khi đọc log lẫn lộn giữa Nexa, LiteLLM và Atlassian.
 */
export function newRequestId(): string {
  return `req_${randomUUID().replace(/-/g, '')}`
}

/** §10.3: `operation_id = uuid()`. Giữ nguyên dạng UUID vì schema IPC validate `.uuid()`. */
export function newOperationId(): string {
  return randomUUID()
}

export function isRequestId(value: string): boolean {
  return /^req_[0-9a-f]{32}$/.test(value)
}
