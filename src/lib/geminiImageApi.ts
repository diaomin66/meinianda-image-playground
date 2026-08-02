import type { ApiProfile, TaskParams } from '../types'
import { buildApiUrl, readClientDevProxyConfig, shouldUseApiProxy } from './devProxy'
import {
  type CallApiOptions,
  type CallApiResult,
  fetchImageUrlAsDataUrl,
  getApiErrorMessage,
  MIME_MAP,
  normalizeBase64Image,
} from './imageApiShared'
import { GEMINI_FLASH_IMAGE_MODEL } from './imageModels'

interface GeminiImageContent {
  data?: string
  uri?: string
  mimeType?: string
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function parseDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;,]+);base64,(.*)$/s)
  if (!match) throw new Error('Gemini 参考图必须是 Base64 data URL')
  return { mimeType: match[1], data: match[2] }
}

function collectImageContent(value: unknown, images: GeminiImageContent[]) {
  if (Array.isArray(value)) {
    for (const item of value) collectImageContent(item, images)
    return
  }

  const record = getRecord(value)
  if (!record) return

  const type = typeof record.type === 'string' ? record.type : ''
  const mimeType = typeof record.mime_type === 'string'
    ? record.mime_type
    : typeof record.mimeType === 'string'
    ? record.mimeType
    : undefined
  const data = typeof record.data === 'string' ? record.data : undefined
  const uri = typeof record.uri === 'string' ? record.uri : undefined

  if ((type === 'image' || mimeType?.startsWith('image/')) && (data || uri)) {
    images.push({ data, uri, mimeType })
  }

  const inlineData = getRecord(record.inlineData)
  if (inlineData) {
    const inlineMime = typeof inlineData.mimeType === 'string' ? inlineData.mimeType : undefined
    const inlineImage = typeof inlineData.data === 'string' ? inlineData.data : undefined
    if (inlineImage && inlineMime?.startsWith('image/')) {
      images.push({ data: inlineImage, mimeType: inlineMime })
    }
  }

  for (const key of ['content', 'parts', 'outputs', 'output_image', 'candidates']) {
    if (record[key] !== undefined) collectImageContent(record[key], images)
  }
}

function extractGeminiImages(payload: unknown) {
  const record = getRecord(payload)
  if (!record) return []

  const images: GeminiImageContent[] = []
  const steps = Array.isArray(record.steps) ? record.steps : []
  for (const step of steps) {
    const stepRecord = getRecord(step)
    if (stepRecord?.type === 'model_output') collectImageContent(stepRecord.content, images)
  }

  if (!images.length) {
    for (const key of ['output_image', 'outputs', 'candidates']) {
      if (record[key] !== undefined) collectImageContent(record[key], images)
    }
  }

  const seen = new Set<string>()
  return images.filter((image) => {
    const key = image.data || image.uri
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function createGeminiInput(prompt: string, inputImageDataUrls: string[]) {
  if (!inputImageDataUrls.length) return prompt
  return [
    { type: 'text', text: prompt },
    ...inputImageDataUrls.map((dataUrl) => {
      const image = parseDataUrl(dataUrl)
      return {
        type: 'image',
        data: image.data,
        mime_type: image.mimeType,
      }
    }),
  ]
}

function getGeminiActualParams(params: TaskParams, imageCount: number): Partial<TaskParams> {
  return {
    ...(params.aspect_ratio === 'auto' ? {} : { aspect_ratio: params.aspect_ratio }),
    output_format: params.output_format,
    n: imageCount,
  }
}

async function callGeminiImageApiSingle(
  opts: CallApiOptions,
  profile: ApiProfile,
): Promise<CallApiResult> {
  if (opts.maskDataUrl) {
    throw new Error('Gemini Interactions API 不支持遮罩参数，请移除遮罩后使用参考图编辑')
  }

  const mime = MIME_MAP[opts.params.output_format] || 'image/png'
  const responseFormat: Record<string, unknown> = {
    type: 'image',
    mime_type: mime,
    image_size: opts.params.size,
  }
  if (opts.params.aspect_ratio !== 'auto') responseFormat.aspect_ratio = opts.params.aspect_ratio

  const body: Record<string, unknown> = {
    model: profile.model,
    input: createGeminiInput(opts.prompt, opts.inputImageDataUrls),
    response_format: responseFormat,
  }
  if (profile.model === GEMINI_FLASH_IMAGE_MODEL) {
    body.generation_config = {
      thinking_level: opts.params.thinking_level,
    }
  }

  const proxyConfig = readClientDevProxyConfig()
  const useApiProxy = shouldUseApiProxy(profile.apiProxy, proxyConfig)
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), profile.timeout * 1000)

  try {
    const response = await fetch(buildApiUrl(profile.baseUrl, 'interactions', proxyConfig, useApiProxy), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': profile.apiKey,
      },
      cache: 'no-store',
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (!response.ok) throw new Error(await getApiErrorMessage(response))

    const payload = await response.json() as unknown
    const imageContents = extractGeminiImages(payload)
    if (!imageContents.length) {
      const err = new Error('Gemini 接口没有返回可识别的图片数据')
      ;(err as any).rawResponsePayload = JSON.stringify(payload, null, 2)
      throw err
    }

    const images = await Promise.all(imageContents.map((image) =>
      image.data
        ? normalizeBase64Image(image.data, image.mimeType || mime)
        : fetchImageUrlAsDataUrl(image.uri!, image.mimeType || mime, controller.signal),
    ))
    const actualParams = getGeminiActualParams(opts.params, images.length)
    return {
      images,
      actualParams,
      actualParamsList: images.map(() => actualParams),
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function callGeminiImageApi(
  opts: CallApiOptions,
  profile: ApiProfile,
): Promise<CallApiResult> {
  const n = Math.max(1, opts.params.n)
  if (n === 1) return callGeminiImageApiSingle(opts, profile)

  const results = await Promise.allSettled(
    Array.from({ length: n }).map(() => callGeminiImageApiSingle({
      ...opts,
      params: { ...opts.params, n: 1 },
    }, profile)),
  )
  const successfulResults = results
    .filter((result): result is PromiseFulfilledResult<CallApiResult> => result.status === 'fulfilled')
    .map((result) => result.value)
  const failedRequests = results.flatMap((result, requestIndex) =>
    result.status === 'rejected'
      ? [{ requestIndex, error: result.reason instanceof Error ? result.reason.message : String(result.reason) }]
      : [],
  )

  if (!successfulResults.length) {
    const firstError = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (firstError) throw firstError.reason
    throw new Error('所有 Gemini 并发请求均失败')
  }

  const images = successfulResults.flatMap((result) => result.images)
  const actualParams = getGeminiActualParams(opts.params, images.length)
  return {
    images,
    actualParams,
    actualParamsList: images.map(() => actualParams),
    ...(failedRequests.length ? { failedRequests } : {}),
  }
}
