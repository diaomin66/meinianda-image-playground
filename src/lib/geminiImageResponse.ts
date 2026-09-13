interface GeminiImageContent {
  data?: string
  uri?: string
  mimeType?: string
}

export function readGeminiImageResponse(payload: unknown) {
  const images: GeminiImageContent[] = []
  const texts: string[] = []
  const reasons: string[] = []
  const models: string[] = []
  let finished = false
  const visit = (value: unknown) => {
    if (Array.isArray(value)) { value.forEach(visit); return }
    if (!value || typeof value !== 'object') return
    const item = value as Record<string, unknown>
    // 中间思考图不作为正式成图交付。
    if (item.thought === true) return
    if (item.error) {
      const error = item.error as { message?: unknown }
      throw new Error(typeof item.error === 'string' ? item.error : typeof error.message === 'string' ? error.message : 'Gemini 返回错误响应。')
    }
    const mime = typeof item.mimeType === 'string' ? item.mimeType : typeof item.mime_type === 'string' ? item.mime_type : undefined
    if ((item.type === 'image' || mime?.startsWith('image/')) && (typeof item.data === 'string' || typeof item.uri === 'string')) {
      images.push({ data: typeof item.data === 'string' ? item.data : undefined, uri: typeof item.uri === 'string' ? item.uri : undefined, mimeType: mime })
    }
    for (const key of ['inlineData', 'inline_data', 'fileData', 'file_data']) {
      const raw = item[key]
      if (!raw || typeof raw !== 'object') continue
      const data = raw as Record<string, unknown>
      const mimeType = typeof data.mimeType === 'string' ? data.mimeType : typeof data.mime_type === 'string' ? data.mime_type : 'image/png'
      if (!mimeType.startsWith('image/')) continue
      if (typeof data.data === 'string' && data.data.trim()) images.push({ data: data.data.replace(/\s/g, ''), mimeType })
      const uri = data.fileUri ?? data.file_uri ?? data.uri
      if (typeof uri === 'string' && /^(https?:\/\/|data:image\/)/i.test(uri)) images.push({ uri, mimeType })
    }
    if (typeof item.text === 'string' && item.text.trim()) texts.push(item.text.trim())
    for (const key of ['blockReason', 'block_reason', 'blockReasonMessage', 'block_reason_message', 'finishReason', 'finish_reason', 'finishMessage', 'finish_message']) {
      if (typeof item[key] === 'string') reasons.push(item[key] as string)
    }
    if (['finishReason', 'finish_reason', 'blockReason', 'block_reason'].some((key) => typeof item[key] === 'string' && item[key] && !item[key].endsWith('UNSPECIFIED'))) finished = true
    const model = item.modelVersion ?? item.model_version
    if (typeof model === 'string') models.push(model)
    for (const key of ['candidates', 'content', 'parts', 'outputs', 'output_image', 'response', 'result', 'promptFeedback', 'prompt_feedback']) {
      if (item[key] !== undefined) visit(item[key])
    }
    if (Array.isArray(item.steps)) item.steps.filter((step) => step?.type === 'model_output').forEach(visit)
  }
  visit(payload)
  if (!images.length) {
    for (const text of texts) {
      for (const match of text.matchAll(/data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)/g)) images.push({ data: match[2], mimeType: match[1] })
      // 只识别明确的 Markdown 图片链接，不把模型提到的普通网址当作成图。
      for (const match of text.matchAll(/!\[[^\]]*\]\(\s*(https?:\/\/[^\s)]+)(?:\s+"[^"]*")?\s*\)/g)) images.push({ uri: match[1] })
    }
  }
  const seen = new Set<string>()
  const unique = images.filter((image) => {
    const key = image.data || image.uri
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
  const preview = texts.join('\n').replace(/data:image\/[^\s)]+/g, '[图片数据]').slice(0, 500)
  const details = [
    ...new Set(reasons.map((reason) => reason.slice(0, 250))),
    ...(preview ? ['模型回复：' + preview] : []),
    ...(models.length ? ['模型：' + [...new Set(models)].join('、')] : []),
  ]
  return { images: unique, finished, error: 'Gemini 未返回图片。' + (details.length ? '\n' + details.join('\n') : '响应中没有有效图片、文字或结束原因，请检查接口是否正确转发了生图响应。') }
}
