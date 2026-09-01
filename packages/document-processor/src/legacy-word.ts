import { ERROR_CODES, NexaError } from '@nexa/shared-types'
import { CfbArchive } from './cfb.js'
import {
  decodeCp1252,
  decodeUtf16Le,
  normalizeLegacyControlChars,
  stripFieldInstructions,
} from './legacy-text.js'

/**
 * Trích văn bản từ `.doc` (Word 97-2003, và dự phòng cho Word 6/95).
 *
 * Word không lưu văn bản thành một khối liền mạch. Nó giữ một **piece table**: một danh sách
 * các "mảnh", mỗi mảnh nói "đoạn ký tự từ CP a tới CP b nằm ở byte offset này, mã hoá 8-bit hay
 * 16-bit". Sửa một chữ giữa tài liệu chỉ cần thêm mảnh mới ở cuối file thay vì viết lại toàn bộ
 * — nhanh cho máy tính năm 1997, nhưng nghĩa là đọc thẳng byte trong stream sẽ ra văn bản SAI
 * THỨ TỰ và lẫn cả những đoạn người dùng đã xoá.
 *
 * Vì thế ở đây bám đúng piece table. Hệ quả về quyền riêng tư cũng đáng nói: nhờ đi qua bảng
 * này, các mảnh mồ côi (nội dung đã xoá còn sót lại trong file) KHÔNG lọt vào kết quả.
 */

const WORD_MAGIC = 0xa5ec
/** nFib từ 193 trở lên là Word 97 và mới hơn — có piece table đầy đủ. */
const NFIB_WORD97 = 193

/** Bit 9 của trường flags trong FIB: văn bản mô tả nằm ở `1Table` thay vì `0Table`. */
const FLAG_WHICH_TABLE_STREAM = 0x0200

const CLX_GRPPRL = 0x01
const CLX_PLCFPCD = 0x02

/** Bit 30 của `fc` trong PCD: mảnh được nén 8-bit (windows-1252) thay vì UTF-16LE. */
const PCD_COMPRESSED = 0x40000000

export interface LegacyExtraction {
  readonly text: string
  readonly truncated: boolean
}

export function extractDoc(buffer: Buffer, maxChars: number): LegacyExtraction {
  const cfb = CfbArchive.open(buffer)

  const wordDocument = cfb.stream('WordDocument')
  if (wordDocument === null) {
    throw failure('doc has no WordDocument stream (not a Word document?)')
  }
  if (wordDocument.length < 0x0200 || wordDocument.readUInt16LE(0) !== WORD_MAGIC) {
    throw failure('doc has a corrupt Word file information block')
  }

  const nFib = wordDocument.readUInt16LE(2)
  const raw =
    nFib >= NFIB_WORD97
      ? readViaPieceTable(cfb, wordDocument, maxChars)
      : readWord95Range(wordDocument, maxChars)

  const text = normalizeLegacyControlChars(stripFieldInstructions(raw))
  return { text: text.slice(0, maxChars), truncated: text.length > maxChars }
}

function readViaPieceTable(cfb: CfbArchive, wordDocument: Buffer, maxChars: number): string {
  const flags = wordDocument.readUInt16LE(0x0a)
  const tableName = (flags & FLAG_WHICH_TABLE_STREAM) !== 0 ? '1Table' : '0Table'
  const table = cfb.firstStream([tableName, '1Table', '0Table'])
  if (table === null) throw failure('doc has no table stream')

  const { fcClx, lcbClx } = locateClx(wordDocument)
  if (lcbClx === 0 || fcClx + lcbClx > table.length) {
    throw failure('doc piece table is missing or out of range')
  }

  const pieces = readPieceTable(table.subarray(fcClx, fcClx + lcbClx))
  if (pieces.length === 0) throw failure('doc piece table is empty')

  const parts: string[] = []
  let produced = 0

  for (const piece of pieces) {
    if (produced >= maxChars) break
    const characterCount = piece.endCp - piece.startCp
    if (characterCount <= 0) continue

    const byteLength = characterCount * (piece.compressed ? 1 : 2)
    if (piece.offset < 0 || piece.offset + byteLength > wordDocument.length) continue

    const slice = wordDocument.subarray(piece.offset, piece.offset + byteLength)
    const decoded = piece.compressed ? decodeCp1252(slice) : decodeUtf16Le(slice)
    parts.push(decoded)
    produced += decoded.length
  }

  return parts.join('')
}

/**
 * Định vị `fcClx`/`lcbClx` bằng cách đi qua từng khối FIB có độ dài tự khai, thay vì dùng
 * hằng số offset 0x01A2.
 *
 * Hằng số đó đúng với FIB của Word 97 chuẩn, nhưng vỡ ngay khi gặp file do bộ công cụ khác
 * sinh ra với `csw`/`cslw` khác. Đi theo độ dài khai báo thì luôn đúng.
 */
function locateClx(wordDocument: Buffer): { fcClx: number; lcbClx: number } {
  let at = 32 // hết FibBase
  const csw = wordDocument.readUInt16LE(at)
  at += 2 + csw * 2
  const cslw = wordDocument.readUInt16LE(at)
  at += 2 + cslw * 4
  const pairCount = wordDocument.readUInt16LE(at)
  at += 2

  // fcClx là cặp (fc, lcb) thứ 34 trong FibRgFcLcb97.
  const CLX_PAIR_INDEX = 33
  if (pairCount <= CLX_PAIR_INDEX) throw failure('doc FIB is too short to hold a piece table')
  const pairAt = at + CLX_PAIR_INDEX * 8
  if (pairAt + 8 > wordDocument.length) throw failure('doc FIB is truncated')

  return { fcClx: wordDocument.readUInt32LE(pairAt), lcbClx: wordDocument.readUInt32LE(pairAt + 4) }
}

interface Piece {
  readonly startCp: number
  readonly endCp: number
  readonly offset: number
  readonly compressed: boolean
}

/**
 * CLX là một chuỗi các khối tự mô tả. Khối `0x01` mang thuộc tính định dạng (bỏ qua), khối
 * `0x02` mới là piece table cần tìm.
 */
function readPieceTable(clx: Buffer): Piece[] {
  let at = 0
  while (at < clx.length) {
    const kind = clx.readUInt8(at)
    if (kind === CLX_GRPPRL) {
      if (at + 3 > clx.length) break
      at += 3 + clx.readUInt16LE(at + 1)
      continue
    }
    if (kind !== CLX_PLCFPCD) break

    if (at + 5 > clx.length) break
    const length = clx.readUInt32LE(at + 1)
    const start = at + 5
    if (start + length > clx.length) break
    return parsePlcfpcd(clx.subarray(start, start + length))
  }
  return []
}

/**
 * PLC = "plex": n+1 mốc CP (32-bit) rồi n cấu trúc dữ liệu 8 byte. Bố cục này lặp lại khắp
 * định dạng Word, nên số 12 dưới đây là 4 (một CP) + 8 (một PCD).
 */
function parsePlcfpcd(plc: Buffer): Piece[] {
  const count = Math.floor((plc.length - 4) / 12)
  if (count <= 0) return []

  const pieces: Piece[] = []
  for (let i = 0; i < count; i++) {
    const startCp = plc.readUInt32LE(i * 4)
    const endCp = plc.readUInt32LE((i + 1) * 4)
    const pcdAt = (count + 1) * 4 + i * 8
    if (pcdAt + 8 > plc.length) break

    const fc = plc.readUInt32LE(pcdAt + 2)
    const compressed = (fc & PCD_COMPRESSED) !== 0
    // Ở dạng nén, offset thật là nửa giá trị sau khi bỏ bit cờ — đó là cách Word nhét thêm
    // một bit cờ vào bên trong một offset 32-bit.
    const offset = compressed ? (fc & ~PCD_COMPRESSED) / 2 : fc

    pieces.push({ startCp, endCp, offset, compressed })
  }
  return pieces
}

/**
 * Word 6/95: không có piece table, văn bản nằm liền một khối giữa `fcMin` và `fcMac`, luôn ở
 * dạng 8-bit. Hiếm gặp nhưng rẻ để hỗ trợ, và nếu không có thì file loại này báo lỗi khó hiểu.
 */
function readWord95Range(wordDocument: Buffer, maxChars: number): string {
  const fcMin = wordDocument.readUInt32LE(0x18)
  const fcMac = wordDocument.readUInt32LE(0x1c)
  if (fcMac <= fcMin || fcMin >= wordDocument.length) {
    throw failure('doc text range is invalid')
  }
  const end = Math.min(fcMac, wordDocument.length, fcMin + maxChars)
  return decodeCp1252(wordDocument.subarray(fcMin, end))
}

function failure(detail: string): NexaError {
  return new NexaError(ERROR_CODES.DOCUMENT_EXTRACTION_FAILED, { safeDetail: detail })
}
