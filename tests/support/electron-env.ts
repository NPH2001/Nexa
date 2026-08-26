/**
 * Codex, IDE extensions and process.fork helpers may set ELECTRON_RUN_AS_NODE in their parent
 * shell. Passing it through would launch Electron as plain Node.js, so Playwright's Chromium
 * switches are rejected before the app starts.
 */
export function electronEnvironment(overrides: NodeJS.ProcessEnv = {}): Record<string, string> {
  const environment: Record<string, string> = {}
  for (const [name, value] of Object.entries({ ...process.env, ...overrides })) {
    if (value !== undefined) environment[name] = value
  }
  delete environment['ELECTRON_RUN_AS_NODE']
  return environment
}
