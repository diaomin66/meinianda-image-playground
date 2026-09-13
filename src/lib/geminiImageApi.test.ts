// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { callImageApi } from './api'
import { createSettingsForApiProfile } from './apiProfiles'
import { executeCharacterImage, parseCharacterImageCall } from './characterImageTool'
import {
  FIXED_GEMINI_PROFILE_ID,
  lockApiSettings,
} from './fixedApiProfiles'
import {
  GEMINI_FLASH_IMAGE_MODEL,
  GEMINI_PRO_IMAGE_MODEL,
} from './imageModels'

vi.mock('./db', () => ({ storeImageWithSize: vi.fn(async () => ({ id: 'generated', width: 832, height: 1248 })) }))
vi.mock('./imageCache', () => ({ ensureImageCached: vi.fn(async () => 'data:image/png;base64,cmVm'), cacheImage: vi.fn() }))

function createGeminiSettings(model = GEMINI_FLASH_IMAGE_MODEL) {
  return lockApiSettings({
    activeProfileId: FIXED_GEMINI_PROFILE_ID,
    profiles: [
      {
        id: FIXED_GEMINI_PROFILE_ID,
        name: 'Gemini',
        provider: 'gemini',
        baseUrl: 'https://example.com/v1beta',
        apiKey: 'gemini-key',
        model,
        timeout: 600,
        apiMode: 'images',
        codexCli: false,
        apiProxy: false,
      },
    ],
  })
}

function mockImageConversion(width: number, height: number) {
  const drawImage = vi.fn()
  const fillRect = vi.fn()
  const toDataURL = vi.fn((type: string) => `data:${type};base64,Y29udmVydGVk`)
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({
      drawImage,
      fillRect,
      fillStyle: '',
    }),
    toDataURL,
  } as unknown as HTMLCanvasElement
  const originalCreateElement = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) =>
    tagName === 'canvas' ? canvas : originalCreateElement(tagName)) as typeof document.createElement)
  vi.stubGlobal('Image', class {
    naturalWidth = width
    naturalHeight = height
    onload: (() => void) | null = null

    set src(_value: string) {
      queueMicrotask(() => this.onload?.())
    }
  })
  return { drawImage, fillRect, toDataURL }
}

describe('Gemini image API', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('完整图片和 STOP 已到达时立即收图，连接保持打开不会拖延或覆盖成功结果', async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>
    const cancel = vi.fn()
    const response = new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller }, cancel }), { headers: { 'Content-Type': 'text/event-stream', 'x-request-id': 'image-request-1' } })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response)
    const progress = vi.fn()
    const pending = callImageApi({ settings: createGeminiSettings(), prompt: '海边', params: { ...DEFAULT_PARAMS, size: '2K' }, inputImageDataUrls: [], onProgress: progress })
    stream.enqueue(new TextEncoder().encode('data: ' + JSON.stringify({ response: { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'ZmluYWw=' } }] }, finish_reason: 'STOP' }] } }) + '\n\n'))
    await expect(pending).resolves.toMatchObject({ images: ['data:image/png;base64,ZmluYWw='] })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(cancel).toHaveBeenCalledOnce()
    expect(progress).toHaveBeenCalledWith('生图接口返回响应头', expect.objectContaining({ status: 200, requestId: 'image-request-1' }))
    expect(progress).toHaveBeenCalledWith('生图响应已完整接收', expect.objectContaining({ imageCount: 1 }))
  })

  it('服务商在响应头之前断连时标记接收阶段，不自动重复 POST 生图', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('NetworkError when attempting to fetch resource.'))
    const progress = vi.fn()
    const err = await callImageApi({ settings: createGeminiSettings(), prompt: '海边', params: { ...DEFAULT_PARAMS, size: '2K' }, inputImageDataUrls: [], onProgress: progress }).catch((err) => err)
    expect(err.message).toContain('等待响应头')
    expect(err.transport).toMatchObject({ stage: '等待响应头', receivedEvents: 0, timedOut: false })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(progress).not.toHaveBeenCalled()
  })

  it('404 错误流立即保留错误正文、请求地址和请求 ID，不重试或等待连接关闭', async () => {
    const payload = { error: { message: 'This model does not support the requested method', code: 404, status: 'NOT_FOUND' } }
    const cancel = vi.fn()
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: ' + JSON.stringify(payload) + '\n\n'))
      },
      cancel,
    }), { status: 404, headers: { 'Content-Type': 'text/event-stream', 'x-request-id': 'failed-image-404' } })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response)
    const progress = vi.fn()
    const err = await callImageApi({ settings: createGeminiSettings(), prompt: '海边', params: { ...DEFAULT_PARAMS, size: '2K' }, inputImageDataUrls: [], onProgress: progress }).catch((err) => err)
    expect(err.message).toContain('HTTP 404')
    expect(err.message).toContain(payload.error.message)
    expect(err.rawResponsePayload).toContain(JSON.stringify(payload))
    expect(err.transport).toMatchObject({ url: `https://meinianda.top/v1beta/models/${GEMINI_FLASH_IMAGE_MODEL}:generateContent`, requestId: 'failed-image-404', status: 404, receivedEvents: 1, timedOut: false })
    expect(progress).toHaveBeenCalledWith('生图接口返回响应头', expect.objectContaining({ status: 404, requestId: 'failed-image-404', url: err.transport.url }))
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('404 标为 SSE 但正文是普通 JSON 时仍读出错误并结束连接', async () => {
    const payload = { error: { message: 'The model was not found' } }
    const cancel = vi.fn()
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode(JSON.stringify(payload))) },
      cancel,
    }), { status: 404, headers: { 'Content-Type': 'text/event-stream' } })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response)
    const err = await callImageApi({ settings: createGeminiSettings(), prompt: '海边', params: { ...DEFAULT_PARAMS, size: '2K' }, inputImageDataUrls: [] }).catch((err) => err)
    expect(err.message).toContain(payload.error.message)
    expect(JSON.parse(err.rawResponsePayload)).toEqual(payload)
    expect(err.transport).toMatchObject({ status: 404, receivedEvents: 0, timedOut: false })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(cancel).toHaveBeenCalledOnce()
  })

  it.each([401, 404, 429, 500])('HTTP %s 普通错误正文保留到日志，不被笼统网络错误覆盖，也不重复提交', async (status) => {
    const payload = { error: { message: '服务商拒绝此次请求', code: 'upstream_error' } }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } }))
    const err = await callImageApi({ settings: createGeminiSettings(), prompt: '海边', params: { ...DEFAULT_PARAMS, size: '2K' }, inputImageDataUrls: [] }).catch((err) => err)
    expect(err.message).toContain(`HTTP ${status}`)
    expect(err.message).toContain(payload.error.message)
    expect(JSON.parse(err.rawResponsePayload)).toEqual(payload)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it.each(['STOP', 'NO_IMAGE', 'SAFETY'])('收到 %s 且没有成图时立即报告原因，不等连接关闭', async (finishReason) => {
    const cancel = vi.fn()
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: '未生成图片' }] }, finishReason }] }) + '\n\n'))
      },
      cancel,
    }), { headers: { 'Content-Type': 'text/event-stream' } })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response)
    const err = await callImageApi({ settings: createGeminiSettings(), prompt: '海边', params: { ...DEFAULT_PARAMS, size: '2K' }, inputImageDataUrls: [] }).catch((err) => err)
    expect(err.message).toContain('Gemini 未返回图片')
    expect(err.message).toContain(finishReason)
    expect(err.transport).toMatchObject({ stage: '解析图片响应', receivedEvents: 1, timedOut: false })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('HTTP 200 之后正文断流也不伪报成功，日志记录 HTTP 状态与已收片段', async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>
    const response = new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller } }), { headers: { 'Content-Type': 'text/event-stream' } })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response)
    const progress = vi.fn()
    const pending = callImageApi({ settings: createGeminiSettings(), prompt: '海边', params: { ...DEFAULT_PARAMS, size: '2K' }, inputImageDataUrls: [], onProgress: progress }).catch((err) => err)
    stream.enqueue(new TextEncoder().encode('data: {"candidates":[{"content":{"parts":[{"text":"thinking"}]}}]}\n\n'))
    await vi.waitFor(() => expect(progress).toHaveBeenCalledWith('收到 Gemini 生图片段', expect.objectContaining({ receivedEvents: 1 })))
    stream.error(new TypeError('NetworkError when attempting to fetch resource.'))
    const err = await pending
    expect(err.message).toContain('读取响应正文，HTTP 200')
    expect(err.transport).toMatchObject({ stage: '读取响应正文', status: 200, receivedEvents: 1 })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it.each([
    ['fixed-images', GEMINI_FLASH_IMAGE_MODEL, GEMINI_PRO_IMAGE_MODEL],
    ['fixed-images', GEMINI_PRO_IMAGE_MODEL, GEMINI_FLASH_IMAGE_MODEL],
    [FIXED_GEMINI_PROFILE_ID, GEMINI_PRO_IMAGE_MODEL, GEMINI_FLASH_IMAGE_MODEL],
  ])('人物执行生图不继承画廊 %s 的地址、密钥、模型，实际请求使用 %s', async (activeProfileId, model, configuredModel) => {
    const settings = lockApiSettings({
      ...createGeminiSettings(configuredModel), activeProfileId,
      profiles: createGeminiSettings(configuredModel).profiles.map((profile) => ({ ...profile, apiKey: profile.id === FIXED_GEMINI_PROFILE_ID ? 'character-gemini-key' : 'gallery-openai-key' })),
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ inlineData: { data: 'ZmluYWw=', mimeType: 'image/png' } }] } }],
    }), { headers: { 'Content-Type': 'application/json' } }))
    const request = {
      profileId: FIXED_GEMINI_PROFILE_ID, model, prompt: '副脑最终提示词原文', referenceIds: ['ref'], maskImageId: null,
      params: { ...DEFAULT_PARAMS, size: '2K', aspect_ratio: '2:3' as const, n: 1, thinking_level: 'high' as const },
    }
    const result = await executeCharacterImage(request, settings, new AbortController().signal)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe(`https://meinianda.top/v1beta/models/${model}:generateContent`)
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ 'x-goog-api-key': 'character-gemini-key' })
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(body.generationConfig.imageConfig).toEqual({ imageSize: '2K', aspectRatio: '2:3' })
    expect(body.generationConfig.thinkingConfig).toEqual(model === GEMINI_FLASH_IMAGE_MODEL ? { thinkingLevel: 'HIGH' } : undefined)
    expect(body.contents[0].parts).toEqual([{ text: request.prompt }, { inlineData: { data: 'cmVm', mimeType: 'image/png' } }])
    expect(result.output.model).toBe(model)
    expect(settings.activeProfileId).toBe(activeProfileId)
    expect(settings.profiles.find((profile) => profile.id === FIXED_GEMINI_PROFILE_ID)?.model).toBe(configuredModel)

    // 与画廊相同的配置构造和 API 调用，逐项对比最终 HTTP 请求，而非仅检查任务记录。
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ inlineData: { data: 'ZmluYWw=', mimeType: 'image/png' } }] } }],
    }), { headers: { 'Content-Type': 'application/json' } }))
    const profile = settings.profiles.find((item) => item.id === FIXED_GEMINI_PROFILE_ID)!
    await callImageApi({ settings: createSettingsForApiProfile(settings, { ...profile, model }), prompt: request.prompt, params: request.params, inputImageDataUrls: ['data:image/png;base64,cmVm'] })
    expect(fetchMock.mock.calls[1][0]).toBe(fetchMock.mock.calls[0][0])
    expect(fetchMock.mock.calls[1][1]?.headers).toEqual(fetchMock.mock.calls[0][1]?.headers)
    expect(fetchMock.mock.calls[1][1]?.body).toBe(fetchMock.mock.calls[0][1]?.body)
  })

  it('画廊使用 Gemini 时，人物 OpenAI 生图同样使用自己的地址、密钥和模型', async () => {
    const settings = createGeminiSettings()
    settings.profiles = settings.profiles.map((profile) => profile.id === 'fixed-images' ? { ...profile, apiKey: 'openai-only-key' } : profile)
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: [{ b64_json: 'ZmluYWw=' }] }), { headers: { 'Content-Type': 'application/json' } }))
    await executeCharacterImage({ profileId: 'fixed-images', model: 'gpt-image-2', prompt: '人物照片', referenceIds: [], maskImageId: null, params: { ...DEFAULT_PARAMS, size: '1024x1536', n: 1 } }, settings, new AbortController().signal)
    expect(fetchMock.mock.calls[0][0]).toBe('https://meinianda.top/v1/images/generations')
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ Authorization: 'Bearer openai-only-key' })
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(body).toMatchObject({ model: 'gpt-image-2', size: '1024x1536', prompt: '人物照片' })
    expect(settings.activeProfileId).toBe(FIXED_GEMINI_PROFILE_ID)
  })

  it.each([
    [GEMINI_FLASH_IMAGE_MODEL, '1024x1536', '2:3'],
    [GEMINI_FLASH_IMAGE_MODEL, '1024x1024', '1:1'],
    [GEMINI_FLASH_IMAGE_MODEL, '1536x1024', '3:2'],
    [GEMINI_PRO_IMAGE_MODEL, '1024x1536', '2:3'],
    [GEMINI_PRO_IMAGE_MODEL, '1536x1024', '3:2'],
    [GEMINI_FLASH_IMAGE_MODEL, 'auto', '1:1'],
  ])('人物画幅 %s / %s 传入原生 imageConfig，参考图不改变所选比例', async (model, size, ratio) => {
    const settings = { ...createGeminiSettings(model), characterImageSize: size }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ inlineData: { data: 'ZmluYWw=', mimeType: 'image/png' } }] } }],
    }), { headers: { 'Content-Type': 'application/json' } }))
    const request = parseCharacterImageCall({
      profileId: FIXED_GEMINI_PROFILE_ID, model, prompt: '一张日常照片', referenceIds: ['ref'], maskImageId: null, intent: 'requested',
      params: { ...DEFAULT_PARAMS, size: '2K', aspect_ratio: '1:1' },
    }, settings, { id: 'test', name: '测试', personality: '人格原文', appearance: '', opening: '', referenceImageIds: ['ref'], autoImages: true, createdAt: 1, updatedAt: 1 }, new Set(['ref']))
    await callImageApi({ settings, prompt: request.prompt, params: request.params, inputImageDataUrls: ['data:image/png;base64,cmVm'] })
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(body.generationConfig.imageConfig).toEqual({ imageSize: '2K', aspectRatio: ratio })
    expect(body.contents[0].parts).toEqual([{ text: request.prompt }, { inlineData: { data: 'cmVm', mimeType: 'image/png' } }])
  })

  it('识别下划线响应、缺省 MIME 和流式包裹，排除思考图片', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response([
      'data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ thought: true, inlineData: { mimeType: 'image/png', data: 'dGhvdWdodA==' } }] } }] }),
      'data: ' + JSON.stringify({ response: { candidates: [{ content: { parts: [{ inline_data: { data: 'ZmluYWw=' } }] }, finish_reason: 'STOP' }] } }),
      'data: [DONE]',
    ].join('\n\n') + '\n\n', { headers: { 'Content-Type': 'text/event-stream' } }))
    const result = await callImageApi({ settings: createGeminiSettings(), prompt: '海边', params: { ...DEFAULT_PARAMS, size: '1K' }, inputImageDataUrls: [] })
    expect(result.images).toEqual(['data:image/png;base64,ZmluYWw='])
  })

  it.each([
    [{ candidates: [{ content: { parts: [{ text: '当前请求未能生成图片' }] }, finishReason: 'NO_IMAGE' }], modelVersion: 'image-model' }, ['NO_IMAGE', '当前请求未能生成图片', 'image-model']],
    [{ prompt_feedback: { block_reason: 'SAFETY', block_reason_message: '请求被拦截' } }, ['SAFETY', '请求被拦截']],
    [{ candidates: [{ finishReason: 'MAX_TOKENS', finishMessage: '输出被截断' }] }, ['MAX_TOKENS', '输出被截断']],
  ])('未出图时展示结束原因和模型说明，而非笼统的解析失败', async (payload, messages) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } }))
    const result = callImageApi({ settings: createGeminiSettings(), prompt: '海边', params: { ...DEFAULT_PARAMS, size: '1K' }, inputImageDataUrls: [] })
    const err = await result.catch((err: Error & { rawResponsePayload: string }) => err)
    expect(err).toBeInstanceOf(Error)
    for (const message of messages) expect((err as Error).message).toContain(message)
    expect((err as Error & { rawResponsePayload: string }).rawResponsePayload).toBe(JSON.stringify(payload, null, 2))
  })

  it('识别文本中的图片 data URL，不把普通网址作为图片请求', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '![图片](data:image/png;base64,ZmluYWw=) 更多信息 https://example.com' }] }, finishReason: 'STOP' }] }), { headers: { 'Content-Type': 'application/json' } }))
    const result = await callImageApi({ settings: createGeminiSettings(), prompt: '海边', params: { ...DEFAULT_PARAMS, size: '1K' }, inputImageDataUrls: [] })
    expect(result.images).toEqual(['data:image/png;base64,ZmluYWw='])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('uses the v1beta generateContent API with official image parameters', async () => {
    const conversion = mockImageConversion(2048, 1152)
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      candidates: [{
        content: {
          parts: [{
            inlineData: {
              data: 'ZmluYWw=',
              mimeType: 'image/jpeg',
            },
          }],
        },
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    const result = await callImageApi({
      settings: createGeminiSettings(),
      prompt: '生成一张海报',
      params: {
        ...DEFAULT_PARAMS,
        size: '2K',
        aspect_ratio: '16:9',
        thinking_level: 'high',
      },
      inputImageDataUrls: ['data:image/jpeg;base64,aW5wdXQ='],
    })

    expect(fetchMock).toHaveBeenCalledWith(
      `https://meinianda.top/v1beta/models/${GEMINI_FLASH_IMAGE_MODEL}:generateContent`,
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'x-goog-api-key': 'gemini-key',
        },
      }),
    )
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(body).toEqual({
      contents: [{
        role: 'user',
        parts: [
          { text: '生成一张海报' },
          { inlineData: { data: 'aW5wdXQ=', mimeType: 'image/jpeg' } },
        ],
      }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: {
          aspectRatio: '16:9',
          imageSize: '2K',
        },
        thinkingConfig: {
          thinkingLevel: 'HIGH',
        },
      },
    })
    expect(result).toEqual({
      images: ['data:image/png;base64,Y29udmVydGVk'],
      actualParams: {
        aspect_ratio: '16:9',
        output_format: 'png',
        n: 1,
      },
      actualParamsList: [{
        aspect_ratio: '16:9',
        output_format: 'png',
        n: 1,
      }],
    })
    expect(conversion.fillRect).not.toHaveBeenCalled()
    expect(conversion.drawImage).toHaveBeenCalledTimes(1)
    expect(conversion.toDataURL).toHaveBeenCalledWith('image/png')
  })

  it('omits Flash-only thinking configuration for Gemini Pro', async () => {
    const conversion = mockImageConversion(2048, 2048)
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      candidates: [{
        content: {
          parts: [{
            inlineData: {
              data: 'cHJv',
              mimeType: 'image/png',
            },
          }],
        },
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    const result = await callImageApi({
      settings: createGeminiSettings(GEMINI_PRO_IMAGE_MODEL),
      prompt: '产品图',
      params: {
        ...DEFAULT_PARAMS,
        size: '4K',
        output_format: 'jpeg',
      },
      inputImageDataUrls: [],
    })

    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(fetchMock.mock.calls[0][0]).toBe(
      `https://meinianda.top/v1beta/models/${GEMINI_PRO_IMAGE_MODEL}:generateContent`,
    )
    expect(body.model).toBeUndefined()
    expect(body.generationConfig.imageConfig).toEqual({
      imageSize: '4K',
    })
    expect(body.generationConfig.imageConfig.aspectRatio).toBeUndefined()
    expect(body.generationConfig.thinkingConfig).toBeUndefined()
    expect(conversion.fillRect).toHaveBeenCalledWith(0, 0, 2048, 2048)
    expect(conversion.drawImage).toHaveBeenCalledTimes(1)
    expect(conversion.toDataURL).toHaveBeenCalledWith('image/jpeg', 0.92)
    expect(result.images).toEqual(['data:image/jpeg;base64,Y29udmVydGVk'])
    expect(result.actualParams).toMatchObject({ output_format: 'jpeg' })
  })

  it('uses concurrent generateContent requests for multiple images and keeps partial success', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      const callIndex = fetchMock.mock.calls.length
      if (callIndex === 2) throw new TypeError('Failed to fetch')
      return new Response(JSON.stringify({
        candidates: [{
          content: {
            parts: [{
              inlineData: {
                data: `aW1hZ2Ut${callIndex}`,
                mimeType: 'image/png',
              },
            }],
          },
        }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const result = await callImageApi({
      settings: createGeminiSettings(),
      prompt: '三张图',
      params: { ...DEFAULT_PARAMS, size: '1K', n: 3 },
      inputImageDataUrls: [],
    })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    for (const call of fetchMock.mock.calls) {
      const body = JSON.parse(String((call[1] as RequestInit).body))
      expect(body.generationConfig.imageConfig).toEqual({ imageSize: '1K' })
      expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'MINIMAL' })
    }
    expect(result.images).toEqual([
      'data:image/png;base64,aW1hZ2Ut1',
      'data:image/png;base64,aW1hZ2Ut3',
    ])
    expect(result.failedRequests).toEqual([{ requestIndex: 1, error: expect.stringContaining('等待响应头') }])
    expect(result.actualParams).toMatchObject({ n: 2 })
  })
})
