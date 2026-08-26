import { describe, expect, it } from 'vitest'
import { electronEnvironment } from './electron-env.js'

describe('electronEnvironment', () => {
  it('không truyền ELECTRON_RUN_AS_NODE vào app Electron', () => {
    const environment = electronEnvironment({
      ELECTRON_RUN_AS_NODE: '1',
      NEXA_TEST_MARKER: 'kept',
    })

    expect(environment['ELECTRON_RUN_AS_NODE']).toBeUndefined()
    expect(environment['NEXA_TEST_MARKER']).toBe('kept')
  })
})
