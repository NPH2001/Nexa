/** Provider LLM được Nexa hỗ trợ. */
export const LLM_PROVIDERS = ['litellm', 'openai'] as const
export type LlmProvider = (typeof LLM_PROVIDERS)[number]

/** Đích model có thể được gán cho một hội thoại, gồm cả phiên ChatGPT do Codex quản lý. */
export const CHAT_MODEL_PROVIDERS = [...LLM_PROVIDERS, 'chatgpt'] as const
export type ChatModelProvider = (typeof CHAT_MODEL_PROVIDERS)[number]

/** Provider nào nằm ngoài tầm kiểm soát của tổ chức. */
export function isExternalProvider(provider: ChatModelProvider): boolean {
  return provider !== 'litellm'
}

/** Phần tối thiểu của OrgPolicy cần để quyết định provider; giữ file này không phụ thuộc Zod. */
export interface DirectProviderPolicy {
  readonly allowDirectOpenAi: boolean
}

/** Policy tổ chức được kiểm tra ở cả UI và mọi execution boundary trong main process. */
export function isProviderAllowedByPolicy(
  provider: ChatModelProvider,
  policy: DirectProviderPolicy,
): boolean {
  return (provider !== 'openai' && provider !== 'chatgpt') || policy.allowDirectOpenAi
}

/** Tên hiển thị cho người dùng. */
export const PROVIDER_LABELS: Readonly<Record<ChatModelProvider, string>> = {
  litellm: 'LiteLLM (nội bộ)',
  openai: 'OpenAI / ChatGPT (bên ngoài)',
  chatgpt: 'ChatGPT Plus / Codex (bên ngoài)',
}
