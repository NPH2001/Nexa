import {
  ERROR_CODES,
  NexaError,
  type ErrorCode,
  type McpTargetSystem,
  type McpToolCallOutcome,
  type McpToolSource,
  type ToolDefinition,
} from '@nexa/shared-types'

/**
 * Một source trong router, kèm tên hệ thống để báo lỗi cho đúng chỗ.
 *
 * `unavailableCode`: mã lỗi lần khởi chạy gần nhất của source (ví dụ `REDMINE_AUTH_FAILED`).
 * Router trả đúng mã đó khi model gọi tool của một source chưa sẵn sàng, thay vì một mã chung
 * khiến người dùng không biết phải sửa kết nối nào.
 */
export interface RoutedMcpSource {
  readonly label: string
  readonly source: McpToolSource
  readonly unavailableCode?: () => ErrorCode | undefined
}

/**
 * Định tuyến lời gọi tool tới đúng MCP server sở hữu nó (ADR 0010).
 *
 * Bản thân router cũng là một `McpToolSource`, nên `AgentRuntime` dùng nó y như dùng một
 * `AtlassianMcpManager` đơn lẻ trước đây — cổng `resolveCallable` vẫn là cổng duy nhất, chỉ là
 * giờ nó hỏi đúng source.
 *
 * Danh sách source đọc qua callback, không chụp lúc dựng: host dựng lại từng source khi người dùng
 * đổi kết nối, và một router giữ tham chiếu cũ sẽ gọi vào transport đã dừng.
 *
 * Cô lập lỗi: một source chưa sẵn sàng chỉ làm TOOL CỦA NÓ không gọi được. `isReady` của router
 * đúng khi ít nhất một source sẵn sàng.
 */
export class McpToolRouter implements McpToolSource {
  private readonly sources: () => readonly (RoutedMcpSource | null)[]

  constructor(sources: () => readonly (RoutedMcpSource | null)[]) {
    this.sources = sources
  }

  private live(): RoutedMcpSource[] {
    return this.sources().filter((s): s is RoutedMcpSource => s !== null)
  }

  get isReady(): boolean {
    return this.live().some((s) => s.source.isReady)
  }

  availableTools(): ToolDefinition[] {
    return this.live()
      .filter((s) => s.source.isReady)
      .flatMap((s) => s.source.availableTools())
  }

  /**
   * Source sở hữu tool, tra theo REGISTRY (không phụ thuộc trạng thái sẵn sàng).
   *
   * Hai source cùng nhận một tên là lỗi lập trình: tên Nexa luôn có tiền tố hệ thống. Ném thay vì
   * chọn đại một source — gọi nhầm hệ thống với một payload ghi là thứ không được phép xảy ra.
   */
  private owner(name: string): RoutedMcpSource | null {
    const owners = this.live().filter((s) => s.source.findTool(name) !== null)
    if (owners.length > 1) {
      throw new NexaError(ERROR_CODES.TOOL_NOT_ALLOWED, {
        safeDetail: `"${name}" is claimed by ${owners.map((o) => o.label).join(', ')}`,
      })
    }
    return owners[0] ?? null
  }

  private requireOwner(name: string): RoutedMcpSource {
    const owner = this.owner(name)
    if (owner === null) {
      throw new NexaError(ERROR_CODES.TOOL_NOT_ALLOWED, {
        safeDetail: `"${name}" is not in the Nexa tool registry`,
      })
    }
    return owner
  }

  findTool(name: string): ToolDefinition | null {
    return this.owner(name)?.source.findTool(name) ?? null
  }

  resolveCallable(name: string): ToolDefinition {
    const owner = this.requireOwner(name)
    if (!owner.source.isReady) {
      throw new NexaError(owner.unavailableCode?.() ?? ERROR_CODES.MCP_SERVER_UNAVAILABLE, {
        safeDetail: `${owner.label} is not connected`,
      })
    }
    return owner.source.resolveCallable(name)
  }

  validateInput(definition: ToolDefinition, rawArgs: unknown): Record<string, unknown> {
    return this.requireOwner(definition.name).source.validateInput(definition, rawArgs)
  }

  callTool(name: string, args: Record<string, unknown>): Promise<McpToolCallOutcome> {
    return this.requireOwner(name).source.callTool(name, args)
  }

  canCallReadTool(name: string): boolean {
    try {
      return this.owner(name)?.source.canCallReadTool(name) ?? false
    } catch {
      return false
    }
  }

  targetSystemUrl(system: McpTargetSystem): string {
    for (const s of this.live()) {
      const url = s.source.targetSystemUrl(system)
      if (url !== '') return url
    }
    return ''
  }

  actingAccount(system: McpTargetSystem): string | undefined {
    for (const s of this.live()) {
      const account = s.source.actingAccount?.(system)
      if (account !== undefined) return account
    }
    return undefined
  }
}

/**
 * Khẳng định các registry không dùng chung tên tool nào.
 *
 * Gọi ở composition root lúc dựng source, để trùng tên lộ ra ngay khi khởi động chứ không phải
 * lần đầu model gọi tới tool đó.
 */
export function assertDisjointToolNames(
  registries: Readonly<Record<string, readonly ToolDefinition[]>>,
): void {
  const seen = new Map<string, string>()
  for (const [label, registry] of Object.entries(registries)) {
    for (const definition of registry) {
      const previous = seen.get(definition.name)
      if (previous !== undefined) {
        throw new NexaError(ERROR_CODES.TOOL_NOT_ALLOWED, {
          safeDetail: `tool "${definition.name}" is defined by both ${previous} and ${label}`,
        })
      }
      seen.set(definition.name, label)
    }
  }
}
