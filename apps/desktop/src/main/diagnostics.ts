import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { app, shell } from 'electron'
import { globalRedactor } from '@nexa/observability'
import type { NexaServices } from './services.js'

/**
 * §16: "cung cấp export log không chứa nội dung".
 * §15.2: người hỗ trợ cần đối chiếu request_id/operation_id với LiteLLM và Atlassian.
 *
 * Gói xuất ra CHỈ gồm: log đã redact, tóm tắt cấu hình không có secret, và bảng đối chiếu
 * id. Không có hội thoại, không có nội dung file, không có credential.
 */
export interface DiagnosticsBundle {
  readonly directory: string
  readonly files: readonly string[]
}

export function exportDiagnostics(services: NexaServices): DiagnosticsBundle {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outDir = join(app.getPath('downloads'), `nexa-diagnostics-${stamp}`)
  mkdirSync(outDir, { recursive: true })

  const written: string[] = []

  // 1. Tóm tắt môi trường — cố ý liệt kê từng trường thay vì dump object, để không có
  //    trường mới nào tự động lọt vào file xuất ra.
  const summary = {
    exportedAt: new Date().toISOString(),
    appVersion: app.getVersion(),
    electron: process.versions['electron'] ?? 'unknown',
    node: process.versions.node,
    platform: `${process.platform} ${process.arch}`,
    schemaVersion: services.store.schemaVersion,
    sqliteDriver: services.store.driverName,
    secureStorageBackend: services.security.backendName,
    secureStorageProductionGrade: services.security.isProductionGrade,
    mcpState: services.mcp?.statusSnapshot.state ?? 'not-configured',
    connections: services.connections.list().map((c) => ({
      type: c.type,
      // Chỉ hostname, không đường dẫn đầy đủ và tuyệt đối không username.
      host: safeHost(c.baseUrl),
      enabled: c.enabled,
      hasCredential: c.hasCredential,
      lastTestOk: c.lastTest?.ok ?? null,
      lastTestErrorCode: c.lastTest?.errorCode ?? null,
    })),
    models: services.models.list().map((m) => ({ modelId: m.modelId, verified: m.verified })),
    settings: redactSettings(services),
    approvalStats: services.audit.approvalStats(services.profileId),
  }
  const summaryPath = join(outDir, 'summary.json')
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8')
  written.push(summaryPath)

  // 2. Bảng đối chiếu id (§15.2) — 200 sự kiện gần nhất, chỉ có id và trạng thái.
  const correlationPath = join(outDir, 'correlation.json')
  writeFileSync(
    correlationPath,
    JSON.stringify(services.audit.recent(services.profileId, 200), null, 2),
    'utf8',
  )
  written.push(correlationPath)

  // 3. Log file. Chúng đã được Redactor lọc lúc ghi; sao chép nguyên vẹn.
  for (const path of services.fileSink?.listFiles() ?? []) {
    const target = join(outDir, basename(path))
    try {
      copyFileSync(path, target)
      written.push(target)
    } catch {
      // File đang bị giữ — bỏ qua, các file còn lại vẫn có giá trị.
    }
  }

  // 4. Log trong RAM — cần khi ổ đĩa không ghi được (chế độ chẩn đoán, §16).
  if (services.fileSink === null) {
    const memoryPath = join(outDir, 'memory-log.jsonl')
    writeFileSync(
      memoryPath,
      services.memorySink.records.map((r) => JSON.stringify(globalRedactor.redact(r))).join('\n'),
      'utf8',
    )
    written.push(memoryPath)
  }

  services.logger.info('diagnostics-exported', { fileCount: written.length })
  void shell.openPath(outDir)

  return { directory: outDir, files: written }
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return '(không đọc được)'
  }
}

/** Cấu hình có thể chứa allowlist nội bộ; giữ lại thứ hữu ích cho gỡ lỗi, bỏ phần nhạy cảm. */
function redactSettings(services: NexaServices): Record<string, unknown> {
  const s = services.settings.get()
  return {
    maxFileSizeMb: s.maxFileSizeMb,
    maxFilesPerRequest: s.maxFilesPerRequest,
    historyRetentionDays: s.historyRetentionDays,
    logRetentionDays: s.logRetentionDays,
    approvalTtlSeconds: s.approvalTtlSeconds,
    llmTimeoutMs: s.llmTimeoutMs,
    toolTimeoutMs: s.toolTimeoutMs,
    maxToolIterations: s.maxToolIterations,
    documentAllowlistConfigured: s.documentAllowedModels.length > 0,
    features: s.features,
  }
}
