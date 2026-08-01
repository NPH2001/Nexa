import { globalRedactor, type Redactor } from './redaction.js'

/** Bốn loại log của §15.1. */
export const LOG_CATEGORIES = ['application', 'performance', 'security', 'tool'] as const
export type LogCategory = (typeof LOG_CATEGORIES)[number]

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const
export type LogLevel = (typeof LOG_LEVELS)[number]

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

export interface LogRecord {
  readonly ts: string
  readonly level: LogLevel
  readonly category: LogCategory
  /** Tên sự kiện dạng kebab, ổn định để grep. Ví dụ 'llm-request-completed'. */
  readonly event: string
  readonly requestId?: string
  readonly operationId?: string
  readonly fields?: Record<string, unknown>
}

export interface LogSink {
  write(record: LogRecord): void
  flush?(): void | Promise<void>
  close?(): void | Promise<void>
}

/** Giữ trong RAM — dùng cho unit test và cho chế độ chẩn đoán khi ổ đĩa không ghi được. */
export class MemorySink implements LogSink {
  readonly records: LogRecord[] = []
  constructor(private readonly max = 5_000) {}
  write(record: LogRecord): void {
    this.records.push(record)
    if (this.records.length > this.max) this.records.shift()
  }
  clear(): void {
    this.records.length = 0
  }
  /** Nối tất cả record thành text — tiện cho test khẳng định "không có secret trong log". */
  asText(): string {
    return this.records.map((r) => JSON.stringify(r)).join('\n')
  }
}

/** Ghi ra nhiều sink cùng lúc. */
export class MultiSink implements LogSink {
  constructor(private readonly sinks: readonly LogSink[]) {}
  write(record: LogRecord): void {
    for (const s of this.sinks) s.write(record)
  }
  async flush(): Promise<void> {
    await Promise.all(this.sinks.map((s) => s.flush?.()))
  }
  async close(): Promise<void> {
    await Promise.all(this.sinks.map((s) => s.close?.()))
  }
}

export interface LoggerOptions {
  readonly sink: LogSink
  readonly redactor?: Redactor
  readonly minLevel?: LogLevel
  /** Trường gắn vào mọi record của logger này (ví dụ `module`, `requestId`). */
  readonly bindings?: Record<string, unknown>
  /** Cho phép test bơm đồng hồ. */
  readonly now?: () => Date
}

/**
 * Logger có redaction bắt buộc.
 *
 * Không có đường nào ghi thẳng ra sink mà không qua `Redactor` — đó là lý do `redact` là
 * private và constructor không nhận sẵn record. §11.1 coi rò rỉ qua log là một threat riêng.
 */
export class Logger {
  private readonly sink: LogSink
  private readonly redactor: Redactor
  private readonly minLevel: number
  private readonly bindings: Record<string, unknown>
  private readonly now: () => Date

  constructor(opts: LoggerOptions) {
    this.sink = opts.sink
    this.redactor = opts.redactor ?? globalRedactor
    this.minLevel = LEVEL_ORDER[opts.minLevel ?? 'info']
    this.bindings = opts.bindings ?? {}
    this.now = opts.now ?? (() => new Date())
  }

  child(bindings: Record<string, unknown>): Logger {
    return new Logger({
      sink: this.sink,
      redactor: this.redactor,
      minLevel: (Object.keys(LEVEL_ORDER) as LogLevel[]).find(
        (l) => LEVEL_ORDER[l] === this.minLevel,
      ),
      bindings: { ...this.bindings, ...bindings },
      now: this.now,
    })
  }

  private emit(
    level: LogLevel,
    category: LogCategory,
    event: string,
    fields?: Record<string, unknown>,
  ): void {
    if (LEVEL_ORDER[level] < this.minLevel) return

    const merged = { ...this.bindings, ...(fields ?? {}) }
    const safe = this.redactor.redact(merged) as Record<string, unknown>

    // requestId/operationId là identifier do Nexa sinh, không nhạy cảm, và §15.2 cần chúng
    // ở top level để đối chiếu với log LiteLLM/Atlassian.
    const requestId = typeof merged['requestId'] === 'string' ? merged['requestId'] : undefined
    const operationId = typeof merged['operationId'] === 'string' ? merged['operationId'] : undefined
    delete safe['requestId']
    delete safe['operationId']

    this.sink.write({
      ts: this.now().toISOString(),
      level,
      category,
      event,
      ...(requestId !== undefined ? { requestId } : {}),
      ...(operationId !== undefined ? { operationId } : {}),
      ...(Object.keys(safe).length > 0 ? { fields: safe } : {}),
    })
  }

  // §15.1 — Application log: phiên bản, startup, trạng thái module, error code.
  debug(event: string, fields?: Record<string, unknown>): void {
    this.emit('debug', 'application', event, fields)
  }
  info(event: string, fields?: Record<string, unknown>): void {
    this.emit('info', 'application', event, fields)
  }
  warn(event: string, fields?: Record<string, unknown>): void {
    this.emit('warn', 'application', event, fields)
  }
  error(event: string, fields?: Record<string, unknown>): void {
    this.emit('error', 'application', event, fields)
  }

  /** §15.1 — Performance: startup time, request latency, memory snapshot tổng quát. */
  perf(event: string, fields: { durationMs?: number } & Record<string, unknown>): void {
    this.emit('info', 'performance', event, fields)
  }

  /**
   * §15.1 — Security event: credential save/delete, DB unlock failure, connection test failure,
   * signature/update failure. Luôn ghi ở mức warn trở lên để không bị lọc mất.
   */
  security(
    event: SecurityEvent,
    fields?: Record<string, unknown>,
    level: 'warn' | 'error' = 'warn',
  ): void {
    this.emit(level, 'security', event, fields)
  }

  /** §15.1 — Tool lifecycle: tool name, trạng thái, approval status, request_id. */
  tool(
    event: string,
    fields: {
      toolName: string
      phase: string
      approvalStatus?: string
      operationId?: string
      requestId?: string
    } & Record<string, unknown>,
  ): void {
    this.emit('info', 'tool', event, fields)
  }

  async flush(): Promise<void> {
    await this.sink.flush?.()
  }
}

/** Tên sự kiện bảo mật cố định — để ATTT grep được và để test khẳng định có ghi. */
export const SECURITY_EVENTS = {
  credentialSaved: 'credential-saved',
  credentialDeleted: 'credential-deleted',
  credentialReadFailed: 'credential-read-failed',
  masterKeyCreated: 'master-key-created',
  masterKeyUnavailable: 'master-key-unavailable',
  dbUnlockFailed: 'db-unlock-failed',
  connectionTestFailed: 'connection-test-failed',
  urlRejected: 'url-rejected',
  domainNotAllowed: 'domain-not-allowed',
  updateSignatureFailed: 'update-signature-failed',
  ipcValidationFailed: 'ipc-validation-failed',
  toolBlocked: 'tool-blocked',
  approvalMismatch: 'approval-payload-mismatch',
  approvalExpired: 'approval-expired',
  dataPurged: 'local-data-purged',
} as const

export type SecurityEvent = (typeof SECURITY_EVENTS)[keyof typeof SECURITY_EVENTS]
