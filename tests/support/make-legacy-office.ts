/**
 * Sinh file Office 97-2003 (`.doc`, `.xls`, `.ppt`) tối thiểu nhưng HỢP LỆ.
 *
 * Cùng lý do như `make-pdf.ts` và `make-office.ts`: fixture nhị phân phải sinh ra từ mã đọc
 * được, không phải một blob commit vào repo. Ở đây điều đó còn quan trọng hơn — bộ đọc CFB và
 * ba bộ đọc định dạng cũ là phần khó kiểm chứng nhất của tính năng, nên fixture cần dựng được
 * đúng những chi tiết cần test: mảnh văn bản nén và không nén, chuỗi bị cắt qua bản ghi
 * CONTINUE, stream nhỏ nằm trong mini stream.
 */

const SECTOR_SIZE = 512
const MINI_SECTOR_SIZE = 64
const MINI_STREAM_CUTOFF = 4096
const ENDOFCHAIN = 0xfffffffe
const FREESECT = 0xffffffff
const FATSECT = 0xfffffffd
const DIRECTORY_ENTRY_SIZE = 128

export interface CfbStream {
  readonly name: string
  readonly data: Buffer
}

export function makeCfb(streams: readonly CfbStream[]): Buffer {
  const sectors: Buffer[] = []
  const fat: number[] = []

  /** Cắt dữ liệu thành sector, nối chúng thành chain trong FAT, trả về sector đầu. */
  const allocate = (data: Buffer): number => {
    if (data.length === 0) return ENDOFCHAIN
    const start = sectors.length
    const count = Math.ceil(data.length / SECTOR_SIZE)
    for (let i = 0; i < count; i++) {
      const sector = Buffer.alloc(SECTOR_SIZE)
      data.copy(sector, 0, i * SECTOR_SIZE, Math.min((i + 1) * SECTOR_SIZE, data.length))
      sectors.push(sector)
      fat.push(i === count - 1 ? ENDOFCHAIN : start + i + 1)
    }
    return start
  }

  const mini = streams.filter((s) => s.data.length > 0 && s.data.length < MINI_STREAM_CUTOFF)
  const regular = streams.filter((s) => s.data.length >= MINI_STREAM_CUTOFF)

  // Mini stream: các stream nhỏ nằm kề nhau trong một stream lớn do root nắm giữ.
  const miniChunks: Buffer[] = []
  const miniFat: number[] = []
  const miniStart = new Map<string, number>()
  for (const stream of mini) {
    const start = miniFat.length
    miniStart.set(stream.name, start)
    const count = Math.ceil(stream.data.length / MINI_SECTOR_SIZE)
    for (let i = 0; i < count; i++) {
      const block = Buffer.alloc(MINI_SECTOR_SIZE)
      stream.data.copy(
        block,
        0,
        i * MINI_SECTOR_SIZE,
        Math.min((i + 1) * MINI_SECTOR_SIZE, stream.data.length),
      )
      miniChunks.push(block)
      miniFat.push(i === count - 1 ? ENDOFCHAIN : start + i + 1)
    }
  }

  const regularStart = new Map<string, number>()
  for (const stream of regular) regularStart.set(stream.name, allocate(stream.data))

  const miniData = Buffer.concat(miniChunks)
  const miniContainerStart = allocate(miniData)

  const miniFatBytes = Buffer.alloc(
    Math.ceil((miniFat.length * 4) / SECTOR_SIZE) * SECTOR_SIZE,
    0xff,
  )
  miniFat.forEach((value, index) => miniFatBytes.writeUInt32LE(value >>> 0, index * 4))
  const miniFatStart = miniFat.length === 0 ? ENDOFCHAIN : allocate(miniFatBytes)
  const miniFatSectorCount = miniFat.length === 0 ? 0 : miniFatBytes.length / SECTOR_SIZE

  const directory = buildDirectory(streams, {
    miniStart,
    regularStart,
    miniContainerStart,
    miniDataLength: miniData.length,
  })
  const directoryStart = allocate(directory)

  // FAT phải mô tả cả chính các sector FAT, nên số lượng của nó là điểm bất động của phép
  // tính này — lặp vài vòng là hội tụ.
  const entriesPerSector = SECTOR_SIZE / 4
  let fatSectorCount = 1
  for (let i = 0; i < 8; i++) {
    const needed = Math.ceil((sectors.length + fatSectorCount) / entriesPerSector)
    if (needed === fatSectorCount) break
    fatSectorCount = needed
  }

  const fatSectorNumbers: number[] = []
  for (let i = 0; i < fatSectorCount; i++) {
    fatSectorNumbers.push(sectors.length)
    sectors.push(Buffer.alloc(SECTOR_SIZE))
    fat.push(FATSECT)
  }

  const fatBytes = Buffer.alloc(fatSectorCount * SECTOR_SIZE, 0xff)
  fat.forEach((value, index) => fatBytes.writeUInt32LE(value >>> 0, index * 4))
  fatSectorNumbers.forEach((sectorNumber, index) => {
    fatBytes.copy(
      sectors[sectorNumber] as Buffer,
      0,
      index * SECTOR_SIZE,
      (index + 1) * SECTOR_SIZE,
    )
  })

  const header = Buffer.alloc(SECTOR_SIZE, 0)
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(header, 0)
  header.writeUInt16LE(0x003e, 0x18) // minor version
  header.writeUInt16LE(0x0003, 0x1a) // major version 3 ⇒ sector 512 byte
  header.writeUInt16LE(0xfffe, 0x1c) // little endian
  header.writeUInt16LE(9, 0x1e) // 1 << 9 = 512
  header.writeUInt16LE(6, 0x20) // 1 << 6 = 64
  header.writeUInt32LE(0, 0x28) // số sector thư mục — không dùng ở phiên bản 3
  header.writeUInt32LE(fatSectorCount, 0x2c)
  header.writeUInt32LE(directoryStart, 0x30)
  header.writeUInt32LE(MINI_STREAM_CUTOFF, 0x38)
  header.writeUInt32LE(miniFatStart, 0x3c)
  header.writeUInt32LE(miniFatSectorCount, 0x40)
  header.writeUInt32LE(ENDOFCHAIN, 0x44) // không cần sector DIFAT phụ
  header.writeUInt32LE(0, 0x48)
  for (let i = 0; i < 109; i++) {
    header.writeUInt32LE(fatSectorNumbers[i] ?? FREESECT, 0x4c + i * 4)
  }

  return Buffer.concat([header, ...sectors])
}

function buildDirectory(
  streams: readonly CfbStream[],
  layout: {
    miniStart: Map<string, number>
    regularStart: Map<string, number>
    miniContainerStart: number
    miniDataLength: number
  },
): Buffer {
  const total = streams.length + 1
  const sectorCount = Math.ceil((total * DIRECTORY_ENTRY_SIZE) / SECTOR_SIZE)
  const buffer = Buffer.alloc(sectorCount * SECTOR_SIZE, 0)

  const writeEntry = (
    index: number,
    name: string,
    type: number,
    start: number,
    size: number,
    child: number,
    right: number,
  ): void => {
    const at = index * DIRECTORY_ENTRY_SIZE
    const encoded = Buffer.from(`${name}\0`, 'utf16le')
    encoded.copy(buffer, at)
    buffer.writeUInt16LE(encoded.length, at + 0x40)
    buffer.writeUInt8(type, at + 0x42)
    buffer.writeUInt8(1, at + 0x43) // màu đen
    buffer.writeUInt32LE(FREESECT, at + 0x44) // anh em trái
    buffer.writeUInt32LE(right >>> 0, at + 0x48)
    buffer.writeUInt32LE(child >>> 0, at + 0x4c)
    buffer.writeUInt32LE(start >>> 0, at + 0x74)
    buffer.writeBigUInt64LE(BigInt(size), at + 0x78)
  }

  writeEntry(
    0,
    'Root Entry',
    5,
    layout.miniContainerStart,
    layout.miniDataLength,
    streams.length > 0 ? 1 : FREESECT,
    FREESECT,
  )

  streams.forEach((stream, index) => {
    const entryIndex = index + 1
    const start =
      layout.regularStart.get(stream.name) ?? layout.miniStart.get(stream.name) ?? ENDOFCHAIN
    writeEntry(
      entryIndex,
      stream.name,
      2,
      start,
      stream.data.length,
      FREESECT,
      entryIndex + 1 < streams.length + 1 ? entryIndex + 1 : FREESECT,
    )
  })

  // Ô thừa trong sector cuối phải mang objectType = 0 (unallocated), không phải rác.
  for (let index = total; index < sectorCount * (SECTOR_SIZE / DIRECTORY_ENTRY_SIZE); index++) {
    buffer.writeUInt32LE(FREESECT, index * DIRECTORY_ENTRY_SIZE + 0x44)
    buffer.writeUInt32LE(FREESECT, index * DIRECTORY_ENTRY_SIZE + 0x48)
    buffer.writeUInt32LE(FREESECT, index * DIRECTORY_ENTRY_SIZE + 0x4c)
  }

  return buffer
}

// ── Word 97 ───────────────────────────────────────────────────────────────

export interface DocPiece {
  readonly text: string
  /** true ⇒ mảnh lưu 8-bit (windows-1252); false ⇒ UTF-16LE. File thật trộn lẫn cả hai. */
  readonly compressed: boolean
}

/**
 * Dựng `.doc` với piece table thật.
 *
 * Đây là điểm mấu chốt cần test: văn bản KHÔNG nằm liền mạch trong stream. Fixture cố ý đặt
 * các mảnh theo thứ tự lộn xộn trong file để một bộ đọc "quét thẳng byte" sẽ ra kết quả sai.
 */
export function makeDoc(pieces: readonly DocPiece[]): Buffer {
  const TEXT_BASE = 0x1000
  const wordDocument = Buffer.alloc(0x4000, 0)

  wordDocument.writeUInt16LE(0xa5ec, 0) // wIdent
  wordDocument.writeUInt16LE(193, 2) // nFib = Word 97
  wordDocument.writeUInt16LE(0x0200, 0x0a) // fWhichTblStm ⇒ dùng 1Table

  // Ba khối độ dài tự khai của FIB, đúng như Word 97 ghi ra.
  wordDocument.writeUInt16LE(0x000e, 0x20) // csw
  wordDocument.writeUInt16LE(0x0016, 0x3e) // cslw
  wordDocument.writeUInt16LE(0x005d, 0x98) // cbRgFcLcb = 93 cặp
  const fcLcbBase = 0x9a

  // Đặt các mảnh CHẠY NGƯỢC trong file: mảnh cuối của tài liệu nằm ở offset thấp nhất.
  const placements: { offset: number; length: number; compressed: boolean }[] = []
  let cursor = TEXT_BASE
  for (const piece of [...pieces].reverse()) {
    const bytes = piece.compressed
      ? Buffer.from(piece.text, 'latin1')
      : Buffer.from(piece.text, 'utf16le')
    bytes.copy(wordDocument, cursor)
    placements.unshift({ offset: cursor, length: piece.text.length, compressed: piece.compressed })
    cursor += bytes.length + 8
  }

  // PLC: n+1 mốc CP rồi n cấu trúc PCD 8 byte.
  const characterPositions: number[] = [0]
  for (const placement of placements) {
    characterPositions.push(
      (characterPositions[characterPositions.length - 1] ?? 0) + placement.length,
    )
  }

  const plc = Buffer.alloc(characterPositions.length * 4 + placements.length * 8)
  characterPositions.forEach((cp, index) => plc.writeUInt32LE(cp, index * 4))
  placements.forEach((placement, index) => {
    const at = characterPositions.length * 4 + index * 8
    const fc = placement.compressed ? 0x40000000 | (placement.offset * 2) : placement.offset
    plc.writeUInt16LE(0, at)
    plc.writeUInt32LE(fc >>> 0, at + 2)
    plc.writeUInt16LE(0, at + 6)
  })

  const clx = Buffer.concat([Buffer.from([0x02]), uint32(plc.length), plc])
  const table = Buffer.alloc(Math.max(0x1000, clx.length + 0x100), 0)
  const fcClx = 0x40
  clx.copy(table, fcClx)

  const CLX_PAIR_INDEX = 33
  wordDocument.writeUInt32LE(fcClx, fcLcbBase + CLX_PAIR_INDEX * 8)
  wordDocument.writeUInt32LE(clx.length, fcLcbBase + CLX_PAIR_INDEX * 8 + 4)

  return makeCfb([
    { name: 'WordDocument', data: wordDocument },
    { name: '1Table', data: table },
  ])
}

// ── Excel 97 (BIFF8) ──────────────────────────────────────────────────────

export interface XlsSheetFixture {
  readonly name: string
  readonly rows: readonly (readonly (string | number | null)[])[]
}

/** Dựng `.xls` dùng SST cho ô chữ và bản ghi NUMBER cho ô số. */
export function makeXls(sheets: readonly XlsSheetFixture[]): Buffer {
  const sharedStrings: string[] = []
  const indexOf = (value: string): number => {
    const found = sharedStrings.indexOf(value)
    if (found >= 0) return found
    sharedStrings.push(value)
    return sharedStrings.length - 1
  }
  for (const sheet of sheets) {
    for (const row of sheet.rows) {
      for (const cell of row) if (typeof cell === 'string') indexOf(cell)
    }
  }

  const sheetBodies = sheets.map((sheet) => {
    const records: Buffer[] = [
      record(0x0809, Buffer.concat([uint16(0x0600), uint16(0x0010), Buffer.alloc(12)])),
    ]
    sheet.rows.forEach((row, rowIndex) => {
      row.forEach((cell, columnIndex) => {
        if (cell === null) return
        if (typeof cell === 'number') {
          const body = Buffer.alloc(14)
          body.writeUInt16LE(rowIndex, 0)
          body.writeUInt16LE(columnIndex, 2)
          body.writeDoubleLE(cell, 6)
          records.push(record(0x0203, body))
          return
        }
        const body = Buffer.alloc(10)
        body.writeUInt16LE(rowIndex, 0)
        body.writeUInt16LE(columnIndex, 2)
        body.writeUInt32LE(indexOf(cell), 6)
        records.push(record(0x00fd, body))
      })
    })
    records.push(record(0x000a, Buffer.alloc(0)))
    return Buffer.concat(records)
  })

  const globalsWithoutBoundsheets = Buffer.concat([
    record(0x0809, Buffer.concat([uint16(0x0600), uint16(0x0005), Buffer.alloc(12)])),
  ])
  const sst = record(
    0x00fc,
    Buffer.concat([
      uint32(sharedStrings.length),
      uint32(sharedStrings.length),
      ...sharedStrings.map((value) => {
        const encoded = Buffer.from(value, 'utf16le')
        return Buffer.concat([uint16(value.length), Buffer.from([0x01]), encoded])
      }),
    ]),
  )
  const globalsEof = record(0x000a, Buffer.alloc(0))

  // BOUNDSHEET phải mang offset thật của BOF từng sheet, nên tính độ dài trước rồi mới ghi.
  const boundsheetSize = sheets.reduce(
    (total, sheet) => total + 4 + 6 + 2 + Buffer.from(sheet.name, 'latin1').length,
    0,
  )
  const globalsSize =
    globalsWithoutBoundsheets.length + boundsheetSize + sst.length + globalsEof.length

  let position = globalsSize
  const boundsheets = sheets.map((sheet, index) => {
    const name = Buffer.from(sheet.name, 'latin1')
    const body = Buffer.concat([
      uint32(position),
      uint16(0), // hiện, kiểu worksheet
      Buffer.from([name.length, 0x00]), // cch + grbitChr (8-bit)
      name,
    ])
    position += sheetBodies[index]?.length ?? 0
    return record(0x0085, body)
  })

  return makeCfb([
    {
      name: 'Workbook',
      data: Buffer.concat([
        globalsWithoutBoundsheets,
        ...boundsheets,
        sst,
        globalsEof,
        ...sheetBodies,
      ]),
    },
  ])
}

// ── PowerPoint 97 ─────────────────────────────────────────────────────────

export interface PptSlideFixture {
  readonly lines: readonly string[]
  /** true ⇒ lưu bằng TextBytesAtom (8-bit) thay vì TextCharsAtom (UTF-16). */
  readonly bytes?: boolean
}

export function makePpt(slides: readonly PptSlideFixture[]): Buffer {
  const containers = slides.map((slide) => {
    const atoms = slide.lines.map((line) =>
      slide.bytes === true
        ? pptRecord(0x0fa8, Buffer.from(line, 'latin1'), 0)
        : pptRecord(0x0fa0, Buffer.from(line, 'utf16le'), 0),
    )
    return pptRecord(0x03ee, Buffer.concat(atoms), 0x0f)
  })

  const stream = Buffer.concat(containers)
  // Stream phải đủ lớn để không rơi vào mini stream ở một số fixture — đệm thêm cho chắc.
  return makeCfb([{ name: 'PowerPoint Document', data: stream }])
}

function pptRecord(type: number, body: Buffer, version: number): Buffer {
  const header = Buffer.alloc(8)
  header.writeUInt16LE(version, 0)
  header.writeUInt16LE(type, 2)
  header.writeUInt32LE(body.length, 4)
  return Buffer.concat([header, body])
}

// ── Tiện ích ──────────────────────────────────────────────────────────────

function record(type: number, body: Buffer): Buffer {
  return Buffer.concat([uint16(type), uint16(body.length), body])
}

function uint16(value: number): Buffer {
  const buffer = Buffer.alloc(2)
  buffer.writeUInt16LE(value)
  return buffer
}

function uint32(value: number): Buffer {
  const buffer = Buffer.alloc(4)
  buffer.writeUInt32LE(value >>> 0)
  return buffer
}
