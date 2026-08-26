import { describe, expect, it, vi } from 'vitest'
import { commitThenRefresh } from './committed-mutation.js'

describe('commitThenRefresh', () => {
  it('không báo xoá hội thoại thất bại khi chỉ bước đọc lại bị lỗi', async () => {
    const onCommitted = vi.fn()
    const onRefreshError = vi.fn()
    const refreshError = new Error('list failed')

    await expect(
      commitThenRefresh({
        commit: vi.fn().mockResolvedValue({ ok: true }),
        onCommitted,
        refresh: vi.fn().mockRejectedValue(refreshError),
        onRefreshError,
      }),
    ).resolves.toBeUndefined()

    expect(onCommitted).toHaveBeenCalledOnce()
    expect(onRefreshError).toHaveBeenCalledWith(refreshError)
  })

  it('vẫn ném lỗi khi xoá kết nối chưa commit', async () => {
    const commitError = new Error('delete failed')
    const onCommitted = vi.fn()
    const refresh = vi.fn()

    await expect(
      commitThenRefresh({
        commit: vi.fn().mockRejectedValue(commitError),
        onCommitted,
        refresh,
        onRefreshError: vi.fn(),
      }),
    ).rejects.toBe(commitError)

    expect(onCommitted).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('cập nhật model cục bộ trước khi đọc lại danh sách', async () => {
    const calls: string[] = []

    await commitThenRefresh({
      commit: async () => calls.push('commit'),
      onCommitted: () => calls.push('local-update'),
      refresh: async () => calls.push('refresh'),
      onRefreshError: vi.fn(),
    })

    expect(calls).toEqual(['commit', 'local-update', 'refresh'])
  })
})
