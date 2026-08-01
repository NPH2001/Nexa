/**
 * Phần JSON-RPC 2.0 của MCP mà Nexa dùng: `initialize`, `tools/list`, `tools/call` (§9.1).
 *
 * Tự viết thay vì kéo MCP SDK, vì ba lý do:
 *  - Bề mặt cần dùng đúng ba method; SDK mang theo nhiều thứ ta cố tình không muốn có
 *    (sampling, roots — đều là đường cho server tác động ngược lên client).
 *  - Ta cần kiểm soát chính xác cách credential được truyền vào process con (§4.2).
 *  - Transport chỉ có stdio: newline-delimited JSON, đủ đơn giản để đọc hết trong một file.
 */

export const MCP_PROTOCOL_VERSION = '2024-11-05'

export interface JsonRpcRequest {
  readonly jsonrpc: '2.0'
  readonly id: number
  readonly method: string
  readonly params?: unknown
}

export interface JsonRpcNotification {
  readonly jsonrpc: '2.0'
  readonly method: string
  readonly params?: unknown
}

export interface JsonRpcResponse {
  readonly jsonrpc: '2.0'
  readonly id: number
  readonly result?: unknown
  readonly error?: { readonly code: number; readonly message: string; readonly data?: unknown }
}

/** Mô tả tool do server công bố qua `tools/list`. */
export interface McpToolDescriptor {
  readonly name: string
  readonly description?: string
  readonly inputSchema?: Record<string, unknown>
}

/** Nội dung trả về từ `tools/call`. */
export interface McpToolResult {
  readonly content: readonly McpContentBlock[]
  /** Server báo lỗi nghiệp vụ (khác với lỗi JSON-RPC). */
  readonly isError: boolean
}

export type McpContentBlock =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly mimeType: string }
  | { readonly type: 'resource'; readonly uri: string }
  | { readonly type: 'unknown' }

export function parseToolsList(result: unknown): McpToolDescriptor[] {
  if (typeof result !== 'object' || result === null) return []
  const tools = (result as Record<string, unknown>)['tools']
  if (!Array.isArray(tools)) return []

  return tools.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return []
    const t = entry as Record<string, unknown>
    const name = typeof t['name'] === 'string' ? t['name'] : ''
    if (name === '') return []
    return [
      {
        name,
        ...(typeof t['description'] === 'string' ? { description: t['description'] } : {}),
        ...(typeof t['inputSchema'] === 'object' && t['inputSchema'] !== null
          ? { inputSchema: t['inputSchema'] as Record<string, unknown> }
          : {}),
      },
    ]
  })
}

export function parseToolResult(result: unknown): McpToolResult {
  if (typeof result !== 'object' || result === null) {
    return { content: [], isError: true }
  }
  const r = result as Record<string, unknown>
  const rawContent = Array.isArray(r['content']) ? r['content'] : []

  const content: McpContentBlock[] = rawContent.map((entry) => {
    if (typeof entry !== 'object' || entry === null) return { type: 'unknown' }
    const e = entry as Record<string, unknown>
    switch (e['type']) {
      case 'text':
        return { type: 'text', text: typeof e['text'] === 'string' ? e['text'] : '' }
      case 'image':
        return { type: 'image', mimeType: String(e['mimeType'] ?? 'application/octet-stream') }
      case 'resource':
        return { type: 'resource', uri: String(e['uri'] ?? '') }
      default:
        return { type: 'unknown' }
    }
  })

  return { content, isError: r['isError'] === true }
}

/** Gộp các khối text thành một chuỗi — dạng duy nhất mà LLM tiêu thụ được. */
export function contentToText(result: McpToolResult): string {
  return result.content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
    .trim()
}

/**
 * Bộ tách frame cho stdio: mỗi message là một dòng JSON.
 *
 * Server có thể in log lẫn vào stdout (nhiều package làm thế), nên dòng nào không parse được
 * thì bỏ qua thay vì làm hỏng cả phiên.
 */
export class LineFramer {
  private buffer = ''

  push(chunk: string): unknown[] {
    this.buffer += chunk
    const messages: unknown[] = []

    let newline: number
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline).trim()
      this.buffer = this.buffer.slice(newline + 1)
      if (line === '') continue
      try {
        messages.push(JSON.parse(line))
      } catch {
        // Không phải JSON-RPC — gần như chắc chắn là log của server.
      }
    }

    // Chặn buffer phình vô hạn nếu server phun ra một dòng khổng lồ không xuống dòng.
    if (this.buffer.length > 8 * 1024 * 1024) this.buffer = ''
    return messages
  }
}

export function encodeMessage(message: JsonRpcRequest | JsonRpcNotification): string {
  return `${JSON.stringify(message)}\n`
}
