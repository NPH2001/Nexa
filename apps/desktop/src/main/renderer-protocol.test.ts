import { beforeEach, describe, expect, it, vi } from 'vitest'

const electronMock = vi.hoisted(() => ({
  registerSchemesAsPrivileged: vi.fn(),
  handle: vi.fn(),
  fetch: vi.fn(),
}))

vi.mock('electron', () => ({
  protocol: {
    registerSchemesAsPrivileged: electronMock.registerSchemesAsPrivileged,
    handle: electronMock.handle,
  },
  net: { fetch: electronMock.fetch },
}))

const { RENDERER_ENTRY_URL, registerRendererProtocol, resolveRendererPath } =
  await import('./renderer-protocol.js')

beforeEach(() => {
  electronMock.handle.mockReset()
  electronMock.fetch.mockReset()
})

describe('renderer protocol', () => {
  it('đăng ký scheme secure/standard trước ready', () => {
    expect(electronMock.registerSchemesAsPrivileged).toHaveBeenCalledWith([
      expect.objectContaining({
        scheme: 'nexa',
        privileges: expect.objectContaining({ standard: true, secure: true }),
      }),
    ])
  })

  it('chỉ resolve asset bên trong renderer root', () => {
    expect(resolveRendererPath('/app/renderer', RENDERER_ENTRY_URL)).toBe(
      '/app/renderer/index.html',
    )
    expect(resolveRendererPath('/app/renderer', 'nexa://app/assets/app.js')).toBe(
      '/app/renderer/assets/app.js',
    )
    expect(resolveRendererPath('/app/renderer', 'nexa://other/index.html')).toBeNull()
    expect(resolveRendererPath('/app/renderer', 'nexa://app/..%2Fsecret.txt')).toBeNull()
    expect(resolveRendererPath('/app/renderer', 'file:///etc/passwd')).toBeNull()
  })

  it('trả 404 cho request ngoài boundary mà không chạm filesystem', async () => {
    registerRendererProtocol('/app/renderer')
    const handler = electronMock.handle.mock.calls[0]?.[1] as
      ((request: { url: string }) => Promise<Response> | Response) | undefined

    const response = await handler?.({ url: 'nexa://app/..%2Fsecret.txt' })

    expect(response?.status).toBe(404)
    expect(electronMock.fetch).not.toHaveBeenCalled()
  })
})
