import { describe, expect, it } from 'vitest'
import { sendBlockedReason, type SendState } from './composer-ui.js'

const ready: SendState = {
  busy: false,
  draft: 'Tóm tắt giúp mình',
  modelMissing: false,
  documentBlocked: false,
  imageBlocked: false,
}

describe('sendBlockedReason', () => {
  it('cho gửi khi đủ điều kiện', () => {
    expect(sendBlockedReason(ready)).toBeNull()
  })

  it('khoá khi nội dung chỉ có khoảng trắng và nói cần nhập gì', () => {
    expect(sendBlockedReason({ ...ready, draft: '  \n ' })).toMatch(/Nhập nội dung/)
  })

  it('mỗi điều kiện khoá đều có lý do riêng', () => {
    const reasons = [
      sendBlockedReason({ ...ready, busy: true }),
      sendBlockedReason({ ...ready, modelMissing: true }),
      sendBlockedReason({ ...ready, documentBlocked: true }),
      sendBlockedReason({ ...ready, imageBlocked: true }),
      sendBlockedReason({ ...ready, draft: '' }),
    ]
    expect(reasons.every((r) => r !== null)).toBe(true)
    expect(new Set(reasons).size).toBe(reasons.length)
  })

  it('đang xử lý thì nói chuyện đó trước, dù ô nhập đang trống', () => {
    expect(sendBlockedReason({ ...ready, busy: true, draft: '' })).toMatch(/đang xử lý/)
  })
})
