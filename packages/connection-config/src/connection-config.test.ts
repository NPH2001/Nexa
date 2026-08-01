import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { DEFAULT_ORG_POLICY, ERROR_CODES, orgPolicySchema } from '@nexa/shared-types'
import { AuditRepository, ConfigRepository } from '@nexa/local-store'
import { MemoryBackend, SecurityService } from '@nexa/security'
import { Logger, MemorySink, Redactor } from '@nexa/observability'
import { ConnectionService, ModelService, SettingsService, loadOrgPolicy } from './index.js'
import { makeTempStore, type TempStore } from '../../../tests/support/factories.js'

let ctx: TempStore | null = null
afterEach(() => {
  ctx?.cleanup()
  ctx = null
})

function makeServices(policyRaw: unknown = {}) {
  ctx = makeTempStore()
  const sink = new MemorySink()
  const redactor = new Redactor()
  const logger = new Logger({ sink, redactor, minLevel: 'debug' })

  const security = new SecurityService({ backend: new MemoryBackend(), logger, redactor })
  const repo = new ConfigRepository(ctx.store)
  const audit = new AuditRepository(ctx.store)
  const policy = orgPolicySchema.parse(policyRaw)

  const connections = new ConnectionService({
    repo,
    audit,
    security,
    profileId: ctx.profileId,
    policy,
    logger,
  })
  const models = new ModelService(repo, ctx.profileId, logger)
  const settings = new SettingsService(repo, ctx.profileId, policy, logger)

  return { connections, models, settings, security, repo, sink, redactor, store: ctx }
}

describe('ConnectionService — URL validation (§11.2)', () => {
  it('accepts a plain HTTPS URL and normalises the trailing slash', () => {
    const { connections } = makeServices()
    const saved = connections.save({
      type: 'jira',
      baseUrl: 'https://jira.internal/',
      username: 'nguyen.van.a',
      secret: 'PAT-0123456789',
      enabled: true,
    })
    expect(saved.baseUrl).toBe('https://jira.internal')
  })

  it.each([
    ['http://jira.internal', 'plain http'],
    ['ftp://jira.internal', 'non-web scheme'],
    ['https://user:pass@jira.internal', 'embedded credentials'],
    ['https://jira.internal?token=x', 'query string'],
    ['không phải url', 'garbage'],
  ])('rejects %s (%s)', (url) => {
    const { connections } = makeServices()
    expect(() =>
      connections.save({
        type: 'jira',
        baseUrl: url,
        username: 'a',
        secret: 'PAT-0123456789',
        enabled: true,
      }),
    ).toThrow(expect.objectContaining({ code: expect.stringMatching(/INVALID_URL/) }))
  })

  it('enforces the organisation domain allowlist', () => {
    const { connections } = makeServices({ allowedDomains: ['*.corp.local'] })

    expect(() =>
      connections.save({
        type: 'jira',
        baseUrl: 'https://jira.evil.example',
        username: 'a',
        secret: 'PAT-0123456789',
        enabled: true,
      }),
    ).toThrow(expect.objectContaining({ code: ERROR_CODES.DOMAIN_NOT_ALLOWED }))

    expect(
      connections.save({
        type: 'jira',
        baseUrl: 'https://jira.corp.local',
        username: 'a',
        secret: 'PAT-0123456789',
        enabled: true,
      }).baseUrl,
    ).toBe('https://jira.corp.local')
  })

  it('does not store anything when the URL is rejected', () => {
    const { connections, security } = makeServices()
    expect(() =>
      connections.save({
        type: 'jira',
        baseUrl: 'http://insecure.internal',
        username: 'a',
        secret: 'PAT-0123456789',
        enabled: true,
      }),
    ).toThrow()

    expect(connections.get('jira')).toBeNull()
    expect(security.hasCredential('jira')).toBe(false)
  })
})

describe('ConnectionService — credential lifecycle (§8.2)', () => {
  it('never writes the PAT into SQLite', () => {
    const { connections, store } = makeServices()
    const pat = 'PAT-super-bi-mat-0123456789'
    connections.save({
      type: 'jira',
      baseUrl: 'https://jira.internal',
      username: 'a',
      secret: pat,
      enabled: true,
    })
    store.store.close()

    expect(readFileSync(store.dbPath).toString('latin1')).not.toContain(pat)
  })

  it('keeps the existing credential when the secret field is left blank', () => {
    const { connections, security } = makeServices()
    connections.save({
      type: 'jira',
      baseUrl: 'https://jira.internal',
      username: 'a',
      secret: 'PAT-0123456789',
      enabled: true,
    })

    connections.save({
      type: 'jira',
      baseUrl: 'https://jira-new.internal',
      username: 'a',
      enabled: true,
    })

    expect(connections.get('jira')?.baseUrl).toBe('https://jira-new.internal')
    expect(security.readCredential('jira')).toBe('PAT-0123456789')
  })

  it('requires a credential the first time', () => {
    const { connections } = makeServices()
    expect(() =>
      connections.save({
        type: 'jira',
        baseUrl: 'https://jira.internal',
        username: 'a',
        enabled: true,
      }),
    ).toThrow(expect.objectContaining({ code: ERROR_CODES.VALIDATION_FAILED }))
  })

  it('requires a username for Atlassian but not for LiteLLM', () => {
    const { connections } = makeServices()
    expect(() =>
      connections.save({
        type: 'confluence',
        baseUrl: 'https://confluence.internal',
        username: '',
        secret: 'PAT-0123456789',
        enabled: true,
      }),
    ).toThrow(expect.objectContaining({ code: ERROR_CODES.VALIDATION_FAILED }))

    expect(
      connections.save({
        type: 'litellm',
        baseUrl: 'https://litellm.internal',
        username: null,
        secret: 'sk-0123456789abcdef',
        enabled: true,
      }).username,
    ).toBeNull()
  })

  it('deletes the credential together with the connection', () => {
    const { connections, security } = makeServices()
    connections.save({
      type: 'jira',
      baseUrl: 'https://jira.internal',
      username: 'a',
      secret: 'PAT-0123456789',
      enabled: true,
    })

    connections.delete('jira')

    expect(connections.get('jira')).toBeNull()
    expect(security.hasCredential('jira')).toBe(false)
  })

  it('registers a saved credential with the redactor immediately', () => {
    const { connections, redactor } = makeServices()
    const pat = 'PAT-can-duoc-che-0123456789'
    connections.save({
      type: 'jira',
      baseUrl: 'https://jira.internal',
      username: 'a',
      secret: pat,
      enabled: true,
    })

    expect(redactor.redactString(`token=${pat}`)).not.toContain(pat)
  })
})

describe('ModelService', () => {
  it('resolves the default model when the conversation has none', () => {
    const { models } = makeServices()
    models.add({ provider: 'litellm', modelId: 'model-a', displayName: 'A', contextWindowTokens: 128_000 })
    expect(models.resolveForConversation(null, null).modelId).toBe('model-a')
  })

  it('fails loudly when a conversation references a removed model', () => {
    const { models } = makeServices()
    const a = models.add({ provider: 'litellm', modelId: 'model-a', displayName: 'A', contextWindowTokens: 128_000 })
    models.add({ provider: 'litellm', modelId: 'model-b', displayName: 'B', contextWindowTokens: 128_000 })
    models.remove(a.id)

    // Không âm thầm chuyển sang model-b: người dùng phải biết model đã đổi.
    expect(() => models.resolveForConversation('model-a', 'litellm')).toThrow(
      expect.objectContaining({ code: ERROR_CODES.MODEL_NOT_CONFIGURED }),
    )
  })

  it('reports MODEL_NOT_CONFIGURED when nothing is configured at all', () => {
    const { models } = makeServices()
    expect(() => models.resolveForConversation(null, null)).toThrow(
      expect.objectContaining({ code: ERROR_CODES.MODEL_NOT_CONFIGURED }),
    )
  })

  it('marks models verified against GET /v1/models', async () => {
    const { models } = makeServices()
    models.add({ provider: 'litellm', modelId: 'model-a', displayName: 'A', contextWindowTokens: 128_000 })
    models.add({ provider: 'litellm', modelId: 'model-khong-ton-tai', displayName: 'B', contextWindowTokens: 128_000 })

    const result = await models.verifyAll('litellm', {
      listModels: () => Promise.resolve(['model-a', 'model-c']),
    } as never)

    expect(result.verified).toEqual(['model-a'])
    expect(result.unknown).toEqual(['model-khong-ton-tai'])
    expect(models.list().find((m) => m.modelId === 'model-a')?.verified).toBe(true)
  })

  it('leaves models unverified — not invalid — when the endpoint is unavailable', async () => {
    const { models } = makeServices()
    models.add({ provider: 'litellm', modelId: 'model-a', displayName: 'A', contextWindowTokens: 128_000 })

    const result = await models.verifyAll('litellm', {
      listModels: () => Promise.reject(new Error('404')),
    } as never)

    expect(result.verified).toEqual([])
    expect(result.unknown).toEqual(['model-a'])
    expect(models.list()[0]?.verified).toBe(false)
  })
})

describe('SettingsService — policy precedence', () => {
  it('lets the organisation force a feature off regardless of user choice', () => {
    const { settings } = makeServices({ forcedFeatures: { jiraCreate: false } })
    const updated = settings.update({ features: { jiraCreate: true } as never })
    expect(updated.features.jiraCreate).toBe(false)
    expect(settings.lockedFeatureNames()).toContain('jiraCreate')
  })

  it('caps history retention at the organisation limit', () => {
    const { settings } = makeServices({ maxHistoryRetentionDays: 90 })
    expect(settings.update({ historyRetentionDays: 3650 }).historyRetentionDays).toBe(90)
    // 0 = giữ mãi, phải bị kéo xuống trần chứ không được coi là "nhỏ nhất".
    expect(settings.update({ historyRetentionDays: 0 }).historyRetentionDays).toBe(90)
  })

  it('keeps user retention when it is below the cap', () => {
    const { settings } = makeServices({ maxHistoryRetentionDays: 180 })
    expect(settings.update({ historyRetentionDays: 30 }).historyRetentionDays).toBe(30)
  })

  it('persists settings across service instances', () => {
    const { settings, repo, store } = makeServices()
    settings.update({ maxFileSizeMb: 10 })

    const { logger } = { logger: new Logger({ sink: new MemorySink() }) }
    const reloaded = new SettingsService(repo, store.profileId, DEFAULT_ORG_POLICY, logger)
    expect(reloaded.get().maxFileSizeMb).toBe(10)
  })
})

describe('loadOrgPolicy', () => {
  it('falls back to defaults for an invalid policy file rather than refusing to start', () => {
    const logger = new Logger({ sink: new MemorySink() })
    expect(loadOrgPolicy({ allowedDomains: 'không phải mảng' }, logger)).toEqual(DEFAULT_ORG_POLICY)
    expect(loadOrgPolicy(null, logger)).toEqual(DEFAULT_ORG_POLICY)
  })

  it('reads a valid policy', () => {
    const logger = new Logger({ sink: new MemorySink() })
    expect(loadOrgPolicy({ allowedDomains: ['*.corp.local'] }, logger).allowedDomains).toEqual([
      '*.corp.local',
    ])
  })
})
