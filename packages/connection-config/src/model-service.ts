import { ERROR_CODES, NexaError, type ModelConfig } from '@nexa/shared-types'
import type { ConfigRepository } from '@nexa/local-store'
import { newRequestId, type Logger } from '@nexa/observability'
import type { LiteLlmClient } from '@nexa/llm-client'

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

  add(input: { modelId: string; displayName: string; contextWindowTokens: number }): ModelConfig {
    const modelId = input.modelId.trim()
    if (modelId === '') {
      throw new NexaError(ERROR_CODES.VALIDATION_FAILED, { safeDetail: 'empty model id' })
    }
    return this.repo.addModel(this.profileId, {
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
  resolveForConversation(conversationModelId: string | null): ModelConfig {
    if (conversationModelId !== null) {
      const found = this.repo.findModelByModelId(this.profileId, conversationModelId)
      if (found !== null) return found
      // Model từng dùng nay đã bị xoá khỏi danh sách. Nói rõ thay vì âm thầm đổi model —
      // người dùng có thể đang hỏi tiếp trong một hội thoại nhạy cảm.
      throw new NexaError(ERROR_CODES.MODEL_NOT_CONFIGURED, {
        safeDetail: `conversation references "${conversationModelId}" which is no longer configured`,
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
  async verifyAll(client: LiteLlmClient): Promise<{ verified: string[]; unknown: string[] }> {
    let remote: string[]
    try {
      remote = await client.listModels({ requestId: newRequestId() })
    } catch (error) {
      this.logger.warn('model-verification-skipped', {
        errorCode: NexaError.wrap(error).code,
      })
      return { verified: [], unknown: this.list().map((m) => m.modelId) }
    }

    const available = new Set(remote)
    const verified: string[] = []
    const unknownModels: string[] = []

    for (const model of this.list()) {
      const ok = available.has(model.modelId)
      this.repo.setModelVerified(model.id, ok)
      ;(ok ? verified : unknownModels).push(model.modelId)
    }

    this.logger.info('models-verified', {
      verifiedCount: verified.length,
      unknownCount: unknownModels.length,
    })
    return { verified, unknown: unknownModels }
  }
}
