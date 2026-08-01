import { Worker } from 'node:worker_threads'
import { ERROR_CODES, NexaError, type ErrorCode } from '@nexa/shared-types'
import { extract } from './extractors.js'
import type { ExtractionRequest, ExtractionResult, ExtractionRunner } from './types.js'

/**
 * Chạy trích xuất ngay trong tiến trình gọi.
 *
 * Dùng cho unit test và cho môi trường không dựng được worker. Trong Electron main, hãy dùng
 * `WorkerThreadRunner` — một PDF 200 trang giữ event loop vài giây là đủ để IPC đứng hình.
 */
export class InlineRunner implements ExtractionRunner {
  run(request: ExtractionRequest): Promise<ExtractionResult> {
    return extract(request)
  }
  dispose(): Promise<void> {
    return Promise.resolve()
  }
}

export interface WorkerThreadRunnerOptions {
  /**
   * Đường dẫn tới file worker đã build. App cấp giá trị này vì chỉ app mới biết layout
   * output của bundler (electron-vite đặt worker ở `out/main/extraction-worker.js`).
   */
  readonly workerPath: string
  /** Quá hạn thì kill worker — một file dựng ngược có thể khiến parser lặp vô hạn. */
  readonly timeoutMs?: number
  /** §12: giới hạn heap của worker để một file lớn không kéo sập cả app. */
  readonly maxOldGenerationSizeMb?: number
}

/**
 * Mỗi lần trích xuất là một worker mới.
 *
 * Không dùng pool có chủ ý: worker chết đi thì toàn bộ bộ nhớ mà parser cấp phát được trả về
 * hệ điều hành ngay, thay vì phình dần theo phiên làm việc. Chi phí spawn (~30ms) không đáng
 * kể so với thời gian đọc một file thật.
 */
export class WorkerThreadRunner implements ExtractionRunner {
  private readonly workerPath: string
  private readonly timeoutMs: number
  private readonly maxOldGenerationSizeMb: number
  private readonly active = new Set<Worker>()

  constructor(opts: WorkerThreadRunnerOptions) {
    this.workerPath = opts.workerPath
    this.timeoutMs = opts.timeoutMs ?? 120_000
    this.maxOldGenerationSizeMb = opts.maxOldGenerationSizeMb ?? 512
  }

  run(request: ExtractionRequest): Promise<ExtractionResult> {
    return new Promise<ExtractionResult>((resolve, reject) => {
      const worker = new Worker(this.workerPath, {
        workerData: request,
        resourceLimits: { maxOldGenerationSizeMb: this.maxOldGenerationSizeMb },
      })
      this.active.add(worker)

      let settled = false
      const finish = (fn: () => void): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.active.delete(worker)
        void worker.terminate()
        fn()
      }

      const timer = setTimeout(() => {
        finish(() =>
          reject(
            new NexaError(ERROR_CODES.DOCUMENT_EXTRACTION_FAILED, {
              safeDetail: 'extraction timed out',
            }),
          ),
        )
      }, this.timeoutMs)

      worker.on('message', (message: unknown) => {
        const m = message as { ok?: boolean; result?: ExtractionResult; code?: ErrorCode }
        if (m.ok === true && m.result !== undefined) {
          finish(() => resolve(m.result as ExtractionResult))
        } else {
          finish(() =>
            reject(new NexaError(m.code ?? ERROR_CODES.DOCUMENT_EXTRACTION_FAILED)),
          )
        }
      })

      worker.on('error', (error) => {
        finish(() =>
          reject(NexaError.wrap(error, ERROR_CODES.DOCUMENT_EXTRACTION_FAILED)),
        )
      })

      worker.on('exit', (code) => {
        // Thoát mà chưa gửi message: thường là chạm resourceLimits (OOM) và bị V8 giết.
        finish(() =>
          reject(
            new NexaError(ERROR_CODES.DOCUMENT_EXTRACTION_FAILED, {
              safeDetail: `worker exited with code ${String(code)} before replying`,
            }),
          ),
        )
      })
    })
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.active].map((w) => w.terminate()))
    this.active.clear()
  }
}
