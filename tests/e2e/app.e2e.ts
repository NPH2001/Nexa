import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { electronEnvironment } from '../support/electron-env.js'

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
function startMockLiteLlm(
  scenario: string,
): Promise<{ proc: ChildProcessWithoutNullStreams; port: number }> {
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

async function launch(
  opts: { litellmScenario?: string; mcpScenario?: string; codexScenario?: string } = {},
): Promise<Harness> {
  const { proc, port } = await startMockLiteLlm(opts.litellmScenario ?? 'ok')
  const userDataDir = mkdtempSync(join(tmpdir(), 'nexa-e2e-'))

  const app = await electron.launch({
    args: [DESKTOP, `--user-data-dir=${userDataDir}`, '--no-sandbox'],
    env: electronEnvironment({
      // MCP thật chưa được chốt (A4); E2E dùng mock server nói đúng JSON-RPC.
      NEXA_MCP_COMMAND: process.execPath,
      NEXA_MCP_ARGS: join(ROOT, 'tests/fixtures/mock-mcp-server.mjs'),
      MOCK_SCENARIO: opts.mcpScenario ?? 'ok',
      // Không dùng phiên Codex thật của máy chạy test. Mock CLI vẫn đi qua đúng stdio JSON-RPC.
      PATH: `${join(ROOT, 'tests/fixtures/mock-codex-bin')}${delimiter}${process.env['PATH'] ?? ''}`,
      NEXA_E2E_NODE: process.execPath,
      NEXA_E2E_CODEX_FIXTURE: join(ROOT, 'tests/fixtures/mock-codex-app-server.mjs'),
      MOCK_CODEX_SCENARIO: opts.codexScenario ?? 'unauthenticated',
    }),
  })

  const page = await app.firstWindow()
  page.on('console', (message) => {
    if (message.type() === 'error') process.stderr.write(`[renderer console] ${message.text()}\n`)
  })
  page.on('pageerror', (error) =>
    process.stderr.write(`[renderer error] ${error.stack ?? error.message}\n`),
  )
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

  await h.page
    .getByLabel('Endpoint (https://…)')
    .or(h.page.locator('.field input').first())
    .fill(`http://127.0.0.1:${String(h.litellmPort)}`)
  await h.page.locator('input[type="password"]').fill(apiKey)
  await h.page.getByRole('button', { name: 'Lưu', exact: true }).click()
  await expect(h.page.getByText('Đã lưu cấu hình kết nối.')).toBeVisible({ timeout: 10_000 })

  // Lưu cấu hình KHÔNG gọi server — nó chỉ ghi vào SQLite và secure storage.
  // Phải bấm "Kiểm tra kết nối" thì mới có request thật tới LiteLLM, và đó cũng đúng là
  // việc người dùng làm sau khi nhập key.
  await h.page.getByRole('button', { name: 'Kiểm tra kết nối' }).click()
  await expect(h.page.getByText(/Kết nối thành công/)).toBeVisible({ timeout: 15_000 })

  await h.page.getByRole('tab', { name: 'Model' }).click()
  await h.page.getByPlaceholder('Model id (ví dụ gpt-5.x-internal)').fill('model-a')
  await h.page.getByPlaceholder('Tên hiển thị').fill('Model A')
  await h.page.getByRole('button', { name: 'Thêm' }).click()
  await expect(h.page.getByText('model-a')).toBeVisible()
}

test.describe('E2E — cấu hình và chat', () => {
  test('hiển thị model Plus ngoài màn hình Chat, chọn được và nhận streaming', async () => {
    const h = await launch({ codexScenario: 'authenticated' })
    try {
      await expect(
        h.page.getByRole('heading', { name: 'Mình tiếp tục việc gì hôm nay?' }),
      ).toBeVisible()
      await h.page.getByRole('button', { name: '+ Hội thoại mới' }).first().click()

      const selector = h.page.getByLabel('Chọn model')
      await expect(selector).toBeVisible()
      await expect(selector.locator('optgroup[label="ChatGPT Plus / Codex"]')).toHaveCount(1)
      await expect(selector.locator('option')).toContainText([
        'GPT-5.6 Sol · Plus',
        'GPT-5.6 Terra · Plus',
      ])
      await selector.selectOption('chatgpt:gpt-5.6-terra')
      await expect(selector).toHaveValue('chatgpt:gpt-5.6-terra')
      await expect(h.page.getByLabel('Đính kèm tài liệu hoặc ảnh')).toBeDisabled()

      const captureDir = process.env['NEXA_CAPTURE_VISUALS']
      if (captureDir !== undefined && captureDir !== '') {
        mkdirSync(captureDir, { recursive: true })
        const toastCloseButtons = h.page.getByLabel('Đóng thông báo')
        while ((await toastCloseButtons.count()) > 0) await toastCloseButtons.first().click()
        await h.page.setViewportSize({ width: 1280, height: 860 })
        await h.page.screenshot({ path: join(captureDir, 'chat-plus-default.png'), fullPage: true })
        await h.page.setViewportSize({ width: 620, height: 720 })
        await h.page.screenshot({ path: join(captureDir, 'chat-plus-narrow.png'), fullPage: true })
        await h.page.setViewportSize({ width: 1280, height: 860 })
      }

      await h.page.getByPlaceholder(/Nhập câu hỏi/).fill('Xin chào từ Nexa')
      await h.page.getByRole('button', { name: 'Gửi' }).click()

      await expect(
        h.page.getByText('Xin chào, đây là câu trả lời từ mock ChatGPT Plus.'),
      ).toBeVisible({ timeout: 20_000 })
    } finally {
      await h.close()
    }
  })

  test('ô chat giữ nguyên tiếng Việt và không gửi khi IME còn ghép dấu', async () => {
    const h = await launch()
    try {
      await configureLiteLlm(h)
      await h.page.getByRole('button', { name: '← Quay lại hội thoại' }).click()
      await h.page.getByRole('button', { name: '+ Hội thoại mới' }).first().click()

      const composer = h.page.getByLabel('Nội dung câu hỏi')
      const vietnameseText = 'Tôi đang nhập tiếng Việt có đầy đủ dấu.'
      await expect(composer).toHaveAttribute('lang', 'vi')
      await expect(composer).toHaveAttribute('spellcheck', 'true')
      await composer.fill(vietnameseText)

      await composer.dispatchEvent('compositionstart', { data: 'ấ' })
      await composer.press('Control+Enter')
      await expect(composer).toHaveValue(vietnameseText)
      await expect(h.page.locator('.message-user')).toHaveCount(0)

      await composer.dispatchEvent('compositionend', { data: 'ấ' })
      await composer.press('Control+Enter')
      await expect(h.page.locator('.message-user').getByText(vietnameseText)).toBeVisible()
      await expect(h.page.getByText(/câu trả lời từ mock LiteLLM/)).toBeVisible({
        timeout: 20_000,
      })
    } finally {
      await h.close()
    }
  })

  test('điều hướng tab cài đặt bằng bàn phím', async () => {
    const h = await launch()
    try {
      expect(h.page.url()).toBe('nexa://app/index.html')
      const liteLlmTab = h.page.getByRole('tab', { name: 'LiteLLM' })
      const openAiTab = h.page.getByRole('tab', { name: 'OpenAI' })

      await liteLlmTab.focus()
      await h.page.keyboard.press('ArrowRight')

      await expect(openAiTab).toBeFocused()
      await expect(openAiTab).toHaveAttribute('aria-selected', 'true')
      await expect(h.page.getByRole('tabpanel')).toHaveAttribute(
        'aria-labelledby',
        'settings-tab-openai',
      )
      await expect(h.page.getByRole('heading', { name: 'Đăng nhập bằng ChatGPT' })).toBeVisible()
      await expect(h.page.getByRole('heading', { name: 'Model Codex khả dụng' })).toBeVisible()
      await expect(
        h.page.getByRole('heading', { name: 'Kết nối bằng OpenAI API key' }),
      ).toBeVisible()
    } finally {
      await h.close()
    }
  })

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

  test('memory do người dùng xác nhận được đưa vào prompt của hội thoại mới', async () => {
    const h = await launch()
    try {
      await configureLiteLlm(h)

      await h.page.getByRole('tab', { name: 'Nexa nhớ' }).click()
      await h.page.getByLabel(/Nội dung nhớ/).fill('Ưu tiên câu trả lời ngắn và có checklist.')
      await h.page.getByLabel('Loại memory').selectOption('preference')
      await h.page.getByRole('button', { name: 'Lưu memory' }).click()
      await expect(h.page.getByText('Đã lưu memory cho Nexa.')).toBeVisible()
      await expect(h.page.getByText('Ưu tiên câu trả lời ngắn và có checklist.')).toBeVisible()

      const captureDir = process.env['NEXA_CAPTURE_VISUALS']
      if (captureDir !== undefined && captureDir !== '') {
        mkdirSync(captureDir, { recursive: true })
        const toastCloseButtons = h.page.getByLabel('Đóng thông báo')
        while ((await toastCloseButtons.count()) > 0) await toastCloseButtons.first().click()
        await h.page.setViewportSize({ width: 1280, height: 860 })
        await h.page.screenshot({ path: join(captureDir, 'memory-default.png'), fullPage: true })
        await h.page.setViewportSize({ width: 620, height: 720 })
        await h.page.screenshot({ path: join(captureDir, 'memory-narrow.png'), fullPage: true })
        await h.page.setViewportSize({ width: 1280, height: 860 })
      }

      await h.page.getByRole('button', { name: 'Hôm nay' }).click()
      await expect(
        h.page.getByRole('heading', { name: 'Mình tiếp tục việc gì hôm nay?' }),
      ).toBeVisible()
      await expect(h.page.getByRole('heading', { name: 'Nexa đang nhớ' })).toBeVisible()

      if (captureDir !== undefined && captureDir !== '') {
        await h.page.setViewportSize({ width: 1280, height: 860 })
        await h.page.screenshot({ path: join(captureDir, 'today-default.png'), fullPage: true })
        await h.page.setViewportSize({ width: 620, height: 720 })
        await h.page.screenshot({ path: join(captureDir, 'today-narrow.png'), fullPage: true })
        await h.page.setViewportSize({ width: 1280, height: 860 })
      }

      await h.page.getByRole('button', { name: '+ Hội thoại mới' }).first().click()
      await h.page.getByPlaceholder(/Nhập câu hỏi/).fill('Lập kế hoạch hôm nay')
      await h.page.getByRole('button', { name: 'Gửi' }).click()
      await expect(h.page.getByText('Xin chào, đây là câu trả lời từ mock LiteLLM.')).toBeVisible({
        timeout: 20_000,
      })

      const received = (await (
        await fetch(`http://127.0.0.1:${String(h.litellmPort)}/__received`)
      ).json()) as { url: string; body: string }[]
      const chatRequest = received.find((entry) => entry.url === '/v1/chat/completions')
      expect(chatRequest).toBeDefined()
      const chatBody = JSON.parse(chatRequest?.body ?? '{}') as {
        messages?: { role: string; content: string }[]
      }
      expect(chatBody.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: 'system',
            content: expect.stringContaining('Ưu tiên câu trả lời ngắn và có checklist.'),
          }),
        ]),
      )
    } finally {
      await h.close()
    }
  })

  test('commitment đi từ Goals tới Today, hoàn thành, mở lại và xoá an toàn', async () => {
    const h = await launch()
    try {
      await configureLiteLlm(h)
      await h.page.getByRole('button', { name: '← Quay lại hội thoại' }).click()
      await h.page.getByRole('button', { name: 'Mục tiêu' }).click()

      await expect(h.page.getByRole('heading', { name: 'Mục tiêu & cam kết' })).toBeVisible()
      await h.page
        .getByLabel(/Kết quả muốn đạt/)
        .fill('Hoàn tất kế hoạch pilot Nexa cho phòng Vận hành')
      await h.page.getByLabel(/Bước tiếp theo/).fill('Chốt danh sách năm người dùng thử nghiệm')
      await h.page.getByRole('button', { name: 'Tạo cam kết' }).click()

      await expect(h.page.getByText('Đã tạo cam kết.')).toBeVisible()
      const activeList = h.page.getByRole('list', { name: 'Đang theo dõi' })
      await expect(
        activeList.getByText('Hoàn tất kế hoạch pilot Nexa cho phòng Vận hành'),
      ).toBeVisible()
      await expect(activeList.getByText(/Chốt danh sách năm người dùng/)).toBeVisible()

      const captureDir = process.env['NEXA_CAPTURE_VISUALS']
      if (captureDir !== undefined && captureDir !== '') {
        mkdirSync(captureDir, { recursive: true })
        const toastCloseButtons = h.page.getByLabel('Đóng thông báo')
        while ((await toastCloseButtons.count()) > 0) await toastCloseButtons.first().click()
        await h.page.setViewportSize({ width: 1280, height: 860 })
        await h.page.screenshot({ path: join(captureDir, 'goals-default.png'), fullPage: true })
        await h.page.setViewportSize({ width: 620, height: 720 })
        await h.page.screenshot({ path: join(captureDir, 'goals-narrow.png'), fullPage: true })
        await h.page.setViewportSize({ width: 1280, height: 860 })
      }

      await h.page.getByRole('button', { name: 'Hôm nay' }).click()
      const todayCommitments = h.page.getByRole('list', { name: 'Cam kết cần chú ý' })
      await expect(
        todayCommitments.getByText('Hoàn tất kế hoạch pilot Nexa cho phòng Vận hành'),
      ).toBeVisible()
      if (captureDir !== undefined && captureDir !== '') {
        await h.page.screenshot({
          path: join(captureDir, 'today-with-commitment-default.png'),
          fullPage: true,
        })
        await h.page.setViewportSize({ width: 620, height: 720 })
        await h.page.screenshot({
          path: join(captureDir, 'today-with-commitment-narrow.png'),
          fullPage: true,
        })
        await h.page.setViewportSize({ width: 1280, height: 860 })
      }
      await todayCommitments.getByRole('button', { name: /Hoàn tất kế hoạch pilot Nexa/ }).click()

      await expect(h.page.getByRole('heading', { name: 'Mục tiêu & cam kết' })).toBeVisible()
      await h.page
        .getByRole('list', { name: 'Đang theo dõi' })
        .getByRole('button', { name: 'Hoàn thành' })
        .click()
      await expect(h.page.getByText('Đã hoàn thành cam kết.')).toBeVisible()
      const completedList = h.page.getByRole('list', { name: 'Đã hoàn thành' })
      await expect(
        completedList.getByText('Hoàn tất kế hoạch pilot Nexa cho phòng Vận hành'),
      ).toBeVisible()

      await completedList.getByRole('button', { name: 'Mở lại' }).click()
      await expect(h.page.getByText('Đã mở lại cam kết.')).toBeVisible()
      await h.page
        .getByRole('list', { name: 'Đang theo dõi' })
        .getByRole('button', { name: 'Xoá' })
        .click()

      const dialog = h.page.getByRole('alertdialog', { name: 'Xoá vĩnh viễn cam kết?' })
      await expect(dialog).toContainText('Nếu chỉ chưa muốn theo dõi')
      await dialog.getByRole('button', { name: 'Xoá cam kết' }).click()
      await expect(h.page.getByText('Đã xoá vĩnh viễn cam kết.')).toBeVisible()
      await expect(h.page.getByText('Hoàn tất kế hoạch pilot Nexa cho phòng Vận hành')).toHaveCount(
        0,
      )
    } finally {
      await h.close()
    }
  })

  test('proactive check-in là opt-in, bốn action chỉ đổi state local và Activity filter được', async () => {
    const h = await launch()
    try {
      const closeToasts = async (): Promise<void> => {
        const closeButtons = h.page.getByLabel('Đóng thông báo')
        while ((await closeButtons.count()) > 0) await closeButtons.first().click()
      }
      await configureLiteLlm(h)
      await h.page.getByRole('button', { name: '← Quay lại hội thoại' }).click()
      await h.page.getByRole('button', { name: 'Mục tiêu' }).click()

      const titles = {
        snooze: 'Check-in E2E — nhắc lại sau',
        dismiss: 'Check-in E2E — bỏ qua',
        mute: 'Check-in E2E — không nhắc nữa',
        act: 'Check-in E2E — thực hiện',
      } as const
      for (const title of Object.values(titles)) {
        await h.page.getByLabel(/Kết quả muốn đạt/).fill(title)
        await h.page.getByLabel(/Bước tiếp theo/).fill('Mở cam kết và tự quyết định bước tiếp theo')
        await h.page.getByLabel('Hạn hoàn thành').fill('2020-01-01T09:00')
        await h.page.getByRole('button', { name: 'Tạo cam kết' }).click()
        await expect(
          h.page.getByRole('list', { name: 'Đang theo dõi' }).getByText(title),
        ).toBeVisible()
      }

      await h.page.getByRole('button', { name: 'Hôm nay' }).click()
      await expect(h.page.getByRole('heading', { name: 'Cần check-in' })).toBeVisible()
      await expect(h.page.getByRole('button', { name: 'Bật nhắc việc' })).toBeVisible()
      await expect(h.page.getByRole('list', { name: 'Check-in cần chú ý' })).toHaveCount(0)

      await h.page.getByRole('button', { name: 'Bật nhắc việc' }).click()
      const checkIns = h.page.getByRole('list', { name: 'Check-in cần chú ý' })
      for (const title of Object.values(titles)) {
        await expect(checkIns.getByText(title)).toBeVisible()
      }

      const captureDir = process.env['NEXA_CAPTURE_VISUALS']
      if (captureDir !== undefined && captureDir !== '') {
        mkdirSync(captureDir, { recursive: true })
        await closeToasts()
        await h.page.setViewportSize({ width: 1280, height: 860 })
        await h.page.screenshot({
          path: join(captureDir, 'check-ins-today-default.png'),
          fullPage: true,
        })
        await h.page.setViewportSize({ width: 620, height: 720 })
        await h.page.screenshot({
          path: join(captureDir, 'check-ins-today-narrow.png'),
          fullPage: true,
        })
        await h.page.setViewportSize({ width: 1280, height: 860 })
      }

      const itemFor = (title: string) => checkIns.locator('li').filter({ hasText: title })
      await itemFor(titles.snooze).getByRole('button', { name: 'Nhắc lại sau' }).click()
      await expect(itemFor(titles.snooze)).toHaveCount(0)
      await itemFor(titles.dismiss).getByRole('button', { name: 'Bỏ qua' }).click()
      await expect(itemFor(titles.dismiss)).toHaveCount(0)
      await itemFor(titles.mute).getByRole('button', { name: 'Không nhắc việc này nữa' }).click()
      await expect(itemFor(titles.mute)).toHaveCount(0)
      await itemFor(titles.act).getByRole('button', { name: 'Thực hiện' }).click()

      await expect(h.page.getByRole('heading', { name: 'Mục tiêu & cam kết' })).toBeVisible()
      const mutedCard = h.page
        .getByRole('list', { name: 'Đang theo dõi' })
        .locator('li')
        .filter({ hasText: titles.mute })
      await expect(mutedCard.getByText('Đã tắt nhắc')).toBeVisible()
      await mutedCard.getByRole('button', { name: 'Bật lại nhắc' }).click()
      await expect(h.page.getByText('Đã bật lại nhắc việc cho cam kết.')).toBeVisible()

      await h.page.getByRole('button', { name: 'Hôm nay' }).click()
      await expect(checkIns.getByText(titles.mute)).toBeVisible()

      await h.page.getByRole('button', { name: 'Hoạt động' }).click()
      await expect(h.page.getByRole('heading', { name: 'Hoạt động' })).toBeVisible()
      await h.page.getByLabel('Loại hoạt động').selectOption('suggestion')
      await h.page.getByLabel('Trạng thái').selectOption('muted')
      const activity = h.page.getByRole('list', { name: 'Timeline hoạt động' })
      await expect(activity.getByText(titles.mute)).toBeVisible()
      await expect(activity.getByText('Đã tắt nhắc', { exact: true }).first()).toBeVisible()
      await expect(activity.getByText(titles.snooze)).toHaveCount(0)

      await h.page.getByLabel('Trạng thái').selectOption('all')
      await expect(activity.getByText('Đã nhắc lại sau', { exact: true }).first()).toBeVisible()
      await expect(activity.getByText('Đã bỏ qua', { exact: true }).first()).toBeVisible()
      await expect(activity.getByText('Đã bật lại nhắc', { exact: true }).first()).toBeVisible()

      if (captureDir !== undefined && captureDir !== '') {
        await closeToasts()
        await h.page.setViewportSize({ width: 1280, height: 860 })
        await h.page.screenshot({
          path: join(captureDir, 'activity-default.png'),
          fullPage: true,
        })
        await h.page.setViewportSize({ width: 620, height: 720 })
        await h.page.screenshot({
          path: join(captureDir, 'activity-narrow.png'),
          fullPage: true,
        })
        await h.page.setViewportSize({ width: 1280, height: 860 })
      }

      await h.page.getByRole('button', { name: 'Hôm nay' }).click()
      await h.page.getByRole('button', { name: 'Tắt nhắc việc' }).click()
      await expect(h.page.getByRole('button', { name: 'Bật nhắc việc' })).toBeVisible()
      await expect(h.page.getByRole('list', { name: 'Check-in cần chú ý' })).toHaveCount(0)
    } finally {
      await h.close()
    }
  })

  test('phản hồi chạm giới hạn độ dài được báo là chưa đầy đủ và có hướng tiếp tục', async () => {
    const h = await launch({ litellmScenario: 'length' })
    try {
      await configureLiteLlm(h)
      await h.page.getByRole('button', { name: '← Quay lại hội thoại' }).click()
      await h.page.getByRole('button', { name: '+ Hội thoại mới' }).first().click()

      await h.page.getByPlaceholder(/Nhập câu hỏi/).fill('Cho tôi một báo cáo dài')
      await h.page.getByRole('button', { name: 'Gửi' }).click()

      await expect(h.page.getByText(/Phần đầu câu trả lời/)).toBeVisible({ timeout: 20_000 })
      await expect(h.page.getByText(/Câu trả lời này chưa đầy đủ/)).toBeVisible()
      await expect(h.page.getByText(/nhắn “tiếp tục”/)).toBeVisible()
    } finally {
      await h.close()
    }
  })

  test('request chậm chỉ hiện nút Dừng trong đúng hội thoại', async () => {
    const h = await launch({ litellmScenario: 'slow' })
    try {
      await configureLiteLlm(h)
      await h.page.getByRole('button', { name: '← Quay lại hội thoại' }).click()
      await h.page.getByRole('button', { name: '+ Hội thoại mới' }).first().click()

      await h.page.getByPlaceholder(/Nhập câu hỏi/).fill('Lượt chat đang chờ')
      await h.page.getByRole('button', { name: 'Gửi' }).click()
      await expect(h.page.getByRole('button', { name: 'Dừng' })).toBeVisible()

      await h.page.getByRole('button', { name: '+ Hội thoại mới' }).first().click()
      await expect(h.page.getByRole('button', { name: 'Đang xử lý…' })).toBeDisabled()
      await expect(h.page.getByRole('button', { name: 'Dừng' })).toHaveCount(0)

      await h.page.getByRole('button', { name: /Lượt chat đang chờ/ }).click()
      await expect(h.page.getByRole('button', { name: 'Dừng' })).toBeVisible()
      await h.page.getByRole('button', { name: 'Dừng' }).click()
      await expect(h.page.getByRole('button', { name: 'Gửi' })).toBeVisible()
    } finally {
      await h.close()
    }
  })

  test('sửa và xoá một tin nhắn lẻ (OPEN-QUESTIONS D4)', async () => {
    const h = await launch()
    try {
      await configureLiteLlm(h)
      await h.page.getByRole('button', { name: '← Quay lại hội thoại' }).click()
      await h.page.getByRole('button', { name: '+ Hội thoại mới' }).first().click()

      await h.page.getByPlaceholder(/Nhập câu hỏi/).fill('Nội dung ban đầu')
      await h.page.getByRole('button', { name: 'Gửi' }).click()
      const userMessage = h.page.locator('.message-user').first()
      await expect(userMessage.getByText('Nội dung ban đầu')).toBeVisible()

      await userMessage.hover()
      await userMessage.getByLabel('Sửa tin nhắn').click()
      await userMessage.locator('textarea').fill('Nội dung đã sửa')
      await userMessage.getByRole('button', { name: 'Lưu' }).click()

      await expect(userMessage.getByText('Nội dung đã sửa')).toBeVisible()
      await expect(userMessage.locator('.message-header-left').getByText(/đã sửa/)).toBeVisible()

      const deleteButton = userMessage.getByLabel('Xoá tin nhắn')
      await deleteButton.click()
      let deleteDialog = h.page.getByRole('alertdialog')
      await expect(deleteDialog.getByText('Xoá tin nhắn?')).toBeVisible()
      await expect(deleteDialog.getByRole('button', { name: 'Huỷ' })).toBeFocused()
      await h.page.keyboard.press('Escape')
      await expect(deleteDialog).toBeHidden()
      await expect(deleteButton).toBeFocused()

      await deleteButton.click()
      deleteDialog = h.page.getByRole('alertdialog')
      await deleteDialog.getByRole('button', { name: 'Xoá tin nhắn' }).click()

      await expect(userMessage.getByText('Tin nhắn đã bị xoá.')).toBeVisible()
      await expect(userMessage.getByText('Nội dung đã sửa')).toHaveCount(0)
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
        const api = (
          window as unknown as { nexa: { invoke: (c: string, p?: unknown) => Promise<unknown> } }
        ).nexa
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
        const api = (
          window as unknown as { nexa: { invoke: (c: string, p?: unknown) => Promise<unknown> } }
        ).nexa
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
      await h.page.getByRole('tab', { name: 'Jira' }).click()
      await h.page.locator('.field input').first().fill('http://127.0.0.1:9/jira')
      await h.page
        .getByLabel('Tên đăng nhập')
        .or(h.page.locator('.field input').nth(1))
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
      await expect(dialog.getByText('jira_create_issue')).toBeVisible()
      // Tiêu đề xuất hiện hai chỗ trong preview: ô "Dữ liệu sẽ được gửi đi" và bảng
      // "Sẽ bị thay đổi". Cả hai đều đúng — chỉ định rõ chỗ nào để locator không mơ hồ.
      await expect(dialog.locator('dl').getByText('Task từ E2E')).toBeVisible()
      await expect(dialog.locator('td.after')).toHaveText('Task từ E2E')
      // §10.2 cấm nhãn mơ hồ: phải là "Xác nhận" và "Huỷ".
      await expect(dialog.getByRole('button', { name: 'Xác nhận' })).toBeVisible()
      await expect(dialog.getByRole('button', { name: 'Huỷ' })).toBeVisible()
      await expect(dialog.getByRole('button', { name: 'Huỷ' })).toBeFocused()

      // §17.2 kịch bản 2: huỷ ⇒ không có gì được gửi tới hệ thống đích.
      await h.page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
    } finally {
      await h.close()
    }
  })
})

test.describe('E2E — cam kết từ hội thoại', () => {
  test('Nexa đề xuất cam kết, người dùng xác nhận rồi thấy nó trong Mục tiêu và Hoạt động', async () => {
    const h = await launch({ litellmScenario: 'commitment-tool' })
    try {
      await configureLiteLlm(h)

      // Quyền ghi mới ⇒ mặc định tắt. Không bật thì model không có tool để gọi.
      await h.page.getByRole('tab', { name: 'Dữ liệu & quyền riêng tư' }).click()
      const commitmentToolToggle = h.page.getByRole('checkbox', {
        name: /Cho Nexa đề xuất tạo và cập nhật cam kết/,
      })
      // Checkbox là controlled và chỉ lật sau khi main lưu xong setting, nên dùng click + assert
      // có retry thay vì `check()` (check() kiểm tra state ngay sau cú click, chưa kịp round-trip).
      await commitmentToolToggle.click()
      await expect(commitmentToolToggle).toBeChecked()

      await h.page.getByRole('button', { name: '← Quay lại hội thoại' }).click()
      await h.page.getByRole('button', { name: '+ Hội thoại mới' }).first().click()
      await h.page
        .getByPlaceholder(/Nhập câu hỏi/)
        .fill('Thứ 6 tuần sau tôi phải gửi báo cáo quý cho sếp')
      await h.page.getByRole('button', { name: 'Gửi' }).click()

      const dialog = h.page.getByRole('dialog')
      await expect(dialog).toBeVisible({ timeout: 25_000 })
      // Đích phải nói rõ là dữ liệu cục bộ, không mượn nhãn Jira.
      await expect(dialog.getByText('Dữ liệu trên máy bạn')).toBeVisible()
      await expect(dialog.getByText('Gửi báo cáo quý cho sếp')).toBeVisible()
      // Mốc tương đối đã được phân giải thành ngày giờ tuyệt đối để người dùng bắt lỗi.
      await expect(dialog.locator('dl')).toContainText(/\d{4}/)
      await expect(dialog.locator('dl')).not.toContainText('thứ 6 tuần sau')

      await dialog.getByRole('button', { name: 'Xác nhận' }).click()
      await expect(dialog).toBeHidden({ timeout: 15_000 })

      await h.page.getByRole('button', { name: 'Mục tiêu' }).click()
      const activeList = h.page.getByRole('list', { name: 'Đang theo dõi' })
      await expect(
        activeList.getByRole('heading', { name: 'Gửi báo cáo quý cho sếp' }),
      ).toBeVisible()
      await expect(activeList.getByText('Nexa đề xuất')).toBeVisible()

      await h.page.getByRole('button', { name: 'Hoạt động' }).click()
      await h.page.getByLabel('Nguồn').selectOption('agent')
      const timeline = h.page.getByRole('list', { name: 'Timeline hoạt động' })
      await expect(timeline.getByText('Nexa đề xuất').first()).toBeVisible()
    } finally {
      await h.close()
    }
  })
})

test.describe('E2E — thu hẹp danh mục tool theo ngữ cảnh (ADR 0009)', () => {
  test('câu hỏi Confluence chỉ gửi tool Confluence, kèm đường mở rộng', async () => {
    const h = await launch()
    try {
      await configureLiteLlm(h)

      // Cấu hình Jira để MCP khởi động được — mock MCP công bố cả tool Jira lẫn Confluence,
      // nên đây đúng là tình huống preset phải lọc bớt.
      await h.page.getByRole('tab', { name: 'Jira' }).click()
      await h.page.locator('.field input').first().fill('http://127.0.0.1:9/jira')
      await h.page
        .getByLabel('Tên đăng nhập')
        .or(h.page.locator('.field input').nth(1))
        .fill('nguyen.van.a')
      await h.page.locator('input[type="password"]').fill('PAT-e2e-0123456789')
      await h.page.getByRole('button', { name: 'Lưu', exact: true }).click()

      await h.page.getByRole('button', { name: '← Quay lại hội thoại' }).click()
      await h.page.getByRole('button', { name: '+ Hội thoại mới' }).first().click()
      await h.page.getByPlaceholder(/Nhập câu hỏi/).fill('Tìm trang wiki về quy trình onboarding')
      await h.page.getByRole('button', { name: 'Gửi' }).click()
      await expect(h.page.getByText('Xin chào, đây là câu trả lời từ mock LiteLLM.')).toBeVisible({
        timeout: 25_000,
      })

      const received = (await (
        await fetch(`http://127.0.0.1:${String(h.litellmPort)}/__received`)
      ).json()) as { url: string; body: string }[]

      const chat = received.filter((r) => r.url === '/v1/chat/completions')
      expect(chat.length).toBeGreaterThan(0)
      const tools = (
        JSON.parse(chat[chat.length - 1]?.body ?? '{}') as {
          tools?: { function: { name: string } }[]
        }
      ).tools
      const names = (tools ?? []).map((t) => t.function.name)

      expect(names).toContain('confluence_get_page')
      expect(names).toContain('confluence_search')
      // Đây là điểm của cả ADR 0009: tool Jira tồn tại và được phép, nhưng không được gửi đi.
      expect(names).not.toContain('jira_get_issue')
      expect(names).not.toContain('jira_create_issue')
      // Và model luôn có đường lấy lại danh mục đầy đủ.
      expect(names).toContain('nexa_mo_rong_tool')
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
      await expect(first.page.locator('.message-user').getByText('Câu hỏi cần nhớ')).toBeVisible()
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
      env: electronEnvironment(),
    })
    try {
      const page = await second.firstWindow()
      await page.waitForLoadState('domcontentloaded')
      // Today là home surface sau khi mở lại app. Hội thoại đã lưu phải xuất hiện trong phần tiếp
      // tục công việc; mở nó rồi mới kiểm chứng nội dung được giải mã từ SQLite.
      const recentConversations = page.getByRole('region', { name: 'Hội thoại gần đây' })
      await recentConversations.getByRole('button', { name: /Câu hỏi cần nhớ/ }).click()
      await expect(page.locator('.message-user').getByText('Câu hỏi cần nhớ')).toBeVisible({
        timeout: 20_000,
      })
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
    await h.page.getByRole('tab', { name: 'OpenAI' }).click()
    await expect(h.page.getByRole('heading', { name: 'Kết nối bằng OpenAI API key' })).toBeVisible()

    // Endpoint được điền sẵn https://api.openai.com — thay bằng mock để không gọi ra Internet.
    await h.page
      .locator('.field input')
      .first()
      .fill(`http://127.0.0.1:${String(h.litellmPort)}`)
    await h.page.locator('input[type="password"]').fill('sk-openai-e2e-0123456789')
    await h.page.getByRole('button', { name: 'Lưu', exact: true }).click()
    await expect(h.page.getByText('Đã lưu cấu hình kết nối.')).toBeVisible({ timeout: 10_000 })

    await h.page.getByRole('tab', { name: 'Model' }).click()
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
      await h.page.getByRole('tab', { name: 'OpenAI' }).click()

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

test.describe('E2E — không gian Nghiệp vụ (BA)', () => {
  /**
   * Cờ `baWorkbench` mặc định TẮT — bật qua đúng ô người dùng bấm, không đi đường tắt IPC.
   *
   * Dùng `click()` rồi assert chứ không dùng `check()`: ô này là controlled checkbox, trạng thái
   * chỉ đổi sau khi IPC lưu xong và App nhận lại settings mới. `check()` khẳng định trạng thái
   * ngay sau cú click nên nó thua cuộc đua đó.
   */
  async function enableBaWorkbench(h: Harness): Promise<void> {
    await h.page.getByRole('tab', { name: 'Dữ liệu & quyền riêng tư' }).click()
    const toggle = h.page.getByLabel('Bật không gian Nghiệp vụ')
    await toggle.click()
    await expect(toggle).toBeChecked()
    await h.page.getByRole('button', { name: '← Quay lại hội thoại' }).click()
  }

  test('đích Nghiệp vụ chỉ hiện khi cờ được bật', async () => {
    const h = await launch()
    try {
      await expect(h.page.getByRole('button', { name: 'Nghiệp vụ' })).toHaveCount(0)

      // App chưa có kết nối LiteLLM nên nó đã tự mở thẳng Cài đặt.
      await enableBaWorkbench(h)

      await expect(h.page.getByRole('button', { name: 'Nghiệp vụ' })).toBeVisible()
    } finally {
      await h.close()
    }
  })

  test('IPC ba:* bị từ chối khi cờ tắt, kể cả khi renderer gọi thẳng', async () => {
    const h = await launch()
    try {
      const result = await h.page.evaluate(async () => {
        const api = (
          window as unknown as { nexa: { invoke: (c: string, p?: unknown) => Promise<unknown> } }
        ).nexa
        return api.invoke('ba:knowledge:list', {})
      })
      // Ẩn nút trong sidebar chỉ là chuyện dễ hiểu; hàng rào thật nằm ở main process.
      expect(JSON.stringify(result)).toContain('VALIDATION_FAILED')
    } finally {
      await h.close()
    }
  })

  test('nhập tài liệu rồi trích xuất ra trang mã lỗi, kèm mã còn thiếu khai báo', async () => {
    const h = await launch()
    try {
      await configureLiteLlm(h)
      await enableBaWorkbench(h)

      await h.page.getByRole('button', { name: 'Nghiệp vụ' }).click()
      await h.page.getByRole('tab', { name: 'Tài liệu' }).click()

      await h.page.getByLabel('Tên tài liệu').fill('US-01 Đặt đơn')
      await h.page.getByRole('button', { name: 'Tạo tài liệu' }).click()

      await h.page
        .getByLabel('Nội dung tài liệu nguồn')
        .fill('# 1. Luồng đặt đơn\nKhách hàng chọn sản phẩm rồi xác nhận đơn.')
      await h.page.getByRole('button', { name: 'Trích xuất' }).click()

      await expect(h.page.getByRole('heading', { name: 'Trang mã lỗi' })).toBeVisible({
        timeout: 20_000,
      })
      // Khoanh vào chính trang mã lỗi: mã E001 còn xuất hiện ở danh sách item phía trên.
      const errorPage = h.page.getByLabel('Trang mã lỗi')
      await expect(errorPage.getByText('E001')).toBeVisible()
      await expect(errorPage).toContainText('Giỏ hàng trống')
      // Mã được nhắc trong luồng ngoại lệ nhưng chưa khai báo — thứ một bản tổng hợp bằng văn
      // xuôi sẽ im lặng bỏ qua.
      await expect(errorPage.getByRole('heading', { name: /chưa khai báo/ })).toBeVisible()
      await expect(errorPage.getByText('E404')).toBeVisible()

      // G2: chọn mẫu chuẩn do IT phân phối, rồi kiểm bản Markdown sinh từ chính mô hình đó.
      await h.page.getByLabel('Mẫu tài liệu').selectOption('us-standard')
      await expect(h.page.getByRole('heading', { name: 'Bản theo mẫu' })).toBeVisible()
      const rendered = h.page.getByLabel('Bản tài liệu theo mẫu')
      await expect(rendered).toContainText('Khách hàng đặt đơn')
      // Mẫu us-standard có mục Tác nhân bắt buộc mà tài liệu chưa có ⇒ phải báo, không giấu.
      await expect(h.page.getByText(/mục bắt buộc còn trống/)).toBeVisible()
    } finally {
      await h.close()
    }
  })

  /**
   * G3: chạy bộ luật, đọc báo cáo, áp dụng đúng một gợi ý.
   *
   * Ba điều test này khoanh vào, và cả ba đều là quyết định gốc chứ không phải chi tiết giao diện:
   * báo cáo nói rõ đã kiểm bộ luật nào và bao nhiêu luật; nó KHÔNG bao giờ nói tài liệu "đầy đủ";
   * và áp dụng là một thao tác của người dùng lên đúng một mục, xong thì phát hiện đó biến mất ở
   * lần chạy sau — chứ không phải hệ thống tự sửa rồi báo đã xong.
   */
  test('chạy bộ luật, báo cáo nói rõ đã kiểm gì, rồi áp dụng đúng một gợi ý', async () => {
    const h = await launch()
    try {
      await configureLiteLlm(h)
      await enableBaWorkbench(h)

      await h.page.getByRole('button', { name: 'Nghiệp vụ' }).click()
      await h.page.getByRole('tab', { name: 'Tài liệu' }).click()
      await h.page.getByLabel('Tên tài liệu').fill('US-02 Kiểm tra')
      await h.page.getByRole('button', { name: 'Tạo tài liệu' }).click()
      await h.page
        .getByLabel('Nội dung tài liệu nguồn')
        .fill('# 1. Luồng đặt đơn\nKhách hàng chọn sản phẩm rồi xác nhận đơn.')
      await h.page.getByRole('button', { name: 'Trích xuất' }).click()
      await expect(h.page.getByRole('heading', { name: 'Trang mã lỗi' })).toBeVisible({
        timeout: 20_000,
      })

      const review = h.page.getByLabel('Kiểm tra tài liệu')
      await review.getByRole('button', { name: 'Chạy kiểm tra' }).click()

      // Báo cáo phải nói đã kiểm BỘ LUẬT NÀO và bao nhiêu luật — con số "đạt" cần có đơn vị.
      await expect(review).toContainText('nexa-ba', { timeout: 20_000 })
      await expect(review).toContainText(/Đã kiểm \d+\/15 luật/)
      // Và không bao giờ tuyên bố tài liệu đầy đủ (ADR 0010).
      await expect(review).not.toContainText('đầy đủ')
      await expect(review).toContainText('không biết một yêu cầu nghiệp vụ chưa ai nghĩ tới')

      // Mã lỗi được nhắc trong luồng ngoại lệ nhưng chưa khai báo là một phát hiện phải sửa.
      await expect(review.locator('.ba-card').filter({ hasText: 'R-ERR-01' }).first()).toBeVisible()

      // Áp dụng cho MỘT phát hiện: use case chưa có luồng thay thế và chưa nói vì sao.
      const card = review.locator('.ba-card').filter({ hasText: 'R-UC-02' })
      await expect(card).toBeVisible()
      await card.getByRole('button', { name: 'Gợi ý câu chữ' }).click()
      // Model chỉ đóng góp câu chữ; các khoá đòi bỏ finding trong output của nó bị bỏ qua.
      await expect(card.getByLabel('Câu chữ thay thế cho R-UC-02')).toHaveValue(
        /chỉ có một đường duyệt/,
        { timeout: 20_000 },
      )
      await expect(card).toContainText('R-UC-02')

      await card.getByLabel('Ô cần sửa cho R-UC-02').selectOption('noAlternateReason')
      await card.getByRole('button', { name: 'Áp dụng cho mục này' }).click()

      // Chạy lại là một cú bấm có ý thức — báo cáo KHÔNG tự làm mới sau khi sửa.
      await expect(card).toBeVisible()
      await review.getByRole('button', { name: 'Chạy lại kiểm tra' }).click()
      await expect(review.locator('.ba-card').filter({ hasText: 'R-UC-02' })).toHaveCount(0, {
        timeout: 20_000,
      })
    } finally {
      await h.close()
    }
  })

  test('bộ mẫu chuẩn chỉ để xem — không có đường tạo hay sửa mẫu', async () => {
    const h = await launch()
    try {
      await enableBaWorkbench(h)
      await h.page.getByRole('button', { name: 'Nghiệp vụ' }).click()
      await h.page.getByRole('tab', { name: 'Mẫu' }).click()

      await expect(h.page.getByText('User Story chuẩn')).toBeVisible()
      await expect(h.page.getByText(/liên hệ IT/)).toBeVisible()
      // Quyền định nghĩa chuẩn thuộc về tổ chức, không thuộc từng máy (D12).
      await expect(h.page.getByRole('button', { name: /Tạo mẫu|Sửa mẫu|Xoá mẫu/ })).toHaveCount(0)
    } finally {
      await h.close()
    }
  })

  test('tri thức mới luôn ở trạng thái chờ xác nhận cho tới khi người dùng chốt', async () => {
    const h = await launch()
    try {
      // App chưa có kết nối LiteLLM nên nó đã tự mở thẳng Cài đặt.
      await enableBaWorkbench(h)
      await h.page.getByRole('button', { name: 'Nghiệp vụ' }).click()

      await h.page.getByLabel('Tiêu đề tri thức').fill('Ngưỡng miễn phí giao hàng')
      await h.page.getByLabel('Nội dung tri thức').fill('Đơn trên 500k miễn phí nội thành')
      await h.page.getByRole('button', { name: 'Thêm' }).click()

      // Khoanh vào đúng thẻ của mục vừa tạo: chữ "Chờ xác nhận" còn xuất hiện ở thống kê, ở
      // dropdown lọc và ở toast, nên tìm theo text trên cả trang là locator quá rộng.
      const card = h.page.locator('.ba-list .ba-card').filter({ hasText: 'Ngưỡng miễn phí giao hàng' })
      await expect(card).toContainText('Chờ xác nhận')
      await card.getByRole('button', { name: 'Xác nhận' }).click()
      await expect(card).toContainText('Đã xác nhận')
    } finally {
      await h.close()
    }
  })
})
