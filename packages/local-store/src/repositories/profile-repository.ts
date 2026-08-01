import { randomUUID } from 'node:crypto'
import { userInfo } from 'node:os'
import type { Profile } from '@nexa/shared-types'
import type { LocalStore } from '../store.js'

/**
 * §8.1 `profiles`: "Một profile theo tài khoản Windows; không phải tài khoản đăng nhập Nexa."
 *
 * Nexa không có đăng nhập riêng — danh tính là tài khoản OS đang chạy app. Trên Windows,
 * secure storage cũng gắn với chính tài khoản đó (DPAPI CurrentUser), nên hai thứ luôn khớp.
 */
export class ProfileRepository {
  constructor(private readonly store: LocalStore) {}

  /** Định danh tài khoản OS. Trên Windows nên truyền SID vào; xem OPEN-QUESTIONS B5. */
  static currentOsAccountId(explicitSid?: string): string {
    if (explicitSid !== undefined && explicitSid !== '') return explicitSid
    const info = userInfo()
    return `${process.platform}:${String(info.uid)}:${info.username}`
  }

  ensure(osAccountId: string, displayName: string): Profile {
    const existing = this.findByOsAccount(osAccountId)
    if (existing !== null) return existing

    const profile: Profile = {
      id: randomUUID(),
      osAccountId,
      displayName,
      createdAt: this.store.nowIso(),
    }
    this.store.handle
      .prepare(
        'INSERT INTO profiles (id, os_account_id, display_name, created_at) VALUES (?, ?, ?, ?)',
      )
      .run(profile.id, profile.osAccountId, profile.displayName, profile.createdAt)
    this.store.log.info('profile-created', { profileId: profile.id })
    return profile
  }

  findByOsAccount(osAccountId: string): Profile | null {
    const row = this.store.handle
      .prepare('SELECT * FROM profiles WHERE os_account_id = ?')
      .get(osAccountId)
    return row === undefined ? null : mapProfile(row)
  }

  list(): Profile[] {
    return this.store.handle
      .prepare('SELECT * FROM profiles ORDER BY created_at')
      .all()
      .map(mapProfile)
  }
}

function mapProfile(row: Record<string, unknown>): Profile {
  return {
    id: String(row['id']),
    osAccountId: String(row['os_account_id']),
    displayName: String(row['display_name']),
    createdAt: String(row['created_at']),
  }
}
