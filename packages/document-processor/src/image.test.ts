import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ERROR_CODES } from '@nexa/shared-types'
import { DocumentProcessor, InlineRunner, estimateImageTokens } from './index.js'
import { testLogger } from '../../../tests/support/factories.js'
import {
  IMAGE_METADATA_MARKER,
  makeGif,
  makeJpeg,
  makePng,
  makeWebp,
} from '../../../tests/support/make-image.js'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nexa-image-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function makeProcessor(maxImageSizeMb?: number) {
  const { logger } = testLogger()
  return new DocumentProcessor({
    runner: new InlineRunner(),
    logger,
    limits: {
      maxFileSizeMb: 30,
      maxFilesPerRequest: 5,
      ...(maxImageSizeMb === undefined ? {} : { maxImageSizeMb }),
    },
  })
}

async function processOne(name: string, content: Buffer, maxImageSizeMb?: number) {
  const path = join(dir, name)
  writeFileSync(path, content)
  const [doc] = await makeProcessor(maxImageSizeMb).process([
    { path, fileName: name, sizeBytes: content.length },
  ])
  if (doc === undefined) throw new Error('không có tài liệu nào được trả về')
  return doc
}

describe('image ingestion', () => {
  it('reads PNG dimensions and produces base64 ready for the model', async () => {
    const doc = await processOne('so-do.png', makePng(64, 32))

    expect(doc.kind).toBe('image')
    expect(doc.image?.mediaType).toBe('image/png')
    expect(doc.image?.width).toBe(64)
    expect(doc.image?.height).toBe(32)
    // Ảnh không sinh văn bản, nên không có gì để chunk.
    expect(doc.text).toBe('')
    expect(doc.chunks).toHaveLength(0)
    expect(doc.charCount).toBe(0)
    // Nhưng vẫn tốn context, và con số đó phải có thật để runtime cắt ngân sách.
    expect(doc.estimatedTokens).toBeGreaterThan(0)
    expect(Buffer.from(doc.image?.dataBase64 ?? '', 'base64').length).toBe(doc.image?.byteSize)
  })

  it.each([
    ['anh.png', () => makePng(20, 10), 'image/png'],
    ['anh.jpg', () => makeJpeg(120, 80), 'image/jpeg'],
    ['anh.gif', () => makeGif(16, 16), 'image/gif'],
    ['anh.webp', () => makeWebp(40, 24), 'image/webp'],
  ])(
    'strips metadata from %s before anything leaves the machine',
    async (name, build, mediaType) => {
      const original = build()
      // Dấu vết phải có thật trong file gốc, nếu không thì phép thử này vô nghĩa.
      expect(original.toString('latin1')).toContain(IMAGE_METADATA_MARKER)

      const doc = await processOne(name, original)
      const prepared = Buffer.from(doc.image?.dataBase64 ?? '', 'base64')

      expect(doc.image?.mediaType).toBe(mediaType)
      expect(doc.image?.metadataStripped).toBe(true)
      expect(prepared.toString('latin1')).not.toContain(IMAGE_METADATA_MARKER)
    },
  )

  it('keeps the JFIF and Adobe colour segments a JPEG needs to render correctly', async () => {
    const doc = await processOne('mau.jpg', makeJpeg(32, 32))
    const prepared = Buffer.from(doc.image?.dataBase64 ?? '', 'base64')
    expect(prepared.toString('latin1')).toContain('JFIF')
  })

  it('reads dimensions from every supported format', async () => {
    expect((await processOne('a.jpg', makeJpeg(300, 150))).image).toMatchObject({
      width: 300,
      height: 150,
    })
    expect((await processOne('b.gif', makeGif(48, 24))).image).toMatchObject({
      width: 48,
      height: 24,
    })
    expect((await processOne('c.webp', makeWebp(100, 50))).image).toMatchObject({
      width: 100,
      height: 50,
    })
  })

  it('labels a PNG renamed to .jpg by its real content, not by its name', async () => {
    // Trong họ ảnh, phần mở rộng sai KHÔNG bị từ chối: media type gửi cho model lấy từ magic
    // bytes, nên nhãn luôn đúng với thứ thật sự được gửi đi. Đổi tên file không lừa được gì.
    const doc = await processOne('gia-mao.jpg', makePng(10, 10))
    expect(doc.image?.mediaType).toBe('image/png')
  })

  it('rejects a text file renamed to .png', async () => {
    await expect(processOne('gia.png', Buffer.from('chỉ là chữ thôi'))).rejects.toMatchObject({
      code: ERROR_CODES.FILE_UNSUPPORTED,
    })
  })

  it.each([
    ['png', () => makePng(32, 32)],
    ['jpg', () => makeJpeg(32, 32)],
    ['webp', () => makeWebp(32, 32)],
  ])('refuses a truncated %s instead of sending a clipped image', async (extension, build) => {
    // Cắt mất đuôi file: bộ gỡ metadata đi hết chuỗi khối mà không gặp dấu kết thúc. Nhánh sai
    // ở đây là ghép lại phần đã đọc được — nó tạo ra một ảnh trông vẫn hợp lệ nhưng đã hỏng.
    const truncated = build().subarray(0, Math.floor(build().length * 0.6))
    await expect(processOne(`cut.${extension}`, truncated)).rejects.toMatchObject({
      code: ERROR_CODES.DOCUMENT_EXTRACTION_FAILED,
    })
  })

  it('enforces the image size limit separately from the file size limit', async () => {
    // Trần 1 byte: ảnh nào cũng vượt, kể cả ảnh nhỏ hơn `maxFileSizeMb` rất nhiều.
    await expect(processOne('to.png', makePng(64, 64), 1 / (1024 * 1024))).rejects.toMatchObject({
      code: ERROR_CODES.FILE_TOO_LARGE,
    })
  })
})

describe('estimateImageTokens', () => {
  it('charges per 512px tile on top of a base cost', () => {
    // 1024×1024 ⇒ lưới 2×2 ô ⇒ 85 + 4×170.
    expect(estimateImageTokens(1024, 1024)).toBe(85 + 4 * 170)
    expect(estimateImageTokens(100, 100)).toBe(85 + 170)
  })

  it('stops growing once the image passes the 2048px working box', () => {
    // Model thu ảnh về khung 2048 trước khi chia ô, nên ảnh lớn hơn không tốn thêm.
    expect(estimateImageTokens(8000, 8000)).toBe(estimateImageTokens(2048, 2048))
  })
})
