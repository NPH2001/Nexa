import { createInterface } from 'node:readline'

const scenario = process.env['MOCK_CODEX_SCENARIO'] ?? 'unauthenticated'
let nextThreadId = 1
let nextTurnId = 1

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function result(id, value) {
  send({ id, result: value })
}

function modelCatalog() {
  return [
    {
      id: 'gpt-5.6-sol',
      model: 'gpt-5.6-sol',
      displayName: 'GPT-5.6 Sol',
      isDefault: true,
      defaultReasoningEffort: 'low',
      supportedReasoningEfforts: [
        { reasoningEffort: 'low', description: 'Nhanh' },
        { reasoningEffort: 'max', description: 'Suy luận tối đa' },
      ],
      inputModalities: ['text'],
    },
    {
      id: 'gpt-5.6-terra',
      model: 'gpt-5.6-terra',
      displayName: 'GPT-5.6 Terra',
      isDefault: false,
      defaultReasoningEffort: 'medium',
      supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Cân bằng' }],
      inputModalities: ['text'],
    },
  ]
}

lines.on('line', (line) => {
  const message = JSON.parse(line)
  if (message.id === undefined || typeof message.method !== 'string') return

  switch (message.method) {
    case 'initialize':
      result(message.id, { userAgent: 'mock-codex-app-server' })
      break
    case 'account/read':
      result(
        message.id,
        scenario === 'authenticated'
          ? {
              account: { type: 'chatgpt', email: 'plus@example.com', planType: 'plus' },
              requiresOpenaiAuth: true,
            }
          : { account: null, requiresOpenaiAuth: true },
      )
      break
    case 'account/rateLimits/read':
      result(message.id, {
        rateLimits: {
          primary: { usedPercent: 5, windowDurationMins: 300, resetsAt: 1_900_000_000 },
        },
      })
      break
    case 'model/list':
      result(message.id, { data: modelCatalog(), nextCursor: null })
      break
    case 'thread/start': {
      const threadId = `mock-thread-${String(nextThreadId++)}`
      result(message.id, { thread: { id: threadId } })
      break
    }
    case 'thread/inject_items':
      result(message.id, {})
      break
    case 'turn/start': {
      const threadId = message.params?.threadId
      const turnId = `mock-turn-${String(nextTurnId++)}`
      result(message.id, { turn: { id: turnId } })
      setTimeout(() => {
        send({
          method: 'item/agentMessage/delta',
          params: {
            threadId,
            turnId,
            itemId: 'mock-agent-message',
            delta: 'Xin chào, đây là câu trả lời ',
          },
        })
        send({
          method: 'item/agentMessage/delta',
          params: {
            threadId,
            turnId,
            itemId: 'mock-agent-message',
            delta: 'từ mock ChatGPT Plus.',
          },
        })
        send({
          method: 'turn/completed',
          params: { threadId, turn: { id: turnId, status: 'completed' } },
        })
      }, 20)
      break
    }
    case 'turn/interrupt':
    case 'thread/unsubscribe':
      result(message.id, {})
      break
    default:
      result(message.id, {})
  }
})
