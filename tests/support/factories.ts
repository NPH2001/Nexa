import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Logger, MemorySink, Redactor } from '@nexa/observability'
import { generateMasterKey, decryptField, encryptField, type MasterKey } from '@nexa/security'
import { LocalStore, ProfileRepository, type FieldCipher } from '@nexa/local-store'

/** Cipher thật (AES-256-GCM), khoá sinh trong RAM — không cần secure storage để test. */
export function testCipher(key: MasterKey = generateMasterKey()): FieldCipher & { key: MasterKey } {
  return {
    key,
    encrypt: (ctx, pt) => encryptField(key, ctx, pt),
    decrypt: (ctx, ct) => decryptField(key, ctx, ct),
  }
}

export function testLogger(): { logger: Logger; sink: MemorySink; redactor: Redactor } {
  const sink = new MemorySink()
  const redactor = new Redactor()
  return { logger: new Logger({ sink, redactor, minLevel: 'debug' }), sink, redactor }
}

export interface TempStore {
  readonly store: LocalStore
  readonly profileId: string
  readonly sink: MemorySink
  readonly redactor: Redactor
  readonly dir: string
  readonly dbPath: string
  cleanup(): void
}

/**
 * Mở một LocalStore thật trên đĩa tạm.
 *
 * Dùng file thật chứ không `:memory:` để test luôn chạm được đúng đường đi của WAL, pragma và
 * migration như bản phát hành.
 */
export function makeTempStore(
  opts: { now?: () => Date; cipher?: FieldCipher } = {},
): TempStore {
  const dir = mkdtempSync(join(tmpdir(), 'nexa-test-'))
  const dbPath = join(dir, 'nexa.db')
  const { logger, sink, redactor } = testLogger()

  const store = LocalStore.open({
    path: dbPath,
    cipher: opts.cipher ?? testCipher(),
    logger,
    // Máy CI/dev có thể không build được native module; node:sqlite luôn có sẵn từ Node 22.5+.
    driver: 'node:sqlite',
    ...(opts.now !== undefined ? { now: opts.now } : {}),
  })

  const profile = new ProfileRepository(store).ensure('test:account', 'Tester')

  return {
    store,
    profileId: profile.id,
    sink,
    redactor,
    dir,
    dbPath,
    cleanup: () => {
      store.close()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

/** Đồng hồ giả tiến theo bước cố định — để test retention và TTL không phụ thuộc thời gian thật. */
export function fakeClock(startIso = '2026-08-01T00:00:00.000Z'): {
  now: () => Date
  advance(ms: number): void
  set(iso: string): void
} {
  let current = new Date(startIso).getTime()
  return {
    now: () => new Date(current),
    advance: (ms) => {
      current += ms
    },
    set: (iso) => {
      current = new Date(iso).getTime()
    },
  }
}
