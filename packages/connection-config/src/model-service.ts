import {
  ERROR_CODES,
  NexaError,
  type LlmProvider,
  type ModelConfig,
} from '@nexa/shared-types'
import type { ConfigRepository } from '@nexa/local-store'
import { newRequestId, type Logger } from '@nexa/observability'
import type { OpenAiCompatibleClient } from '@nexa/llm-client'

/**
 * Danh sách model cục bộ (EPIC-03).
 *
 * §4.1: "Người dùng lưu danh sách model cục bộ và chọn model — LiteLLM quyết định key có được
 * gọi model đó hay không." Nghĩa là Nexa KHÔNG được coi danh sách này là quyền: nó chỉ là
 * tiện ích chọn nhanh. Quyền thực tế do LiteLLM áp khi request tới.
 */
export class ModelService {
  constructor(
    private readonly repo: ConfigRepository,
    private readonly profileId: string,
    private readonly logger: Logger,
  ) {}

  list(): ModelConfig[] {
    return this.repo.listModels(this.profileId)
  }

  add(input: {
    provider: LlmProvider
    modelId: string
    displayName: string
    contextWindowTokens: number
  }): ModelConfig {
    const modelId = input.modelId.trim()
    if (modelId === '') {
      throw new NexaError(ERROR_CODES.VALIDATION_FAILED, { safeDetail: 'empty model id' })
    }
    return this.repo.addModel(this.profileId, {
      provider: input.provider,
      modelId,
      displayName: input.displayName.trim() === '' ? modelId : input.displayName.trim(),
      contextWindowTokens: input.contextWindowTokens,
    })
  }

  remove(id: string): void {
    this.repo.removeModel(this.profileId, id)
  }

  setDefault(id: string): void {
    this.repo.setDefaultModel(this.profileId, id)
  }

  getDefault(): ModelConfig | null {
    return this.repo.getDefaultModel(this.profileId)
  }

  /**
   * Model dùng cho một hội thoại: model đã gán > model mặc định > lỗi rõ ràng.
   *
   * Trả về cả `contextWindowTokens` vì AgentRuntime cần nó để cắt context, và nó là thuộc tính
   * người dùng khai chứ không phải thứ LiteLLM cho biết.
   */
  resolveForConversation(
    conversationModelId: string | null,
    conversationProvider: LlmProvider | null,
  ): ModelConfig {
    if (conversationModelId !== null) {
      // Provider có thể null với hội thoại tạo trước migration v2; khi đó suy ra 'litellm'
      // vì đó là provider duy nhất tồn tại lúc ấy.
      const provider = conversationProvider ?? 'litellm'
      const found = this.repo.findModelByModelId(this.profileId, provider, conversationModelId)
      if (found !== null) return found
      // Model từng dùng nay đã bị xoá khỏi danh sách. Nói rõ thay vì âm thầm đổi model —
      // người dùng có thể đang hỏi tiếp trong một hội thoại nhạy cảm.
      throw new NexaError(ERROR_CODES.MODEL_NOT_CONFIGURED, {
        safeDetail: `conversation references "${conversationModelId}" on provider "${provider}" which is no longer configured`,
      })
    }

    const fallback = this.getDefault()
    if (fallback === null) {
      throw new NexaError(ERROR_CODES.MODEL_NOT_CONFIGURED, {
        safeDetail: 'no models configured',
      })
    }
    return fallback
  }

  /**
   * Đối chiếu danh sách cục bộ với `GET /v1/models` (§9.1 "hỗ trợ người dùng tham khảo model
   * khả dụng").
   *
   * Gateway không bật endpoint đó thì bỏ qua im lặng — không đánh dấu model là sai, vì ta
   * không có bằng chứng gì cả.
   */
  async verifyAll(
    provider: LlmProvider,
    client: OpenAiCompatibleClient,
  ): Promise<{ verified: string[]; unknown: string[] }> {
    // Chỉ đối chiếu model CỦA provider này. Model của provider khác không nằm trong danh sách
    // mà endpoint này trả về, nên đánh dấu chúng "không tìm thấy" là kết luận sai.
    const scope = this.repo.listModelsByProvider(this.profileId, provider)

    let remote: string[]
    try {
      remote = await client.listModels({ requestId: newRequestId() })
    } catch (error) {
      this.logger.warn('model-verification-skipped', {
        provider,
        errorCode: NexaError.wrap(error).code,
      })
      return { verified: [], unknown: scope.map((m) => m.modelId) }
    }

    const available = new Set(remote)
    const verified: string[] = []
    const unknownModels: string[] = []

    for (const model of scope) {
      const ok = available.has(model.modelId)
      this.repo.setModelVerified(model.id, ok)
      ;(ok ? verified : unknownModels).push(model.modelId)
    }

    this.logger.info('models-verified', {
      provider,
      verifiedCount: verified.length,
      unknownCount: unknownModels.length,
    })
    return { verified, unknown: unknownModels }
  }
}
