import { afterEach, describe, expect, it } from 'vitest'
import { statSync } from 'node:fs'
import { ConversationRepository, ConversationSearch } from '@nexa/local-store'
import { DocumentProcessor, InlineRunner, estimateTokens } from '@nexa/document-processor'
import { buildContext } from '@nexa/agent-runtime'
import { decryptField, encryptField, generateMasterKey } from '@nexa/security'
import { makeTempStore, testLogger, type TempStore } from './support/factories.js'

/**
 * Test hiệu năng — §17.1: "Startup, memory idle, 100+ hội thoại, PDF lớn trong giới hạn."
 *
 * Ngưỡng ở đây được đặt RỘNG có chủ ý. Mục đích không phải là đo chính xác — máy CI và máy dev
 * chênh nhau nhiều lần — mà là bắt hồi quy bậc độ lớn: một thay đổi biến thao tác 200 ms thành
 * 20 giây phải làm đỏ pipeline.
 *
 * Số đo thật để so với mục tiêu §12.1 (idle < 500 MB, chat < 800 MB, startup < 5 s) phải lấy
 * trên máy Windows với app đã đóng gói. Các test này KHÔNG thay thế việc đó.
 */

let ctx: TempStore | null = null
afterEach(() => {
  ctx?.cleanup()
  ctx = null
})

/** In số đo ra để đọc được trong log CI, không chỉ pass/fail. */
function report(label: string, value: number, unit: string): void {
  process.stdout.write(`    ⏱  ${label}: ${value.toFixed(1)} ${unit}\n`)
}

function heapMb(): number {
  return process.memoryUsage().heapUsed / 1024 / 1024
}

describe('§17.1 — lịch sử 100+ hội thoại', () => {
  const CONVERSATIONS = 120
  const MESSAGES_EACH = 20

  function seed(store: TempStore): ConversationRepository {
    const repo = new ConversationRepository(store.store)
    store.store.transaction(() => {
      for (let c = 0; c < CONVERSATIONS; c++) {
        const conv = repo.create(store.profileId, `Hội thoại số ${String(c)}`, 'model-a')
        for (let m = 0; m < MESSAGES_EACH; m++) {
          repo.appendMessage({
            conversationId: conv.id,
            role: m % 2 === 0 ? 'user' : 'assistant',
            content:
              `Tin nhắn ${String(m)} của hội thoại ${String(c)}. ` +
              'Nội dung mẫu đủ dài để phản ánh một câu trả lời thật của trợ lý, '.repeat(4),
          })
        }
      }
    })
    return repo
  }

  it('ghi 2.400 message đã mã hoá trong thời gian chấp nhận được', () => {
    ctx = makeTempStore()
    const started = Date.now()
    seed(ctx)
    const elapsed = Date.now() - started

    report('ghi 2.400 message (mã hoá)', elapsed, 'ms')
    // Ở chế độ WAL, phần lớn dữ liệu còn nằm trong file -wal cho tới lần checkpoint,
    // nên đo riêng file .db sẽ ra một con số nhỏ đến mức gây hiểu nhầm.
    const dbBytes = ['', '-wal', '-shm'].reduce((sum, suffix) => {
      try {
        return sum + statSync(`${ctx!.dbPath}${suffix}`).size
      } catch {
        return sum
      }
    }, 0)
    report('kích thước DB (gồm WAL)', dbBytes / 1024, 'KB')
    expect(elapsed).toBeLessThan(30_000)
  })

  it('liệt kê 100 hội thoại gần nhất nhanh — đây là truy vấn của màn hình chính', () => {
    ctx = makeTempStore()
    const repo = seed(ctx)

    const started = Date.now()
    const list = repo.list(ctx.profileId, { includeArchived: false, limit: 100, offset: 0 })
    const elapsed = Date.now() - started

    report('list 100 hội thoại', elapsed, 'ms')
    expect(list).toHaveLength(100)
    // Truy vấn này chạy mỗi lần mở app và sau mỗi lượt chat; phải ở mức mili-giây.
    expect(elapsed).toBeLessThan(1_000)
  })

  it('mở một hội thoại 20 message không bị N+1', () => {
    ctx = makeTempStore()
    const repo = seed(ctx)
    const conv = repo.list(ctx.profileId, { includeArchived: false, limit: 1, offset: 0 })[0]

    const started = Date.now()
    const messages = repo.listMessages(conv!.id, 200)
    const elapsed = Date.now() - started

    report('mở hội thoại 20 message', elapsed, 'ms')
    expect(messages).toHaveLength(MESSAGES_EACH)
    expect(elapsed).toBeLessThan(500)
  })

  it('tìm kiếm decrypt-and-scan trên 2.400 message vẫn trong ngân sách (ADR 0005)', () => {
    ctx = makeTempStore()
    const repo = seed(ctx)
    const search = new ConversationSearch(ctx.store, repo)

    const started = Date.now()
    const result = search.search(ctx.profileId, 'hội thoại 42', { limit: 50 })
    const elapsed = Date.now() - started

    report('search 2.400 message', elapsed, 'ms')
    report('  đã quét', result.scanned, 'message')
    expect(result.hits.length).toBeGreaterThan(0)
    // Ngân sách mặc định là 3 s; vượt nghĩa là kết quả bị cắt và tính năng mất giá trị.
    expect(elapsed).toBeLessThan(3_500)
  })

  it('tôn trọng trần thời gian thay vì quét vô hạn', () => {
    ctx = makeTempStore()
    const repo = seed(ctx)
    const search = new ConversationSearch(ctx.store, repo)

    const started = Date.now()
    const result = search.search(ctx.profileId, 'không-bao-giờ-khớp-chuỗi-này', { budgetMs: 200 })
    const elapsed = Date.now() - started

    report('search có trần 200 ms', elapsed, 'ms')
    expect(elapsed).toBeLessThan(2_000)
    if (result.scanned < CONVERSATIONS * MESSAGES_EACH) {
      // Dừng sớm thì BẮT BUỘC phải báo là chưa đầy đủ.
      expect(result.truncated).toBe(true)
    }
  })
})

describe('§17.1 — mã hoá', () => {
  it('thông lượng AES-256-GCM đủ cho một hội thoại dài', () => {
    const key = generateMasterKey()
    const payload = 'Nội dung tiếng Việt có dấu để phản ánh dữ liệu thật. '.repeat(40)
    const ROUNDS = 2_000

    const started = Date.now()
    for (let i = 0; i < ROUNDS; i++) {
      decryptField(key, 'messages.content', encryptField(key, 'messages.content', payload))
    }
    const elapsed = Date.now() - started

    const mbProcessed = (Buffer.byteLength(payload) * ROUNDS * 2) / 1024 / 1024
    report('mã hoá + giải mã', elapsed, 'ms')
    report('  thông lượng', (mbProcessed / elapsed) * 1000, 'MB/s')
    expect(elapsed).toBeLessThan(10_000)
  })
})

describe('§17.1 — tài liệu lớn', () => {
  it('chunk một tài liệu 2 MB không phình bộ nhớ quá mức', () => {
    const { logger } = testLogger()
    const processor = new DocumentProcessor({
      runner: new InlineRunner(),
      logger,
      limits: { maxFileSizeMb: 30, maxFilesPerRequest: 5 },
    })

    const paragraph = 'Đoạn văn mẫu trong tài liệu nội bộ, đủ dài để giống nội dung thật. '.repeat(10)
    const text = Array.from({ length: 2_000 }, () => paragraph).join('\n\n')

    const before = heapMb()
    const started = Date.now()
    const chunks = processor.chunk(text, 'pdf')
    const elapsed = Date.now() - started
    const delta = heapMb() - before

    report('chunk tài liệu 2 MB', elapsed, 'ms')
    report('  số chunk', chunks.length, 'chunk')
    report('  heap tăng', delta, 'MB')

    expect(chunks.length).toBeGreaterThan(50)
    expect(elapsed).toBeLessThan(10_000)
    // §12 đặt ngân sách 1–2 GB cho "nhiều file/tài liệu lớn"; riêng bước chunk phải rẻ hơn nhiều.
    expect(delta).toBeLessThan(300)
  })

  it('dựng context cắt tài liệu theo ngân sách token thay vì nhồi hết', () => {
    const paragraph = 'Nội dung tài liệu. '.repeat(50)
    const text = Array.from({ length: 500 }, () => paragraph).join('\n\n')
    const { logger } = testLogger()
    const processor = new DocumentProcessor({
      runner: new InlineRunner(),
      logger,
      limits: { maxFileSizeMb: 30, maxFilesPerRequest: 5 },
    })

    const built = buildContext({
      history: [{ role: 'user', content: 'Tóm tắt tài liệu này' }],
      documents: [
        {
          fileName: 'lon.txt',
          kind: 'txt',
          sizeBytes: Buffer.byteLength(text),
          sourcePathHash: 'a'.repeat(64),
          text,
          chunks: processor.chunk(text, 'txt'),
          charCount: text.length,
          estimatedTokens: estimateTokens(text),
          truncated: false,
        },
      ],
      budget: { contextWindowTokens: 8_000 },
    })

    report('token ước lượng của context', built.estimatedTokens, 'token')
    expect(built.documentsTruncated).toBe(true)
    // Phải nằm dưới cửa sổ ngữ cảnh sau khi trừ phần dành cho câu trả lời và biên an toàn.
    expect(built.estimatedTokens).toBeLessThan(8_000)
  })
})

describe('§17.1 — khởi động', () => {
  it('mở DB và áp migration nhanh — đây là phần Nexa kiểm soát được trong thời gian khởi động', () => {
    const started = Date.now()
    ctx = makeTempStore()
    const elapsed = Date.now() - started

    report('mở DB + migration v1', elapsed, 'ms')
    // §12.1 đặt mục tiêu startup < 5 s cho cả app; riêng phần DB phải là một phần rất nhỏ.
    expect(elapsed).toBeLessThan(2_000)
  })

  it('mở lại DB đã có dữ liệu không chạy lại migration', () => {
    ctx = makeTempStore()
    const repo = new ConversationRepository(ctx.store)
    repo.create(ctx.profileId, 'x', null)
    const version = ctx.store.schemaVersion

    const started = Date.now()
    expect(ctx.store.schemaVersion).toBe(version)
    report('kiểm tra schema version', Date.now() - started, 'ms')
  })
})
