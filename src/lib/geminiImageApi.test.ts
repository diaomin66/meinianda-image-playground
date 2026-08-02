// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { callImageApi } from './api'
import {
  FIXED_GEMINI_PROFILE_ID,
  lockApiSettings,
} from './fixedApiProfiles'
import {
  GEMINI_FLASH_IMAGE_MODEL,
  GEMINI_PRO_IMAGE_MODEL,
} from './imageModels'

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
      `https://meinianda.top/v1beta/models/${GEMINI_FLASH_IMAGE_MODEL}:generateContent?key=gemini-key`,
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    )
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(body).toEqual({
      contents: [{
        parts: [
          { text: '生成一张海报' },
          { inlineData: { data: 'aW5wdXQ=', mimeType: 'image/jpeg' } },
        ],
      }],
      generationConfig: {
        responseModalities: ['IMAGE'],
        imageConfig: {
          aspectRatio: '16:9',
          imageSize: '2K',
        },
        thinkingConfig: {
          thinkingLevel: 'High',
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
      `https://meinianda.top/v1beta/models/${GEMINI_PRO_IMAGE_MODEL}:generateContent?key=gemini-key`,
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
      expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'Minimal' })
    }
    expect(result.images).toEqual([
      'data:image/png;base64,aW1hZ2Ut1',
      'data:image/png;base64,aW1hZ2Ut3',
    ])
    expect(result.failedRequests).toEqual([{ requestIndex: 1, error: 'Failed to fetch' }])
    expect(result.actualParams).toMatchObject({ n: 2 })
  })
})
