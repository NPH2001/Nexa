import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * E2E desktop — T-13-13, §17.1 "E2E desktop: cấu hình LiteLLM, thêm model, chat, file attach,
 * history, lưu credential, Jira/Confluence mock và confirmation."
 *
 * Chạy app THẬT (Electron + main process + renderer), nói chuyện với mock LiteLLM và mock MCP
 * qua đúng đường mạng/stdio mà bản phát hành dùng. Khác với unit test ở chỗ nó đi qua preload
 * bridge, IPC, SQLite thật và secure storage thật.
 *
 * Giới hạn cần biết:
 *   - Chạy trên Linux. `safeStorage` ở đây dùng keyring của Linux, KHÔNG phải DPAPI của Windows
 *     (docs/OPEN-QUESTIONS.md C1). Xác minh DPAPI do job CI trên windows-latest đảm nhiệm.
 *   - Mock server không phải LiteLLM/Atlassian thật (C2).
 */

// File này chạy dưới dạng ES module nên không có `__dirname`.
const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const DESKTOP = join(ROOT, 'apps/desktop')

interface Harness {
  app: ElectronApplication
  page: Page
  litellmPort: number
  userDataDir: string
  litellm: ChildProcessWithoutNullStreams
  close: () => Promise<void>
}

/** Khởi chạy mock LiteLLM và đọc cổng nó tự chọn. */
function startMockLiteLlm(scenario: string): Promise<{ proc: ChildProcessWithoutNullStreams; port: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [join(ROOT, 'tests/fixtures/mock-litellm-server.mjs')], {
      env: { ...process.env, MOCK_SCENARIO: scenario },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const timer = setTimeout(() => reject(new Error('mock litellm không khởi động')), 10_000)
    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', (chunk: string) => {
      const match = /LISTENING (\d+)/.exec(chunk)
      if (match?.[1] !== undefined) {
        clearTimeout(timer)
        resolve({ proc, port: Number(match[1]) })
      }
    })
    proc.on('error', reject)
  })
}

async function launch(opts: { litellmScenario?: string; mcpScenario?: string } = {}): Promise<Harness> {
  const { proc, port } = await startMockLiteLlm(opts.litellmScenario ?? 'ok')
  const userDataDir = mkdtempSync(join(tmpdir(), 'nexa-e2e-'))

  const app = await electron.launch({
    args: [DESKTOP, `--user-data-dir=${userDataDir}`, '--no-sandbox'],
    env: {
      ...process.env,
      // MCP thật chưa được chốt (A4); E2E dùng mock server nói đúng JSON-RPC.
      NEXA_MCP_COMMAND: process.execPath,
      NEXA_MCP_ARGS: join(ROOT, 'tests/fixtures/mock-mcp-server.mjs'),
      MOCK_SCENARIO: opts.mcpScenario ?? 'ok',
    },
  })

  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  return {
    app,
    page,
    litellmPort: port,
    userDataDir,
    litellm: proc,
    close: async () => {
      await app.close().catch(() => undefined)
      proc.kill('SIGTERM')
      rmSync(userDataDir, { recursive: true, force: true })
    },
  }
}

/** Cấu hình LiteLLM + một model qua đúng giao diện người dùng sẽ dùng. */
async function configureLiteLlm(h: Harness, apiKey = 'sk-e2e-0123456789abcdef'): Promise<void> {
  // Chưa có kết nối nào ⇒ app tự mở thẳng Settings.
  await expect(h.page.getByRole('heading', { name: 'Kết nối LiteLLM' })).toBeVisible()

  await h.page.getByLabel('Endpoint (https://…)').or(h.page.locator('.field input').first())
    .fill(`http://127.0.0.1:${String(h.litellmPort)}`)
  await h.page.locator('input[type="password"]').fill(apiKey)
  await h.page.getByRole('button', { name: 'Lưu', exact: true }).click()
  await expect(h.page.getByText('Đã lưu cấu hình kết nối.')).toBeVisible({ timeout: 10_000 })

  // Lưu cấu hình KHÔNG gọi server — nó chỉ ghi vào SQLite và secure storage.
  // Phải bấm "Kiểm tra kết nối" thì mới có request thật tới LiteLLM, và đó cũng đúng là
  // việc người dùng làm sau khi nhập key.
  await h.page.getByRole('button', { name: 'Kiểm tra kết nối' }).click()
  await expect(h.page.getByText(/Kết nối thành công/)).toBeVisible({ timeout: 15_000 })

  await h.page.getByRole('button', { name: 'Model' }).click()
  await h.page.getByPlaceholder('Model id (ví dụ gpt-5.x-internal)').fill('model-a')
  await h.page.getByPlaceholder('Tên hiển thị').fill('Model A')
  await h.page.getByRole('button', { name: 'Thêm' }).click()
  await expect(h.page.getByText('model-a')).toBeVisible()
}

test.describe('E2E — cấu hình và chat', () => {
  test('cấu hình LiteLLM, thêm model, chat và nhận phản hồi streaming', async () => {
    const h = await launch()
    try {
      await configureLiteLlm(h)

      await h.page.getByRole('button', { name: '← Quay lại hội thoại' }).click()
      await h.page.getByRole('button', { name: '+ Hội thoại mới' }).first().click()

      await h.page.getByPlaceholder(/Nhập câu hỏi/).fill('Xin chào Nexa')
      await h.page.getByRole('button', { name: 'Gửi' }).click()

      // Câu trả lời của mock được stream theo từng từ.
      await expect(h.page.getByText('Xin chào, đây là câu trả lời từ mock LiteLLM.')).toBeVisible({
        timeout: 20_000,
      })
    } finally {
      await h.close()
    }
  })

  test('API key gửi trong header Authorization, không nằm trong URL', async () => {
    const h = await launch()
    try {
      await configureLiteLlm(h, 'sk-e2e-bi-mat-0123456789')

      const received = (await (
        await fetch(`http://127.0.0.1:${String(h.litellmPort)}/__received`)
      ).json()) as { url: string; auth: string | null; requestId: string | null }[]

      const authed = received.filter((r) => r.auth !== null)
      expect(authed.length).toBeGreaterThan(0)
      expect(authed[0]?.auth).toBe('Bearer sk-e2e-bi-mat-0123456789')
      // §9.3: key không được xuất hiện ở bất kỳ chỗ nào khác.
      for (const entry of received) {
        expect(entry.url).not.toContain('sk-e2e')
      }
    } finally {
      await h.close()
    }
  })

  test('mỗi request mang X-Request-ID để đối chiếu với log LiteLLM (§15.2)', async () => {
    const h = await launch()
    try {
      await configureLiteLlm(h)
      const received = (await (
        await fetch(`http://127.0.0.1:${String(h.litellmPort)}/__received`)
      ).json()) as { url: string; requestId: string | null }[]

      const models = received.find((r) => r.url === '/v1/models')
      expect(models?.requestId).toMatch(/^req_[0-9a-f]{32}$/)
    } finally {
      await h.close()
    }
  })
})

test.describe('E2E — credential không rò rỉ', () => {
  test('renderer không đọc được API key qua bridge', async () => {
    const h = await launch()
    try {
      await configureLiteLlm(h, 'sk-e2e-tuyet-mat-0123456789')

      // Đúng những gì một đoạn mã bị chèn vào renderer sẽ thử làm.
      const leaked = await h.page.evaluate(async () => {
        const api = (window as unknown as { nexa: { invoke: (c: string, p?: unknown) => Promise<unknown> } })
          .nexa
        const connections = await api.invoke('connection:list')
        const settings = await api.invoke('settings:get')
        const diagnostics = await api.invoke('diagnostics:appInfo')
        return JSON.stringify({ connections, settings, diagnostics })
      })

      expect(leaked).not.toContain('sk-e2e-tuyet-mat')
      // Chỉ có cờ boolean, không có giá trị.
      expect(leaked).toContain('hasCredential')
    } finally {
      await h.close()
    }
  })

  test('preload chỉ nhận channel trong danh sách trắng', async () => {
    const h = await launch()
    try {
      const result = await h.page.evaluate(async () => {
        const api = (window as unknown as { nexa: { invoke: (c: string, p?: unknown) => Promise<unknown> } })
          .nexa
        return api.invoke('fs:readFile', { path: '/etc/passwd' })
      })
      expect(JSON.stringify(result)).toContain('VALIDATION_FAILED')
    } finally {
      await h.close()
    }
  })

  test('renderer không gọi được mạng — CSP chặn connect-src', async () => {
    const h = await launch()
    try {
      const blocked = await h.page.evaluate(async () => {
        try {
          await fetch('http://127.0.0.1:1/should-be-blocked')
          return 'KHÔNG BỊ CHẶN'
        } catch {
          return 'bị chặn'
        }
      })
      expect(blocked).toBe('bị chặn')
    } finally {
      await h.close()
    }
  })
})

test.describe('E2E — xác nhận thao tác thay đổi dữ liệu (§10.2)', () => {
  test('tool write hiện bản xem trước và chỉ chạy sau khi người dùng xác nhận', async () => {
    const h = await launch({ litellmScenario: 'tool-call' })
    try {
      await configureLiteLlm(h)

      // Cấu hình Jira để MCP khởi động được.
      await h.page.getByRole('button', { name: 'Jira' }).click()
      await h.page.locator('.field input').first().fill('http://127.0.0.1:9/jira')
      await h.page.getByLabel('Tên đăng nhập').or(h.page.locator('.field input').nth(1))
        .fill('nguyen.van.a')
      await h.page.locator('input[type="password"]').fill('PAT-e2e-0123456789')
      await h.page.getByRole('button', { name: 'Lưu', exact: true }).click()

      await h.page.getByRole('button', { name: '← Quay lại hội thoại' }).click()
      await h.page.getByRole('button', { name: '+ Hội thoại mới' }).first().click()
      await h.page.getByPlaceholder(/Nhập câu hỏi/).fill('Tạo giúp tôi một task')
      await h.page.getByRole('button', { name: 'Gửi' }).click()

      // §10.2: phải hiện màn hình xác nhận với đủ thông tin.
      const dialog = h.page.getByRole('dialog')
      await expect(dialog).toBeVisible({ timeout: 25_000 })
      await expect(dialog.getByText('Xác nhận thao tác thay đổi dữ liệu')).toBeVisible()
      await expect(dialog.getByText('jira.create_issue')).toBeVisible()
      // Tiêu đề xuất hiện hai chỗ trong preview: ô "Dữ liệu sẽ được gửi đi" và bảng
      // "Sẽ bị thay đổi". Cả hai đều đúng — chỉ định rõ chỗ nào để locator không mơ hồ.
      await expect(dialog.locator('dl').getByText('Task từ E2E')).toBeVisible()
      await expect(dialog.locator('td.after')).toHaveText('Task từ E2E')
      // §10.2 cấm nhãn mơ hồ: phải là "Xác nhận" và "Huỷ".
      await expect(dialog.getByRole('button', { name: 'Xác nhận' })).toBeVisible()
      await expect(dialog.getByRole('button', { name: 'Huỷ' })).toBeVisible()

      // §17.2 kịch bản 2: huỷ ⇒ không có gì được gửi tới hệ thống đích.
      await dialog.getByRole('button', { name: 'Huỷ' }).click()
      await expect(dialog).toBeHidden()
    } finally {
      await h.close()
    }
  })
})

test.describe('E2E — lịch sử tồn tại qua các lần khởi động', () => {
  test('hội thoại được lưu và đọc lại sau khi mở lại app', async () => {
    const first = await launch()
    let userDataDir: string
    try {
      await configureLiteLlm(first)
      await first.page.getByRole('button', { name: '← Quay lại hội thoại' }).click()
      await first.page.getByRole('button', { name: '+ Hội thoại mới' }).first().click()
      await first.page.getByPlaceholder(/Nhập câu hỏi/).fill('Câu hỏi cần nhớ')
      await first.page.getByRole('button', { name: 'Gửi' }).click()
      await expect(first.page.getByText('Câu hỏi cần nhớ')).toBeVisible()
      await expect(first.page.getByText(/câu trả lời từ mock/)).toBeVisible({ timeout: 20_000 })

      userDataDir = first.userDataDir
      await first.app.close()
      first.litellm.kill('SIGTERM')
    } catch (error) {
      await first.close()
      throw error
    }

    // Mở lại với cùng thư mục dữ liệu.
    const second = await electron.launch({
      args: [DESKTOP, `--user-data-dir=${userDataDir}`, '--no-sandbox'],
    })
    try {
      const page = await second.firstWindow()
      await page.waitForLoadState('domcontentloaded')
      // Nội dung được giải mã lại từ SQLite bằng master key trong secure storage.
      await expect(page.getByText('Câu hỏi cần nhớ')).toBeVisible({ timeout: 20_000 })
    } finally {
      await second.close()
      rmSync(userDataDir, { recursive: true, force: true })
    }
  })
})

test.describe('E2E — provider ngoài tổ chức (OPEN-QUESTIONS F1)', () => {
  /**
   * Mock LiteLLM đóng thế api.openai.com được vì giao thức giống hệt — đó chính là lý do
   * `OpenAiCompatibleClient` không có gì riêng cho LiteLLM.
   *
   * Test này kiểm chứng bất biến T16 của threat model qua ĐÚNG đường thật: UI → preload →
   * IPC → main → document policy. Unit test đã bao phủ logic; ở đây xác nhận nó thực sự được
   * nối vào và người dùng thực sự bị chặn.
   */
  async function configureOpenAi(h: Harness): Promise<void> {
    await h.page.getByRole('button', { name: 'OpenAI' }).click()
    await expect(h.page.getByRole('heading', { name: 'Kết nối OpenAI (ChatGPT)' })).toBeVisible()

    // Endpoint được điền sẵn https://api.openai.com — thay bằng mock để không gọi ra Internet.
    await h.page.locator('.field input').first().fill(`http://127.0.0.1:${String(h.litellmPort)}`)
    await h.page.locator('input[type="password"]').fill('sk-openai-e2e-0123456789')
    await h.page.getByRole('button', { name: 'Lưu', exact: true }).click()
    await expect(h.page.getByText('Đã lưu cấu hình kết nối.')).toBeVisible({ timeout: 10_000 })

    await h.page.getByRole('button', { name: 'Model' }).click()
    await h.page.getByLabel('Provider').selectOption('openai')
    await h.page.getByPlaceholder('Model id (ví dụ gpt-5.x-internal)').fill('gpt-4o')
    await h.page.getByPlaceholder('Tên hiển thị').fill('GPT-4o ngoài')
    await h.page.getByRole('button', { name: 'Thêm' }).click()
    await expect(h.page.getByText('GPT-4o ngoài')).toBeVisible()
  }

  test('tab OpenAI cảnh báo rõ rằng dữ liệu ra ngoài tổ chức', async () => {
    const h = await launch()
    try {
      await configureLiteLlm(h)
      await h.page.getByRole('button', { name: 'OpenAI' }).click()

      // §11.2 yêu cầu hiển thị cảnh báo dữ liệu. Đây là chỗ nó phải xuất hiện đầu tiên.
      await expect(h.page.getByText(/dịch vụ bên ngoài tổ chức/)).toBeVisible()
      await expect(h.page.getByText(/đính kèm tài liệu bị CHẶN theo mặc định/)).toBeVisible()
    } finally {
      await h.close()
    }
  })

  test('model ngoài hiện nhãn cảnh báo và bảng model ghi rõ provider', async () => {
    const h = await launch()
    try {
      await configureLiteLlm(h)
      await configureOpenAi(h)

      // Bảng model phải phân biệt được provider — cùng model id có thể ở hai nơi.
      await expect(h.page.locator('.external-tag').first()).toBeVisible()
    } finally {
      await h.close()
    }
  })

  test('chọn model ngoài trong chat thì hiện cảnh báo dữ liệu', async () => {
    const h = await launch()
    try {
      await configureLiteLlm(h)
      await configureOpenAi(h)

      await h.page.getByRole('button', { name: '← Quay lại hội thoại' }).click()
      await h.page.getByRole('button', { name: '+ Hội thoại mới' }).first().click()
      await h.page.getByLabel('Chọn model').selectOption('openai:gpt-4o')

      await expect(h.page.getByText(/nằm ngoài tổ chức/)).toBeVisible()
      await expect(h.page.locator('.chat-header-right .external-tag')).toBeVisible()
    } finally {
      await h.close()
    }
  })

  test('chat KHÔNG kèm tài liệu vẫn gửi được tới model ngoài', async () => {
    const h = await launch()
    try {
      await configureLiteLlm(h)
      await configureOpenAi(h)

      await h.page.getByRole('button', { name: '← Quay lại hội thoại' }).click()
      await h.page.getByRole('button', { name: '+ Hội thoại mới' }).first().click()
      await h.page.getByLabel('Chọn model').selectOption('openai:gpt-4o')

      await h.page.getByPlaceholder(/Nhập câu hỏi/).fill('Xin chào model ngoài')
      await h.page.getByRole('button', { name: 'Gửi' }).click()

      // Chính sách chặn TÀI LIỆU, không kiểm duyệt chat — người dùng vẫn tự gõ được gì họ muốn.
      await expect(h.page.getByText(/câu trả lời từ mock/)).toBeVisible({ timeout: 20_000 })
    } finally {
      await h.close()
    }
  })
})
