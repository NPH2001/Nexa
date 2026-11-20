import { ERROR_CODES, NexaError, type McpStatusEvent } from '@nexa/shared-types'
import {
  buildMcpManager,
  buildRedmineServer,
  buildXwikiServer,
  type NexaServices,
} from './services.js'

/** Đúng ba source MCP Nexa đang có — cố ý không khái quát cho source thứ tư (YAGNI, S-3). */
export type McpSystem = 'atlassian' | 'redmine' | 'xwiki'

export const MCP_SYSTEMS: readonly McpSystem[] = ['atlassian', 'redmine', 'xwiki']

/**
 * Source nào phải dựng lại khi một kết nối đổi — credential và base URL đều nằm trong spec của
 * source. Redmine còn phụ thuộc `mcpGateway` (ADR 0010): đổi URL/token gateway thì Redmine cũng
 * phải dựng lại. Thứ tự trả về là thứ tự dựng lại.
 */
export function mcpSystemsAffectedBy(connectionType: string): readonly McpSystem[] {
  switch (connectionType) {
    case 'jira':
    case 'confluence':
      return ['atlassian']
    case 'mcpGateway':
      return ['atlassian', 'redmine']
    case 'redmine':
      return ['redmine']
    case 'xwiki':
      return ['xwiki']
    default:
      return []
  }
}

interface McpSource {
  readonly isLifecycleBusy: boolean
  start(): Promise<void>
  stop(): Promise<void>
}

export interface McpLifecycle {
  /** Ném `OPERATION_ALREADY_RUNNING` khi một rebuild hoặc vòng đời của source nào đó còn chạy. */
  assertIdle(): void
  rebuild(system: McpSystem): Promise<void>
}

/**
 * Vòng đời MCP sau khi khởi động: chỗ DUY NHẤT gán lại `services.mcp`, `services.redmine` và
 * `services.xwiki`. `bootstrapServices` chỉ gán lần đầu.
 */
export function createMcpLifecycle(
  services: NexaServices,
  onStatus: (event: McpStatusEvent) => void,
): McpLifecycle {
  let rebuildInFlight = false

  const swap = async <T extends McpSource>(
    previous: T | null,
    set: (source: T | null) => void,
    build: () => T | null,
  ): Promise<void> => {
    // Rút source cũ khỏi service trước `await` đầu tiên: chat mới không thể giữ tham chiếu tới
    // transport đang dừng, còn mutex chặn một save/delete/restart thứ hai chạy chen vào.
    set(null)
    await previous?.stop()
    const next = build()
    set(next)
    if (next === null) return
    try {
      await next.start()
    } catch {
      // Trạng thái lỗi đã được source phát ra; không chặn việc lưu cấu hình.
    }
  }

  const rebuildSource = (system: McpSystem): Promise<void> => {
    switch (system) {
      case 'atlassian':
        return swap(
          services.mcp,
          (source) => {
            services.mcp = source
          },
          () => buildMcpManager(services, onStatus),
        )
      case 'redmine':
        return swap(
          services.redmine,
          (source) => {
            services.redmine = source
          },
          () => buildRedmineServer(services, onStatus),
        )
      case 'xwiki':
        return swap(
          services.xwiki,
          (source) => {
            services.xwiki = source
          },
          () => buildXwikiServer(services, onStatus),
        )
    }
  }

  return {
    assertIdle() {
      if (
        rebuildInFlight ||
        services.mcp?.isLifecycleBusy === true ||
        services.redmine?.isLifecycleBusy === true ||
        services.xwiki?.isLifecycleBusy === true
      ) {
        throw new NexaError(ERROR_CODES.OPERATION_ALREADY_RUNNING, {
          safeDetail: 'cannot change MCP connection while its lifecycle is busy',
        })
      }
    },

    async rebuild(system) {
      rebuildInFlight = true
      try {
        await rebuildSource(system)
        // Bản tin lấy việc từ Redmine và cache theo ngày: không dọn thì người dùng vừa kết nối
        // xong vẫn thấy "chưa kết nối" tới hết ngày.
        if (system === 'redmine') services.briefing.invalidate()
      } finally {
        rebuildInFlight = false
      }
    },
  }
}
