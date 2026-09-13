import { forwardAbort } from './abort'
import type { ApiProfile, TaskParams } from '../types'
import { convertImageDataUrlFormat } from './canvasImage'
import { buildApiUrl, readClientDevProxyConfig, shouldUseApiProxy } from './devProxy'
import {
  type CallApiOptions,
  type CallApiResult,
  fetchImageUrlAsDataUrl,
  getApiErrorMessage,
  normalizeBase64Image,
} from './imageApiShared'
import { GEMINI_FLASH_IMAGE_MODEL } from './imageModels'
import { readGeminiImageResponse } from './geminiImageResponse'
import { isEventStreamResponse, parseServerSentEventBlock, readJsonServerSentEvents } from './serverSentEvents'

function parseDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;,]+);base64,(.*)$/s)
  if (!match) throw new Error('Gemini 参考图必须是 Base64 data URL')
  return { mimeType: match[1], data: match[2] }
}

function createGeminiParts(prompt: string, inputImageDataUrls: string[]) {
  return [
    { text: prompt },
    ...inputImageDataUrls.map((dataUrl) => {
      const image = parseDataUrl(dataUrl)
      return {
        inlineData: {
          data: image.data,
          mimeType: image.mimeType,
        },
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
    throw new Error('Gemini generateContent API 不支持遮罩参数，请移除遮罩后使用参考图编辑')
  }

  const image: Record<string, unknown> = {
    imageSize: opts.params.size,
  }
  if (opts.params.aspect_ratio !== 'auto') image.aspectRatio = opts.params.aspect_ratio

  const generationConfig: Record<string, unknown> = {
    responseModalities: ['TEXT', 'IMAGE'],
    imageConfig: image,
  }
  if (profile.model === GEMINI_FLASH_IMAGE_MODEL) {
    generationConfig.thinkingConfig = {
      thinkingLevel: opts.params.thinking_level === 'high' ? 'HIGH' : 'MINIMAL',
    }
  }
  const body = {
    contents: [{
      role: 'user',
      parts: createGeminiParts(opts.prompt, opts.inputImageDataUrls),
    }],
    generationConfig,
  }

  const proxyConfig = readClientDevProxyConfig()
  const useApiProxy = shouldUseApiProxy(profile.apiProxy, proxyConfig)
  const controller = new AbortController()
  const detachAbort = forwardAbort(opts.signal, controller)
  const timeoutId = setTimeout(() => controller.abort(), profile.timeout * 1000)
  let stage = '等待响应头'
  let status: number | undefined
  let receivedEvents = 0
  let requestId: string | null = null
  let requestUrl = ''

  try {
    controller.signal.throwIfAborted()
    // 生图恢复已使用的普通端点；语言流式可用不代表同一服务商支持图片流式。
    const path = `models/${encodeURIComponent(profile.model.replace(/^models\//, ''))}:generateContent`
    const url = buildApiUrl(profile.baseUrl, path, proxyConfig, useApiProxy)
    requestUrl = url
    opts.onRequest?.(url, body)
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'x-goog-api-key': profile.apiKey,
      },
      cache: 'no-store',
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    status = response.status
    requestId = response.headers.get('x-request-id') || response.headers.get('x-oneapi-request-id')
    stage = '读取响应正文'
    opts.onProgress?.('生图接口返回响应头', { url, status, contentType: response.headers.get('Content-Type'), contentLength: response.headers.get('Content-Length'), requestId })
    if (!response.ok) {
      let rawResponsePayload = ''
      let errorPayload = ''
      if (isEventStreamResponse(response) && response.body) {
        // 中转错误可能标为 SSE 却发送普通 JSON；两者都在完整错误到达后立即结束。
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        const cancelReader = () => { void reader.cancel().catch(() => undefined) }
        controller.signal.addEventListener('abort', cancelReader, { once: true })
        try {
          while (rawResponsePayload.length < 128000) {
            controller.signal.throwIfAborted()
            const { value, done } = await reader.read()
            controller.signal.throwIfAborted()
            rawResponsePayload += decoder.decode(value, { stream: !done })
            try {
              JSON.parse(rawResponsePayload)
              errorPayload = rawResponsePayload
              break
            } catch { /* 普通 JSON 未完整，继续检查 SSE 事件。 */ }
            for (const block of rawResponsePayload.split(/\r?\n\r?\n/).slice(0, -1)) {
              const data = parseServerSentEventBlock(block)
              if (!data) continue
              receivedEvents += 1
              errorPayload = data
              break
            }
            if (errorPayload || done) break
          }
        } finally {
          controller.signal.removeEventListener('abort', cancelReader)
          await reader.cancel().catch(() => undefined)
        }
      } else rawResponsePayload = await response.text()
      const message = await getApiErrorMessage(new Response(errorPayload || rawResponsePayload, { status }))
      throw Object.assign(new Error(`Gemini 生图请求失败（HTTP ${status}）：${message || response.statusText || '接口未返回错误说明'}`), { rawResponsePayload })
    }

    let payload: unknown
    if (isEventStreamResponse(response)) {
      const chunks: unknown[] = []
      let finished = false
      await readJsonServerSentEvents(response, (chunk) => {
        chunks.push(chunk)
        receivedEvents += 1
        const parsed = readGeminiImageResponse(chunk)
        if (parsed.finished) finished = true
        if (receivedEvents === 1 || parsed.images.length || parsed.finished) opts.onProgress?.('收到 Gemini 生图片段', { receivedEvents, imageCount: parsed.images.length, finished })
      }, { signals: [controller.signal, opts.signal], isComplete: () => finished })
      payload = chunks
    } else payload = await response.json()
    stage = '解析图片响应'
    controller.signal.throwIfAborted()
    const parsed = readGeminiImageResponse(payload)
    const imageContents = parsed.images
    if (!imageContents.length) {
      throw Object.assign(new Error(parsed.error), { rawResponsePayload: JSON.stringify(payload, null, 2) })
    }
    opts.onProgress?.('生图响应已完整接收', { imageCount: imageContents.length, inlineImages: imageContents.filter((image) => image.data).length, imageUrls: imageContents.filter((image) => !image.data).map((image) => image.uri) })

    stage = '下载结果图片'
    const sourceImages = await Promise.all(imageContents.map((image) =>
      image.data
        ? normalizeBase64Image(image.data, image.mimeType || 'image/png')
        : fetchImageUrlAsDataUrl(image.uri!, image.mimeType || 'image/png', controller.signal),
    ))
    stage = '转换图片格式'
    const images = await Promise.all(sourceImages.map((image) =>
      convertImageDataUrlFormat(image, opts.params.output_format === 'jpeg' ? 'jpeg' : 'png'),
    ))
    const actualParams = getGeminiActualParams(opts.params, images.length)
    return {
      images,
      actualParams,
      actualParamsList: images.map(() => actualParams),
    }
  } catch (err) {
    if (opts.signal?.aborted) throw err
    const original = err instanceof Error ? err.message : String(err)
    const network = err instanceof TypeError || (err instanceof Error && err.name === 'NetworkError')
    const message = controller.signal.aborted
      ? `Gemini 生图接收超时（${stage}）。服务端可能已经完成，请先核对后台结果再重试。`
      : network ? `Gemini 生图响应未能完整接收（${stage}${status ? `，HTTP ${status}` : ''}）。服务端可能已完成生成，但浏览器没有收到可用图片；请先核对后台结果再重试。原始错误：${original}` : original
    throw Object.assign(new Error(message), { name: err instanceof Error ? err.name : 'Error', transport: { url: requestUrl, requestId, stage, status, receivedEvents, timedOut: controller.signal.aborted, originalError: original }, ...(err && typeof err === 'object' && 'rawResponsePayload' in err ? { rawResponsePayload: err.rawResponsePayload } : {}) })
  } finally {
    detachAbort()
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
