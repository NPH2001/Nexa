import type { ConversationRepository } from './repositories/conversation-repository.js'
import type { LocalStore } from './store.js'

/**
 * Tìm kiếm hội thoại trên nội dung ĐÃ MÃ HOÁ.
 *
 * Đây là điểm thiết kế đáng chú ý nhất của EPIC-05 — tài liệu yêu cầu search (§2.1) nhưng
 * §8.1 lưu `content_ciphertext`, nên không `LIKE` được. Xem docs/OPEN-QUESTIONS.md A9 để biết
 * các phương án đã cân nhắc và vì sao chọn decrypt-and-scan.
 *
 * Hai chốt chặn để không treo UI khi lịch sử lớn:
 *   - `maxMessagesScanned`: trần số message
 *   - `budgetMs`: trần thời gian
 * Chạm bất kỳ trần nào ⇒ trả `truncated: true` để UI nói rõ "kết quả chưa đầy đủ" thay vì
 * để người dùng tưởng là không có gì.
 */

export interface SearchOptions {
  readonly limit?: number
  readonly maxMessagesScanned?: number
  readonly budgetMs?: number
  readonly batchSize?: number
  /** Bỏ dấu tiếng Việt khi so khớp. Mặc định bật. */
  readonly diacriticInsensitive?: boolean
}

export interface SearchHit {
  readonly conversationId: string
  readonly conversationTitle: string
  readonly messageId: string
  readonly createdAt: string
  /** Đoạn văn bản quanh vị trí khớp. Đã cắt ngắn. */
  readonly snippet: string
}

export interface SearchResult {
  readonly hits: readonly SearchHit[]
  readonly scanned: number
  readonly truncated: boolean
  readonly elapsedMs: number
}

const SNIPPET_RADIUS = 60

export class ConversationSearch {
  constructor(
    private readonly store: LocalStore,
    private readonly conversations: ConversationRepository,
  ) {}

  search(profileId: string, rawQuery: string, opts: SearchOptions = {}): SearchResult {
    const limit = opts.limit ?? 50
    const maxScanned = opts.maxMessagesScanned ?? 2_000
    const budgetMs = opts.budgetMs ?? 3_000
    const batchSize = opts.batchSize ?? 200
    const fold = opts.diacriticInsensitive !== false

    const needle = normalize(rawQuery, fold)
    if (needle === '') {
      return { hits: [], scanned: 0, truncated: false, elapsedMs: 0 }
    }

    const startedAt = Date.now()
    const hits: SearchHit[] = []
    const titleCache = new Map<string, string>()
    let scanned = 0
    let offset = 0
    let truncated = false

    while (hits.length < limit && scanned < maxScanned) {
      if (Date.now() - startedAt > budgetMs) {
        truncated = true
        break
      }

      const batch = this.conversations.scanBatch(profileId, offset, batchSize)
      if (batch.length === 0) break
      offset += batch.length

      for (const row of batch) {
        scanned++
        let plaintext: string
        try {
          plaintext = this.conversations.decryptContent(row.ciphertext)
        } catch {
          // Một bản ghi hỏng không được làm chết cả lần tìm kiếm.
          continue
        }

        const haystack = normalize(plaintext, fold)
        const at = haystack.indexOf(needle)
        if (at < 0) continue

        hits.push({
          conversationId: row.conversationId,
          conversationTitle: this.titleFor(row.conversationId, titleCache),
          messageId: row.messageId,
          createdAt: row.createdAt,
          snippet: makeSnippet(plaintext, at, needle.length),
        })
        if (hits.length >= limit) break
      }
    }

    if (scanned >= maxScanned) truncated = true

    const elapsedMs = Date.now() - startedAt
    this.store.log.perf('conversation-search', {
      durationMs: elapsedMs,
      scanned,
      hitCount: hits.length,
      truncated,
    })

    return { hits, scanned, truncated, elapsedMs }
  }

  private titleFor(conversationId: string, cache: Map<string, string>): string {
    const cached = cache.get(conversationId)
    if (cached !== undefined) return cached
    const row = this.store.handle
      .prepare('SELECT title_ciphertext FROM conversations WHERE id = ?')
      .get(conversationId)
    let title = '(không đọc được tiêu đề)'
    if (row !== undefined) {
      try {
        title = this.conversations.decryptTitle(String(row['title_ciphertext']))
      } catch {
        // giữ nguyên nhãn mặc định
      }
    }
    cache.set(conversationId, title)
    return title
  }
}

/**
 * Chuẩn hoá để so khớp: NFD tách dấu ra rồi bỏ dấu, hạ chữ thường.
 * Nhờ vậy "kế hoạch" tìm được "ke hoach" và ngược lại — điều người dùng Việt luôn mong đợi.
 * `đ`/`Đ` không phải tổ hợp dấu nên phải xử lý riêng.
 */
export function normalize(input: string, foldDiacritics: boolean): string {
  const lower = input.toLowerCase()
  if (!foldDiacritics) return lower
  return lower
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
}

function makeSnippet(text: string, at: number, matchLen: number): string {
  // `at` là chỉ số trên chuỗi đã normalize. Với tiếng Việt, NFD làm độ dài lệch so với bản gốc,
  // nên đây là xấp xỉ — đủ tốt cho snippet, và ta cắt rộng ra hai bên để không hụt.
  const start = Math.max(0, at - SNIPPET_RADIUS)
  const end = Math.min(text.length, at + matchLen + SNIPPET_RADIUS)
  const body = text.slice(start, end).replace(/\s+/g, ' ').trim()
  return `${start > 0 ? '…' : ''}${body}${end < text.length ? '…' : ''}`
}
