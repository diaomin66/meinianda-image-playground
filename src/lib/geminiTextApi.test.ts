import { afterEach, describe, expect, it, vi } from 'vitest'
import { callGeminiTextApi } from './geminiTextApi'
import { FIXED_GEMINI_TEXT_PROFILE_ID, lockApiSettings } from './fixedApiProfiles'
import { createCharacterImageTool } from './characterImageTool'

const settings = lockApiSettings({ apiKey: 'native-test-key' })
const profile = settings.profiles.find((profile) => profile.id === FIXED_GEMINI_TEXT_PROFILE_ID)!
const character = { id: 'lin', name: '林夏', personality: ' 你是林夏。\n只说短句。 ', appearance: '', opening: '', referenceImageIds: [], autoImages: true, createdAt: 1, updatedAt: 1 }
const opts = { profile, instructions: character.personality, contents: [{ role: 'user' as const, parts: [{ text: '你好' }] }], tools: [createCharacterImageTool(settings, character)] }
afterEach(() => { vi.unstubAllGlobals() })

describe('Gemini 原生语言接口', () => {
  it('修复流中的签名空块并清理占位块，回传始终具备 Part.data 且签名不移位', async () => {
    const incoming = [
      { text: '正在准备。' }, {}, { thought: true },
      { thought_signature: 'signature-only' },
      { function_call: { name: 'generate_image', args: { prompt: '海边' } }, thought_signature: 'call-signature' },
    ]
    const fetchMock = vi.fn(async (_url: string, _request: RequestInit) => new Response('data: ' + JSON.stringify({ candidates: [{ content: { parts: incoming }, finishReason: 'STOP' }] }) + '\n\n', { headers: { 'Content-Type': 'text/event-stream' } }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await callGeminiTextApi(opts)
    expect(result.content.parts).toEqual([
      { text: '正在准备。' },
      { thoughtSignature: 'signature-only', text: '' },
      { functionCall: { name: 'generate_image', args: { prompt: '海边' } }, thoughtSignature: 'call-signature' },
    ])
    await callGeminiTextApi({ ...opts, contents: [...opts.contents, result.content, { role: 'user', parts: [{ functionResponse: { name: 'generate_image', response: { accepted: true } } }] }] })
    const body = JSON.parse(fetchMock.mock.calls[1][1].body as string)
    for (const content of body.contents) for (const part of content.parts) expect(['text', 'inlineData', 'functionCall', 'functionResponse'].filter((key) => part[key] !== undefined)).toHaveLength(1)
    expect(body.contents[1].parts[1]).toEqual({ thoughtSignature: 'signature-only', text: '' })
  })

  it('发送前修复旧聊天记录中的签名块和下划线图片字段', async () => {
    const fetchMock = vi.fn(async (_url: string, _request: RequestInit) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '好了' }] }, finishReason: 'STOP' }] })))
    vi.stubGlobal('fetch', fetchMock)
    await callGeminiTextApi({ ...opts, contents: [{ role: 'model', parts: [{ thoughtSignature: 'persisted-signature' }, {}] }, { role: 'user', parts: [{ inline_data: { mime_type: 'image/png', data: 'aW1n' } } as unknown as import('../types').GeminiPart] }] })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.contents).toEqual([{ role: 'model', parts: [{ thoughtSignature: 'persisted-signature', text: '' }] }, { role: 'user', parts: [{ inlineData: { mimeType: 'image/png', data: 'aW1n' } }] }])
  })

  it('图片或函数内容缺失时本地给出具体路径，不向服务端发送无效 Part', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(callGeminiTextApi({ ...opts, contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/png', data: '' } }] }] })).rejects.toThrow('contents[0].parts[0]')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('流尚未结束就推送文字，完整保留函数调用和空文本签名块', async () => {
    const encoder = new TextEncoder()
    let stream: ReadableStreamDefaultController<Uint8Array>
    const response = new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller } }), { headers: { 'Content-Type': 'text/event-stream' } })
    vi.stubGlobal('fetch', vi.fn(async () => response))
    const onTextDelta = vi.fn()
    let completed = false
    const pending = callGeminiTextApi({ ...opts, onTextDelta }).then((result) => { completed = true; return result })
    const start = [{ text: '隐藏推理', thought: true }, { text: '你好，' }]
    const bytes = encoder.encode('data: ' + JSON.stringify({ candidates: [{ index: 0, content: { parts: start } }] }) + '\r\n\r\n')
    // 刻意拆散 UTF-8 字节和 SSE 分隔符。
    for (let idx = 0; idx < bytes.length; idx += 7) stream!.enqueue(bytes.slice(idx, idx + 7))
    await vi.waitFor(() => expect(onTextDelta).toHaveBeenCalledWith('你好，'))
    expect(completed).toBe(false)
    const end = [
      { text: '给你看看。' },
      { thoughtSignature: 'function-signature', functionCall: { id: 'call-1', name: 'generate_image', args: { prompt: '河边' } } },
      { text: '', thoughtSignature: 'trailing-signature' },
    ]
    stream!.enqueue(encoder.encode('data: ' + JSON.stringify({ candidates: [{ index: 0, content: { parts: end } }] }) + '\n\n'))
    stream!.enqueue(encoder.encode('data: ' + JSON.stringify({ candidates: [{ index: 0, finishReason: 'STOP' }], usageMetadata: {} }) + '\n\n'))
    stream!.close()
    const result = await pending
    expect(result.text).toBe('你好，给你看看。')
    expect(onTextDelta.mock.calls).toEqual([['你好，'], ['给你看看。']])
    expect(result.content.parts).toEqual([...start, ...end])
  })

  it('中途取消时终止读取，已收到的文字仍已交给界面', async () => {
    const cancel = vi.fn()
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('data: {"candidates":[{"content":{"parts":[{"text":"正在回复"}]}}]}\n\n')) },
      cancel,
    }), { headers: { 'Content-Type': 'text/event-stream' } })
    vi.stubGlobal('fetch', vi.fn(async () => response))
    const controller = new AbortController()
    const onTextDelta = vi.fn(() => controller.abort())
    await expect(callGeminiTextApi({ ...opts, signal: controller.signal, onTextDelta })).rejects.toMatchObject({ name: 'AbortError' })
    expect(onTextDelta).toHaveBeenCalledWith('正在回复')
    expect(cancel).toHaveBeenCalledOnce()
  })

  it.each(['done', 'snake', 'json'])('兼容 %s 结束方式，不丢弃完整副脑 JSON', async (ending) => {
    const text = JSON.stringify({ subject_appearance: 'White cat', pose_and_action: 'Sitting' })
    const body = 'data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: text.slice(0, 18) }] } }] }) + '\n\n'
      + 'data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: text.slice(18) }] }, ...(ending === 'snake' ? { finish_reason: 'STOP' } : {}) }] }) + '\n\n'
      + (ending === 'done' ? 'data: [DONE]\n\n' : '')
    const fetchMock = vi.fn(async (_url: string, _request: RequestInit) => new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await callGeminiTextApi({ ...opts, tools: [], responseMimeType: 'application/json' })
    expect(result.text).toBe(text)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).generationConfig).toEqual({ responseMimeType: 'application/json' })
  })

  it('收到 DONE 后立即结束读取，兼容中转保持连接的情况', async () => {
    const cancel = vi.fn()
    const parts = [{ functionCall: { name: 'generate_image', args: { prompt: '照片' } }, thoughtSignature: 'done-signature' }]
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('data: ' + JSON.stringify({ candidates: [{ content: { parts } }] }) + '\n\ndata: [DONE]\n\n')) },
      cancel,
    }), { headers: { 'Content-Type': 'text/event-stream' } })
    vi.stubGlobal('fetch', vi.fn(async () => response))
    expect((await callGeminiTextApi(opts)).content.parts).toEqual(parts)
    expect(cancel).toHaveBeenCalledOnce()
  })

  it.each(['STOP', 'MAX_TOKENS'])('收到原生结束标记 %s 后不等 HTTP 连接关闭，错误仍按结束原因处理', async (reason) => {
    const cancel = vi.fn()
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: '你好。' }] }, finishReason: reason }] }) + '\n\n')) },
      cancel,
    }), { headers: { 'Content-Type': 'text/event-stream' } })
    vi.stubGlobal('fetch', vi.fn(async () => response))
    const onTextDelta = vi.fn()
    const result = callGeminiTextApi({ ...opts, onTextDelta })
    if (reason === 'STOP') expect((await result).text).toBe('你好。')
    else await expect(result).rejects.toThrow(reason)
    expect(onTextDelta).toHaveBeenCalledWith('你好。')
    expect(cancel).toHaveBeenCalledOnce()
  })

  it.each([
    [{ candidates: [{ content: { parts: [{ text: '{"subject_appearance":"cat"' }] } }] }, '', '不是完整 JSON'],
    [{ candidates: [{ content: { parts: [{ text: '{"subject_appearance":"cat"}' }] }, finish_reason: 'MAX_TOKENS' }] }, 'data: [DONE]\n\n', 'MAX_TOKENS'],
    [{ candidates: [{ content: { parts: [{ text: '{"subject_appearance":"cat"}' }] }, finishReason: 'SAFETY' }] }, '', 'SAFETY'],
    [{ candidates: [{ content: { parts: [{ functionCall: { name: 'generate_image', args: {} } }] } }] }, '', '未完整结束'],
  ])('JSON 兼容不会掩盖截断、拦截或未结束的函数调用', async (payload, suffix, error) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('data: ' + JSON.stringify(payload) + '\n\n' + suffix, { headers: { 'Content-Type': 'text/event-stream' } })))
    await expect(callGeminiTextApi({ ...opts, responseMimeType: 'application/json' })).rejects.toThrow(error)
  })

  it('真实读取异常不因已经收到 JSON 而视为成功', async () => {
    let stream: ReadableStreamDefaultController<Uint8Array>
    const response = new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller } }), { headers: { 'Content-Type': 'text/event-stream' } })
    vi.stubGlobal('fetch', vi.fn(async () => response))
    const onTextDelta = vi.fn()
    const result = callGeminiTextApi({ ...opts, responseMimeType: 'application/json', onTextDelta })
    const rejection = expect(result).rejects.toThrow('连接重置')
    stream!.enqueue(new TextEncoder().encode('data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"subject_appearance":"cat"}' }] } }] }) + '\n\n'))
    await vi.waitFor(() => expect(onTextDelta).toHaveBeenCalled())
    stream!.error(new Error('连接重置'))
    await rejection
  })

  it.each([
    ['data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"generate_image","args":{"prompt":"未完成"}}}]}}]}\n\n', '未完整结束'],
    ['data: {"error":{"message":"流式接口错误"}}\n\n', '流式接口错误'],
    ['data: broken-json\n\n', '格式无效'],
    ['data: {"candidates":[{"content":{"parts":[{"text":"截断"}]},"finishReason":"MAX_TOKENS"}]}\n\n', 'MAX_TOKENS'],
  ])('流式错误或截断不会返回可执行函数结果', async (body, error) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })))
    await expect(callGeminiTextApi(opts)).rejects.toThrow(error)
  })

  it('使用原生系统提示词、contents、函数声明和头部密钥，保留签名', async () => {
    const parts = [{ text: '隐藏思考', thought: true }, { text: '你好。' }, { thoughtSignature: 'signature-data', functionCall: { name: 'generate_image', args: { prompt: '河边' } } }]
    const fetchMock = vi.fn(async (_url: string, _request: RequestInit) => new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts } }] }), { headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await callGeminiTextApi(opts)
    const [url, request] = fetchMock.mock.calls[0]
    expect(url).toBe('https://meinianda.top/v1beta/models/' + profile.model + ':streamGenerateContent?alt=sse')
    expect(request.headers).toEqual({ 'Content-Type': 'application/json', Accept: 'text/event-stream', 'x-goog-api-key': 'native-test-key' })
    const body = JSON.parse(request.body as string)
    expect(body.systemInstruction).toEqual({ parts: [{ text: character.personality }] })
    expect(body.contents).toEqual(opts.contents)
    expect(body.tools[0].functionDeclarations[0]).toMatchObject({ name: 'generate_image', parametersJsonSchema: opts.tools[0].parameters })
    expect(body).not.toHaveProperty('messages')
    expect(body).not.toHaveProperty('instructions')
    expect(body).not.toHaveProperty('model')
    expect(result.text).toBe('你好。')
    expect(result.content.parts).toEqual(parts)
  })

  it('空人格不注入默认系统提示词，工具关闭后不再附加函数声明', async () => {
    const fetchMock = vi.fn(async (_url: string, _request: RequestInit) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '你好。' }] } }] })))
    vi.stubGlobal('fetch', fetchMock)
    await callGeminiTextApi({ ...opts, instructions: '', tools: [] })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body).not.toHaveProperty('systemInstruction')
    expect(body).not.toHaveProperty('tools')
  })

  it.each([
    [null, '未返回有效回复'],
    [{ candidates: [] }, '未返回有效回复'],
    [{ promptFeedback: { blockReason: 'SAFETY' } }, 'SAFETY'],
    [{ candidates: [{ content: { parts: [{ text: '思考', thought: true }] }, finishReason: 'MAX_TOKENS' }] }, 'MAX_TOKENS'],
    [{ error: { message: '模型不可用' } }, '模型不可用'],
  ])('显式报告空回复、拦截及接口错误', async (payload, expected) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload))))
    await expect(callGeminiTextApi(opts)).rejects.toThrow(expected as string)
  })

  it('预先取消时不发送请求，HTTP 错误保留服务端消息', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { message: '密钥无效' } }), { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    controller.abort()
    await expect(callGeminiTextApi({ ...opts, signal: controller.signal })).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
    await expect(callGeminiTextApi(opts)).rejects.toThrow('密钥无效')
  })
})
