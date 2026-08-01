/**
 * Tên channel IPC và tên sự kiện — KHÔNG import zod.
 *
 * Tách riêng khỏi `ipc.ts` vì preload phải nạp được danh sách này mà không kéo theo zod:
 * preload chạy trong context sandbox, và mỗi kilobyte ở đó đều nằm sát ranh giới bảo mật.
 * `ipc.ts` có một phép kiểm tra ở mức kiểu để hai danh sách không bao giờ lệch nhau.
 */
export const IPC_CHANNEL_NAMES = [
  'connection:list',
  'connection:save',
  'connection:test',
  'connection:delete',

  'model:list',
  'model:add',
  'model:remove',
  'model:setDefault',
  'model:verifyAll',

  'conversation:list',
  'conversation:create',
  'conversation:rename',
  'conversation:delete',
  'conversation:archive',
  'conversation:search',
  'message:list',

  'chat:send',
  'chat:cancel',

  'file:pick',
  'file:release',

  'tool:approve',
  'tool:cancel',
  'tool:lookupUncertain',
  'tool:listUncertain',
  'tool:list',

  'settings:get',
  'settings:update',
  'policy:get',

  'mcp:status',
  'mcp:restart',

  'diagnostics:export',
  'diagnostics:appInfo',
  'data:purge',
] as const

export type IpcChannelName = (typeof IPC_CHANNEL_NAMES)[number]

export const NEXA_EVENTS = {
  chatDelta: 'nexa:chat-delta',
  chatDone: 'nexa:chat-done',
  chatError: 'nexa:chat-error',
  toolConfirmation: 'nexa:tool-confirmation',
  toolStatus: 'nexa:tool-status',
  mcpStatus: 'nexa:mcp-status',
  connectionStatus: 'nexa:connection-status',
} as const

export type NexaEventName = (typeof NEXA_EVENTS)[keyof typeof NEXA_EVENTS]

export const NEXA_EVENT_NAMES: readonly NexaEventName[] = Object.values(NEXA_EVENTS)
