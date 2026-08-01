import { parentPort, workerData } from 'node:worker_threads'
import { ERROR_CODES, NexaError } from '@nexa/shared-types'
import { extract } from './extractors.js'
import type { ExtractionRequest } from './types.js'

/**
 * Điểm vào của worker trích xuất (§14.1 "worker/process riêng để tránh khóa UI").
 *
 * Worker chỉ nhận đường dẫn + loại + giới hạn, và trả về text. Nó không có tham chiếu tới
 * secure storage, DB hay mạng — nếu một PDF độc hại làm sập nó thì chỉ mất đúng worker đó.
 */
const request = workerData as ExtractionRequest

async function main(): Promise<void> {
  if (parentPort === null) return
  try {
    parentPort.postMessage({ ok: true, result: await extract(request) })
  } catch (error) {
    const nexa = NexaError.wrap(error, ERROR_CODES.DOCUMENT_EXTRACTION_FAILED)
    // Chỉ gửi mã lỗi về: message của thư viện parser có thể chứa mảnh nội dung file (§11.1).
    parentPort.postMessage({ ok: false, code: nexa.code })
  }
}

void main()
