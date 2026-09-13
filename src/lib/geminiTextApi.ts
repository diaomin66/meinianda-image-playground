import type { ApiProfile, GeminiContent, GeminiPart } from '../types'
import { forwardAbort } from './abort'
import { buildApiUrl, readClientDevProxyConfig, shouldUseApiProxy } from './devProxy'
import { getApiErrorMessage } from './imageApiShared'
import { isEventStreamResponse, readJsonServerSentEvents } from './serverSentEvents'
import { normalizeGeminiParts } from './geminiParts'

export function geminiImagePart(dataUrl: string): GeminiPart {
  const match = dataUrl.match(/^data:(image\/[\w.+-]+);base64,([\s\S]+)$/)
  if (!match) throw new Error('Gemini 图片必须是有效的 Base64 图片。')
  return { inlineData: { mimeType: match[1], data: match[2] } }
}

export async function callGeminiTextApi(opts: {
  profile: ApiProfile
  instructions: string
  contents: GeminiContent[]
  tools: Array<{ name: string; description: string; parameters: Record<string, unknown> }>
  signal?: AbortSignal
  onTextDelta?: (delta: string) => void
  responseMimeType?: 'application/json'
  onRequest?: (url: string, body: unknown) => void
}) {
  const controller = new AbortController()
  const detachAbort = forwardAbort(opts.signal, controller)
  const timeoutId = setTimeout(() => controller.abort(), opts.profile.timeout * 1000)
  const proxyConfig = readClientDevProxyConfig()
  try {
    controller.signal.throwIfAborted()
    const body = {
      ...(opts.instructions ? { systemInstruction: { parts: [{ text: opts.instructions }] } } : {}),
      ...(opts.responseMimeType ? { generationConfig: { responseMimeType: opts.responseMimeType } } : {}),
      contents: opts.contents.flatMap((content, idx) => {
        const parts = normalizeGeminiParts(content.parts, `contents[${idx}].parts`)
        return parts.length ? [{ ...content, parts }] : []
      }),
      ...(opts.tools.length ? {
        tools: [{ functionDeclarations: opts.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parametersJsonSchema: tool.parameters,
        })) }],
        toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
      } : {}),
    }
    const model = opts.profile.model.replace(/^models\//, '')
    const url = buildApiUrl(opts.profile.baseUrl, `models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, proxyConfig, shouldUseApiProxy(opts.profile.apiProxy, proxyConfig))
    opts.onRequest?.(url, body)
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', 'x-goog-api-key': opts.profile.apiKey },
      cache: 'no-store',
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(await getApiErrorMessage(response))
    const parts: GeminiPart[] = []
    let finishReason = ''
    let streamDone = false
    const consume = (value: unknown) => {
      const payload = value as {
        candidates?: Array<{ index?: number; content?: { parts?: GeminiPart[] }; finishReason?: string; finish_reason?: string }>
        promptFeedback?: { blockReason?: string }
        error?: { message?: string }
      } | null
      if (payload?.error) throw new Error(payload.error.message || 'Gemini 接口返回错误。')
      if (payload?.promptFeedback?.blockReason) throw new Error(`Gemini 未返回有效回复（${payload.promptFeedback.blockReason}）。`)
      const candidate = Array.isArray(payload?.candidates) ? payload.candidates.find((item) => item && (item.index === undefined || item.index === 0)) : undefined
      const reason = candidate?.finishReason || candidate?.finish_reason
      if (reason) finishReason = reason
      const chunk = candidate?.content?.parts
      if (chunk === undefined) return
      if (!Array.isArray(chunk) || chunk.some((part) => !part || typeof part !== 'object' || Array.isArray(part))) throw new Error('Gemini 返回的流式内容格式无效。')
      const normalized = normalizeGeminiParts(chunk, 'response.parts')
      parts.push(...normalized)
      for (const part of normalized) {
        if (!part.thought && typeof part.text === 'string' && part.text) opts.onTextDelta?.(part.text)
      }
    }
    const streaming = isEventStreamResponse(response)
    if (streaming) await readJsonServerSentEvents(response, consume, {
      signals: [controller.signal, opts.signal],
      formatErrorMessage: () => 'Gemini 流式响应格式无效，请重试。',
      onDone: () => { streamDone = true },
      // 原生 Gemini 以 finishReason 结束；中转可能继续保持 HTTP 连接。
      isComplete: () => Boolean(finishReason),
    })
    else consume(await response.json())
    controller.signal.throwIfAborted()
    if (finishReason && finishReason !== 'STOP') throw new Error(`Gemini 回复未正常完成（${finishReason}），请重试。`)
    if (!parts.length) throw new Error('Gemini 未返回有效回复。')
    const text = parts.filter((part) => !part.thought && typeof part.text === 'string').map((part) => part.text).join('')
    const calls = parts.filter((part) => part.functionCall)
    if (streaming && !finishReason && !streamDone) {
      // 部分中转省略结束原因。仅结构化文本可通过完整 JSON 校验确认结束，函数调用仍需明确结束标记。
      if (opts.responseMimeType !== 'application/json' || calls.length) throw new Error('Gemini 流式回复未完整结束，请重试。')
      try {
        const data: unknown = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''))
        if (!data || typeof data !== 'object') throw new Error('invalid JSON')
      } catch {
        throw new Error('Gemini 结构化回复不是完整 JSON，请重试。')
      }
    }
    if (calls.some((part) => typeof part.functionCall?.name !== 'string' || !part.functionCall.name)) {
      throw new Error('Gemini 返回的函数调用缺少名称。')
    }
    if (!text.trim() && !calls.length) throw new Error('Gemini 未返回文字或函数调用。')
    // 原样保留模型的全部 parts，包括函数调用上的 thoughtSignature。
    return { text, content: { role: 'model', parts } as GeminiContent }
  } finally {
    clearTimeout(timeoutId)
    detachAbort()
  }
}
