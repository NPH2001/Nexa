import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { ERROR_CODES, NexaError } from '@nexa/shared-types'
import type { Logger } from '@nexa/observability'
import {
  LineFramer,
  MCP_PROTOCOL_VERSION,
  encodeMessage,
  parseToolResult,
  parseToolsList,
  type JsonRpcResponse,
  type McpToolDescriptor,
  type McpToolResult,
} from './protocol.js'

export interface StdioClientOptions {
  readonly command: string
  readonly args: readonly string[]
  /**
   * Biến môi trường cho process con. Credential đi qua ĐÂY, không qua argv.
   *
   * Lý do: argv hiện trong `ps`/Task Manager cho mọi tiến trình khác trên máy; environment
   * của một process thì chỉ chủ sở hữu đọc được. §11.1 cấm secret nằm ở nơi đọc được.
   */
  readonly env: Readonly<Record<string, string>>
  readonly cwd?: string
  readonly logger: Logger
  readonly startupTimeoutMs?: number
  readonly requestTimeoutMs?: number
}

interface Pending {
  resolve(value: unknown): void
  reject(error: unknown): void
  timer: NodeJS.Timeout
  method: string
}

/**
 * MCP Client (§5.2) trên transport stdio.
 *
 * §4.2 cho phép "MCP stdio hoặc localhost chỉ bind loopback". Nexa cố ý CHỈ làm stdio —
 * xem docs/OPEN-QUESTIONS.md D1 để biết vì sao localhost HTTP là bề mặt tấn công không cần thiết.
 */
export class McpStdioClient {
  private child: ChildProcessWithoutNullStreams | null = null
  private readonly framer = new LineFramer()
  private readonly pending = new Map<number, Pending>()
  private nextId = 1
  private ready = false
  private closedReason: string | null = null
  private serverName = 'unknown'
  private readonly opts: StdioClientOptions
  private readonly log: Logger

  constructor(opts: StdioClientOptions) {
    this.opts = opts
    this.log = opts.logger.child({ module: 'mcp-client' })
  }

  get isReady(): boolean {
    return this.ready
  }

  get name(): string {
    return this.serverName
  }

  /** Khởi chạy process con và hoàn tất bắt tay `initialize` (§9.1). */
  async start(): Promise<void> {
    if (this.child !== null) return

    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn(this.opts.command, [...this.opts.args], {
        // Không kế thừa toàn bộ environment của Nexa: process con chỉ cần đúng những gì
        // được liệt kê, cộng PATH để tìm được binary.
        env: { PATH: process.env['PATH'] ?? '', ...this.opts.env },
        ...(this.opts.cwd !== undefined ? { cwd: this.opts.cwd } : {}),
        stdio: ['pipe', 'pipe', 'pipe'],
        // Không dùng shell: tránh mọi khả năng chèn lệnh qua command/args cấu hình được.
        shell: false,
        windowsHide: true,
      })
    } catch (cause) {
      throw new NexaError(ERROR_CODES.MCP_SERVER_UNAVAILABLE, {
        cause,
        safeDetail: `cannot spawn "${this.opts.command}"`,
      })
    }

    this.child = child
    this.closedReason = null

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      for (const message of this.framer.push(chunk)) this.handleMessage(message)
    })

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      // stderr của MCP server có thể chứa URL Jira và cả PAT nếu server log ẩu.
      // Chỉ ghi độ dài — Redactor cũng sẽ lọc, nhưng không log nội dung thì chắc chắn hơn.
      this.log.debug('mcp-server-stderr', { bytes: chunk.length })
    })

    child.on('error', (error) => this.fail(`spawn error: ${error.name}`))
    child.on('exit', (code, signal) =>
      this.fail(`process exited (code=${String(code)}, signal=${String(signal)})`),
    )

    try {
      const result = await this.request(
        'initialize',
        {
          protocolVersion: MCP_PROTOCOL_VERSION,
          // Cố ý KHÔNG khai báo `sampling` hay `roots`: đó là các năng lực cho phép server
          // yêu cầu ngược client gọi LLM hoặc đọc file. Nexa không cấp quyền đó.
          capabilities: {},
          clientInfo: { name: 'Nexa', version: '0.1.0' },
        },
        this.opts.startupTimeoutMs ?? 30_000,
      )
      this.serverName = readServerName(result)
      this.notify('notifications/initialized')
      this.ready = true
      this.log.info('mcp-initialized', { server: this.serverName })
    } catch (error) {
      await this.stop()
      throw NexaError.wrap(error, ERROR_CODES.MCP_SERVER_UNAVAILABLE)
    }
  }

  async listTools(): Promise<McpToolDescriptor[]> {
    this.assertReady()
    return parseToolsList(await this.request('tools/list', {}))
  }

  /**
   * §9.1 `tools/call` — "Gọi tool sau khi validate schema và hoàn tất xác nhận nếu có side effect."
   *
   * Client này KHÔNG tự kiểm tra approval; đó là việc của ConfirmationGuard. Ở đây chỉ có
   * transport, để trách nhiệm không bị chia đôi giữa hai lớp.
   */
  async callTool(
    name: string,
    args: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<McpToolResult> {
    this.assertReady()
    const result = await this.request(
      'tools/call',
      { name, arguments: args },
      timeoutMs ?? this.opts.requestTimeoutMs ?? 60_000,
    )
    return parseToolResult(result)
  }

  async stop(): Promise<void> {
    const child = this.child
    this.ready = false
    this.child = null
    if (child === null) return

    this.rejectAllPending('client is shutting down')

    child.stdin.end()
    child.kill('SIGTERM')

    // Cho 3 giây để thoát tử tế rồi mới cưỡng chế — tránh để lại process mồ côi giữ PAT
    // trong bộ nhớ của nó.
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        resolve()
      }, 3_000)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })
  }

  // ── Nội bộ ──────────────────────────────────────────────────────────────

  private assertReady(): void {
    if (!this.ready) {
      throw new NexaError(ERROR_CODES.MCP_SERVER_UNAVAILABLE, {
        safeDetail: this.closedReason ?? 'client not initialised',
      })
    }
  }

  private request(method: string, params: unknown, timeoutMs = 60_000): Promise<unknown> {
    const child = this.child
    if (child === null) {
      return Promise.reject(
        new NexaError(ERROR_CODES.MCP_SERVER_UNAVAILABLE, { safeDetail: 'no server process' }),
      )
    }

    const id = this.nextId++
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(
          new NexaError(ERROR_CODES.MCP_SERVER_UNAVAILABLE, {
            safeDetail: `"${method}" timed out after ${String(timeoutMs)}ms`,
          }),
        )
      }, timeoutMs)

      this.pending.set(id, { resolve, reject, timer, method })

      try {
        child.stdin.write(encodeMessage({ jsonrpc: '2.0', id, method, params }))
      } catch (cause) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(NexaError.wrap(cause, ERROR_CODES.MCP_SERVER_UNAVAILABLE))
      }
    })
  }

  private notify(method: string, params?: unknown): void {
    try {
      this.child?.stdin.write(encodeMessage({ jsonrpc: '2.0', method, params }))
    } catch {
      // Notification không có phản hồi; mất một cái không đáng để làm hỏng luồng chính.
    }
  }

  private handleMessage(message: unknown): void {
    if (typeof message !== 'object' || message === null) return
    const m = message as Partial<JsonRpcResponse> & { method?: string }

    // Server gửi request/notification ngược lại. Nexa không khai báo capability nào nên
    // không có gì hợp lệ để phục vụ — bỏ qua và ghi nhận.
    if (typeof m.method === 'string') {
      this.log.debug('mcp-inbound-ignored', { method: m.method })
      return
    }
    if (typeof m.id !== 'number') return

    const pending = this.pending.get(m.id)
    if (pending === undefined) return
    this.pending.delete(m.id)
    clearTimeout(pending.timer)

    if (m.error !== undefined) {
      // Message của server có thể echo lại argument (tức là nội dung nghiệp vụ) — chỉ giữ code.
      pending.reject(
        new NexaError(ERROR_CODES.MCP_SERVER_UNAVAILABLE, {
          safeDetail: `${pending.method} failed with rpc code ${String(m.error.code)}`,
        }),
      )
      return
    }
    pending.resolve(m.result)
  }

  private fail(reason: string): void {
    if (!this.ready && this.closedReason !== null) return
    this.closedReason = reason
    this.ready = false
    this.child = null
    this.log.warn('mcp-server-down', { reason })
    this.rejectAllPending(reason)
  }

  private rejectAllPending(reason: string): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(
        new NexaError(ERROR_CODES.MCP_SERVER_UNAVAILABLE, { safeDetail: reason }),
      )
      this.pending.delete(id)
    }
  }
}

function readServerName(initializeResult: unknown): string {
  if (typeof initializeResult !== 'object' || initializeResult === null) return 'unknown'
  const info = (initializeResult as Record<string, unknown>)['serverInfo']
  if (typeof info !== 'object' || info === null) return 'unknown'
  return String((info as Record<string, unknown>)['name'] ?? 'unknown')
}
