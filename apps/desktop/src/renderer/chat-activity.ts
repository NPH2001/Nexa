export interface ChatActivity {
  readonly conversationId: string
  readonly requestId: string | null
}

export function beginChatActivity(conversationId: string): ChatActivity {
  return { conversationId, requestId: null }
}

export function bindChatRequest(
  activity: ChatActivity | null,
  conversationId: string,
  requestId: string,
): ChatActivity | null {
  if (activity?.conversationId !== conversationId || activity.requestId !== null) return activity
  return { conversationId, requestId }
}

export function completeChatActivity(
  activity: ChatActivity | null,
  conversationId: string,
  requestId: string,
): ChatActivity | null {
  if (activity?.conversationId !== conversationId) return activity
  if (activity.requestId !== null && activity.requestId !== requestId) return activity
  return null
}
