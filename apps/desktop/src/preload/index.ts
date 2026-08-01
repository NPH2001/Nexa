import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC_CHANNEL_NAMES, NEXA_EVENT_NAMES } from '@nexa/shared-types'

/**
 * Preload bridge (§5.2, §5.3).
 *
 * Bốn ràng buộc, mỗi cái tương ứng với một dòng trong §5.3:
 *   - KHÔNG expose `ipcRenderer` — chỉ hai hàm `invoke`/`on` đã đóng khung.
 *   - `invoke` chỉ nhận channel nằm trong danh sách trắng; chuỗi lạ bị từ chối tại đây,
 *     trước khi chạm tới main.
 *   - `on` chỉ nhận tên sự kiện trong danh sách trắng, và KHÔNG chuyển tiếp `IpcRendererEvent`
 *     (object đó có `sender`, tức là một tay cầm để renderer gửi ngược tuỳ ý).
 *   - Không có hàm nào đọc file, đọc secret hay gọi mạng.
 *
 * Bản thân file này cố ý không import zod hay bất kỳ package nào của Nexa ngoài danh sách
 * tên channel — bề mặt càng nhỏ càng tốt.
 */

const allowedChannels = new Set<string>(IPC_CHANNEL_NAMES)
const allowedEvents = new Set<string>(NEXA_EVENT_NAMES)

const api = {
  /**
   * Gọi một channel. Luôn trả về envelope `{ request_id, data }` hoặc
   * `{ request_id, error }` (§9.2) — không bao giờ ném, để UI xử lý lỗi bằng một nhánh duy nhất.
   */
  invoke(channel: string, payload?: unknown): Promise<unknown> {
    if (!allowedChannels.has(channel)) {
      return Promise.resolve({
        request_id: 'req_local',
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Kênh IPC không hợp lệ.',
          retryable: false,
        },
      })
    }
    return ipcRenderer.invoke(channel, payload ?? {})
  },

  /** Đăng ký nhận sự kiện. Trả về hàm huỷ đăng ký. */
  on(eventName: string, listener: (payload: unknown) => void): () => void {
    if (!allowedEvents.has(eventName)) return () => undefined

    const wrapped = (_event: IpcRendererEvent, payload: unknown): void => {
      listener(payload)
    }
    ipcRenderer.on(eventName, wrapped)
    return () => {
      ipcRenderer.removeListener(eventName, wrapped)
    }
  },

  /** Danh sách channel/sự kiện — để UI kiểm tra trong dev, không dùng cho logic. */
  readonly: {
    channels: [...IPC_CHANNEL_NAMES],
    events: [...NEXA_EVENT_NAMES],
  },
} as const

contextBridge.exposeInMainWorld('nexa', api)

export type NexaBridge = typeof api
