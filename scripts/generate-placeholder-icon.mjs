#!/usr/bin/env node
/**
 * Sinh `apps/desktop/resources/icon.ico` — **ICON TẠM** (OPEN-QUESTIONS E8).
 *
 * Vì sao có script này thay vì commit một file .ico:
 *   - electron-builder cần icon.ico, không có thì không đóng gói được. Một icon tạm giúp
 *     pipeline chạy được ngay hôm nay.
 *   - Một blob nhị phân trong repo là thứ không ai review được. Script thì đọc được, và
 *     rõ ràng là tạm.
 *
 * ⚠️ ĐÂY KHÔNG PHẢI NHẬN DIỆN THƯƠNG HIỆU. Khi design cấp file thật, xoá script này và
 * commit file .ico của họ.
 *
 *   node scripts/generate-placeholder-icon.mjs
 */

import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { stdout } from 'node:process'

const TARGET = 'apps/desktop/resources/icon.ico'
// Bộ kích thước Windows dùng: taskbar, explorer, alt-tab, và bản lớn cho màn hình HiDPI.
const SIZES = [16, 24, 32, 48, 64, 128, 256]

const BACKGROUND = [15, 17, 21, 255] // #0f1115 — nền tối của app
const FOREGROUND = [76, 141, 255, 255] // #4c8dff — màu nhấn của app

/** Vẽ chữ "N" bằng ba nét, tỉ lệ theo kích thước ảnh. */
function drawPixels(size) {
  const pixels = Buffer.alloc(size * size * 4)
  for (let i = 0; i < size * size; i++) {
    pixels.set(BACKGROUND, i * 4)
  }

  const margin = Math.max(2, Math.round(size * 0.24))
  const stroke = Math.max(1, Math.round(size * 0.11))
  const top = margin
  const bottom = size - margin
  const left = margin
  const right = size - margin - stroke
  const height = bottom - top

  const put = (x, y) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return
    pixels.set(FOREGROUND, (y * size + x) * 4)
  }

  for (let y = top; y < bottom; y++) {
    // Hai nét dọc.
    for (let dx = 0; dx < stroke; dx++) {
      put(left + dx, y)
      put(right + dx, y)
    }
    // Nét chéo nối hai nét dọc.
    const progress = (y - top) / Math.max(1, height - 1)
    const x = Math.round(left + progress * (right - left))
    for (let dx = 0; dx < stroke; dx++) put(x + dx, y)
  }

  return pixels
}

function crc32(buf) {
  let crc = 0xffffffff
  for (const byte of buf) {
    crc ^= byte
    for (let i = 0; i < 8; i++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const typeAndData = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData))
  return Buffer.concat([length, typeAndData, crc])
}

/** PNG 8-bit RGBA, không lọc (filter byte 0 mỗi hàng). */
function encodePng(size, pixels) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type RGBA
  // 10,11,12 = compression/filter/interlace, đều 0

  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

/** Vỏ ICO nhúng PNG (Windows Vista trở lên hỗ trợ). */
function buildIco(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type = icon
  header.writeUInt16LE(images.length, 4)

  const directory = Buffer.alloc(16 * images.length)
  let offset = header.length + directory.length

  images.forEach((img, i) => {
    const at = i * 16
    // 256 được mã hoá là 0 trong đặc tả ICO.
    directory[at] = img.size >= 256 ? 0 : img.size
    directory[at + 1] = img.size >= 256 ? 0 : img.size
    directory[at + 2] = 0 // số màu trong palette
    directory[at + 3] = 0 // reserved
    directory.writeUInt16LE(1, at + 4) // colour planes
    directory.writeUInt16LE(32, at + 6) // bits per pixel
    directory.writeUInt32BE(0, at + 8)
    directory.writeUInt32LE(img.png.length, at + 8)
    directory.writeUInt32LE(offset, at + 12)
    offset += img.png.length
  })

  return Buffer.concat([header, directory, ...images.map((i) => i.png)])
}

const images = SIZES.map((size) => ({ size, png: encodePng(size, drawPixels(size)) }))
const ico = buildIco(images)

mkdirSync(dirname(TARGET), { recursive: true })
writeFileSync(TARGET, ico)
stdout.write(
  `Đã ghi ${TARGET} — ${String(images.length)} kích thước (${SIZES.join(', ')}), ${String(ico.length)} byte\n`,
)
stdout.write('⚠️  Đây là ICON TẠM. Thay bằng file của design trước khi phát hành.\n')
