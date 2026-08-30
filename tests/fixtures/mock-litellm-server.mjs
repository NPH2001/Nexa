#!/usr/bin/env node
/**
 * LiteLLM giả trên HTTP — dùng cho E2E.
 *
 * ĐÂY KHÔNG PHẢI LiteLLM THẬT (docs/OPEN-QUESTIONS.md A1, C2). Nó nói đúng phần giao thức
 * tương thích OpenAI mà Nexa dùng, và cố ý bắt chước các hành vi khó chịu:
 *   - `GET /v1/models` có thể bị tắt (404) để test nhánh fallback
 *   - streaming SSE chia nhỏ, có cả tool call theo từng mảnh
 *   - từ chối request thiếu `Authorization: Bearer`
 *
 * In ra stdout đúng một dòng `LISTENING <port>` để tiến trình cha đọc được cổng.
 *
 * Kịch bản qua env `MOCK_SCENARIO`: ok | no-models-endpoint | auth-failed | tool-call |
 *                                   commitment-tool | slow | length
 */

import { createServer } from 'node:http'
import { stdout, env, exit } from 'node:process'

const scenario = env.MOCK_SCENARIO ?? 'ok'
/** Ghi lại mọi request để test khẳng định được cả những gì KHÔNG được gửi. */
const received = []

function sse(res, chunks) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  let i = 0
  const tick = () => {
    if (i >= chunks.length) {
      res.end()
      return
    }
    res.write(chunks[i++])
    // Giãn ra vài mili-giây để giống stream thật, và để UI kịp render từng phần.
    setTimeout(tick, 15)
  }
  tick()
}

function textStream(text, finishReason = 'stop') {
  const words = text.split(' ')
  return [
    ...words.map(
      (w, i) =>
        `data: ${JSON.stringify({ choices: [{ delta: { content: i === 0 ? w : ` ${w}` } }] })}\n\n`,
    ),
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finishReason }] })}\n\n`,
    `data: ${JSON.stringify({ usage: { prompt_tokens: 12, completion_tokens: words.length }, choices: [] })}\n\n`,
    'data: [DONE]\n\n',
  ]
}

/**
 * Kết quả trích xuất BA mẫu.
 *
 * Cố ý có một mã lỗi được nhắc trong luồng ngoại lệ (E404) mà KHÔNG khai báo — để E2E khẳng định
 * trang mã lỗi bắt được thiếu sót, chứ không chỉ liệt kê được thứ đã có.
 */
const BA_EXTRACTION_JSON = JSON.stringify({
  items: [
    {
      itemType: 'error_code',
      id: 'e-1',
      ordinal: 0,
      code: 'E001',
      message: 'Giỏ hàng trống',
    },
    {
      itemType: 'use_case',
      id: 'uc-1',
      ordinal: 0,
      name: 'Khách hàng đặt đơn',
      actor: 'Khách hàng',
      precondition: 'Đã đăng nhập',
      mainFlow: ['Chọn sản phẩm', 'Xác nhận đơn'],
      postcondition: 'Đơn được tạo',
      role: 'customer',
      dataEffects: ['create'],
      exceptionFlows: [{ name: 'Hết hàng', steps: ['Báo lỗi hết hàng'], errorCode: 'E404' }],
    },
  ],
  links: [],
})

const server = createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    const bodyText = Buffer.concat(chunks).toString('utf8')
    received.push({
      method: req.method,
      url: req.url,
      auth: req.headers.authorization ?? null,
      requestId: req.headers['x-request-id'] ?? null,
      body: bodyText,
    })

    // Endpoint chỉ dùng cho test: cho phép khẳng định về những gì server ĐÃ nhận.
    if (req.url === '/__received') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(received))
      return
    }

    const authorized = (req.headers.authorization ?? '').startsWith('Bearer ')
    if (!authorized || scenario === 'auth-failed') {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'invalid api key' } }))
      return
    }

    if (req.url === '/v1/models') {
      if (scenario === 'no-models-endpoint') {
        res.writeHead(404)
        res.end('not found')
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: 'model-a' }, { id: 'model-b' }] }))
      return
    }

    if (req.url === '/v1/chat/completions') {
      const body = safeJson(bodyText)

      if (scenario === 'slow') {
        setTimeout(() => sse(res, textStream('Câu trả lời đến muộn')), 4_000)
        return
      }

      if (scenario === 'length') {
        sse(res, textStream('Phần đầu câu trả lời', 'length'))
        return
      }

      if (body?.stream !== true) {
        // Job trích xuất BA gọi non-stream và đòi JSON đúng schema `ba-kit`. Nhận ra nó bằng
        // system prompt, vì đây là đường duy nhất trong app gửi request non-stream có prompt đó.
        const systemPrompt = (body?.messages ?? []).find((m) => m.role === 'system')?.content ?? ''
        if (systemPrompt.includes('bộ trích xuất tài liệu nghiệp vụ')) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: BA_EXTRACTION_JSON } }] }))
          return
        }
        // Bước gợi ý câu chữ của review. Output CỐ Ý kèm những khoá mà model không được phép
        // dùng — E2E khẳng định chúng bị bỏ, chứ không chỉ khẳng định phần gợi ý chạy được.
        if (systemPrompt.includes('diễn đạt lại MỘT chỗ trong tài liệu nghiệp vụ')) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(
            JSON.stringify({
              choices: [
                {
                  finish_reason: 'stop',
                  message: {
                    content: JSON.stringify({
                      goi_y: 'Use case này chỉ có một đường duyệt duy nhất theo quy trình hiện hành.',
                      bo_qua: true,
                      severity: 'info',
                      findings: [],
                    }),
                  },
                },
              ],
            }),
          )
          return
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            choices: [{ finish_reason: 'stop', message: { content: 'pong' } }],
          }),
        )
        return
      }

      // Vòng đầu đề xuất tool; vòng sau (đã có message role='tool') mới trả lời bằng text.
      const alreadyRanTool = (body?.messages ?? []).some((m) => m.role === 'tool')
      if (scenario === 'tool-call' && !alreadyRanTool) {
        sse(res, [
          `data: ${JSON.stringify({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call_e2e_1',
                      function: {
                        name: 'jira_create_issue',
                        arguments:
                          '{"project_key":"PRJ","summary":"Task từ E2E","issue_type":"Task"}',
                      },
                    },
                  ],
                },
              },
            ],
          })}\n\n`,
          `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })}\n\n`,
          'data: [DONE]\n\n',
        ])
        return
      }

      if (scenario === 'commitment-tool' && !alreadyRanTool) {
        sse(res, [
          `data: ${JSON.stringify({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call_e2e_commitment',
                      function: {
                        name: 'nexa_tao_cam_ket',
                        arguments:
                          '{"title":"Gửi báo cáo quý cho sếp","next_action":"Xin số liệu kế toán","due_at":"thứ 6 tuần sau"}',
                      },
                    },
                  ],
                },
              },
            ],
          })}\n\n`,
          `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })}\n\n`,
          'data: [DONE]\n\n',
        ])
        return
      }

      sse(res, textStream('Xin chào, đây là câu trả lời từ mock LiteLLM.'))
      return
    }

    res.writeHead(404)
    res.end('not found')
  })
})

function safeJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

server.listen(0, '127.0.0.1', () => {
  const address = server.address()
  if (address === null || typeof address === 'string') {
    exit(1)
  }
  stdout.write(`LISTENING ${address.port}\n`)
})
