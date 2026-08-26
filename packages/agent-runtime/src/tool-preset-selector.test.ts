import { describe, expect, it } from 'vitest'
import { detectSignals, normalizeQuestion, selectPreset, selectPresetForHistory } from './tool-preset-selector.js'

describe('normalizeQuestion', () => {
  it('bỏ dấu và hạ chữ thường', () => {
    expect(normalizeQuestion('Tạo Cho Tôi Một Task')).toBe('tao cho toi mot task')
  })

  it('xử lý đ/Đ — không nằm trong dải dấu tổ hợp Unicode', () => {
    expect(normalizeQuestion('Đóng issue này')).toBe('dong issue nay')
  })

  it('giữ nguyên chuỗi đã không dấu', () => {
    expect(normalizeQuestion('tao issue moi')).toBe('tao issue moi')
  })
})

describe('bảng quyết định hai trục (ADR 0009)', () => {
  const cases: readonly [string, string][] = [
    ['Cho tôi xem issue PRJ-12 đang ở trạng thái nào', 'jira-read'],
    ['Liệt kê các bug trong sprint hiện tại', 'jira-read'],
    ['Tạo cho tôi một task mới trong Jira', 'jira-full'],
    ['Cập nhật assignee của ticket này', 'jira-full'],
    ['Tìm trang wiki về quy trình onboarding', 'confluence-read'],
    ['Nội dung tài liệu hướng dẫn cài đặt là gì', 'confluence-read'],
    ['Tạo một trang Confluence tổng hợp', 'confluence-full'],
    ['Cập nhật trang wiki đó giúp tôi', 'confluence-full'],
    ['So sánh issue PRJ-1 với trang wiki mô tả nó', 'all-read'],
    ['Đọc các bug trong sprint rồi tạo một trang Confluence tổng hợp', 'all'],
    ['Tóm tắt file này giúp tôi', 'all-read'],
    ['Viết lại đoạn văn cho gọn hơn', 'all-read'],
  ]

  for (const [question, expected] of cases) {
    it(`"${question}" → ${expected}`, () => {
      expect(selectPreset(question)).toBe(expected)
    })
  }
})

describe('nhận dạng dấu hiệu', () => {
  it('nhận issue key trên chuỗi gốc dù không có từ khoá Jira nào khác', () => {
    expect(selectPreset('PRJ-1234 sao rồi')).toBe('jira-read')
    expect(detectSignals('PRJ-1234 sao rồi').jira).toBe(true)
  })

  it('không nhận issue key khi viết chữ thường', () => {
    expect(detectSignals('prj-1234 sao rồi').jira).toBe(false)
  })

  it('không khớp nhầm tiền tố kỹ thuật thành issue key', () => {
    for (const s of ['File này encode UTF-8 phải không', 'Theo RFC-2119 thì sao', 'Bản vá cho CVE-2024 chưa']) {
      expect(detectSignals(s).jira, s).toBe(false)
    }
  })

  it('"trạng thái" không bị coi là dấu hiệu Confluence', () => {
    // "trạng thái" bỏ dấu thành "trang thai", chứa "trang". Nếu không gỡ cụm này thì mọi câu
    // hỏi về trạng thái issue sẽ bị đẩy sang nhánh hai-hệ và mất hết phần tiết kiệm.
    const signals = detectSignals('Chuyển trạng thái issue PRJ-1 sang Done')
    expect(signals.confluence).toBe(false)
    expect(signals.jira).toBe(true)
    expect(selectPreset('Chuyển trạng thái issue PRJ-1 sang Done')).toBe('jira-full')
  })

  it('"hoạt động" và "gần đây" không bị coi là ý định write', () => {
    // Lý do `dong` và `gan` bị bỏ khỏi danh sách động từ write — xem comment trong selector.
    expect(detectSignals('Xem hoạt động gần đây của issue PRJ-1').write).toBe(false)
    expect(selectPreset('Xem hoạt động gần đây của issue PRJ-1')).toBe('jira-read')
  })

  it('nhận ý định write khi gõ không dấu', () => {
    expect(detectSignals('tao issue moi').write).toBe(true)
    expect(selectPreset('tao issue moi')).toBe('jira-full')
  })

  it('nhận động từ tiếng Anh trộn trong câu tiếng Việt', () => {
    expect(selectPreset('update cái ticket này giúp tôi')).toBe('jira-full')
  })

  it('không khớp từ khoá nằm trong một từ dài hơn', () => {
    expect(detectSignals('taobao la gi').write).toBe(false)
    expect(detectSignals('multitasking').jira).toBe(false)
  })

  it('chuỗi rỗng và chuỗi toàn khoảng trắng → all-read', () => {
    expect(selectPreset('')).toBe('all-read')
    expect(selectPreset('   ')).toBe('all-read')
  })
})

describe('tính xác định', () => {
  it('cùng câu hỏi cho cùng kết quả qua 100 lần gọi', () => {
    const question = 'Tạo cho tôi một task trong Jira và cập nhật trang wiki'
    const first = selectPreset(question)
    for (let i = 0; i < 100; i++) expect(selectPreset(question)).toBe(first)
  })

  it('không phụ thuộc thứ tự gọi giữa các câu hỏi khác nhau', () => {
    const a = selectPreset('Liệt kê bug trong sprint')
    selectPreset('Tạo trang Confluence')
    expect(selectPreset('Liệt kê bug trong sprint')).toBe(a)
  })
})

describe('lấy câu hỏi từ history', () => {
  it('dùng message user cuối cùng, không phải message đầu', () => {
    expect(
      selectPresetForHistory([
        { role: 'user', content: 'Tạo một trang Confluence' },
        { role: 'assistant', content: 'Đã xong' },
        { role: 'user', content: 'Giờ xem issue PRJ-9' },
      ]),
    ).toBe('jira-read')
  })

  it('bỏ qua message assistant kể cả khi nó chứa từ khoá', () => {
    expect(
      selectPresetForHistory([
        { role: 'user', content: 'Tóm tắt giúp tôi' },
        { role: 'assistant', content: 'Tôi sẽ tạo một trang Confluence' },
      ]),
    ).toBe('all-read')
  })

  it('history rỗng hoặc không có message user → all-read', () => {
    expect(selectPresetForHistory([])).toBe('all-read')
    expect(selectPresetForHistory([{ role: 'system', content: 'tạo trang wiki' }])).toBe('all-read')
  })
})
