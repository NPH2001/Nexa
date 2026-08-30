import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { DEFAULT_APP_SETTINGS } from '@nexa/shared-types'
import { globalRedactor, Logger, MemorySink } from '@nexa/observability'
import type { NexaServices } from './services.js'

const electronMock = vi.hoisted(() => ({
  downloads: '/tmp',
  openPath: vi.fn(),
}))

vi.mock('electron', () => ({
  app: {
    getPath: () => electronMock.downloads,
    getVersion: () => '0.1.0-test',
  },
  shell: { openPath: electronMock.openPath },
}))

const { exportDiagnostics } = await import('./diagnostics.js')

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nexa-diagnostics-test-'))
  electronMock.downloads = dir
  electronMock.openPath.mockReset()
  globalRedactor.clearSecrets()
})

afterEach(() => {
  globalRedactor.clearSecrets()
  rmSync(dir, { recursive: true, force: true })
})

function makeServices(
  overrides: {
    readonly fileSink?: { listFiles(): readonly string[] } | null
    readonly memorySink?: MemorySink
  } = {},
): NexaServices {
  const memorySink = overrides.memorySink ?? new MemorySink()
  return {
    logger: new Logger({ sink: memorySink, minLevel: 'debug' }),
    fileSink: overrides.fileSink ?? null,
    memorySink,
    profileId: 'profile-1',
    store: { schemaVersion: 7, driverName: 'node:sqlite' },
    security: {
      backendName: 'safe-storage',
      isProductionGrade: true,
    },
    mcp: { statusSnapshot: { state: 'ready' } },
    connections: {
      list: () => [
        {
          type: 'jira',
          baseUrl: 'https://alice:password@jira.corp.local/private/path?token=secret',
          username: 'alice@corp.local',
          enabled: true,
          hasCredential: true,
          lastTest: {
            ok: false,
            checkedAt: '2026-08-23T00:00:00.000Z',
            errorCode: 'ATLASSIAN_AUTH_FAILED',
          },
        },
      ],
    },
    models: {
      list: () => [
        {
          modelId: 'internal-model',
          displayName: 'Internal model',
          verified: true,
        },
      ],
    },
    settings: {
      get: () => ({
        ...DEFAULT_APP_SETTINGS,
        documentAllowedModels: ['sensitive-model-name'],
      }),
    },
    audit: {
      approvalStats: () => ({ approved: 2, cancelled: 1 }),
      recent: () => [{ requestId: 'request-safe', status: 'ok' }],
    },
  } as unknown as NexaServices
}

function readBundleFile(bundle: { files: readonly string[] }, fileName: string): string {
  const path = bundle.files.find((item) => basename(item) === fileName)
  if (path === undefined) throw new Error(`Missing diagnostics file: ${fileName}`)
  return readFileSync(path, 'utf8')
}

describe('exportDiagnostics', () => {
  it('chỉ xuất hostname và các trường cấu hình an toàn', () => {
    const bundle = exportDiagnostics(makeServices())
    const summaryText = readBundleFile(bundle, 'summary.json')
    const summary = JSON.parse(summaryText) as {
      connections: Array<{ host: string }>
      settings: Record<string, unknown>
    }

    expect(summary.connections[0]?.host).toBe('jira.corp.local')
    expect(summary.settings).toMatchObject({
      documentAllowlistConfigured: true,
      maxFilesPerRequest: DEFAULT_APP_SETTINGS.maxFilesPerRequest,
    })
    expect(summaryText).not.toContain('alice@corp.local')
    expect(summaryText).not.toContain('password')
    expect(summaryText).not.toContain('/private/path')
    expect(summaryText).not.toContain('sensitive-model-name')
    expect(electronMock.openPath).toHaveBeenCalledWith(bundle.directory)
  })

  it('redact log trong RAM khi không có file sink', () => {
    const memorySink = new MemorySink()
    const secret = 'PAT-super-secret-0123456789'
    globalRedactor.registerSecret(secret)
    memorySink.write({
      ts: '2026-08-23T00:00:00.000Z',
      level: 'warn',
      category: 'application',
      event: 'test-event',
      fields: { detail: `Credential was ${secret}` },
    })

    const bundle = exportDiagnostics(makeServices({ memorySink }))
    const memoryLog = readBundleFile(bundle, 'memory-log.jsonl')

    expect(memoryLog).toContain('[REDACTED]')
    expect(memoryLog).not.toContain(secret)
  })

  /**
   * Gói chẩn đoán là đường duy nhất log rời khỏi máy người dùng, nên nó là chỗ cuối cùng để
   * khẳng định bộ luật review không đánh rơi nội dung nghiệp vụ ra ngoài.
   *
   * Bản ghi dưới đây là ĐÚNG hình dạng `BaReviewService` ghi ra: id, phiên bản pack, số đếm. Test
   * đỏ nếu có ai thêm `findings` hay tên item vào một dòng log của review.
   */
  it('gói chẩn đoán chứa số đếm của review, không chứa nội dung finding', () => {
    const memorySink = new MemorySink()
    memorySink.write({
      ts: '2026-08-30T00:00:00.000Z',
      level: 'info',
      category: 'application',
      event: 'ba-review-completed',
      fields: {
        documentId: 'doc-1',
        reviewId: 'rev-1',
        rulePackId: 'nexa-ba',
        rulePackVersion: '1',
        rulesTotal: 15,
        rulesRun: 14,
        rulesPassed: 13,
        findingCount: 2,
        excludedNeedsReview: 1,
      },
    })

    const bundle = exportDiagnostics(makeServices({ memorySink }))
    const memoryLog = readBundleFile(bundle, 'memory-log.jsonl')

    expect(memoryLog).toContain('ba-review-completed')
    expect(memoryLog).toContain('"findingCount":2')
    expect(memoryLog).not.toContain('luồng ngoại lệ')
    expect(memoryLog).not.toContain('Khách hàng đặt đơn')
    expect(memoryLog).not.toContain('R-UC-')
  })

  it('sao chép log đọc được và bỏ qua file đang mất', () => {
    const source = join(dir, 'nexa.log')
    const missing = join(dir, 'missing.log')
    writeFileSync(source, '{"event":"safe"}\n', 'utf8')

    const bundle = exportDiagnostics(
      makeServices({ fileSink: { listFiles: () => [source, missing] } }),
    )

    expect(readBundleFile(bundle, 'nexa.log')).toContain('safe')
    expect(bundle.files.some((item) => basename(item) === 'memory-log.jsonl')).toBe(false)
    expect(bundle.files.some((item) => basename(item) === 'missing.log')).toBe(false)
  })
})
