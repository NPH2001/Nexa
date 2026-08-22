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

/**
 * Tên header mà gateway MCP Atlassian remote nhận credential (ADR-0005).
 *
 * ⚠️ CHƯA ĐƯỢC CHỐT CHUNG — như `CREDENTIAL_ENV_KEYS` ở trên, đây là quy ước của MỘT gateway cụ
 * thể (đã xác nhận hoạt động qua một cấu hình Kilo Code thật), không phải chuẩn MCP. Gateway
 * khác có thể dùng tên header khác — đổi ở đúng bảng này, không phải sửa code gọi nó.
 */
export const GATEWAY_HEADER_KEYS = {
  mcpServers: 'x-mcp-servers',
  jiraUrl: 'x-mcp-atlassian-x-atlassian-jira-url',
  jiraUsername: 'x-mcp-atlassian-x-atlassian-jira-username',
  jiraToken: 'x-mcp-atlassian-x-atlassian-jira-personal-token',
  jiraSslVerify: 'x-mcp-atlassian-x-atlassian-jira-ssl-verify',
  confluenceUrl: 'x-mcp-atlassian-x-atlassian-confluence-url',
  confluenceUsername: 'x-mcp-atlassian-x-atlassian-confluence-username',
  confluenceToken: 'x-mcp-atlassian-x-atlassian-confluence-personal-token',
  confluenceSslVerify: 'x-mcp-atlassian-x-atlassian-confluence-ssl-verify',
} as const

/**
 * Dựng header HTTP cho gateway.
 *
 * Cùng nguyên tắc như `buildCredentialEnv`: chỉ hàm này được chạm vào giá trị bearer
 * token/PAT, nhận credential đã giải mã, trả về object dùng một lần rồi bỏ.
 *
 * `*-ssl-verify` mặc định là `'true'` — §11.2 "validate certificate". Chỉ thành `'false'` khi
 * người dùng TỰ tích `mcpGatewaySkipAtlassianTlsVerify` trong Settings; không có biến môi trường
 * hay policy file nào bật được nó (xem JSDoc của cờ đó và ADR-0008).
 *
 * Lý do có đường thoát này, dù §11.2 nói ngược: hạ tầng thật đã gặp có Jira/Confluence ký bằng
 * CA nội bộ mà container `mcp-atlassian` không tin, và khi đó MỌI tool Jira/Confluence đều lỗi
 * với một câu nói về token chứ không nói về chứng chỉ — không dùng được gì cả. Đường thoát này
 * mặc định tắt, phải người dùng tự bật, và cách sửa đúng vẫn là cài CA nội bộ ở phía gateway.
 */
export function buildGatewayHeaders(credentials: {
  readonly gatewayToken: string
  readonly jira?: AtlassianCredentials['jira']
  readonly confluence?: AtlassianCredentials['confluence']
  /** Mặc định `false` ⇒ gửi `ssl-verify: 'true'`. Bỏ qua xác thực là lựa chọn phải nói ra. */
  readonly skipTlsVerify?: boolean
}): Record<string, string> {
  const sslVerify = credentials.skipTlsVerify === true ? 'false' : 'true'
  const headers: Record<string, string> = {
    authorization: `Bearer ${credentials.gatewayToken}`,
    [GATEWAY_HEADER_KEYS.mcpServers]: 'atlassian',
  }
  if (credentials.jira !== undefined) {
    headers[GATEWAY_HEADER_KEYS.jiraUrl] = credentials.jira.baseUrl
    headers[GATEWAY_HEADER_KEYS.jiraUsername] = credentials.jira.username
    headers[GATEWAY_HEADER_KEYS.jiraToken] = credentials.jira.token
    headers[GATEWAY_HEADER_KEYS.jiraSslVerify] = sslVerify
  }
  if (credentials.confluence !== undefined) {
    headers[GATEWAY_HEADER_KEYS.confluenceUrl] = credentials.confluence.baseUrl
    headers[GATEWAY_HEADER_KEYS.confluenceUsername] = credentials.confluence.username
    headers[GATEWAY_HEADER_KEYS.confluenceToken] = credentials.confluence.token
    headers[GATEWAY_HEADER_KEYS.confluenceSslVerify] = sslVerify
  }
  return headers
}

/** Tên header chứa secret — dùng để khẳng định trong test rằng chúng không lọt ra ngoài. */
export const GATEWAY_SECRET_HEADER_KEYS: readonly string[] = [
  'authorization',
  GATEWAY_HEADER_KEYS.jiraToken,
  GATEWAY_HEADER_KEYS.confluenceToken,
]
