import type { McpServerSpec } from '@nexa/shared-types'

/**
 * Cấu hình mặc định để khởi chạy MCP Atlassian.
 *
 * ⚠️ CHƯA ĐƯỢC CHỐT — xem docs/OPEN-QUESTIONS.md A4. Giá trị dưới đây theo quy ước của
 * package `mcp-atlassian` (bản Python, phổ biến nhất cho Jira/Confluence Server/DC), nhưng
 * chưa ai kiểm chứng với hạ tầng nội bộ. Đổi package = đổi đúng object này, không phải sửa code.
 */
export const DEFAULT_ATLASSIAN_MCP_SPEC: McpServerSpec = {
  command: 'uvx',
  args: ['mcp-atlassian'],
  env: {},
  startupTimeoutMs: 30_000,
}

/** Tên biến môi trường mà server con nhận credential. Cùng lý do như trên: quy ước, chưa chốt. */
export const CREDENTIAL_ENV_KEYS = {
  jiraUrl: 'JIRA_URL',
  jiraUsername: 'JIRA_USERNAME',
  jiraToken: 'JIRA_PERSONAL_TOKEN',
  confluenceUrl: 'CONFLUENCE_URL',
  confluenceUsername: 'CONFLUENCE_USERNAME',
  confluenceToken: 'CONFLUENCE_PERSONAL_TOKEN',
} as const

export interface AtlassianCredentials {
  readonly jira?: { readonly baseUrl: string; readonly username: string; readonly token: string }
  readonly confluence?: {
    readonly baseUrl: string
    readonly username: string
    readonly token: string
  }
}

/**
 * Dựng environment cho process con.
 *
 * Chỉ có hàm này được phép chạm vào giá trị PAT. Nó nhận credential đã giải mã, trả về một
 * object dùng một lần rồi bỏ — không lưu ở đâu, không log (§6 "Không lưu/không gửi secret").
 */
export function buildCredentialEnv(
  spec: McpServerSpec,
  credentials: AtlassianCredentials,
): Record<string, string> {
  const env: Record<string, string> = { ...spec.env }

  if (credentials.jira !== undefined) {
    env[CREDENTIAL_ENV_KEYS.jiraUrl] = credentials.jira.baseUrl
    env[CREDENTIAL_ENV_KEYS.jiraUsername] = credentials.jira.username
    env[CREDENTIAL_ENV_KEYS.jiraToken] = credentials.jira.token
  }
  if (credentials.confluence !== undefined) {
    env[CREDENTIAL_ENV_KEYS.confluenceUrl] = credentials.confluence.baseUrl
    env[CREDENTIAL_ENV_KEYS.confluenceUsername] = credentials.confluence.username
    env[CREDENTIAL_ENV_KEYS.confluenceToken] = credentials.confluence.token
  }
  return env
}

/** Tên biến chứa secret — dùng để khẳng định trong test rằng chúng không lọt ra ngoài. */
export const SECRET_ENV_KEYS: readonly string[] = [
  CREDENTIAL_ENV_KEYS.jiraToken,
  CREDENTIAL_ENV_KEYS.confluenceToken,
]
