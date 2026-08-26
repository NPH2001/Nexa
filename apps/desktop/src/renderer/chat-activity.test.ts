import { describe, expect, it } from 'vitest'
import {
  beginChatActivity,
  bindChatRequest,
  completeChatActivity,
  type ChatActivity,
} from './chat-activity.js'

describe('chat activity state', () => {
  it('khóa đúng hội thoại ngay cả trước khi main trả request id', () => {
    expect(beginChatActivity('conversation-a')).toEqual({
      conversationId: 'conversation-a',
      requestId: null,
    })
  })

  it('chỉ gắn request id vào placeholder của đúng hội thoại', () => {
    const pending = beginChatActivity('conversation-a')
    expect(bindChatRequest(pending, 'conversation-a', 'request-a')).toEqual({
      conversationId: 'conversation-a',
      requestId: 'request-a',
    })
    expect(bindChatRequest(pending, 'conversation-b', 'request-b')).toBe(pending)
  })

  it('sự kiện cũ không được mở khóa request mới', () => {
    const active: ChatActivity = {
      conversationId: 'conversation-b',
      requestId: 'request-new',
    }
    expect(completeChatActivity(active, 'conversation-a', 'request-old')).toBe(active)
    expect(completeChatActivity(active, 'conversation-b', 'request-old')).toBe(active)
    expect(completeChatActivity(active, 'conversation-b', 'request-new')).toBeNull()
  })

  it('sự kiện hoàn tất đến trước phản hồi IPC vẫn dọn được placeholder', () => {
    const pending = beginChatActivity('conversation-a')
    expect(completeChatActivity(pending, 'conversation-a', 'request-a')).toBeNull()
  })
})
