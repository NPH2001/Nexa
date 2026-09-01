import { describe, expect, it } from 'vitest'
import { ERROR_CODES } from '@nexa/shared-types'
import type { ProcessedDocument } from '@nexa/document-processor'
import {
  assertModelSupportsImages,
  buildContext,
  mayReceiveImages,
  summarizeForWarning,
} from './index.js'

function imageDoc(overrides: Partial<ProcessedDocument> = {}): ProcessedDocument {
  return {
    fileName: 'so-do.png',
    kind: 'image',
    sizeBytes: 2_048,
    sourcePathHash: 'a'.repeat(64),
    text: '',
    chunks: [],
    charCount: 0,
    estimatedTokens: 765,
    truncated: false,
    image: {
      mediaType: 'image/png',
      dataBase64: 'AAAA',
      byteSize: 3,
      width: 1024,
      height: 1024,
      metadataStripped: true,
    },
    ...overrides,
  }
}

function textDoc(): ProcessedDocument {
  return {
    fileName: 'bao-cao.xlsx',
    kind: 'xlsx',
    sizeBytes: 4_096,
    sourcePathHash: 'b'.repeat(64),
    text: 'Đơn vị\tDoanh thu\nHà Nội\t120',
    chunks: [],
    charCount: 26,
    estimatedTokens: 7,
    truncated: false,
  }
}

describe('ảnh trong context', () => {
  it('gửi ảnh dưới dạng data URL kèm nhãn tên file', () => {
    const context = buildContext({
      history: [{ role: 'user', content: 'Sơ đồ này nói gì?' }],
      documents: [imageDoc()],
      budget: { contextWindowTokens: 128_000 },
    })

    const imageMessage = context.messages.find((message) => typeof message.content !== 'string')
    expect(imageMessage).toBeDefined()
    const parts = imageMessage?.content
    if (typeof parts === 'string' || parts === undefined)
      throw new Error('mong đợi nội dung nhiều mảnh')

    expect(parts[0]).toMatchObject({ type: 'text' })
    expect(parts[0]).toHaveProperty('text', expect.stringContaining('so-do.png'))
    expect(parts[1]).toMatchObject({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,AAAA' },
    })
    expect(context.imagesIncluded).toBe(1)
    expect(context.imagesTruncated).toBe(0)
  })

  it('gộp nhiều ảnh vào một message thay vì mỗi ảnh một message', () => {
    const context = buildContext({
      history: [{ role: 'user', content: 'So sánh hai ảnh' }],
      documents: [imageDoc(), imageDoc({ fileName: 'so-do-2.png' })],
      budget: { contextWindowTokens: 128_000 },
    })

    const multipart = context.messages.filter((message) => typeof message.content !== 'string')
    expect(multipart).toHaveLength(1)
    expect(context.imagesIncluded).toBe(2)
  })

  it('tính token của ảnh vào ngân sách chung', () => {
    const withImage = buildContext({
      history: [{ role: 'user', content: 'Câu hỏi' }],
      documents: [imageDoc()],
      budget: { contextWindowTokens: 128_000 },
    })
    const withoutImage = buildContext({
      history: [{ role: 'user', content: 'Câu hỏi' }],
      budget: { contextWindowTokens: 128_000 },
    })
    expect(withImage.estimatedTokens - withoutImage.estimatedTokens).toBe(765)
  })

  it('đánh dấu ảnh bị loại thay vì âm thầm bỏ khi hết ngân sách', () => {
    const context = buildContext({
      history: [{ role: 'user', content: 'Câu hỏi' }],
      documents: [imageDoc({ estimatedTokens: 1_000_000 })],
      budget: { contextWindowTokens: 8_000 },
    })

    expect(context.imagesIncluded).toBe(0)
    expect(context.imagesTruncated).toBe(1)
    expect(context.messages.every((message) => typeof message.content === 'string')).toBe(true)
  })

  it('giữ tài liệu văn bản ở dạng chuỗi thuần, không đổi sang mảng mảnh', () => {
    const context = buildContext({
      history: [{ role: 'user', content: 'Câu hỏi' }],
      documents: [textDoc()],
      budget: { contextWindowTokens: 128_000 },
    })
    expect(context.messages.every((message) => typeof message.content === 'string')).toBe(true)
    expect(context.imagesIncluded).toBe(0)
  })
})

describe('assertModelSupportsImages', () => {
  it('chặn ảnh khi model chưa được đánh dấu đọc được ảnh', () => {
    expect(() =>
      assertModelSupportsImages({ modelId: 'chi-doc-chu', supportsVision: false }, [imageDoc()]),
    ).toThrowError(expect.objectContaining({ code: ERROR_CODES.MODEL_DOES_NOT_SUPPORT_IMAGES }))
  })

  it('cho qua khi model đọc được ảnh', () => {
    expect(() =>
      assertModelSupportsImages({ modelId: 'co-thi-giac', supportsVision: true }, [imageDoc()]),
    ).not.toThrow()
  })

  it('không đụng tới lượt chỉ có tài liệu văn bản', () => {
    // Model chỉ đọc chữ vẫn nhận được file Excel — đây là kiểm tra về ẢNH, không phải về file.
    expect(() =>
      assertModelSupportsImages({ modelId: 'chi-doc-chu', supportsVision: false }, [textDoc()]),
    ).not.toThrow()
  })

  it('mayReceiveImages phản chiếu đúng hàm assert cho UI', () => {
    expect(mayReceiveImages({ modelId: 'm', supportsVision: false }, [imageDoc()])).toBe(false)
    expect(mayReceiveImages({ modelId: 'm', supportsVision: true }, [imageDoc()])).toBe(true)
    expect(mayReceiveImages({ modelId: 'm', supportsVision: false }, [textDoc()])).toBe(true)
  })
})

describe('summarizeForWarning', () => {
  it('kèm kích thước điểm ảnh cho ảnh và bỏ trống với tài liệu', () => {
    const [image, text] = summarizeForWarning([imageDoc(), textDoc()])
    expect(image?.imageSize).toEqual({ width: 1024, height: 1024 })
    expect(text?.imageSize).toBeUndefined()
  })
})
