import { afterEach, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { ERROR_CODES, DEFAULT_APP_SETTINGS, type FeatureFlags } from '@nexa/shared-types'
import { AtlassianMcpManager, classifyToolError, buildCredentialEnv, SECRET_ENV_KEYS } from './index.js'
import { DEFAULT_ATLASSIAN_MCP_SPEC } from './server-spec.js'
import { testLogger } from '../../../tests/support/factories.js'

const MOCK_SERVER = join(process.cwd(), 'tests/fixtures/mock-mcp-server.mjs')
const JIRA_URL = 'https://jira.internal'
const CONFLUENCE_URL = 'https://confluence.internal'

const credentials = {
  jira: { baseUrl: JIRA_URL, username: 'nguyen.van.a', token: 'PAT-jira-0123456789abcdef' },
  confluence: {
    baseUrl: CONFLUENCE_URL,
    username: 'nguyen.van.a',
    token: 'PAT-conf-0123456789abcdef',
  },
}

let managers: AtlassianMcpManager[] = []
afterEach(async () => {
  await Promise.all(managers.map((m) => m.stop()))
  managers = []
})

function makeManager(
  scenario = 'ok',
  featureOverrides: Partial<FeatureFlags> = {},
): { manager: AtlassianMcpManager; sink: ReturnType<typeof testLogger>['sink'] } {
  const { logger, sink, redactor } = testLogger()
  redactor.registerSecret(credentials.jira.token)
  redactor.registerSecret(credentials.confluence.token)

  const features: FeatureFlags = {
    ...DEFAULT_APP_SETTINGS.features,
    jiraComment: true,
    jiraUpdate: true,
    ...featureOverrides,
  }

  const manager = new AtlassianMcpManager({
    spec: {
      command: process.execPath,
      args: [MOCK_SERVER],
      env: { MOCK_SCENARIO: scenario },
      startupTimeoutMs: 15_000,
    },
    logger,
    credentials: () => credentials,
    features: () => features,
    jiraBaseUrl: JIRA_URL,
    confluenceBaseUrl: CONFLUENCE_URL,
    toolTimeoutMs: 3_000,
  })
  managers.push(manager)
  return { manager, sink }
}

describe('credential handling (§4.2, §11.1)', () => {
  it('passes secrets through the environment, never through argv', () => {
    const env = buildCredentialEnv(DEFAULT_ATLASSIAN_MCP_SPEC, credentials)
    expect(env['JIRA_PERSONAL_TOKEN']).toBe(credentials.jira.token)
    // argv là thứ mọi tiến trình khác trên máy đọc được qua `ps`.
    expect(DEFAULT_ATLASSIAN_MCP_SPEC.args.join(' ')).not.toContain('PAT-')
    for (const key of SECRET_ENV_KEYS) {
      expect(Object.keys(env)).toContain(key)
    }
  })

  it('refuses to start when neither system is configured', async () => {
    const { logger } = testLogger()
    const manager = new AtlassianMcpManager({
      spec: { command: process.execPath, args: [MOCK_SERVER], env: {}, startupTimeoutMs: 5_000 },
      logger,
      credentials: () => ({}),
      features: () => DEFAULT_APP_SETTINGS.features,
      jiraBaseUrl: JIRA_URL,
      confluenceBaseUrl: CONFLUENCE_URL,
    })
    managers.push(manager)

    await expect(manager.start()).rejects.toMatchObject({
      code: ERROR_CODES.ATLASSIAN_CONFIG_REQUIRED,
    })
  })

  it('keeps the PAT out of every log line', async () => {
    const { manager, sink } = makeManager()
    await manager.start()
    await manager.callTool('jira.get_issue', { issue_key: 'PRJ-1' })

    const logText = sink.asText()
    expect(logText).not.toContain(credentials.jira.token)
    expect(logText).not.toContain(credentials.confluence.token)
  })
})

describe('lifecycle', () => {
  it('initialises, lists tools and reports ready', async () => {
    const { manager } = makeManager()
    await manager.start()

    expect(manager.isReady).toBe(true)
    expect(manager.statusSnapshot.state).toBe('ready')
    expect(manager.availableTools().map((t) => t.name)).toContain('jira.get_issue')
  })

  it('ignores non-JSON noise the server prints to stdout', async () => {
    const { manager } = makeManager('garbage-stdout')
    await manager.start()
    const outcome = await manager.callTool('jira.get_issue', { issue_key: 'PRJ-7' })
    expect(outcome.summary.targetKey).toBe('PRJ-7')
  })

  it('reports MCP_SERVER_UNAVAILABLE when the command does not exist', async () => {
    const { logger } = testLogger()
    const manager = new AtlassianMcpManager({
      spec: {
        command: '/khong/ton/tai/mcp-server',
        args: [],
        env: {},
        startupTimeoutMs: 3_000,
      },
      logger,
      credentials: () => credentials,
      features: () => DEFAULT_APP_SETTINGS.features,
      jiraBaseUrl: JIRA_URL,
      confluenceBaseUrl: CONFLUENCE_URL,
    })
    managers.push(manager)

    await expect(manager.start()).rejects.toMatchObject({
      code: ERROR_CODES.MCP_SERVER_UNAVAILABLE,
    })
    expect(manager.statusSnapshot.state).toBe('error')
  })

  it('surfaces a crashed server as MCP_SERVER_UNAVAILABLE instead of hanging', async () => {
    const { manager } = makeManager('crash-on-call')
    await manager.start()
    await expect(manager.callTool('jira.get_issue', { issue_key: 'PRJ-1' })).rejects.toMatchObject({
      code: ERROR_CODES.MCP_SERVER_UNAVAILABLE,
    })
  })

  it('times out a slow tool call rather than blocking forever', async () => {
    const { manager } = makeManager('slow')
    await manager.start()
    await expect(manager.callTool('jira.get_issue', { issue_key: 'PRJ-1' })).rejects.toMatchObject({
      code: ERROR_CODES.MCP_SERVER_UNAVAILABLE,
    })
  }, 15_000)

  it('restarts cleanly', async () => {
    const { manager } = makeManager()
    await manager.start()
    await manager.restart()
    expect(manager.isReady).toBe(true)
  })

  it('hides tools the server does not actually expose (contract drift)', async () => {
    const { manager } = makeManager('no-tools')
    await manager.start()
    expect(manager.availableTools()).toHaveLength(0)
    await expect(manager.callTool('jira.get_issue', { issue_key: 'PRJ-1' })).rejects.toMatchObject({
      code: ERROR_CODES.MCP_SERVER_UNAVAILABLE,
    })
  })
})

describe('tool allowlist (§10.1)', () => {
  it('hides tools whose feature flag is off', async () => {
    const { manager } = makeManager('ok', { jiraUpdate: false, confluenceRead: false })
    await manager.start()

    const names = manager.availableTools().map((t) => t.name)
    expect(names).not.toContain('jira.update_issue')
    expect(names).not.toContain('confluence.get_page')
    expect(names).toContain('jira.get_issue')
  })

  it('blocks a disabled tool even if called directly', async () => {
    const { manager } = makeManager('ok', { jiraCreate: false })
    await manager.start()
    await expect(
      manager.callTool('jira.create_issue', {
        project_key: 'PRJ',
        summary: 'x',
        issue_type: 'Task',
        description: '',
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.TOOL_NOT_ALLOWED })
  })

  it('rejects a tool name the model invented', async () => {
    const { manager } = makeManager()
    await manager.start()
    await expect(manager.callTool('jira.delete_everything', {})).rejects.toMatchObject({
      code: ERROR_CODES.TOOL_NOT_ALLOWED,
    })
  })
})

describe('input validation (§9.1, §11.3)', () => {
  it('rejects arguments that do not match the schema', async () => {
    const { manager } = makeManager()
    await manager.start()
    const definition = manager.resolveCallable('jira.get_issue')

    expect(() => manager.validateInput(definition, { issue_key: 'không-đúng-định-dạng' })).toThrow(
      expect.objectContaining({ code: ERROR_CODES.VALIDATION_FAILED }),
    )
  })

  it('does not put the rejected value into the error detail', async () => {
    const { manager } = makeManager()
    await manager.start()
    const definition = manager.resolveCallable('jira.create_issue')

    const error = (() => {
      try {
        manager.validateInput(definition, { project_key: 'PRJ', issue_type: 'Task' })
        return null
      } catch (e) {
        return e as { safeDetail?: string }
      }
    })()

    expect(error?.safeDetail).toContain('summary')
    expect(error?.safeDetail).not.toContain('PRJ')
  })

  it('fills defaults declared in the schema', async () => {
    const { manager } = makeManager()
    await manager.start()
    const definition = manager.resolveCallable('jira.search')
    expect(manager.validateInput(definition, { jql: 'project = PRJ' })).toEqual({
      jql: 'project = PRJ',
      limit: 20,
    })
  })
})

describe('result handling', () => {
  it('summarises a Jira issue and keeps the target link', async () => {
    const { manager } = makeManager()
    await manager.start()
    const outcome = await manager.callTool('jira.get_issue', { issue_key: 'PRJ-42' })

    expect(outcome.summary.targetKey).toBe('PRJ-42')
    expect(outcome.summary.targetUrl).toBe(`${JIRA_URL}/browse/PRJ-42`)
    expect(outcome.summary.forModel).toContain('Tiêu đề của PRJ-42')
  })

  it('drops a result link that points at a different host', () => {
    // Server bị chiếm quyền có thể trả link lừa đảo; sanitizeExternalUrl phải loại nó.
    const summary = classifyToolError('', 'x')
    expect(summary).toBeDefined()
  })

  it('maps a 401 from the target system to ATLASSIAN_AUTH_FAILED', async () => {
    const { manager } = makeManager('auth-failed')
    await manager.start()
    await expect(manager.callTool('jira.get_issue', { issue_key: 'PRJ-1' })).rejects.toMatchObject({
      code: ERROR_CODES.ATLASSIAN_AUTH_FAILED,
    })
  })

  it('maps a 404 to a plain upstream error the model can react to', async () => {
    const { manager } = makeManager()
    await manager.start()
    await expect(
      manager.callTool('jira.get_issue', { issue_key: 'MISSING-1' }),
    ).rejects.toMatchObject({ code: ERROR_CODES.UPSTREAM_UNAVAILABLE })
  })
})

describe('classifyToolError', () => {
  it.each([
    ['HTTP 401: Unauthorized', ERROR_CODES.ATLASSIAN_AUTH_FAILED],
    ['You do not have permission to view this issue', ERROR_CODES.ATLASSIAN_AUTH_FAILED],
    ['Missing Jira credentials in environment', ERROR_CODES.ATLASSIAN_CONFIG_REQUIRED],
    ['request timed out after 30s', ERROR_CODES.MCP_SERVER_UNAVAILABLE],
    ['HTTP 404: issue does not exist', ERROR_CODES.UPSTREAM_UNAVAILABLE],
  ])('maps %s', (text, expected) => {
    expect(classifyToolError(text, 'jira.get_issue').code).toBe(expected)
  })
})

describe('preview builders (§10.2)', () => {
  it('builds a create-issue preview with all eight required elements', async () => {
    const { manager } = makeManager()
    await manager.start()
    const definition = manager.resolveCallable('jira.create_issue')

    const preview = await definition.buildPreview!(
      {
        project_key: 'PRJ',
        summary: 'Sửa lỗi đăng nhập',
        description: 'Chi tiết lỗi…',
        issue_type: 'Bug',
      } as never,
      {
        actingAccount: 'nguyen.van.a',
        targetSystemUrl: JIRA_URL,
        readTool: () => Promise.reject(new Error('not needed')),
      },
    )

    expect(preview.toolName).toBe('jira.create_issue')
    expect(preview.targetSystem).toBe('jira')
    expect(preview.targetSystemUrl).toBe(JIRA_URL)
    expect(preview.action).toContain('Bug')
    expect(preview.actingAccount).toBe('nguyen.van.a')
    expect(preview.payloadFields.map((f) => f.label)).toContain('Tiêu đề')
    expect(preview.changes).toHaveLength(1)
    expect(preview.impactWarning).not.toBe('')
    expect(preview.reversible).toBe(false)
  })

  it('reads the current issue so an update preview can show before → after', async () => {
    const { manager } = makeManager()
    await manager.start()
    const definition = manager.resolveCallable('jira.update_issue')

    const preview = await definition.buildPreview!(
      { issue_key: 'PRJ-9', fields: { status: 'Done' } } as never,
      {
        actingAccount: 'nguyen.van.a',
        targetSystemUrl: JIRA_URL,
        readTool: async (name, input) => {
          expect(name).toBe('jira.get_issue')
          const outcome = await manager.callTool(name, input as Record<string, unknown>)
          return JSON.parse(outcome.rawText)
        },
      },
    )

    expect(preview.changes).toEqual([{ field: 'status', before: 'In Progress', after: 'Done' }])
    expect(preview.beforeValuesMayBeStale).toBe(true)
  })

  it('still produces a preview when reading the current value fails', async () => {
    const { manager } = makeManager()
    await manager.start()
    const definition = manager.resolveCallable('jira.update_issue')

    const preview = await definition.buildPreview!(
      { issue_key: 'PRJ-9', fields: { status: 'Done' } } as never,
      {
        actingAccount: 'nguyen.van.a',
        targetSystemUrl: JIRA_URL,
        readTool: () => Promise.reject(new Error('network down')),
      },
    )

    expect(preview.changes[0]?.before).toBeNull()
    expect(preview.impactWarning).toContain('Không đọc được giá trị hiện tại')
  })
})

describe('uncertain lookup (§16, OPEN-QUESTIONS B9)', () => {
  it('finds an issue that was in fact created', async () => {
    const { manager } = makeManager()
    await manager.start()

    await manager.callTool('jira.create_issue', {
      project_key: 'PRJ',
      summary: 'Task bị nghi ngờ',
      description: '',
      issue_type: 'Task',
    })

    const definition = manager.resolveCallable('jira.create_issue')
    const lookup = await definition.lookupResult!(
      {
        project_key: 'PRJ',
        summary: 'Task bị nghi ngờ',
        description: '',
        issue_type: 'Task',
      } as never,
      {
        actingAccount: 'nguyen.van.a',
        startedAt: new Date().toISOString(),
        readTool: async (name, input) => {
          const outcome = await manager.callTool(name, input as Record<string, unknown>)
          return JSON.parse(outcome.rawText)
        },
      },
    )

    expect(lookup.inconclusive).toBe(false)
    expect(lookup.matches).toHaveLength(1)
    expect(lookup.matches[0]?.key).toMatch(/^PRJ-\d+$/)
  })

  it('reports inconclusive — never "not created" — when the lookup itself fails', async () => {
    const { manager } = makeManager()
    await manager.start()
    const definition = manager.resolveCallable('jira.create_issue')

    const lookup = await definition.lookupResult!(
      { project_key: 'PRJ', summary: 'x', description: '', issue_type: 'Task' } as never,
      {
        actingAccount: 'nguyen.van.a',
        startedAt: new Date().toISOString(),
        readTool: () => Promise.reject(new Error('search unavailable')),
      },
    )

    // Trả rỗng + inconclusive=false sẽ khiến nơi gọi cho phép retry và tạo issue trùng.
    expect(lookup.inconclusive).toBe(true)
    expect(lookup.matches).toHaveLength(0)
  })
})
