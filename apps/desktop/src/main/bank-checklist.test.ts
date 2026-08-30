import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatRequest, ChatResult } from '@nexa/llm-client'
import { BankChecklistRepository } from '@nexa/local-store'
import { DEFAULT_APP_SETTINGS } from '@nexa/shared-types'
import type { ProcessedDocument } from '@nexa/document-processor'
import { makeTempStore, type TempStore } from '../../../../tests/support/factories.js'
import {
  BankChecklistService,
  MAX_BANK_EXTRACTION_ATTEMPTS,
  loadBankChecklistTemplates,
  type BankExtractionLlm,
} from './bank-checklist.js'

let ctx: TempStore | null = null
afterEach(() => {
  ctx?.cleanup()
  ctx = null
})

class FakeLlm implements BankExtractionLlm {
  readonly requests: ChatRequest[] = []
  constructor(private readonly replies: string[]) {}

  async complete(request: ChatRequest): Promise<ChatResult> {
    this.requests.push(request)
    return {
      text: this.replies[Math.min(this.requests.length - 1, this.replies.length - 1)] ?? '',
      toolCalls: [],
      finishReason: 'stop',
    }
  }
}

const processedDocument: ProcessedDocument = {
  fileName: 'identity.pdf',
  kind: 'pdf',
  sizeBytes: 100,
  sourcePathHash: 'a'.repeat(64),
  text: 'Họ tên Nguyễn Văn A',
  chunks: [
    {
      text: 'Họ tên Nguyễn Văn A',
      index: 0,
      locationLabel: 'trang 1',
      estimatedTokens: 8,
    },
  ],
  charCount: 20,
  estimatedTokens: 8,
  truncated: false,
}

function makeService(llm: BankExtractionLlm, provider: 'litellm' | 'openai' = 'litellm') {
  ctx = makeTempStore()
  const repository = new BankChecklistRepository(ctx.store)
  const templates = loadBankChecklistTemplates(
    () => ({
      templates: [
        {
          id: 'retail-kyc-basic',
          version: '1.0',
          name: 'KYC',
          caseType: 'retail_kyc',
          requirements: [
            {
              id: 'identity-document',
              label: 'Giấy tờ định danh',
              acceptedDocumentTypes: ['national_id'],
              requiredFields: ['full_name'],
            },
          ],
          crossChecks: [],
        },
      ],
    }),
    ctx.store.log,
  )
  const build = vi.fn(() => llm)
  const service = new BankChecklistService({
    repository,
    templates,
    resolveModel: () => ({ modelId: 'extractor', provider }),
    buildLlmClient: build,
    settings: () => DEFAULT_APP_SETTINGS,
    logger: ctx.store.log,
    now: () => new Date('2026-08-30T00:00:00.000Z'),
  })
  return { service, repository, build }
}

describe('BankChecklistService', () => {
  it('chỉ nhận output trích xuất, từ chối status do model tự kết luận rồi nói lại', async () => {
    const invalid = JSON.stringify({
      documentType: 'national_id',
      fields: [],
      needsReview: false,
      status: 'passed',
    })
    const valid = JSON.stringify({
      documentType: 'national_id',
      fields: [
        { key: 'full_name', value: 'Nguyễn Văn A', sourceLabel: 'trang 1', needsReview: false },
      ],
      needsReview: false,
    })
    const llm = new FakeLlm([invalid, valid])
    const { service } = makeService(llm)

    const output = await service.extract(processedDocument)
    expect(output).not.toHaveProperty('status')
    expect(llm.requests).toHaveLength(2)
  })

  it('từ chối provider ngoài LiteLLM trước khi dựng client', async () => {
    const llm = new FakeLlm([])
    const { service, build } = makeService(llm, 'openai')
    await expect(service.extract(processedDocument)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    })
    expect(build).not.toHaveBeenCalled()
  })

  it('dừng sau đúng số lần output sai schema', async () => {
    const llm = new FakeLlm(['không phải JSON'])
    const { service } = makeService(llm)
    await expect(service.extract(processedDocument)).rejects.toThrow()
    expect(llm.requests).toHaveLength(MAX_BANK_EXTRACTION_ATTEMPTS)
  })

  it('không gửi bản scan sang model và đánh dấu để người kiểm tra', async () => {
    const llm = new FakeLlm([])
    const { service, build } = makeService(llm)
    const output = await service.extract({ ...processedDocument, suspectedScan: true })
    expect(output).toEqual({ documentType: 'other', fields: [], needsReview: true })
    expect(build).not.toHaveBeenCalled()
  })
})
