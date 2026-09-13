import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Character, CharacterMessage } from '../types'
import { DEFAULT_PARAMS } from '../types'
import { DEFAULT_SETTINGS } from './apiProfiles'
import { FIXED_GEMINI_PROFILE_ID, FIXED_GEMINI_TEXT_PROFILE_ID, lockApiSettings } from './fixedApiProfiles'
import { GEMINI_FLASH_IMAGE_MODEL } from './imageModels'
import { useCharacterStore } from '../characterStore'
import { buildCharacterInput, retryCharacterImageJob, sendCharacterMessage, stopCharacterResponse } from './characterChat'
import { createCharacterImageTool, executeCharacterImage, parseCharacterImageCall } from './characterImageTool'
import { callAgentResponsesApi } from './agentApi'
import { callGeminiTextApi } from './geminiTextApi'
import { callImageApi } from './api'
import { ensureImageCached } from './imageCache'
import { storeImageWithSize } from './db'
import { normalizeCharacterData } from './characterState'
import { cancelCharacterImageJob, enqueueCharacterImageJob, getCharacterImageJobs, readCharacterImageTaskStatus } from './characterImageJobs'
import { useCharacterLogStore } from './characterLogs'
import { getCharacterLifeDate } from './characterLifeScheduler'

const app = vi.hoisted(() => ({ settings: {} as typeof DEFAULT_SETTINGS, showToast: vi.fn(), setShowSettings: vi.fn() }))
vi.mock('../store', () => ({ useStore: { getState: () => app } }))
vi.mock('./db', () => ({ putCharacterData: vi.fn(async () => 'main'), getCharacterData: vi.fn(async () => undefined), storeImageWithSize: vi.fn(async () => ({ id: 'generated-image' })), getImageThumbnail: vi.fn(async () => undefined) }))
vi.mock('./imageCache', () => ({ ensureImageCached: vi.fn(async (id: string) => 'data:image/png;base64,' + id), cacheImage: vi.fn() }))
vi.mock('./characterChatImages', () => ({ getCharacterChatImage: (id: string) => ensureImageCached(id).then((url) => { if (!url) throw new Error('聊天所需的图片已丢失'); return url }) }))
vi.mock('./agentApi', () => ({ callAgentResponsesApi: vi.fn() }))
vi.mock('./geminiTextApi', async (importOriginal) => ({ ...await importOriginal<typeof import('./geminiTextApi')>(), callGeminiTextApi: vi.fn() }))
vi.mock('./api', () => ({ callImageApi: vi.fn() }))

const char: Character = { id: 'lin', name: '林夏', personality: ' 你是林夏。只用短句回答。\n保持这个人格。 ', appearance: '黑发', opening: '', referenceImageIds: ['face', 'body'], autoImages: true, createdAt: 1, updatedAt: 2 }
const args = { profileId: 'fixed-images', model: 'gpt-image-2', prompt: '在河边拍照', referenceIds: ['face'], maskImageId: null, intent: 'requested', params: { ...DEFAULT_PARAMS, size: '1536x1024', quality: 'high', output_format: 'webp', output_compression: 80, moderation: 'low', n: 2 } }
const toolResponse = { text: '给你看看。', images: [], outputItems: [{ type: 'function_call', call_id: 'call-1', name: 'generate_image', arguments: JSON.stringify(args) }] }
const finalResponse = { text: '图片已经生成。', images: [], outputItems: [{ type: 'message', content: [{ type: 'output_text', text: '图片已经生成。' }] }] }

beforeEach(() => {
  vi.resetAllMocks()
  useCharacterLogStore.setState({ entries: [], storageError: null })
  app.settings = lockApiSettings({ ...DEFAULT_SETTINGS, apiKey: 'test-only' })
  app.settings.characterImageBackground = false
  app.settings.characterImageSize = 'auto'
  app.settings.characterImageOptimizer = { enabled: false, profileId: null, model: '', style: 'follow', customPrompt: '', timeout: 45 }
  app.settings.profiles = app.settings.profiles.map((profile) => ({ ...profile, apiKey: 'test-only' }))
  useCharacterStore.setState({ loaded: true, characters: [char], conversations: [], activeCharacterId: null, activeConversationId: null })
  vi.mocked(ensureImageCached).mockImplementation(async (id) => 'data:image/png;base64,' + id)
  vi.mocked(storeImageWithSize).mockImplementation(async (url) => ({ id: url.endsWith('second') ? 'second-image' : url.endsWith('result') ? 'generated-image' : url.split(',')[1] }))
  let imageCount = 0
  vi.mocked(callImageApi).mockImplementation(async (opts) => ({ images: Array.from({ length: opts.params.n }, () => 'data:image/png;base64,' + (['result', 'second'][imageCount++] ?? `image-${imageCount}`)) }))
  vi.mocked(callAgentResponsesApi).mockResolvedValueOnce(toolResponse).mockResolvedValue(finalResponse)
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function lastMessage() { return useCharacterStore.getState().conversations[0].messages.slice(-1)[0] }
async function waitDone(status: 'done' | 'error' = 'done') { await vi.waitFor(() => expect(lastMessage().status).toBe(status)) }

describe('人物函数调用', () => {
  it('首次生成的生活状态当轮生效，系统提示词仍为人格原文', async () => {
    useCharacterStore.setState({ characters: [{ ...char, lifeSchedulerEnabled: true }] })
    vi.mocked(callAgentResponsesApi).mockReset()
      .mockResolvedValueOnce({ ...finalResponse, text: JSON.stringify({ outfit_style: '日常', outfit: '蓝色衬衫', schedule: '08:00 在书店看书\n22:00 回家休息' }) })
      .mockResolvedValue(finalResponse)
    const id = useCharacterStore.getState().newConversation(char.id)
    await sendCharacterMessage(id, '今天穿什么？')
    await waitDone()
    const calls = vi.mocked(callAgentResponsesApi).mock.calls
    expect(calls).toHaveLength(2)
    expect(calls.every(([opts]) => opts.instructions === char.personality)).toBe(true)
    expect(calls[0][0].settings).toBe(app.settings)
    expect(JSON.stringify(calls[1][0].input)).toContain('蓝色衬衫')
    expect(JSON.stringify(calls[1][0].input)).toContain('<character_state>')
    expect(useCharacterStore.getState().characters[0].lifeSchedule?.date).toBe(getCharacterLifeDate(char))
  })

  it('生活日程请求失败后仍正常回复并记录日志', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    useCharacterStore.setState({ characters: [{ ...char, lifeSchedulerEnabled: true }] })
    vi.mocked(callAgentResponsesApi).mockReset().mockRejectedValueOnce(new Error('日程服务暂不可用')).mockResolvedValue(finalResponse)
    const id = useCharacterStore.getState().newConversation(char.id)
    await sendCharacterMessage(id, '你好')
    await waitDone()
    expect(callAgentResponsesApi).toHaveBeenCalledTimes(2)
    expect(lastMessage().content).toBe(finalResponse.text)
    expect(useCharacterLogStore.getState().entries.some((item) => item.title === '生活日程未更新，继续对话' && item.status === 'warning')).toBe(true)
  })

  it('停止回复会取消日程请求且不再发送聊天请求', async () => {
    useCharacterStore.setState({ characters: [{ ...char, lifeSchedulerEnabled: true }] })
    let signal: AbortSignal | undefined
    vi.mocked(callAgentResponsesApi).mockReset().mockImplementation((opts) => new Promise((_resolve, reject) => {
      signal = opts.signal
      signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    }))
    const id = useCharacterStore.getState().newConversation(char.id)
    await sendCharacterMessage(id, '你好')
    await vi.waitFor(() => expect(signal).toBeDefined())
    stopCharacterResponse(id)
    await waitDone('error')
    expect(signal!.aborted).toBe(true)
    expect(callAgentResponsesApi).toHaveBeenCalledOnce()
    expect(useCharacterStore.getState().characters[0].lifeSchedule).toBeUndefined()
  })

  it('Gemini 同一批抵达的文字在连接仍打开时全部显示，不等下一个分片或回复结束', async () => {
    app.settings.characterTextProfileId = FIXED_GEMINI_TEXT_PROFILE_ID
    const native = await vi.importActual<typeof import('./geminiTextApi')>('./geminiTextApi')
    vi.mocked(callGeminiTextApi).mockImplementation(native.callGeminiTextApi)
    const encoder = new TextEncoder()
    let stream!: ReadableStreamDefaultController<Uint8Array>
    const response = new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller } }), { headers: { 'Content-Type': 'text/event-stream' } })
    const fetchMock = vi.fn(async () => response)
    vi.stubGlobal('fetch', fetchMock)
    const id = useCharacterStore.getState().newConversation(char.id)
    await sendCharacterMessage(id, '你好')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    try {
      const chunks = ['你好', '，今天过得怎么样？'].map((text) => 'data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }) + '\n\n').join('')
      stream.enqueue(encoder.encode(chunks))
      await vi.waitFor(() => expect(lastMessage().content).toBe('你好，今天过得怎么样？'), { timeout: 500, interval: 10 })
      expect(lastMessage().status).toBe('replying')
      expect(callImageApi).not.toHaveBeenCalled()
    } finally {
      stream.enqueue(encoder.encode('data: {"candidates":[{"finishReason":"STOP"}]}\n\n'))
      stream.close()
      await waitDone()
    }
  })

  it('取消回复时保留已收到但尚未显示的尾部文字，之后不再更新', async () => {
    let started = false
    vi.mocked(callAgentResponsesApi).mockReset().mockImplementation((opts) => new Promise((resolve, reject) => {
      opts.onTextDelta?.('你好')
      opts.onTextDelta?.('，收到你的消息了。')
      started = true
      opts.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    }))
    const id = useCharacterStore.getState().newConversation(char.id)
    await sendCharacterMessage(id, '你好')
    await vi.waitFor(() => expect(started).toBe(true))
    stopCharacterResponse(id)
    await waitDone('error')
    expect(lastMessage().content).toBe('你好，收到你的消息了。')
    const message = lastMessage()
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(lastMessage()).toBe(message)
  })

  it('Gemini 原生流实时更新界面，流结束后生图，再流式回复工具结果', async () => {
    app.settings.characterTextProfileId = FIXED_GEMINI_TEXT_PROFILE_ID
    const native = await vi.importActual<typeof import('./geminiTextApi')>('./geminiTextApi')
    vi.mocked(callGeminiTextApi).mockImplementation(native.callGeminiTextApi)
    const encoder = new TextEncoder()
    let stream: ReadableStreamDefaultController<Uint8Array>
    const response = new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller } }), { headers: { 'Content-Type': 'text/event-stream' } })
    const fetchMock = vi.fn(async (_url: string, _request: RequestInit) => new Response('data: {"candidates":[{"content":{"parts":[{"text":"图片已经生成。"}]},"finishReason":"STOP"}]}\n\n', { headers: { 'Content-Type': 'text/event-stream' } })).mockResolvedValueOnce(response)
    vi.stubGlobal('fetch', fetchMock)
    const id = useCharacterStore.getState().newConversation(char.id)
    await sendCharacterMessage(id, '发照片')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    stream!.enqueue(encoder.encode('data: {"candidates":[{"content":{"parts":[{"text":"给你看看。"}]}}]}\n\n'))
    await vi.waitFor(() => expect(lastMessage().content).toBe('给你看看。'))
    expect(lastMessage().status).toBe('replying')
    expect(callImageApi).not.toHaveBeenCalled()
    const functionPart = { thoughtSignature: 'stream-signature', functionCall: { name: 'generate_image', args } }
    stream!.enqueue(encoder.encode('data: ' + JSON.stringify({ candidates: [{ content: { parts: [functionPart] } }] }) + '\n\n'))
    expect(callImageApi).not.toHaveBeenCalled()
    stream!.enqueue(encoder.encode('data: {"candidates":[{"finishReason":"STOP"}]}\n\n'))
    stream!.close()
    await waitDone()
    expect(callImageApi).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.every(([url]) => url.endsWith(':streamGenerateContent?alt=sse'))).toBe(true)
    const second = JSON.parse(fetchMock.mock.calls[1][1].body as string)
    expect(second.systemInstruction).toEqual({ parts: [{ text: char.personality }] })
    expect(second.contents.some((content: { parts: unknown[] }) => content.parts.some((part) => JSON.stringify(part) === JSON.stringify(functionPart)))).toBe(true)
    expect(second.contents[second.contents.length - 1].parts[0]).toMatchObject({ functionResponse: { name: 'generate_image', response: { success: true } } })
    expect(lastMessage().content).toContain('图片已经生成。')
  })

  it('原样使用人格、提示词及指定参考图，完整执行生图并把结果回传给语言模型', async () => {
    const id = useCharacterStore.getState().newConversation(char.id)
    expect(await sendCharacterMessage(id, '发两张照片')).toBe(true)
    expect(await sendCharacterMessage(id, '重复发送')).toBe(false)
    useCharacterStore.setState({ activeCharacterId: 'other' })
    await waitDone()
    expect(callAgentResponsesApi).toHaveBeenCalledTimes(2)
    for (const [opts] of vi.mocked(callAgentResponsesApi).mock.calls) expect(opts.instructions).toBe(char.personality)
    expect(callImageApi).toHaveBeenCalledTimes(1)
    expect(vi.mocked(callImageApi).mock.calls[0][0]).toMatchObject({ prompt: args.prompt, params: args.params, inputImageDataUrls: ['data:image/png;base64,face'] })
    expect(lastMessage()).toMatchObject({ imageIds: ['generated-image', 'second-image'], imageRequest: { params: args.params } })
    expect(lastMessage().content).toContain('图片已经生成。')
    const input = vi.mocked(callAgentResponsesApi).mock.calls[1][0].input as Array<Record<string, unknown>>
    expect(input).toContainEqual(toolResponse.outputItems[0])
    const output = input.find((item) => item.type === 'function_call_output')!
    expect(output.call_id).toBe('call-1')
    expect(JSON.parse(output.output as string)).toMatchObject({ success: true, imageIds: ['generated-image', 'second-image'], actualParams: args.params })
    expect(JSON.stringify(input)).toContain('data:image/png;base64,generated-image')
    expect(useCharacterStore.getState().activeCharacterId).toBe('other')
  })

  it('修改人格后下一轮立即使用新原文', async () => {
    const id = useCharacterStore.getState().newConversation(char.id)
    await sendCharacterMessage(id, '你好')
    await waitDone()
    useCharacterStore.getState().saveCharacter({ ...char, personality: '只回复一个数字。' })
    await sendCharacterMessage(id, '继续')
    await waitDone()
    expect(vi.mocked(callAgentResponsesApi).mock.calls.slice(-1)[0][0].instructions).toBe('只回复一个数字。')
  })

  it('失败作为工具结果回传，重试沿用已保存参数', async () => {
    vi.mocked(callImageApi).mockRejectedValueOnce(new Error('图片服务暂不可用'))
    const id = useCharacterStore.getState().newConversation(char.id)
    await sendCharacterMessage(id, '发张照片')
    await waitDone('error')
    const input = vi.mocked(callAgentResponsesApi).mock.calls[1][0].input as Array<Record<string, unknown>>
    expect(JSON.parse(input.find((item) => item.type === 'function_call_output')!.output as string)).toEqual({ success: false, error: '图片服务暂不可用' })
    const saved = normalizeCharacterData(useCharacterStore.getState())
    useCharacterStore.setState(saved)
    await sendCharacterMessage(id, '', [], lastMessage().id)
    await waitDone()
    expect(callImageApi).toHaveBeenCalledTimes(2)
    expect(vi.mocked(callImageApi).mock.calls[1][0].params).toEqual(args.params)
    expect(callAgentResponsesApi).toHaveBeenCalledTimes(3)
  })

  it('图片成功但后续语言请求失败时，重试不会重新生图', async () => {
    vi.mocked(callAgentResponsesApi).mockReset().mockResolvedValueOnce(toolResponse).mockRejectedValueOnce(new Error('回复断线')).mockResolvedValue(finalResponse)
    const id = useCharacterStore.getState().newConversation(char.id)
    await sendCharacterMessage(id, '发张照片')
    await waitDone('error')
    useCharacterStore.setState(normalizeCharacterData(useCharacterStore.getState()))
    await sendCharacterMessage(id, '', [], lastMessage().id)
    await waitDone()
    expect(callImageApi).toHaveBeenCalledTimes(1)
    expect(lastMessage().imageIds).toHaveLength(2)
  })

  it('参数缺失和虚构引用会回传错误，模型可纠正后调用', async () => {
    vi.mocked(callAgentResponsesApi).mockReset().mockResolvedValueOnce({ ...toolResponse, outputItems: [{ ...toolResponse.outputItems[0], arguments: JSON.stringify({ ...args, referenceIds: ['unknown'] }) }] }).mockResolvedValueOnce(toolResponse).mockResolvedValue(finalResponse)
    const id = useCharacterStore.getState().newConversation(char.id)
    await sendCharacterMessage(id, '发张照片')
    await waitDone()
    expect(callImageApi).toHaveBeenCalledTimes(1)
    expect(callAgentResponsesApi).toHaveBeenCalledTimes(3)
    expect(lastMessage().imageError).toBeUndefined()
  })

  it('Gemini 保留 thoughtSignature 并使用原生 functionResponse 回传全部结果', async () => {
    app.settings.characterTextProfileId = FIXED_GEMINI_TEXT_PROFILE_ID
    const content = { role: 'model' as const, parts: [{ text: '给你看看。' }, { thoughtSignature: 'opaque-signature', functionCall: { id: 'gemini-call', name: 'generate_image', args } }] }
    vi.mocked(callGeminiTextApi).mockResolvedValueOnce({ text: '给你看看。', content }).mockResolvedValue({ text: '图片完成。', content: { role: 'model', parts: [{ text: '图片完成。' }] } })
    const id = useCharacterStore.getState().newConversation(char.id)
    await sendCharacterMessage(id, '发张照片')
    await waitDone()
    expect(callAgentResponsesApi).not.toHaveBeenCalled()
    expect(callGeminiTextApi).toHaveBeenCalledTimes(2)
    const second = vi.mocked(callGeminiTextApi).mock.calls[1][0]
    expect(second.instructions).toBe(char.personality)
    expect(second.contents).toContainEqual(content)
    expect(second.contents.slice(-1)[0].parts[0]).toMatchObject({ functionResponse: { id: 'gemini-call', name: 'generate_image', response: { success: true, imageIds: ['generated-image', 'second-image'] } } })
    expect(second.contents.slice(-1)[0].parts.some((part) => part.inlineData)).toBe(true)
  })

  it('取消回复后不继续生图，缺少密钥不创建空消息', async () => {
    vi.mocked(callAgentResponsesApi).mockReset().mockImplementationOnce((opts) => new Promise((resolve, reject) => { opts.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }) }))
    const id = useCharacterStore.getState().newConversation(char.id)
    await sendCharacterMessage(id, '发张照片')
    await vi.waitFor(() => expect(callAgentResponsesApi).toHaveBeenCalled())
    stopCharacterResponse(id)
    await waitDone('error')
    expect(lastMessage().error).toContain('已停止')
    expect(callImageApi).not.toHaveBeenCalled()
    app.settings = lockApiSettings(DEFAULT_SETTINGS)
    expect(await sendCharacterMessage(id, '你好')).toBe(false)
    expect(app.setShowSettings).toHaveBeenCalledWith(true, 'api')
    expect(useCharacterStore.getState().conversations[0].messages).toHaveLength(2)
  })

  it('工具轮数达到上限后仍回传最后结果，但不再执行生图', async () => {
    app.settings.agentMaxToolRounds = 1
    vi.mocked(callAgentResponsesApi).mockReset().mockResolvedValueOnce(toolResponse).mockResolvedValueOnce(toolResponse).mockResolvedValue(finalResponse)
    const id = useCharacterStore.getState().newConversation(char.id)
    await sendCharacterMessage(id, '发张照片')
    await waitDone('error')
    expect(callImageApi).toHaveBeenCalledTimes(1)
    expect(vi.mocked(callAgentResponsesApi).mock.calls[1][0].tools).toEqual([])
  })
})

describe('人物上下文和参数校验', () => {
  it('模型省略可空遮罩时视为未使用遮罩，不额外占用纠错轮次', () => {
    const { maskImageId, ...withoutMask } = args
    expect(parseCharacterImageCall(withoutMask, app.settings, char, new Set(['face'])).maskImageId).toBeNull()
    expect(() => parseCharacterImageCall({ ...withoutMask, maskImageId: 123 }, app.settings, char, new Set(['face']))).toThrow('maskImageId')
  })
  it('逐张读取图片实际尺寸，不把请求的竖图比例当成接口已生效的比例', async () => {
    vi.mocked(storeImageWithSize).mockResolvedValueOnce({ id: 'square', width: 2048, height: 2048 }).mockResolvedValueOnce({ id: 'portrait', width: 832, height: 1248 })
    const request = { ...args, profileId: 'fixed-gemini', model: 'gemini-3.1-flash-image', params: { ...DEFAULT_PARAMS, size: '1K', aspect_ratio: '2:3' as const, n: 2 } }
    vi.mocked(callImageApi).mockResolvedValue({ images: ['first', 'second'], actualParams: { aspect_ratio: '2:3', n: 2 } })
    const result = await executeCharacterImage(request, app.settings, new AbortController().signal)
    expect(result.output.requestedParams).toEqual(request.params)
    expect(result.output.actualParams).toMatchObject({ size: '2048x2048', aspect_ratio: '1:1' })
    expect(result.output.actualParamsList).toEqual([{ n: 2, size: '2048x2048', aspect_ratio: '1:1' }, { n: 2, size: '832x1248', aspect_ratio: '2:3' }])
  })

  it.each(['1024x1536', '1024x1024', '1536x1024', 'auto'])('OpenAI 画幅 %s 落实到像素 size，自动时保留模型选择', async (size) => {
    app.settings.characterImageSize = size
    const input = { ...args, params: { ...args.params, size: 'auto' } }
    const request = parseCharacterImageCall(input, app.settings, char, new Set(['face']))
    await executeCharacterImage(request, app.settings, new AbortController().signal)
    expect(vi.mocked(callImageApi).mock.calls[0][0].params).toEqual({ ...args.params, size })
    expect(input.params.size).toBe('auto')
  })

  it('自动画幅允许本轮横图，工具说明提供各接口的画幅参数', () => {
    expect(parseCharacterImageCall(args, app.settings, char, new Set(['face'])).params).toEqual(args.params)
    app.settings.characterImageSize = '1024x1536'
    const tool = createCharacterImageTool(app.settings, char)
    expect(tool.description).toContain('params.aspect_ratio 填 2:3')
    expect(tool.description).toContain('params.size 填 1024x1536')
  })

  it('人物参考模式固定身份图顺序，区分物体与服装且不混用头像', () => {
    const result = parseCharacterImageCall({ ...args, mode: 'selfie', referenceIds: ['cat', 'face'], referenceRoles: ['object', 'identity'], optimize: true }, app.settings, { ...char, avatarImageId: 'avatar' }, new Set(['face', 'body', 'cat']))
    expect(result.referenceIds).toEqual(['face', 'body', 'cat'])
    expect(result.referenceRoles).toEqual(['identity', 'identity', 'object'])
    expect(() => parseCharacterImageCall({ ...args, mode: 'edit', referenceRoles: ['style'] }, app.settings, char, new Set(['face']))).toThrow('subject')
    expect(() => parseCharacterImageCall({ ...args, mode: 'selfie', referenceRoles: [] }, app.settings, char, new Set(['face']))).toThrow('一一对应')
    expect(() => parseCharacterImageCall({ ...args, mode: 'selfie', referenceIds: [], referenceRoles: [] }, app.settings, { ...char, referenceImageIds: [] }, new Set())).toThrow('头像不能代替')
  })
  it('独立头像不进入语言上下文，也不能作为生图参考图调用', async () => {
    const character = { ...char, avatarImageId: 'display-only-avatar' }
    const context = await buildCharacterInput(character, [])
    expect(context.imageIds.has('display-only-avatar')).toBe(false)
    expect(JSON.stringify(context.input)).not.toContain('display-only-avatar')
    expect(JSON.stringify(context.contents)).not.toContain('display-only-avatar')
    expect(ensureImageCached).not.toHaveBeenCalledWith('display-only-avatar')
    expect(() => parseCharacterImageCall({ ...args, referenceIds: ['display-only-avatar'] }, app.settings, character, context.imageIds)).toThrow('不存在')
  })
  it('仅附上模型明确选择的参考图，允许纯文生图', () => {
    expect(parseCharacterImageCall({ ...args, referenceIds: [] }, app.settings, char, new Set()).referenceIds).toEqual([])
    expect(() => parseCharacterImageCall({ ...args, referenceIds: ['unknown'] }, app.settings, char, new Set())).toThrow('不存在')
    expect(() => parseCharacterImageCall({ ...args, params: { size: 'auto' } }, app.settings, char, new Set(['face']))).toThrow()
    expect(() => parseCharacterImageCall({ ...args, intent: 'spontaneous' }, app.settings, { ...char, autoImages: false }, new Set(['face']))).toThrow('关闭')
    expect(() => parseCharacterImageCall({ ...args, model: 'unknown' }, app.settings, char, new Set(['face']))).toThrow('可用的模型')
  })

  it('普通聊天仅提供人物参考图 ID，不读取原图；聊天附件仍可看图并限制历史图片数量', async () => {
    const messages: CharacterMessage[] = Array.from({ length: 12 }, (_, idx) => ({ id: String(idx), role: 'assistant', content: '图片', imageIds: ['photo-' + idx], status: 'done', createdAt: idx }))
    const context = await buildCharacterInput(char, messages)
    expect([...context.imageIds]).toEqual(['face', 'body', ...Array.from({ length: 8 }, (_, idx) => 'photo-' + (idx + 4))])
    expect(JSON.stringify(context.input)).not.toContain('photo-0')
    expect(JSON.stringify(context.contents)).not.toContain('photo-0')
    expect(ensureImageCached).not.toHaveBeenCalledWith('face')
    expect(ensureImageCached).not.toHaveBeenCalledWith('body')
    expect(JSON.stringify(context.contents)).toContain('inlineData')
    vi.mocked(ensureImageCached).mockClear().mockResolvedValue(undefined)
    const plain = await buildCharacterInput(char, [])
    expect(plain.imageIds).toEqual(new Set(['face', 'body']))
    expect(ensureImageCached).not.toHaveBeenCalled()
    expect(JSON.stringify(plain.input)).not.toContain('input_image')
    expect(JSON.stringify(plain.contents)).not.toContain('inlineData')
    expect(JSON.stringify(plain.contents)).toContain('仅生图使用')
    await expect(buildCharacterInput(char, [{ ...messages[0], role: 'user' }])).rejects.toThrow('图片已丢失')
  })
})

describe('人物后台生图', () => {
  it('三个副脑同时开始，先完成的方案立即生图，乱序完成按送达顺序入库', async () => {
    app.settings.characterImageOptimizer = { ...app.settings.characterImageOptimizer!, enabled: true, style: 'photo' }
    const finishPlans: Array<(value: Awaited<ReturnType<typeof callAgentResponsesApi>>) => void> = []
    const finishImages: Array<(value: { images: string[] }) => void> = []
    vi.mocked(callAgentResponsesApi).mockReset().mockImplementation(() => new Promise((resolve) => { finishPlans.push(resolve) }))
    vi.mocked(callImageApi).mockReset().mockImplementation(() => new Promise((resolve) => { finishImages.push(resolve) }))
    const id = useCharacterStore.getState().newConversation(char.id)
    useCharacterStore.setState((state) => ({ conversations: state.conversations.map((convo) => ({ ...convo, messages: [{ id: 'batch', role: 'assistant', content: '', imageIds: [], status: 'done', createdAt: 1 }] })) }))
    const request = parseCharacterImageCall({ ...args, optimize: true, params: { ...args.params, n: 3 } }, app.settings, char, new Set(['face']))
    const settled = vi.fn()
    const job = await enqueueCharacterImageJob({ conversationId: id, messageId: 'batch', callKey: 'parallel', request, settings: app.settings, onSettled: settled })
    await vi.waitFor(() => expect(finishPlans).toHaveLength(3))
    expect(finishImages).toHaveLength(0)
    finishPlans[1]({ text: JSON.stringify({ subject_appearance: 'Woman', pose_and_action: 'Waving' }), images: [], outputItems: [] })
    await vi.waitFor(() => expect(finishImages).toHaveLength(1))
    expect(settled).not.toHaveBeenCalled()
    finishPlans[0]({ text: JSON.stringify({ subject_appearance: 'Woman', pose_and_action: 'Smiling' }), images: [], outputItems: [] })
    finishPlans[2]({ text: JSON.stringify({ subject_appearance: 'Woman', pose_and_action: 'Looking back' }), images: [], outputItems: [] })
    await vi.waitFor(() => expect(finishImages).toHaveLength(3))
    expect(vi.mocked(callImageApi).mock.calls.every(([opts]) => opts.params.n === 1)).toBe(true)
    expect(new Set(vi.mocked(callImageApi).mock.calls.map(([opts]) => opts.prompt)).size).toBe(3)
    finishImages[2]({ images: ['data:image/png;base64,third'] })
    await vi.waitFor(() => expect(getCharacterImageJobs(id)[0].items[2].status).toBe('completed'))
    finishImages[0]({ images: ['data:image/png;base64,second'] })
    finishImages[1]({ images: ['data:image/png;base64,result'] })
    await vi.waitFor(() => expect(settled).toHaveBeenCalledOnce())
    expect(getCharacterImageJobs(id)[0].status).toBe('completed')
    expect(useCharacterStore.getState().conversations[0].messages.filter((msg) => msg.imageIds.length).map((msg) => msg.id)).toEqual([2, 1, 0].map((idx) => `image-${job.id}-${idx}`))
  })

  it('取消并发多图时等待全部子请求退出，保留已送达图片', async () => {
    const id = useCharacterStore.getState().newConversation(char.id)
    useCharacterStore.setState((state) => ({ conversations: state.conversations.map((convo) => ({ ...convo, messages: [{ id: 'batch', role: 'assistant', content: '', imageIds: [], status: 'done', createdAt: 1 }] })) }))
    const requests: Array<{ signal: AbortSignal; finish: (value: { images: string[] }) => void }> = []
    vi.mocked(callImageApi).mockReset().mockImplementation((opts) => new Promise((resolve, reject) => {
      requests.push({ signal: opts.signal!, finish: resolve })
      opts.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    }))
    const settled = vi.fn()
    const request = parseCharacterImageCall({ ...args, optimize: false, params: { ...args.params, n: 3 } }, app.settings, char, new Set(['face']))
    const job = await enqueueCharacterImageJob({ conversationId: id, messageId: 'batch', callKey: 'cancel', request, settings: app.settings, onSettled: settled })
    await vi.waitFor(() => expect(requests).toHaveLength(3))
    requests[1].finish({ images: ['data:image/png;base64,second'] })
    await vi.waitFor(() => expect(getCharacterImageJobs(id)[0].items[1].status).toBe('completed'))
    cancelCharacterImageJob(job.id)
    await vi.waitFor(() => expect(settled).toHaveBeenCalledOnce())
    expect(requests.every((item) => item.signal.aborted)).toBe(true)
    expect(getCharacterImageJobs(id)[0].items.map((item) => item.status)).toEqual(['cancelled', 'completed', 'cancelled'])
    expect(useCharacterStore.getState().conversations[0].messages.flatMap((msg) => msg.imageIds)).toEqual(['second-image'])
  })

  it('副脑重复方案并发重写且不重复提交图片，单张优化失败保留其他结果', async () => {
    app.settings.characterImageOptimizer = { ...app.settings.characterImageOptimizer!, enabled: true, style: 'photo' }
    const scene = { subject_appearance: 'Woman', pose_and_action: 'Sitting' }
    vi.mocked(callAgentResponsesApi).mockReset().mockImplementation(async (opts) => ({ text: JSON.stringify(opts.instructions?.includes('Create only image 3') ? { error: 'bad plan' } : { ...scene, pose_and_action: opts.instructions?.includes('Already used image prompts') ? 'Standing' : 'Sitting' }), images: [], outputItems: [] }))
    const id = useCharacterStore.getState().newConversation(char.id)
    useCharacterStore.setState((state) => ({ conversations: state.conversations.map((convo) => ({ ...convo, messages: [{ id: 'batch', role: 'assistant', content: '', imageIds: [], status: 'done', createdAt: 1 }] })) }))
    const settled = vi.fn()
    const request = parseCharacterImageCall({ ...args, optimize: true, params: { ...args.params, n: 3 } }, app.settings, char, new Set(['face']))
    await enqueueCharacterImageJob({ conversationId: id, messageId: 'batch', callKey: 'duplicate', request, settings: app.settings, onSettled: settled })
    await vi.waitFor(() => expect(settled).toHaveBeenCalledOnce())
    const job = getCharacterImageJobs(id)[0]
    expect(job.status).toBe('partial')
    expect(job.items.map((item) => item.status)).toEqual(['completed', 'completed', 'failed'])
    expect(callAgentResponsesApi).toHaveBeenCalledTimes(4)
    expect(callImageApi).toHaveBeenCalledTimes(2)
    expect(new Set(vi.mocked(callImageApi).mock.calls.map(([opts]) => opts.prompt)).size).toBe(2)
    expect(vi.mocked(callAgentResponsesApi).mock.calls.every(([opts]) => JSON.stringify(opts.input) === JSON.stringify([{ role: 'user', content: args.prompt }]))).toBe(true)
  })

  it('Gemini 连续两轮各生成三张：原生函数接单，副脑仅传文本，每张完成即送达且不复用上一轮', async () => {
    app.settings.characterTextProfileId = FIXED_GEMINI_TEXT_PROFILE_ID
    app.settings.characterImageBackground = true
    app.settings.characterImageSize = '1024x1536'
    app.settings.characterImageOptimizer = { ...app.settings.characterImageOptimizer!, enabled: true, style: 'photo' }
    const native = await vi.importActual<typeof import('./geminiTextApi')>('./geminiTextApi')
    vi.mocked(callGeminiTextApi).mockImplementation(native.callGeminiTextApi)
    let batch = 0
    const fetchMock = vi.fn(async (_url: string, request: RequestInit) => {
      const body = JSON.parse(request.body as string)
      const response = (parts: unknown[]) => new Response('data: ' + JSON.stringify({ candidates: [{ content: { parts }, finishReason: 'STOP' }] }) + '\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
      if (body.generationConfig?.responseMimeType === 'application/json') {
        const prompt = body.contents[0].parts[0].text
        const idx = Number(body.systemInstruction.parts[0].text.match(/Create only image (\d+)/)[1]) - 1
        return response([{ text: JSON.stringify({ subject_appearance: 'Woman from identity references', pose_and_action: ['Waving', 'Looking back', 'Smiling'][idx], environment_and_scene: prompt, technical_specs: 'Phone photo' }) }])
      }
      if (!body.tools || body.contents.some((content: { parts: Array<{ functionResponse?: unknown }> }) => content.parts.some((part) => part.functionResponse))) return response([{ text: '你喜欢哪张？' }])
      batch += 1
      return response([{ text: '给你看看。' }, { thoughtSignature: `signature-${batch}`, functionCall: { id: 'same-provider-call', name: 'generate_image', args: {
        ...args, profileId: FIXED_GEMINI_PROFILE_ID, model: GEMINI_FLASH_IMAGE_MODEL,
        prompt: batch === 1 ? 'Beach' : 'Cafe', mode: 'selfie', referenceIds: [], referenceRoles: [], optimize: true,
        params: { ...DEFAULT_PARAMS, size: '2K', n: 3 },
      } } }])
    })
    vi.stubGlobal('fetch', fetchMock)
    const finishImages: Array<(value: { images: string[] }) => void> = []
    vi.mocked(callImageApi).mockReset().mockImplementation(() => new Promise((resolve) => { finishImages.push(resolve) }))
    const id = useCharacterStore.getState().newConversation(char.id)
    for (const [round, text] of ['发三张不同姿势的海边自拍', '再发三张咖啡馆的自拍'].entries()) {
      expect(await sendCharacterMessage(id, text)).toBe(true)
      await waitDone()
      await vi.waitFor(() => expect(finishImages).toHaveLength((round + 1) * 3))
      for (let idx = 0; idx < 3; idx += 1) {
        const count = round * 3 + idx
        expect(finishImages).toHaveLength((round + 1) * 3)
        expect(useCharacterStore.getState().conversations[0].messages.filter((msg) => msg.imageIds.length)).toHaveLength(count)
        finishImages[count]({ images: [`data:image/png;base64,batch-${round}-${idx}`] })
        await vi.waitFor(() => expect(useCharacterStore.getState().conversations[0].messages.filter((msg) => msg.imageIds.length)).toHaveLength(count + 1))
      }
      await vi.waitFor(() => expect(getCharacterImageJobs(id)[round]?.notification).toBe('done'))
    }
    const jobs = getCharacterImageJobs(id)
    expect(jobs).toHaveLength(2)
    expect(jobs[0].id).not.toBe(jobs[1].id)
    expect(jobs.every((job) => job.status === 'completed' && job.items.length === 3 && job.request.params.n === 3)).toBe(true)
    expect(new Set(jobs.flatMap((job) => job.items.map((item) => item.prompt))).size).toBe(6)
    const calls = vi.mocked(callImageApi).mock.calls.map(([opts]) => opts)
    expect(calls.map((opts) => opts.prompt)).toEqual(jobs.flatMap((job) => job.items.map((item) => item.prompt)))
    expect(calls.every((opts) => opts.params.n === 1 && opts.params.aspect_ratio === '2:3')).toBe(true)
    expect(calls.every((opts) => JSON.stringify(opts.inputImageDataUrls) === JSON.stringify(['data:image/png;base64,face', 'data:image/png;base64,body']))).toBe(true)
    const bodies = fetchMock.mock.calls.map(([, request]) => JSON.parse(request.body as string))
    const optimizers = bodies.filter((body) => body.generationConfig?.responseMimeType === 'application/json')
    expect(optimizers).toHaveLength(6)
    expect(optimizers.map((body) => body.contents)).toEqual(['Beach', 'Beach', 'Beach', 'Cafe', 'Cafe', 'Cafe'].map((text) => [{ role: 'user', parts: [{ text }] }]))
    expect(optimizers.every((body) => body.systemInstruction.parts[0].text.includes('Output ONLY ONE valid JSON object'))).toBe(true)
    expect(bodies.filter((body) => !optimizers.includes(body)).every((body) => body.systemInstruction.parts[0].text === char.personality)).toBe(true)
    const languageImages = bodies.flatMap((body) => body.contents.flatMap((content: { parts: Array<{ inlineData?: { data: string } }> }) => content.parts.filter((part) => part.inlineData).map((part) => part.inlineData!.data)))
    expect(languageImages.filter((data) => data === 'face' || data === 'body')).toEqual([])
    expect(callAgentResponsesApi).not.toHaveBeenCalled()
    const logs = useCharacterLogStore.getState().entries.filter((entry) => entry.conversationId === id)
    expect(logs.filter((entry) => entry.stage === 'optimizer' && entry.status === 'success')).toHaveLength(6)
    expect(logs.filter((entry) => entry.title === '发送生图请求' && entry.status === 'success')).toHaveLength(6)
    expect(logs.filter((entry) => entry.title === '图片送达聊天')).toHaveLength(6)
    expect(logs.some((entry) => entry.status === 'running')).toBe(false)
    expect(logs.filter((entry) => entry.title.startsWith('主 Agent 请求')).every((entry) => entry.details?.includes('streamGenerateContent?alt=sse'))).toBe(true)
    expect(JSON.stringify(logs)).not.toContain('test-only')
    expect(JSON.stringify(logs)).not.toContain('signature-1')
  })

  it('第二轮接口返回旧图时重新请求，仍重复则该张失败，多图其他结果继续送达', async () => {
    app.settings.characterImageBackground = true
    const imageArgs = { ...args, mode: 'draw', referenceRoles: ['identity'], optimize: false, params: { ...args.params, n: 1 } }
    vi.mocked(callAgentResponsesApi).mockReset().mockResolvedValueOnce({ ...toolResponse, outputItems: [{ ...toolResponse.outputItems[0], arguments: JSON.stringify(imageArgs) }] }).mockResolvedValue(finalResponse)
    vi.mocked(callImageApi).mockReset().mockResolvedValueOnce({ images: ['data:image/png;base64,result'] })
    const id = useCharacterStore.getState().newConversation(char.id)
    await sendCharacterMessage(id, '发一张')
    await vi.waitFor(() => expect(getCharacterImageJobs(id)[0]?.notification).toBe('done'))
    vi.mocked(callAgentResponsesApi).mockResolvedValueOnce({ ...toolResponse, outputItems: [{ ...toolResponse.outputItems[0], arguments: JSON.stringify({ ...imageArgs, prompt: '在咖啡馆拍新照片', params: { ...imageArgs.params, n: 3 } }) }] })
    vi.mocked(callImageApi)
      .mockResolvedValueOnce({ images: ['data:image/png;base64,result'] })
      .mockResolvedValueOnce({ images: ['data:image/png;base64,second'] })
      .mockResolvedValueOnce({ images: ['data:image/png;base64,second'] })
      .mockResolvedValueOnce({ images: ['data:image/png;base64,second'] })
      .mockResolvedValueOnce({ images: ['data:image/png;base64,third'] })
    await sendCharacterMessage(id, '再发三张')
    await vi.waitFor(() => expect(getCharacterImageJobs(id)[1]?.notification).toBe('done'))
    const job = getCharacterImageJobs(id)[1]
    expect(job.status).toBe('partial')
    expect(job.items.filter((item) => item.status === 'completed')).toHaveLength(2)
    expect(job.items.find((item) => item.status === 'failed')?.error).toContain('连续返回重复图片')
    expect(callImageApi).toHaveBeenCalledTimes(6)
    expect(vi.mocked(callImageApi).mock.calls.slice(1).every(([opts]) => opts.prompt === job.request.prompt && opts.params.n === 1)).toBe(true)
    expect(useCharacterStore.getState().conversations[0].messages.filter((msg) => msg.imageIds.length).map((msg) => msg.imageIds)).toEqual([['generated-image'], ['second-image'], ['third']])
    const logs = useCharacterLogStore.getState().entries.filter((entry) => entry.conversationId === id)
    expect(logs.filter((entry) => entry.title.includes('自动重试'))).toHaveLength(2)
    expect(logs.some((entry) => entry.title.startsWith('生成第 ') && entry.status === 'error' && entry.result?.includes('连续返回重复图片'))).toBe(true)
  })

  it('接单固定竖图参数，设置改变及失败重试都不会改回方图', async () => {
    app.settings.characterImageBackground = true
    app.settings.characterImageSize = '1024x1536'
    const imageArgs = { ...args, mode: 'draw', referenceRoles: ['identity'], optimize: false, params: { ...args.params, size: '1024x1024', n: 1 } }
    vi.mocked(callAgentResponsesApi).mockReset().mockResolvedValueOnce({ ...toolResponse, outputItems: [{ ...toolResponse.outputItems[0], arguments: JSON.stringify(imageArgs) }] }).mockResolvedValue(finalResponse)
    vi.mocked(callImageApi).mockReset().mockRejectedValueOnce(new Error('暂时失败')).mockResolvedValue({ images: ['data:image/png;base64,result'] })
    const id = useCharacterStore.getState().newConversation(char.id)
    await sendCharacterMessage(id, '发张照片')
    await vi.waitFor(() => expect(getCharacterImageJobs(id)[0]?.notification).toBe('done'))
    const job = getCharacterImageJobs(id)[0]
    expect(job.request.params.size).toBe('1024x1536')
    app.settings.characterImageSize = '1536x1024'
    const msgId = useCharacterStore.getState().conversations[0].messages.find((msg) => msg.imageJobs?.some((item) => item.id === job.id))!.id
    await retryCharacterImageJob(id, msgId, job.id)
    await vi.waitFor(() => expect(getCharacterImageJobs(id)[0]?.notification).toBe('done'))
    expect(getCharacterImageJobs(id)[0].status).toBe('completed')
    expect(vi.mocked(callImageApi).mock.calls.map(([opts]) => opts.params.size)).toEqual(['1024x1536', '1024x1536'])
  })

  it('主 Agent → OmniDraw 副脑 → 生图逐字直传，重试复用优化结果和参考图', async () => {
    app.settings.characterImageBackground = true
    app.settings.characterImageOptimizer = { ...app.settings.characterImageOptimizer!, enabled: true, style: 'photo' }
    const imageArgs = { ...args, mode: 'draw', referenceRoles: ['identity'], optimize: true }
    const scene = { subject_appearance: 'Black-haired woman', clothing_and_accessories: 'White shirt', pose_and_action: 'Sitting', environment_and_scene: 'Riverside', lighting_and_mood: 'Daylight', technical_specs: 'Phone photo', realism_and_quality_guardrails: 'Natural proportions' }
    const expected = 'single image, one natural coherent frame, no grid, no collage, no split screen, no multiple views, Black-haired woman, White shirt, Sitting, Riverside, Daylight, Phone photo, Natural proportions'
    vi.mocked(callAgentResponsesApi).mockReset().mockResolvedValueOnce({ ...toolResponse, outputItems: [{ ...toolResponse.outputItems[0], arguments: JSON.stringify(imageArgs) }] }).mockImplementation(async (opts) => opts.instructions === char.personality ? finalResponse : { text: JSON.stringify({ ...scene, pose_and_action: opts.instructions?.includes('Create only image 2') ? 'Standing' : 'Sitting' }), images: [], outputItems: [] })
    vi.mocked(callImageApi).mockReset().mockResolvedValueOnce({ images: ['data:image/png;base64,result'] }).mockRejectedValueOnce(new Error('第二张失败')).mockResolvedValue({ images: ['data:image/png;base64,second'] })
    const id = useCharacterStore.getState().newConversation(char.id)
    await sendCharacterMessage(id, '拍两张')
    await vi.waitFor(() => expect(getCharacterImageJobs(id)[0]?.notification).toBe('done'))
    const job = getCharacterImageJobs(id)[0]
    expect(job.optimizerStatus).toBe('optimized')
    expect(job.items.map((item) => item.prompt)).toEqual([expected, expected.replace('Sitting', 'Standing')])
    expect(job.request.prompt).toBe(args.prompt)
    const optimizers = vi.mocked(callAgentResponsesApi).mock.calls.filter(([opts]) => opts.instructions !== char.personality)
    expect(optimizers).toHaveLength(2)
    expect(optimizers[0][0].input).toEqual([{ role: 'user', content: args.prompt }])
    expect(optimizers[0][0].instructions).toContain('Create only image 1 of 2')
    expect(optimizers[0][0].tools).toEqual([])
    const msgId = useCharacterStore.getState().conversations[0].messages[1].id
    await retryCharacterImageJob(id, msgId, job.id)
    await vi.waitFor(() => expect(getCharacterImageJobs(id)[0]?.notification).toBe('done'))
    expect(getCharacterImageJobs(id)[0].status).toBe('completed')
    const pictures = vi.mocked(callImageApi).mock.calls.map(([opts]) => opts)
    expect(pictures.map((opts) => opts.prompt)).toEqual([expected, expected.replace('Sitting', 'Standing'), expected.replace('Sitting', 'Standing')])
    expect(pictures.every((opts) => opts.inputImageDataUrls?.[0] === 'data:image/png;base64,face')).toBe(true)
    expect(vi.mocked(callAgentResponsesApi).mock.calls.filter(([opts]) => opts.instructions !== char.personality)).toHaveLength(2)
  })

  it('透明输出使用背景参数，不在最终生图提示词后追加内容', async () => {
    const request = parseCharacterImageCall({ ...args, params: { ...args.params, output_format: 'png', output_compression: null, transparent_output: true, n: 1 } }, app.settings, char, new Set(['face']))
    await executeCharacterImage(request, app.settings, new AbortController().signal)
    expect(vi.mocked(callImageApi).mock.calls[0][0]).toMatchObject({ prompt: args.prompt, params: { background: 'transparent', output_format: 'png', output_compression: null } })
  })

  it('关闭后台后仍使用任务链路，保留部分成功结果并通过函数回传，不额外发通知', async () => {
    vi.mocked(callAgentResponsesApi).mockReset().mockResolvedValueOnce({ ...toolResponse, outputItems: [{ ...toolResponse.outputItems[0], arguments: JSON.stringify({ ...args, mode: 'draw', referenceRoles: ['subject'], optimize: false }) }] }).mockResolvedValue(finalResponse)
    vi.mocked(callImageApi).mockReset().mockResolvedValueOnce({ images: ['data:image/png;base64,result'] }).mockRejectedValueOnce(new Error('第二张失败'))
    const id = useCharacterStore.getState().newConversation(char.id)
    await sendCharacterMessage(id, '拍两张')
    await waitDone('error')
    expect(lastMessage().imageIds).toEqual(['generated-image'])
    expect(lastMessage().imageJobs![0].status).toBe('partial')
    expect(lastMessage().imageJobs![0].notification).toBe('done')
    expect(callAgentResponsesApi).toHaveBeenCalledTimes(2)
    const input = vi.mocked(callAgentResponsesApi).mock.calls[1][0].input as Array<Record<string, unknown>>
    expect(JSON.parse(input.find((item) => item.type === 'function_call_output')!.output as string)).toMatchObject({ success: false, status: 'partial', completedCount: 1, imageIds: ['generated-image'] })
  })

  it('后台缺失显式参考图时失败，不降级为无参考生图', async () => {
    app.settings.characterImageBackground = true
    const id = useCharacterStore.getState().newConversation(char.id)
    vi.mocked(ensureImageCached).mockImplementation(async (imageId) => imageId === 'face' ? undefined : 'data:image/png;base64,' + imageId)
    await sendCharacterMessage(id, '拍两张')
    await vi.waitFor(() => expect(getCharacterImageJobs(id)[0]?.status).toBe('failed'))
    expect(callImageApi).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(getCharacterImageJobs(id)[0]?.notification).toBe('done'))
  })

  it('接单后释放聊天，完成时等待正在进行的回复，再根据真实结果通知且不重复出图', async () => {
    app.settings.characterImageBackground = true
    let finishImage!: (value: { images: string[] }) => void
    vi.mocked(callImageApi).mockImplementationOnce(() => new Promise((resolve) => { finishImage = resolve }))
    vi.mocked(callAgentResponsesApi).mockReset().mockResolvedValueOnce({ ...toolResponse, outputItems: [{ ...toolResponse.outputItems[0], arguments: JSON.stringify({ ...args, params: { ...args.params, n: 1 } }) }] }).mockResolvedValue(finalResponse)
    const id = useCharacterStore.getState().newConversation(char.id)
    await sendCharacterMessage(id, '拍一张')
    await waitDone()
    expect(getCharacterImageJobs(id)[0].status).toBe('generating')
    const receipt = (vi.mocked(callAgentResponsesApi).mock.calls[1][0].input as Array<Record<string, unknown>>).find((item) => item.type === 'function_call_output')!
    expect(JSON.parse(receipt.output as string)).toMatchObject({ accepted: true, taskId: getCharacterImageJobs(id)[0].id })
    expect(JSON.parse(receipt.output as string).success).toBeUndefined()
    let finishChat!: (value: typeof finalResponse) => void
    vi.mocked(callAgentResponsesApi).mockImplementationOnce(() => new Promise((resolve) => { finishChat = resolve }))
    expect(await sendCharacterMessage(id, '等待时聊一会')).toBe(true)
    await vi.waitFor(() => expect(callAgentResponsesApi).toHaveBeenCalledTimes(3))
    finishImage({ images: ['data:image/png;base64,result'] })
    await vi.waitFor(() => expect(getCharacterImageJobs(id)[0].status).toBe('completed'))
    expect(callAgentResponsesApi).toHaveBeenCalledTimes(3)
    finishChat(finalResponse)
    await vi.waitFor(() => expect(getCharacterImageJobs(id)[0].notification).toBe('done'))
    expect(callAgentResponsesApi).toHaveBeenCalledTimes(4)
    const notification = vi.mocked(callAgentResponsesApi).mock.calls[3][0]
    expect(notification.tools).toEqual([])
    expect(notification.instructions).toBe(char.personality)
    expect(JSON.stringify(notification.input)).toContain('generated-image')
    expect(callImageApi).toHaveBeenCalledTimes(1)
    const messages = useCharacterStore.getState().conversations[0].messages
    expect(messages[1].imageIds).toEqual([])
    const picture = messages.find((msg) => msg.id === `image-${getCharacterImageJobs(id)[0].id}-0`)!
    expect(picture).toMatchObject({ role: 'assistant', content: '', status: 'done', imageIds: ['generated-image'] })
    expect(messages.indexOf(picture)).toBeGreaterThan(messages.findIndex((msg) => msg.content === '等待时聊一会'))
    expect(JSON.stringify(notification.input)).not.toContain('requestedParams')
    expect(JSON.stringify(notification.input)).not.toContain('第一张完整方案')
    expect(() => readCharacterImageTaskStatus('other-conversation', { taskId: getCharacterImageJobs(id)[0].id, detail: false })).toThrow('没有此图片任务')
  })

  it('批量部分失败只补生成缺失项，恢复持久化记录后保留实际提示词和成功结果', async () => {
    app.settings.characterImageBackground = true
    vi.mocked(callImageApi).mockReset().mockResolvedValueOnce({ images: ['data:image/png;base64,result'] }).mockRejectedValueOnce(new Error('第二张失败')).mockResolvedValue({ images: ['data:image/png;base64,second'] })
    const id = useCharacterStore.getState().newConversation(char.id)
    await sendCharacterMessage(id, '拍两张')
    await vi.waitFor(() => expect(getCharacterImageJobs(id)[0]?.notification).toBe('done'))
    const job = getCharacterImageJobs(id)[0]
    expect(job.status).toBe('partial')
    expect(job.items.map((item) => item.status)).toEqual(['completed', 'failed'])
    useCharacterStore.setState(normalizeCharacterData(useCharacterStore.getState()))
    const msgId = useCharacterStore.getState().conversations[0].messages[1].id
    await retryCharacterImageJob(id, msgId, job.id)
    await vi.waitFor(() => expect(getCharacterImageJobs(id)[0]?.notification).toBe('done'))
    expect(getCharacterImageJobs(id)[0].status).toBe('completed')
    expect(callImageApi).toHaveBeenCalledTimes(3)
    const messages = useCharacterStore.getState().conversations[0].messages
    expect(messages[1].imageIds).toEqual([])
    expect(messages.filter((msg) => msg.imageIds.length).map((msg) => msg.imageIds)).toEqual([['generated-image'], ['second-image']])
    expect(messages.filter((msg) => msg.id.startsWith(`image-${job.id}-`))).toHaveLength(2)
  })

  it('最多同时处理两个任务，排队取消不会请求图片，重复接单不会新增任务', async () => {
    const id = useCharacterStore.getState().newConversation(char.id)
    const msg: CharacterMessage = { id: 'jobs', role: 'assistant', content: '', imageIds: [], status: 'done', createdAt: 1 }
    useCharacterStore.setState((state) => ({ conversations: state.conversations.map((convo) => ({ ...convo, messages: [msg] })) }))
    const settled = vi.fn()
    vi.mocked(callImageApi).mockImplementation((opts) => new Promise((resolve, reject) => { opts.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }) }))
    const request = parseCharacterImageCall({ ...args, params: { ...args.params, n: 1 } }, app.settings, char, new Set(['face']))
    const opts = { conversationId: id, messageId: msg.id, request, settings: app.settings, onSettled: settled }
    const first = await enqueueCharacterImageJob({ ...opts, callKey: 'first' })
    const second = await enqueueCharacterImageJob({ ...opts, callKey: 'second' })
    const third = await enqueueCharacterImageJob({ ...opts, callKey: 'third' })
    expect((await enqueueCharacterImageJob({ ...opts, callKey: 'first' })).id).toBe(first.id)
    await vi.waitFor(() => expect(callImageApi).toHaveBeenCalledTimes(2))
    expect(getCharacterImageJobs(id)[2].status).toBe('queued')
    cancelCharacterImageJob(third.id)
    await vi.waitFor(() => expect(getCharacterImageJobs(id)[2].status).toBe('cancelled'))
    cancelCharacterImageJob(first.id)
    cancelCharacterImageJob(second.id)
    await vi.waitFor(() => expect(settled).toHaveBeenCalledTimes(3))
    expect(callImageApi).toHaveBeenCalledTimes(2)
  })
})
