import { afterEach, describe, expect, it } from 'vitest'
import type { ChatRequest, ChatResult } from '@nexa/llm-client'
import { BaDocumentRepository } from '@nexa/local-store'
import { DEFAULT_APP_SETTINGS } from '@nexa/shared-types'
import { BaExtractionJob, MAX_EXTRACTION_ATTEMPTS, type ExtractionLlm } from './ba-extraction.js'
import { makeTempStore, type TempStore } from '../../../../tests/support/factories.js'

let ctx: TempStore | null = null
afterEach(() => {
  ctx?.cleanup()
  ctx = null
})

class FakeLlm implements ExtractionLlm {
  readonly requests: ChatRequest[] = []
  constructor(private readonly replies: string[]) {}

  async complete(request: ChatRequest): Promise<ChatResult> {
    this.requests.push(request)
    const reply = this.replies[Math.min(this.requests.length - 1, this.replies.length - 1)] ?? ''
    return { text: reply, toolCalls: [], finishReason: 'stop' }
  }
}

function useCaseJson(id: string, name: string): string {
  return JSON.stringify({
    items: [
      {
        itemType: 'use_case',
        id,
        ordinal: 0,
        name,
        actor: 'Khách hàng',
        precondition: 'Đã đăng nhập',
        mainFlow: ['Chọn sản phẩm'],
        postcondition: 'Đơn được tạo',
        role: 'customer',
        dataEffects: ['create'],
      },
    ],
    links: [],
  })
}

function makeJob(llm: ExtractionLlm, store: TempStore) {
  const documents = new BaDocumentRepository(store.store)
  const job = new BaExtractionJob({
    documents,
    resolveModel: () => ({ modelId: 'model-a', provider: 'litellm' }),
    buildLlmClient: () => llm,
    settings: () => DEFAULT_APP_SETTINGS,
    logger: store.store.log,
  })
  const document = documents.create({ profileId: store.profileId, title: 'US-01', kind: 'us' })
  return { job, documents, documentId: document.id }
}

describe('job trích xuất', () => {
  it('ghi mô hình khi output khớp schema', async () => {
    ctx = makeTempStore()
    const llm = new FakeLlm([useCaseJson('uc-1', 'Khách hàng đặt đơn')])
    const { job, documents, documentId } = makeJob(llm, ctx)

    const result = await job.run(documentId, '# US-01\nKhách hàng đặt đơn.')

    expect(result.cached).toBe(false)
    expect(documents.readModel(documentId).items).toHaveLength(1)
  })

  it('gỡ được hàng rào ```json mà model hay thêm', async () => {
    ctx = makeTempStore()
    const llm = new FakeLlm(['```json\n' + useCaseJson('uc-1', 'Khách hàng đặt đơn') + '\n```'])
    const { job, documentId } = makeJob(llm, ctx)

    const result = await job.run(documentId, '# US-01\nNội dung.')
    expect(result.model.items).toHaveLength(1)
  })

  it('từ chối output sai schema và nói lại, không ép kiểu', async () => {
    ctx = makeTempStore()
    // Lần đầu thiếu `actor`; lần sau hợp lệ.
    const broken = JSON.stringify({ items: [{ itemType: 'use_case', id: 'uc-1', ordinal: 0 }] })
    const llm = new FakeLlm([broken, useCaseJson('uc-1', 'Khách hàng đặt đơn')])
    const { job, documents, documentId } = makeJob(llm, ctx)

    await job.run(documentId, '# US-01\nNội dung.')

    expect(llm.requests).toHaveLength(2)
    expect(documents.readModel(documentId).items).toHaveLength(1)
  })

  it('thất bại rõ ràng sau đúng số lần thử tối đa', async () => {
    ctx = makeTempStore()
    const llm = new FakeLlm(['không phải json'])
    const { job, documentId } = makeJob(llm, ctx)

    await expect(job.run(documentId, '# US-01\nNội dung.')).rejects.toThrow()
    expect(llm.requests).toHaveLength(MAX_EXTRACTION_ATTEMPTS)
  })

  it('không gọi model lần hai khi nội dung không đổi', async () => {
    ctx = makeTempStore()
    const llm = new FakeLlm([useCaseJson('uc-1', 'Khách hàng đặt đơn')])
    const { job, documentId } = makeJob(llm, ctx)
    const source = '# US-01\nNội dung.'

    await job.run(documentId, source)
    const second = await job.run(documentId, source)

    expect(second.cached).toBe(true)
    expect(llm.requests).toHaveLength(1)
  })

  it('gọi lại model khi nội dung đổi', async () => {
    ctx = makeTempStore()
    const llm = new FakeLlm([useCaseJson('uc-1', 'Khách hàng đặt đơn')])
    const { job, documentId } = makeJob(llm, ctx)

    await job.run(documentId, '# US-01\nBản một.')
    const second = await job.run(documentId, '# US-01\nBản hai.')

    expect(second.cached).toBe(false)
    expect(llm.requests).toHaveLength(2)
  })

  it('gắn tiền tố section nên hai mục cùng đánh id uc-1 không đè nhau', async () => {
    ctx = makeTempStore()
    const llm = new FakeLlm([
      useCaseJson('uc-1', 'Khách hàng đặt đơn'),
      useCaseJson('uc-1', 'Khách hàng huỷ đơn'),
    ])
    const { job, documents, documentId } = makeJob(llm, ctx)

    await job.run(documentId, ['# 1. Đặt đơn', 'Nội dung.', '# 2. Huỷ đơn', 'Nội dung.'].join('\n'))

    const items = documents.readModel(documentId).items
    expect(items).toHaveLength(2)
    expect(new Set(items.map((item) => item.id)).size).toBe(2)
  })

  it('gộp use case trùng khít xuất hiện ở hai mục', async () => {
    ctx = makeTempStore()
    const llm = new FakeLlm([
      useCaseJson('uc-1', 'Khách hàng đặt đơn'),
      useCaseJson('uc-9', 'Khách hàng đặt đơn'),
    ])
    const { job, documents, documentId } = makeJob(llm, ctx)

    const result = await job.run(
      documentId,
      ['# 1. Đặt đơn', 'Nội dung.', '# 2. Nhắc lại', 'Nội dung.'].join('\n'),
    )

    expect(result.mergedCount).toBe(1)
    const items = documents.readModel(documentId).items
    expect(items).toHaveLength(1)
    expect(items[0]?.sources).toEqual(['1. Đặt đơn', '2. Nhắc lại'])
  })

  it('không log nội dung nghiệp vụ, kể cả khi output hỏng', async () => {
    ctx = makeTempStore()
    const llm = new FakeLlm(['{"items":[{"itemType":"use_case","id":"uc-1","ordinal":0}]}'])
    const { job, documentId } = makeJob(llm, ctx)

    await expect(
      job.run(documentId, '# US-01\nĐơn trên 500k được miễn phí giao hàng nội thành.'),
    ).rejects.toThrow()

    const logged = ctx.sink.asText()
    expect(logged).toContain('ba-extraction-invalid-output')
    expect(logged).not.toContain('miễn phí giao hàng nội thành')
    expect(logged).not.toContain('Khách hàng đặt đơn')
  })

  it('báo lỗi rõ khi nguồn không có nội dung trích xuất được', async () => {
    ctx = makeTempStore()
    const llm = new FakeLlm([useCaseJson('uc-1', 'Khách hàng đặt đơn')])
    const { job, documentId } = makeJob(llm, ctx)

    await expect(job.run(documentId, '   \n\n  ')).rejects.toThrow()
    expect(llm.requests).toHaveLength(0)
  })
})
