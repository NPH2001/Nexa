import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Xác minh secure storage trên Windows — phần còn lại của docs/OPEN-QUESTIONS.md C1.
 *
 * §8.2 dựa vào **DPAPI CurrentUser**. Máy phát triển chạy Linux nên không kiểm chứng được điều
 * đó; job `verify-windows` trong CI chạy file này trên `windows-latest`.
 *
 * Ba điều cần chứng minh, và chỉ Windows chứng minh được:
 *   1. `safeStorage` báo backend đạt chuẩn (không phải fallback `basic_text` như Linux thiếu keyring)
 *   2. Credential ghi rồi đọc lại được sau khi app khởi động lại
 *   3. Blob credential trên đĩa không chứa secret dạng rõ
 *
 * Điều KHÔNG kiểm chứng được ở đây: credential có mở được từ **tài khoản Windows khác** hay không.
 * CI chỉ có một tài khoản. Đó vẫn là việc phải làm bằng tay — xem checklist trước pilot.
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const DESKTOP = join(ROOT, 'apps/desktop')

// Trên nền tảng khác thì bỏ qua — không phải thất bại.
test.skip(process.platform !== 'win32', 'Chỉ chạy trên Windows (xác minh DPAPI)')

const API_KEY = 'sk-dpapi-kiem-chung-0123456789'

test('safeStorage dùng backend đạt chuẩn và credential sống qua lần khởi động lại', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'nexa-win-'))

  try {
    // ── Lần chạy 1: lưu credential ────────────────────────────────────────
    const first = await electron.launch({ args: [DESKTOP, `--user-data-dir=${userDataDir}`] })
    const firstPage = await first.firstWindow()
    await firstPage.waitForLoadState('domcontentloaded')

    const info = await firstPage.evaluate(async () => {
      const api = (window as unknown as { nexa: { invoke: (c: string, p?: unknown) => Promise<unknown> } })
        .nexa
      return api.invoke('diagnostics:appInfo')
    })
    const appInfo = (info as { data: { secureStorageBackend: string; secureStorageProductionGrade: boolean } })
      .data

    // (1) Đây là điều Linux không chứng minh được.
    expect(appInfo.secureStorageProductionGrade).toBe(true)
    expect(appInfo.secureStorageBackend).toContain('safeStorage')

    const saved = await firstPage.evaluate(async (apiKey) => {
      const api = (window as unknown as { nexa: { invoke: (c: string, p?: unknown) => Promise<unknown> } })
        .nexa
      return api.invoke('connection:save', {
        type: 'litellm',
        baseUrl: 'https://litellm.internal',
        username: null,
        secret: apiKey,
        enabled: true,
      })
    }, API_KEY)
    expect(JSON.stringify(saved)).toContain('hasCredential')
    // Secret không bao giờ quay ngược ra renderer.
    expect(JSON.stringify(saved)).not.toContain(API_KEY)

    await first.close()

    // ── Lần chạy 2: đọc lại bằng cùng tài khoản Windows ───────────────────
    const second = await electron.launch({ args: [DESKTOP, `--user-data-dir=${userDataDir}`] })
    const secondPage = await second.firstWindow()
    await secondPage.waitForLoadState('domcontentloaded')

    const connections = await secondPage.evaluate(async () => {
      const api = (window as unknown as { nexa: { invoke: (c: string, p?: unknown) => Promise<unknown> } })
        .nexa
      return api.invoke('connection:list')
    })
    const list = (connections as { data: { type: string; hasCredential: boolean }[] }).data
    const litellm = list.find((c) => c.type === 'litellm')

    // (2) DPAPI giải mã được bằng cùng tài khoản Windows.
    expect(litellm?.hasCredential).toBe(true)

    await second.close()

    // (3) Blob trên đĩa không chứa secret dạng rõ.
    const secureDir = join(userDataDir, 'secure')
    const blobs = readdirSync(secureDir)
    expect(blobs).toContain('credentials.bin')
    for (const name of blobs) {
      const raw = readFileSync(join(secureDir, name)).toString('latin1')
      expect(raw).not.toContain(API_KEY)
      expect(raw).not.toContain('sk-dpapi')
    }
  } finally {
    rmSync(userDataDir, { recursive: true, force: true })
  }
})

test('khởi động trong ngân sách thời gian của §12.1', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'nexa-win-perf-'))
  try {
    const started = Date.now()
    const app = await electron.launch({ args: [DESKTOP, `--user-data-dir=${userDataDir}`] })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    const elapsed = Date.now() - started

    process.stdout.write(`\n    ⏱  khởi động tới cửa sổ đầu tiên: ${String(elapsed)} ms\n`)

    // §12.1 đặt mục tiêu < 5 s trên cấu hình khuyến nghị. CI runner chậm hơn máy thật đáng kể,
    // nên ngưỡng ở đây rộng hơn — nó để bắt hồi quy bậc độ lớn, không phải để nghiệm thu.
    // Số đo nghiệm thu phải lấy trên máy Windows thật với bản đã đóng gói.
    expect(elapsed).toBeLessThan(20_000)

    await app.close()
  } finally {
    rmSync(userDataDir, { recursive: true, force: true })
  }
})
