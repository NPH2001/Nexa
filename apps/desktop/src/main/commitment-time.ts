import { ERROR_CODES, NexaError } from '@nexa/shared-types'

/**
 * Chuẩn hoá mốc thời gian cho commitment do model đề xuất.
 *
 * Vì sao phân giải ở main process chứ không bắt model trả ISO: model không biết chắc "hôm nay"
 * là ngày nào theo giờ máy người dùng, và một mốc lệch một ngày sẽ âm thầm sinh nhắc việc sai.
 * Ở đây có `now` thật, nên đây là chỗ duy nhất được phép quyết định "thứ 6 tuần sau" là ngày nào.
 *
 * Hàm THUẦN: mọi phụ thuộc thời gian đi qua tham số `now`. Không phân giải được thì ném lỗi —
 * đoán một mốc gần đúng còn tệ hơn hỏi lại người dùng.
 */

/** Giờ mặc định khi người dùng chỉ nói ngày: cuối giờ làm việc. */
const DEFAULT_HOUR = 17
const DEFAULT_MINUTE = 0

/** Thứ 2 = 1 … Chủ nhật = 7, theo cách gọi ngày trong tiếng Việt. */
const WEEKDAY_WORDS: Readonly<Record<string, number>> = {
  'thu 2': 1,
  'thu hai': 1,
  'thu 3': 2,
  'thu ba': 2,
  'thu 4': 3,
  'thu tu': 3,
  'thu 5': 4,
  'thu nam': 4,
  'thu 6': 5,
  'thu sau': 5,
  'thu 7': 6,
  'thu bay': 6,
  'chu nhat': 7,
  'cn': 7,
}

const UNIT_DAYS: Readonly<Record<string, 'day' | 'week' | 'month'>> = {
  ngay: 'day',
  tuan: 'week',
  thang: 'month',
}

export function resolveCommitmentTimestamp(input: string, now: Date): string {
  const raw = input.trim()
  if (raw === '') fail('mốc thời gian rỗng')

  // ISO đi thẳng: model đã có mốc tuyệt đối thì không việc gì phải đoán lại.
  if (/^\d{4}-\d{2}-\d{2}([T ]|$)/.test(raw)) {
    const parsed = new Date(raw.length <= 10 ? `${raw}T${pad(DEFAULT_HOUR)}:00:00` : raw)
    if (Number.isNaN(parsed.getTime())) fail(`không đọc được mốc ISO "${raw}"`)
    return parsed.toISOString()
  }

  const text = normalize(raw)
  const time = extractTimeOfDay(text)
  const dayText = time.rest

  // Thứ tự KHÔNG tuỳ tiện: mẫu hẹp trước mẫu rộng. "thứ 6 tuần sau" chứa cả "6 tuần", nên nếu
  // hỏi offset đếm được trước thì nó bị đọc thành "6 tuần nữa" — sai một tháng rưỡi mà vẫn im
  // lặng thành công.
  const explicit = resolveExplicitDate(dayText, now)
  if (explicit !== null) return withTime(explicit, time)

  const weekday = resolveWeekday(dayText, now)
  if (weekday !== null) return withTime(weekday, time)

  const boundary = resolveBoundary(dayText, now)
  if (boundary !== null) return withTime(boundary, time)

  const relative = resolveRelativeOffset(dayText, now)
  if (relative !== null) return withTime(relative, time)

  // Chỉ có giờ, không có ngày ⇒ hiểu là hôm nay, và nếu đã qua thì ngày mai.
  if (time.hour !== null) {
    const today = startOfDay(now)
    const candidate = setTime(today, time.hour, time.minute ?? 0)
    if (candidate.getTime() <= now.getTime()) candidate.setDate(candidate.getDate() + 1)
    return candidate.toISOString()
  }

  fail(`không hiểu mốc thời gian "${raw}"`)
}

// ── Phân giải từng dạng ────────────────────────────────────────────────────

/** "20/9", "20/09/2026", "ngày 20 tháng 9". */
function resolveExplicitDate(text: string, now: Date): Date | null {
  const slash = /(?:^|\s)(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?(?:\s|$)/.exec(text)
  if (slash !== null) {
    const day = Number(slash[1])
    const month = Number(slash[2])
    const year = slash[3] === undefined ? now.getFullYear() : Number(slash[3])
    return makeDate(year, month, day, slash[3] === undefined ? now : null)
  }

  const spelled = /ngay (\d{1,2}) thang (\d{1,2})(?: nam (\d{4}))?/.exec(text)
  if (spelled !== null) {
    const day = Number(spelled[1])
    const month = Number(spelled[2])
    const year = spelled[3] === undefined ? now.getFullYear() : Number(spelled[3])
    return makeDate(year, month, day, spelled[3] === undefined ? now : null)
  }

  return null
}

/**
 * Ngày tuyệt đối. Khi người dùng không nói năm và ngày đó đã qua, hiểu là năm sau — "20/9" nói
 * vào tháng 12 gần như chắc chắn là sang năm, không phải một hạn đã trôi qua ba tháng.
 */
function makeDate(year: number, month: number, day: number, rollForwardFrom: Date | null): Date {
  if (month < 1 || month > 12 || day < 1 || day > 31) fail('ngày/tháng ngoài khoảng hợp lệ')
  const date = new Date(year, month - 1, day, DEFAULT_HOUR, DEFAULT_MINUTE, 0, 0)
  if (date.getMonth() !== month - 1) fail('ngày không tồn tại trong tháng đó')
  if (rollForwardFrom !== null && date.getTime() < startOfDay(rollForwardFrom).getTime()) {
    date.setFullYear(date.getFullYear() + 1)
  }
  return date
}

/** "hôm nay", "ngày mai", "3 ngày nữa", "sau 2 tuần", "tuần sau", "tháng sau". */
function resolveRelativeOffset(text: string, now: Date): Date | null {
  const today = startOfDay(now)

  if (/\bhom nay\b|\btrong ngay\b/.test(text)) return today
  if (/\bngay mai\b|\bmai\b/.test(text)) return addDays(today, 1)
  if (/\bngay kia\b|\bmot\b/.test(text)) return addDays(today, 2)

  const counted = /(?:sau\s+)?(\d+)\s+(ngay|tuan|thang)(?:\s+(?:nua|toi|sau))?/.exec(text)
  if (counted !== null) {
    const amount = Number(counted[1])
    const unit = UNIT_DAYS[counted[2] ?? '']
    if (unit === undefined) return null
    if (amount > 3650) fail('khoảng thời gian quá xa')
    if (unit === 'day') return addDays(today, amount)
    if (unit === 'week') return addDays(today, amount * 7)
    return addMonths(today, amount)
  }

  // "tuần sau"/"tháng sau" đứng một mình — có thứ đi kèm thì đã do resolveWeekday xử lý.
  if (/\b(tuan|tuan le)\s+(sau|toi)\b/.test(text) && !hasWeekday(text)) return addDays(today, 7)
  if (/\bthang\s+(sau|toi)\b/.test(text)) return addMonths(today, 1)

  return null
}

/** "thứ 6", "thứ 6 tuần sau", "chủ nhật". */
function resolveWeekday(text: string, now: Date): Date | null {
  const target = matchWeekday(text)
  if (target === null) return null

  const today = startOfDay(now)
  const currentIso = isoWeekday(today)
  const nextWeek = /\btuan\s+(sau|toi)\b/.test(text)
  const thisWeek = /\btuan\s+nay\b/.test(text)

  if (nextWeek) {
    // Tuần sau tính theo tuần lịch bắt đầu từ thứ 2, không phải "7 ngày nữa".
    const mondayNextWeek = addDays(today, 8 - currentIso)
    return addDays(mondayNextWeek, target - 1)
  }

  if (thisWeek) return addDays(today, target - currentIso)

  // Không nói tuần nào: lần xuất hiện kế tiếp, hôm nay không tính (hạn "thứ 6" nói vào thứ 6
  // gần như luôn có nghĩa là thứ 6 tuần tới).
  const delta = target - currentIso
  return addDays(today, delta > 0 ? delta : delta + 7)
}

/** "cuối tuần", "cuối tháng", "đầu tuần sau", "đầu tháng sau". */
function resolveBoundary(text: string, now: Date): Date | null {
  const today = startOfDay(now)

  if (/\bcuoi tuan\b/.test(text)) {
    const delta = 7 - isoWeekday(today)
    return addDays(today, delta === 0 ? 7 : delta)
  }
  if (/\bdau tuan (sau|toi)\b/.test(text)) return addDays(today, 8 - isoWeekday(today))
  if (/\bcuoi thang (sau|toi)\b/.test(text)) return endOfMonth(addMonths(today, 1))
  if (/\bcuoi thang\b/.test(text)) return endOfMonth(today)
  if (/\bdau thang (sau|toi)\b/.test(text)) {
    const next = addMonths(today, 1)
    return new Date(next.getFullYear(), next.getMonth(), 1, DEFAULT_HOUR, DEFAULT_MINUTE, 0, 0)
  }

  return null
}

// ── Giờ trong ngày ─────────────────────────────────────────────────────────

interface TimeOfDay {
  readonly hour: number | null
  readonly minute: number | null
  /** Phần văn bản còn lại sau khi đã bóc giờ ra. */
  readonly rest: string
}

function extractTimeOfDay(text: string): TimeOfDay {
  const pattern = /\b(\d{1,2})\s*(?:h|:|gio)\s*(\d{2})?\b/
  const match = pattern.exec(text)
  const meridiem = /\b(sang|trua|chieu|toi|dem)\b/.exec(text)

  if (match === null) return { hour: null, minute: null, rest: text }

  let hour = Number(match[1])
  const minute = match[2] === undefined ? 0 : Number(match[2])
  if (hour > 23 || minute > 59) fail('giờ ngoài khoảng hợp lệ')

  const period = meridiem?.[1]
  if (hour <= 12 && (period === 'chieu' || period === 'toi' || period === 'dem')) hour += 12
  if (hour === 12 && period === 'sang') hour = 0

  return { hour, minute, rest: text.replace(pattern, ' ') }
}

function withTime(date: Date, time: TimeOfDay): string {
  const result = setTime(date, time.hour ?? DEFAULT_HOUR, time.minute ?? DEFAULT_MINUTE)
  return result.toISOString()
}

// ── Tiện ích ───────────────────────────────────────────────────────────────

/**
 * Bỏ dấu và hạ chữ thường. Model gõ "thứ 6" hay "thu 6" đều là một ý; so khớp trên dạng không
 * dấu tránh nhân đôi mọi mẫu regex.
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ')
    .trim()
}

function hasWeekday(text: string): boolean {
  return matchWeekday(text) !== null
}

function matchWeekday(text: string): number | null {
  for (const [word, iso] of Object.entries(WEEKDAY_WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(text)) return iso
  }
  return null
}

/** Thứ 2 = 1 … Chủ nhật = 7. `Date.getDay()` trả Chủ nhật = 0 nên phải đổi. */
function isoWeekday(date: Date): number {
  const day = date.getDay()
  return day === 0 ? 7 : day
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0)
}

function setTime(date: Date, hour: number, minute: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute, 0, 0)
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date.getTime())
  result.setDate(result.getDate() + days)
  return result
}

/**
 * Cộng tháng có kẹp ngày: 31/1 + 1 tháng là 28/2 (hoặc 29/2), không phải 3/3. `setMonth` của JS
 * tự tràn sang tháng sau, và một hạn tràn ngày là một hạn sai.
 */
function addMonths(date: Date, months: number): Date {
  const targetMonth = date.getMonth() + months
  const candidate = new Date(date.getFullYear(), targetMonth, 1, 0, 0, 0, 0)
  const lastDay = new Date(candidate.getFullYear(), candidate.getMonth() + 1, 0).getDate()
  return new Date(
    candidate.getFullYear(),
    candidate.getMonth(),
    Math.min(date.getDate(), lastDay),
    date.getHours(),
    date.getMinutes(),
    0,
    0,
  )
}

function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, DEFAULT_HOUR, DEFAULT_MINUTE, 0, 0)
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function fail(detail: string): never {
  throw new NexaError(ERROR_CODES.VALIDATION_FAILED, { safeDetail: `commitment time: ${detail}` })
}
