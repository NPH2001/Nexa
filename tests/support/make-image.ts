import { deflateSync } from 'node:zlib'
import { crc32 } from './make-office.js'

/**
 * Sinh ảnh tối thiểu nhưng HỢP LỆ, có kèm khối metadata để test được việc gỡ bỏ.
 *
 * Mỗi hàm dưới đây đều nhét sẵn một dấu vết dễ tìm (`EXIF-BÍ-MẬT`) vào đúng khối mà Nexa cam
 * kết sẽ loại bỏ. Test chỉ cần khẳng định chuỗi đó KHÔNG còn trong ảnh đã chuẩn bị — cách kiểm
 * chứng trực tiếp nhất cho một lời hứa về quyền riêng tư.
 */

export const IMAGE_METADATA_MARKER = 'EXIF-BI-MAT'

export function makePng(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr.writeUInt8(8, 8) // bit depth
  ihdr.writeUInt8(2, 9) // truecolour

  // Mỗi hàng điểm ảnh mở đầu bằng một byte filter, rồi 3 byte RGB cho mỗi cột.
  const raw = Buffer.alloc(height * (1 + width * 3))
  const idat = deflateSync(raw)

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('tEXt', Buffer.from(`Comment\0${IMAGE_METADATA_MARKER}`, 'latin1')),
    pngChunk('eXIf', Buffer.from(IMAGE_METADATA_MARKER, 'latin1')),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

function pngChunk(type: string, body: Buffer): Buffer {
  const header = Buffer.alloc(8)
  header.writeUInt32BE(body.length, 0)
  header.write(type, 4, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), body])), 0)
  return Buffer.concat([header, body, crc])
}

export function makeJpeg(width: number, height: number): Buffer {
  const jfif = Buffer.from([
    0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  ])
  const exif = Buffer.concat([
    Buffer.from('Exif\0\0', 'latin1'),
    Buffer.from(IMAGE_METADATA_MARKER, 'latin1'),
  ])

  const sof = Buffer.alloc(15)
  sof.writeUInt8(8, 0) // độ sâu mẫu
  sof.writeUInt16BE(height, 1)
  sof.writeUInt16BE(width, 3)
  sof.writeUInt8(3, 5) // ba thành phần màu
  for (let i = 0; i < 3; i++) {
    sof.writeUInt8(i + 1, 6 + i * 3)
    sof.writeUInt8(0x11, 7 + i * 3)
    sof.writeUInt8(0, 8 + i * 3)
  }

  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    jpegSegment(0xe0, jfif),
    jpegSegment(0xe1, exif),
    jpegSegment(0xfe, Buffer.from(`comment ${IMAGE_METADATA_MARKER}`, 'latin1')),
    jpegSegment(0xc0, sof),
    jpegSegment(0xda, Buffer.from([0x01, 0x01, 0x00, 0x00, 0x3f, 0x00])),
    Buffer.from([0x00, 0x00]), // dữ liệu nén giả
    Buffer.from([0xff, 0xd9]),
  ])
}

function jpegSegment(marker: number, body: Buffer): Buffer {
  const header = Buffer.alloc(4)
  header.writeUInt8(0xff, 0)
  header.writeUInt8(marker, 1)
  header.writeUInt16BE(body.length + 2, 2)
  return Buffer.concat([header, body])
}

export function makeGif(width: number, height: number): Buffer {
  const header = Buffer.alloc(13)
  header.write('GIF89a', 0, 'latin1')
  header.writeUInt16LE(width, 6)
  header.writeUInt16LE(height, 8)
  header.writeUInt8(0x00, 10) // không có bảng màu chung

  const comment = Buffer.concat([
    Buffer.from([0x21, 0xfe]),
    dataBlocks(Buffer.from(IMAGE_METADATA_MARKER, 'latin1')),
  ])

  const descriptor = Buffer.alloc(10)
  descriptor.writeUInt8(0x2c, 0)
  descriptor.writeUInt16LE(width, 5)
  descriptor.writeUInt16LE(height, 7)

  return Buffer.concat([
    header,
    comment,
    descriptor,
    Buffer.from([0x02]), // cỡ mã LZW tối thiểu
    dataBlocks(Buffer.from([0x44, 0x01])),
    Buffer.from([0x3b]),
  ])
}

function dataBlocks(payload: Buffer): Buffer {
  return Buffer.concat([Buffer.from([payload.length]), payload, Buffer.from([0x00])])
}

export function makeWebp(width: number, height: number): Buffer {
  const vp8x = Buffer.alloc(10)
  vp8x.writeUInt8(0x08, 0) // cờ: có EXIF
  vp8x.writeUIntLE(width - 1, 4, 3)
  vp8x.writeUIntLE(height - 1, 7, 3)

  const body = Buffer.concat([
    riffChunk('VP8X', vp8x),
    riffChunk('VP8L', Buffer.from([0x2f, 0x00, 0x00, 0x00, 0x00])),
    riffChunk('EXIF', Buffer.from(IMAGE_METADATA_MARKER, 'latin1')),
  ])

  const header = Buffer.alloc(12)
  header.write('RIFF', 0, 'latin1')
  header.writeUInt32LE(body.length + 4, 4)
  header.write('WEBP', 8, 'latin1')
  return Buffer.concat([header, body])
}

function riffChunk(fourcc: string, body: Buffer): Buffer {
  const header = Buffer.alloc(8)
  header.write(fourcc, 0, 'latin1')
  header.writeUInt32LE(body.length, 4)
  const padding = body.length % 2 === 1 ? Buffer.from([0x00]) : Buffer.alloc(0)
  return Buffer.concat([header, body, padding])
}
