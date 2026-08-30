import { describe, expect, it } from 'vitest'
import { LOGICAL_WORDS, jaccard, normalizeText, stripDiacritics, tokenSet } from './text.js'

describe('chuẩn hoá text tiếng Việt', () => {
  it('bỏ dấu và xử lý được chữ đ', () => {
    expect(stripDiacritics('Đơn hàng đã huỷ')).toBe('Don hang da huy')
  })

  it('hạ chữ, bỏ dấu câu và gộp khoảng trắng', () => {
    expect(normalizeText('  Đơn hàng   PHẢI có ít nhất 1 sản phẩm!  ')).toBe(
      'don hang phai co it nhat 1 san pham',
    )
  })

  it('bỏ hư từ khỏi token-set', () => {
    expect(tokenSet('Đơn hàng của khách hàng')).toEqual(new Set(['don', 'hang', 'khach']))
  })
})

describe('từ mang nghĩa logic không bị coi là hư từ', () => {
  it.each(LOGICAL_WORDS)('giữ lại "%s"', (word) => {
    expect(tokenSet(`quy tac ${word} ap dung`)).toContain(word)
  })

  it('giữ phủ định nên hai mệnh đề ngược nhau không chuẩn hoá thành một', () => {
    const positive = normalizeText('Cho phép sửa đơn hàng')
    const negative = normalizeText('Không cho phép sửa đơn hàng')
    expect(positive).not.toBe(negative)
    expect(tokenSet('Không cho phép sửa đơn hàng')).toContain('khong')
  })
})

describe('jaccard', () => {
  it('tập giống hệt cho 1', () => {
    expect(jaccard(tokenSet('đơn hàng rỗng'), tokenSet('đơn hàng rỗng'))).toBe(1)
  })

  it('tập rời nhau cho 0', () => {
    expect(jaccard(tokenSet('đơn hàng'), tokenSet('người dùng'))).toBe(0)
  })

  it('tập rỗng cho 0 chứ không phải giống hoàn toàn', () => {
    expect(jaccard(new Set(), new Set())).toBe(0)
  })

  it('không phụ thuộc thứ tự từ', () => {
    expect(jaccard(tokenSet('khách hàng huỷ đơn'), tokenSet('đơn huỷ khách hàng'))).toBe(1)
  })
})
