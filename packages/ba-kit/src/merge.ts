import { analyzeSimilarity, fingerprint, type SimilarPair } from './dedupe.js'
import { ITEM_TYPES, type BaDocItem, type BaDocLink, type BaDocModel } from './model.js'

/**
 * Hợp nhất kết quả trích xuất của nhiều chunk thành một mô hình (D4 quy tắc 3).
 *
 * Tài liệu dài được cắt theo heading và trích xuất từng phần độc lập, nên cùng một use case hay
 * cùng một mã lỗi xuất hiện ở hai chunk là chuyện bình thường, không phải lỗi. Việc của module này
 * là gộp cái chắc chắn là một, và **chỉ gắn cờ** cái nghi ngờ là một.
 */

export interface MergeResult {
  readonly model: BaDocModel
  /** Cặp gần-trùng để người dùng quyết định — không được tự gộp (D5). */
  readonly nearDuplicates: readonly SimilarPair[]
  /** Cặp giống từ ngữ nhưng lệch phủ định. Không bao giờ được đề xuất gộp. */
  readonly potentialContradictions: readonly SimilarPair[]
  /** Số item bị gộp vì trùng khít. Hiển thị được để người dùng biết đã xảy ra chuyện gì. */
  readonly mergedCount: number
}

function unionSources(a: readonly string[], b: readonly string[]): string[] {
  return [...new Set([...a, ...b])].sort()
}

/**
 * Chọn bản nội dung khi hai item trùng khít.
 *
 * Bản đã chắc chắn thắng bản `needsReview`; ngoài ra bản gặp trước thắng. Không trộn trường của
 * hai bản: một use case nửa lấy luồng chính của chunk này, nửa lấy postcondition của chunk kia là
 * một use case chưa từng tồn tại trong tài liệu gốc.
 */
function pickContent(existing: BaDocItem, incoming: BaDocItem): BaDocItem {
  if (existing.needsReview && !incoming.needsReview) return incoming
  return existing
}

export function mergeChunkModels(chunks: readonly BaDocModel[]): MergeResult {
  const byKey = new Map<string, BaDocItem>()
  /** id cũ → id còn sống sau khi gộp. Dùng để chiếu lại link. */
  const idMap = new Map<string, string>()
  const order: string[] = []
  let mergedCount = 0

  for (const chunk of chunks) {
    for (const item of chunk.items) {
      const key = fingerprint(item)
      const existing = byKey.get(key)
      if (existing === undefined) {
        byKey.set(key, item)
        idMap.set(item.id, item.id)
        order.push(key)
        continue
      }

      mergedCount += 1
      idMap.set(item.id, existing.id)
      const winner = pickContent(existing, item)
      byKey.set(key, {
        ...winner,
        // Id của bản gặp trước luôn thắng, kể cả khi nội dung lấy từ bản sau — nếu không, link đã
        // chiếu sang id cũ sẽ trỏ vào hư không.
        id: existing.id,
        sources: unionSources(existing.sources, item.sources),
      } as BaDocItem)
    }
  }

  const merged = order
    .map((key) => byKey.get(key))
    .filter((item): item is BaDocItem => item !== undefined)

  // Ordinal gán lại theo nhóm kiểu, thứ tự xuất hiện đầu tiên. Ordinal của từng chunk vô nghĩa
  // sau khi hợp nhất, và giữ lại chúng sẽ cho ra một tài liệu có hai item cùng ordinal.
  const items: BaDocItem[] = []
  for (const itemType of ITEM_TYPES) {
    let ordinal = 0
    for (const item of merged) {
      if (item.itemType !== itemType) continue
      items.push({ ...item, ordinal } as BaDocItem)
      ordinal += 1
    }
  }

  const alive = new Set(items.map((item) => item.id))
  const seenLinks = new Set<string>()
  const links: BaDocLink[] = []
  for (const chunk of chunks) {
    for (const link of chunk.links) {
      const from = idMap.get(link.from) ?? link.from
      const to = idMap.get(link.to) ?? link.to
      // Link tự trỏ vào chính mình xuất hiện khi hai đầu bị gộp làm một. Nó không mang thông tin.
      if (from === to) continue
      if (!alive.has(from) || !alive.has(to)) continue
      const key = `${from}|${to}|${link.kind}|${link.label ?? ''}`
      if (seenLinks.has(key)) continue
      seenLinks.add(key)
      links.push({ ...link, from, to })
    }
  }

  const similarity = analyzeSimilarity(items)
  return {
    model: { items, links },
    nearDuplicates: similarity.nearDuplicates,
    potentialContradictions: similarity.potentialContradictions,
    mergedCount,
  }
}

/**
 * Gộp hai item do NGƯỜI DÙNG chỉ định — không phải do bộ dò trùng tự quyết (D5).
 *
 * Bộ dò trùng chỉ gắn cờ; hàm này chạy sau khi có người bấm "gộp". Nó giữ item `keepId`, cộng dồn
 * `sources`, chiếu mọi cạnh của `dropId` sang `keepId`, rồi bỏ cạnh tự trỏ và cạnh trùng.
 *
 * Hai item khác kiểu thì từ chối: gộp một rule vào một use case không có nghĩa gì, và nếu để lọt
 * thì cái mất đi là nội dung nghiệp vụ chứ không phải một dòng dữ liệu.
 */
export function mergeItemsInModel(
  model: BaDocModel,
  keepId: string,
  dropId: string,
): { readonly model: BaDocModel; readonly merged: boolean; readonly reason?: string } {
  if (keepId === dropId) return { model, merged: false, reason: 'Hai id trùng nhau.' }

  const keep = model.items.find((item) => item.id === keepId)
  const drop = model.items.find((item) => item.id === dropId)
  if (keep === undefined || drop === undefined) {
    return { model, merged: false, reason: 'Không tìm thấy một trong hai item.' }
  }
  if (keep.itemType !== drop.itemType) {
    return { model, merged: false, reason: 'Chỉ gộp được hai item cùng kiểu.' }
  }

  const items = model.items
    .filter((item) => item.id !== dropId)
    .map((item) =>
      item.id === keepId
        ? ({ ...item, sources: unionSources(keep.sources, drop.sources) } as BaDocItem)
        : item,
    )

  const alive = new Set(items.map((item) => item.id))
  const seen = new Set<string>()
  const links: BaDocLink[] = []
  for (const link of model.links) {
    const from = link.from === dropId ? keepId : link.from
    const to = link.to === dropId ? keepId : link.to
    if (from === to) continue
    if (!alive.has(from) || !alive.has(to)) continue
    const key = `${from}|${to}|${link.kind}|${link.label ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    links.push({ ...link, from, to })
  }

  return { model: { items, links }, merged: true }
}
