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

describe('Gemini image API', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uses the v1beta Interactions API with official image parameters', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      steps: [{
        type: 'model_output',
        content: [{
          type: 'image',
          data: 'ZmluYWw=',
          mime_type: 'image/png',
        }],
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
      'https://meinianda.top/v1beta/interactions',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': 'gemini-key',
        },
      }),
    )
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(body).toEqual({
      model: GEMINI_FLASH_IMAGE_MODEL,
      input: [
        { type: 'text', text: '生成一张海报' },
        { type: 'image', data: 'aW5wdXQ=', mime_type: 'image/jpeg' },
      ],
      response_format: {
        type: 'image',
        mime_type: 'image/png',
        image_size: '2K',
        aspect_ratio: '16:9',
      },
      generation_config: {
        thinking_level: 'high',
      },
    })
    expect(result).toEqual({
      images: ['data:image/png;base64,ZmluYWw='],
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
  })

  it('omits Flash-only thinking configuration for Gemini Pro', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output_image: {
        type: 'image',
        data: 'cHJv',
        mime_type: 'image/jpeg',
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await callImageApi({
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
    expect(body.model).toBe(GEMINI_PRO_IMAGE_MODEL)
    expect(body.response_format).toMatchObject({
      mime_type: 'image/jpeg',
      image_size: '4K',
    })
    expect(body.generation_config).toBeUndefined()
  })

  it('uses concurrent Interactions requests for multiple images and keeps partial success', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      const callIndex = fetchMock.mock.calls.length
      if (callIndex === 2) throw new TypeError('Failed to fetch')
      return new Response(JSON.stringify({
        output_image: {
          type: 'image',
          data: `aW1hZ2Ut${callIndex}`,
          mime_type: 'image/png',
        },
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
    expect(result.images).toEqual([
      'data:image/png;base64,aW1hZ2Ut1',
      'data:image/png;base64,aW1hZ2Ut3',
    ])
    expect(result.failedRequests).toEqual([{ requestIndex: 1, error: 'Failed to fetch' }])
    expect(result.actualParams).toMatchObject({ n: 2 })
  })
})
