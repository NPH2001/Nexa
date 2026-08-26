import { isAbsolute, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { net, protocol } from 'electron'

export const RENDERER_SCHEME = 'nexa'
export const RENDERER_ORIGIN = `${RENDERER_SCHEME}://app`
export const RENDERER_ENTRY_URL = `${RENDERER_ORIGIN}/index.html`

// Electron yêu cầu khai báo scheme trước sự kiện ready. Module này được import tĩnh từ index.ts.
protocol.registerSchemesAsPrivileged([
  {
    scheme: RENDERER_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: false },
  },
])

/** Chỉ phục vụ file nằm trong đúng renderer root; mọi host/path khác trả 404. */
export function registerRendererProtocol(rendererRoot: string): void {
  protocol.handle(RENDERER_SCHEME, (request) => {
    const filePath = resolveRendererPath(rendererRoot, request.url)
    if (filePath === null) {
      return new Response('Not found', {
        status: 404,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      })
    }
    return net.fetch(pathToFileURL(filePath).toString())
  })
}

export function resolveRendererPath(rendererRoot: string, requestUrl: string): string | null {
  let url: URL
  try {
    url = new URL(requestUrl)
  } catch {
    return null
  }
  if (
    url.protocol !== `${RENDERER_SCHEME}:` ||
    url.host !== 'app' ||
    url.username !== '' ||
    url.password !== ''
  ) {
    return null
  }

  let requestPath: string
  try {
    requestPath = decodeURIComponent(url.pathname).replace(/^\/+/, '')
  } catch {
    return null
  }
  if (requestPath.includes('\0')) return null

  const root = resolve(rendererRoot)
  const target = resolve(root, requestPath === '' ? 'index.html' : requestPath)
  const relativePath = relative(root, target)
  if (relativePath === '' || relativePath.startsWith('..') || isAbsolute(relativePath)) return null
  return target
}
