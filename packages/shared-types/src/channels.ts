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

  'chatgpt:status',
  'chatgpt:models',
  'chatgpt:login',
  'chatgpt:logout',

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
  'message:edit',
  'message:delete',

  'memory:list',
  'memory:create',
  'memory:update',
  'memory:archive',
  'memory:restore',
  'memory:delete',

  'commitment:list',
  'commitment:create',
  'commitment:update',
  'commitment:delete',
  'checkin:list',
  'checkin:setEnabled',
  'checkin:respond',
  'checkin:unmute',
  'activity:list',

  'briefing:get',
  'briefing:refresh',

  'ba:knowledge:list',
  'ba:knowledge:create',
  'ba:knowledge:update',
  'ba:knowledge:confirm',
  'ba:knowledge:supersede',
  'ba:knowledge:delete',
  'ba:knowledge:link',
  'ba:knowledge:unlink',
  'ba:knowledge:stats',
  'ba:document:list',
  'ba:document:create',
  'ba:document:delete',
  'ba:document:read',
  'ba:document:extract',
  'ba:document:errorCodes',
  'ba:document:setTemplate',
  'ba:document:projections',
  'ba:document:mergeItems',
  'ba:document:review',
  'ba:document:reviewHistory',
  'ba:document:suggestWording',
  'ba:document:applyFinding',
  'ba:template:list',
  'ba:checklist:templates',
  'ba:checklist:list',
  'ba:checklist:create',
  'ba:checklist:delete',
  'ba:checklist:read',
  'ba:checklist:ingest',
  'ba:checklist:review',

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
  checkInsChanged: 'nexa:checkins-changed',
  /** Có bản cập nhật không bắt buộc. Trường hợp bắt buộc/thu hồi do main chặn thẳng. */
  updateAvailable: 'nexa:update-available',
} as const

export type NexaEventName = (typeof NEXA_EVENTS)[keyof typeof NEXA_EVENTS]

export const NEXA_EVENT_NAMES: readonly NexaEventName[] = Object.values(NEXA_EVENTS)
