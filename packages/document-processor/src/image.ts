import { ERROR_CODES, NexaError } from '@nexa/shared-types'
import type { ExtractedImage, ImageMediaType } from './types.js'

/**
 * Chuẩn bị ảnh để gửi cho model có thị giác.
 *
 * Ba việc, theo đúng thứ tự đó:
 *
 *  1. **Nhận dạng bằng magic bytes**, không tin phần mở rộng. Một file `.png` thực chất là
 *     HTML sẽ bị chặn ở đây thay vì được base64 hoá rồi đẩy ra ngoài tổ chức.
 *  2. **Đọc kích thước** để ước lượng token và để chặn ảnh có số điểm ảnh phi lý.
 *  3. **Gỡ metadata** trước khi mã hoá base64. Đây là phần quan trọng nhất về quyền riêng tư:
 *     một tấm ảnh chụp màn hình hay ảnh điện thoại mang theo EXIF có toạ độ GPS, số sê-ri máy,
 *     và đôi khi cả ảnh thu nhỏ của khung hình GỐC trước khi bị cắt. Người dùng đính kèm ảnh
 *     là có ý gửi những gì họ NHÌN THẤY; những thứ đó thì không.
 *
 * Điều KHÔNG làm: không giải mã và không vẽ lại điểm ảnh. Nexa không nhúng bộ giải mã ảnh nào,
 * nên ở đây chỉ cắt gọt ở mức khối dữ liệu — vừa đủ để gỡ metadata mà không mở thêm bề mặt
 * tấn công của một bộ decode ảnh chạy trên dữ liệu lạ.
 */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Trần điểm ảnh mỗi chiều. Ảnh lớn hơn thế gần như chắc chắn là ảnh quét/bản đồ, và model
 *  cũng sẽ tự thu nhỏ về mất chi tiết — chặn sớm để người dùng biết mà tự xử lý. */
const MAX_DIMENSION = 12_000

export interface ImageOptions {
  /** Trần byte của ảnh SAU khi gỡ metadata. */
  readonly maxBytes: number
}

export function detectImageMediaType(head: Buffer): ImageMediaType | null {
  if (head.length >= 8 && head.subarray(0, 8).equals(PNG_SIGNATURE)) return 'image/png'
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return 'image/jpeg'
  }
  if (
    head.length >= 6 &&
    head
      .subarray(0, 6)
      .toString('latin1')
      .match(/^GIF8[79]a$/) !== null
  ) {
    return 'image/gif'
  }
  if (
    head.length >= 12 &&
    head.subarray(0, 4).toString('latin1') === 'RIFF' &&
    head.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp'
  }
  return null
}

export function prepareImage(buffer: Buffer, options: ImageOptions): ExtractedImage {
  const mediaType = detectImageMediaType(buffer)
  if (mediaType === null) {
    throw new NexaError(ERROR_CODES.FILE_UNSUPPORTED, {
      safeDetail: 'image content is not PNG, JPEG, WebP or GIF',
    })
  }

  const size = readDimensions(buffer, mediaType)
  if (size === null) {
    throw new NexaError(ERROR_CODES.DOCUMENT_EXTRACTION_FAILED, {
      safeDetail: `${mediaType} header is corrupt (no dimensions)`,
    })
  }
  if (size.width > MAX_DIMENSION || size.height > MAX_DIMENSION) {
    throw new NexaError(ERROR_CODES.FILE_TOO_LARGE, {
      safeDetail: `image is ${String(size.width)}×${String(size.height)}, limit is ${String(MAX_DIMENSION)} px per side`,
    })
  }

  const stripped = stripMetadata(buffer, mediaType)
  if (stripped.length > options.maxBytes) {
    throw new NexaError(ERROR_CODES.FILE_TOO_LARGE, {
      safeDetail: `image is ${String(stripped.length)} bytes after cleaning, limit is ${String(options.maxBytes)}`,
    })
  }

  return {
    mediaType,
    dataBase64: stripped.toString('base64'),
    byteSize: stripped.length,
    width: size.width,
    height: size.height,
    metadataStripped: stripped.length !== buffer.length,
  }
}

/**
 * Ước lượng token của một ảnh theo cách các model thị giác OpenAI-compatible tính tiền: ảnh
 * được chia thành lưới ô 512 px, mỗi ô một khoản token cố định, cộng một khoản nền.
 *
 * Đây là ƯỚC LƯỢNG dùng để cắt ngân sách context, không phải con số hoá đơn. Ước hơi cao còn
 * hơn ước thiếu rồi bị model từ chối vì tràn context.
 */
export function estimateImageTokens(width: number, height: number): number {
  const BASE_TOKENS = 85
  const TILE_TOKENS = 170
  const TILE_SIZE = 512
  // Model thu ảnh về khung 2048×2048 trước khi chia ô, nên ảnh lớn không tốn thêm.
  const scale = Math.min(1, 2048 / Math.max(width, height, 1))
  const tilesWide = Math.ceil((width * scale) / TILE_SIZE)
  const tilesHigh = Math.ceil((height * scale) / TILE_SIZE)
  return BASE_TOKENS + TILE_TOKENS * Math.max(1, tilesWide) * Math.max(1, tilesHigh)
}

// ── Kích thước ────────────────────────────────────────────────────────────

interface Dimensions {
  readonly width: number
  readonly height: number
}

function readDimensions(buffer: Buffer, mediaType: ImageMediaType): Dimensions | null {
  switch (mediaType) {
    case 'image/png':
      return readPngDimensions(buffer)
    case 'image/jpeg':
      return readJpegDimensions(buffer)
    case 'image/gif':
      return buffer.length < 10
        ? null
        : { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) }
    case 'image/webp':
      return readWebpDimensions(buffer)
    default:
      return null
  }
}

function readPngDimensions(buffer: Buffer): Dimensions | null {
  // Chunk đầu tiên bắt buộc là IHDR, và width/height là hai dword đầu của nó.
  if (buffer.length < 24 || buffer.subarray(12, 16).toString('latin1') !== 'IHDR') return null
  const width = buffer.readUInt32BE(16)
  const height = buffer.readUInt32BE(20)
  return width > 0 && height > 0 ? { width, height } : null
}

function readJpegDimensions(buffer: Buffer): Dimensions | null {
  let at = 2
  while (at + 4 <= buffer.length) {
    if (buffer.readUInt8(at) !== 0xff) {
      at++
      continue
    }
    const marker = buffer.readUInt8(at + 1)
    // Marker không có payload: SOI/EOI/RSTn và byte đệm 0xFF.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      at += 2
      continue
    }
    const length = buffer.readUInt16BE(at + 2)
    // SOFn mang kích thước thật. Loại trừ 0xC4/0xC8/0xCC — chúng dùng chung dải mã nhưng là
    // bảng Huffman / mở rộng, không phải frame header.
    const isStartOfFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isStartOfFrame) {
      if (at + 9 > buffer.length) return null
      return { height: buffer.readUInt16BE(at + 5), width: buffer.readUInt16BE(at + 7) }
    }
    // Tới dữ liệu ảnh nén mà chưa thấy SOF nghĩa là file hỏng.
    if (marker === 0xda) return null
    at += 2 + length
  }
  return null
}

function readWebpDimensions(buffer: Buffer): Dimensions | null {
  if (buffer.length < 30) return null
  const format = buffer.subarray(12, 16).toString('latin1')

  if (format === 'VP8X') {
    return {
      width: buffer.readUIntLE(24, 3) + 1,
      height: buffer.readUIntLE(27, 3) + 1,
    }
  }
  if (format === 'VP8 ') {
    // 3 byte frame tag + 3 byte sync code, rồi mới tới kích thước 14-bit.
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    }
  }
  if (format === 'VP8L') {
    const bits = buffer.readUInt32LE(21)
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
  }
  return null
}

// ── Gỡ metadata ───────────────────────────────────────────────────────────

function stripMetadata(buffer: Buffer, mediaType: ImageMediaType): Buffer {
  try {
    switch (mediaType) {
      case 'image/jpeg':
        return stripJpegMetadata(buffer)
      case 'image/png':
        return stripPngMetadata(buffer)
      case 'image/webp':
        return stripWebpMetadata(buffer)
      case 'image/gif':
        return stripGifMetadata(buffer)
      default:
        return buffer
    }
  } catch {
    // Không gỡ được thì KHÔNG gửi ảnh nguyên bản — cam kết "đã gỡ metadata" phải luôn đúng,
    // nếu không nó thành lời hứa suông đúng lúc quan trọng nhất.
    throw new NexaError(ERROR_CODES.DOCUMENT_EXTRACTION_FAILED, {
      safeDetail: `${mediaType} metadata could not be removed`,
    })
  }
}

/**
 * JPEG: giữ SOI, khung ảnh và dữ liệu nén; bỏ APP1…APP13, APP15 và COM.
 *
 * APP0 (JFIF) và APP14 (Adobe) được giữ lại có chủ ý: chúng mô tả cách diễn giải màu, bỏ đi
 * thì ảnh CMYK bị đảo màu. Còn EXIF, XMP, IPTC và ảnh thu nhỏ đều nằm trong nhóm bị bỏ.
 */
function stripJpegMetadata(buffer: Buffer): Buffer {
  const kept: Buffer[] = [buffer.subarray(0, 2)]
  let at = 2

  while (at + 4 <= buffer.length) {
    if (buffer.readUInt8(at) !== 0xff) break
    const marker = buffer.readUInt8(at + 1)

    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      kept.push(buffer.subarray(at, at + 2))
      at += 2
      continue
    }

    const length = buffer.readUInt16BE(at + 2)
    const segmentEnd = at + 2 + length
    if (length < 2 || segmentEnd > buffer.length) break

    const isMetadata = (marker >= 0xe1 && marker <= 0xed) || marker === 0xef || marker === 0xfe

    if (!isMetadata) kept.push(buffer.subarray(at, segmentEnd))

    if (marker === 0xda) {
      // SOS: mọi thứ sau đây là dữ liệu nén (kèm EOI), sao chép nguyên vẹn.
      kept.push(buffer.subarray(segmentEnd))
      return Buffer.concat(kept)
    }
    at = segmentEnd
  }

  // Đi hết vòng lặp mà chưa gặp SOS nghĩa là chuỗi segment gãy giữa chừng. Ghép những gì đã giữ
  // lại sẽ ra một file JPEG cụt trông vẫn "hợp lệ" — thà báo lỗi còn hơn gửi cho model một tấm
  // ảnh mà chính ta biết là đã hỏng.
  throw new Error('jpeg segment chain ended before the start of scan')
}

/** PNG: chỉ giữ các chunk mô tả ảnh; bỏ mọi chunk văn bản, thời gian và eXIf. */
function stripPngMetadata(buffer: Buffer): Buffer {
  const ALLOWED = new Set([
    'IHDR',
    'PLTE',
    'IDAT',
    'IEND',
    'tRNS',
    'gAMA',
    'cHRM',
    'sRGB',
    'iCCP',
    'sBIT',
    'bKGD',
    'pHYs',
    'sPLT',
    // APNG: giữ để ảnh động không vỡ thành một khung trắng.
    'acTL',
    'fcTL',
    'fdAT',
  ])

  const kept: Buffer[] = [buffer.subarray(0, 8)]
  let at = 8
  let sawEnd = false

  while (at + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(at)
    const type = buffer.subarray(at + 4, at + 8).toString('latin1')
    const chunkEnd = at + 12 + length
    if (chunkEnd > buffer.length) break

    if (ALLOWED.has(type)) kept.push(buffer.subarray(at, chunkEnd))
    at = chunkEnd
    if (type === 'IEND') {
      sawEnd = true
      break
    }
  }

  // Cùng lập luận như với JPEG: chuỗi chunk không kết thúc bằng IEND thì file đã gãy, và ghép
  // lại phần đầu chỉ tạo ra một ảnh cụt trông có vẻ dùng được.
  if (!sawEnd) throw new Error('png chunk chain ended before IEND')
  return Buffer.concat(kept)
}

/** WebP: bỏ chunk EXIF/XMP, cập nhật lại độ dài RIFF và tắt cờ tương ứng trong VP8X. */
function stripWebpMetadata(buffer: Buffer): Buffer {
  const body: Buffer[] = []
  let at = 12
  let removed = false

  while (at + 8 <= buffer.length) {
    const fourcc = buffer.subarray(at, at + 4).toString('latin1')
    const length = buffer.readUInt32LE(at + 4)
    // Chunk RIFF luôn được đệm cho chẵn byte.
    const chunkEnd = at + 8 + length + (length % 2)
    // Chunk khai dài hơn phần file còn lại: container đã gãy. Bỏ dở ở đây rồi ghép lại sẽ ra
    // một ảnh cụt, nên báo lỗi thay vì gửi đi.
    if (chunkEnd > buffer.length) throw new Error('webp chunk runs past end of file')

    if (fourcc === 'EXIF' || fourcc === 'XMP ') {
      removed = true
    } else {
      const chunk = Buffer.from(buffer.subarray(at, Math.min(chunkEnd, buffer.length)))
      // Cờ ở byte đầu của VP8X nói "file này có EXIF/XMP"; giữ nguyên cờ sau khi đã xoá dữ
      // liệu sẽ khiến bộ giải mã đi tìm một chunk không còn tồn tại.
      if (fourcc === 'VP8X' && chunk.length >= 9) chunk.writeUInt8(chunk.readUInt8(8) & ~0x0c, 8)
      body.push(chunk)
    }
    at = chunkEnd
  }

  if (!removed) return buffer

  const payload = Buffer.concat(body)
  const header = Buffer.alloc(12)
  header.write('RIFF', 0, 'latin1')
  header.writeUInt32LE(payload.length + 4, 4)
  header.write('WEBP', 8, 'latin1')
  return Buffer.concat([header, payload])
}

/**
 * GIF: bỏ Comment Extension và Application Extension mang XMP.
 *
 * Các Application Extension khác (NETSCAPE2.0 điều khiển vòng lặp) được giữ vì chúng thuộc về
 * cách ảnh hiển thị, không phải dữ liệu về người chụp.
 */
function stripGifMetadata(buffer: Buffer): Buffer {
  if (buffer.length < 13) return buffer

  const kept: Buffer[] = []
  let at = 13

  // Bảng màu chung, nếu có, nằm ngay sau logical screen descriptor.
  const packed = buffer.readUInt8(10)
  if ((packed & 0x80) !== 0) at += 3 * (1 << ((packed & 0x07) + 1))
  kept.push(buffer.subarray(0, at))

  let removed = false
  while (at < buffer.length) {
    const introducer = buffer.readUInt8(at)

    if (introducer === 0x3b) {
      kept.push(buffer.subarray(at, at + 1))
      break
    }

    if (introducer === 0x21) {
      const label = at + 1 < buffer.length ? buffer.readUInt8(at + 1) : 0
      const blockEnd = skipDataBlocks(buffer, at + 2)
      const isXmp =
        label === 0xff &&
        at + 14 <= buffer.length &&
        buffer.subarray(at + 3, at + 11).toString('latin1') === 'XMP Data'
      if (label === 0xfe || isXmp) removed = true
      else kept.push(buffer.subarray(at, blockEnd))
      at = blockEnd
      continue
    }

    if (introducer === 0x2c) {
      // Image descriptor 10 byte, có thể kèm bảng màu cục bộ, rồi tới dữ liệu nén.
      let cursor = at + 10
      if (cursor <= buffer.length) {
        const localPacked = buffer.readUInt8(at + 9)
        if ((localPacked & 0x80) !== 0) cursor += 3 * (1 << ((localPacked & 0x07) + 1))
      }
      cursor += 1 // cỡ mã LZW
      const blockEnd = skipDataBlocks(buffer, cursor)
      kept.push(buffer.subarray(at, blockEnd))
      at = blockEnd
      continue
    }

    // Byte lạ giữa các khối: dừng và giữ nguyên phần đuôi để không làm hỏng ảnh.
    kept.push(buffer.subarray(at))
    break
  }

  return removed ? Buffer.concat(kept) : buffer
}

/** Chuỗi sub-block của GIF: mỗi block có 1 byte độ dài, kết thúc bằng block độ dài 0. */
function skipDataBlocks(buffer: Buffer, from: number): number {
  let at = from
  while (at < buffer.length) {
    const size = buffer.readUInt8(at)
    at += 1 + size
    if (size === 0) break
  }
  return Math.min(at, buffer.length)
}
