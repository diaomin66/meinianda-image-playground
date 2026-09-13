import type { GeminiPart } from '../types'

const DATA_FIELDS = ['text', 'inlineData', 'fileData', 'functionCall', 'functionResponse', 'executableCode', 'codeExecutionResult', 'toolCall', 'toolResponse']
const ALIASES: Record<string, string> = {
  inline_data: 'inlineData', file_data: 'fileData', function_call: 'functionCall', function_response: 'functionResponse',
  executable_code: 'executableCode', code_execution_result: 'codeExecutionResult', thought_signature: 'thoughtSignature',
  tool_call: 'toolCall', tool_response: 'toolResponse', video_metadata: 'videoMetadata', media_resolution: 'mediaResolution', part_metadata: 'partMetadata',
}

export function normalizeGeminiParts(value: unknown, path: string): GeminiPart[] {
  if (!Array.isArray(value)) throw new Error(`Gemini ${path} 必须是内容数组。`)
  return value.flatMap((raw, idx) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
    const part: Record<string, unknown> = { ...raw }
    for (const [from, to] of Object.entries(ALIASES)) {
      if (part[from] !== undefined && part[to] === undefined) part[to] = part[from]
      delete part[from]
    }
    for (const key of ['inlineData', 'fileData']) {
      const data = part[key]
      if (!data || typeof data !== 'object' || Array.isArray(data)) continue
      const normalized = { ...data } as Record<string, unknown>
      if (normalized.mime_type !== undefined && normalized.mimeType === undefined) normalized.mimeType = normalized.mime_type
      if (normalized.file_uri !== undefined && normalized.fileUri === undefined) normalized.fileUri = normalized.file_uri
      delete normalized.mime_type
      delete normalized.file_uri
      part[key] = normalized
    }
    const fields = DATA_FIELDS.filter((key) => part[key] !== undefined && part[key] !== null)
    if (fields.length > 1) throw new Error(`Gemini ${path}[${idx}] 同时包含多个内容类型：${fields.join('、')}。`)
    if (!fields.length) {
      // 流末尾可能只有签名。保留其独立位置并显式设置 text，使 Part.data 有值。
      if (typeof part.thoughtSignature === 'string' && part.thoughtSignature) return [{ ...part, text: '' } as GeminiPart]
      return []
    }
    const key = fields[0]
    if (key === 'text') {
      if (typeof part.text !== 'string') throw new Error(`Gemini ${path}[${idx}].text 必须是字符串。`)
      if (!part.text && !part.thoughtSignature) return []
    } else {
      const data = part[key]
      if (!data || typeof data !== 'object' || Array.isArray(data) || !Object.keys(data).length) throw new Error(`Gemini ${path}[${idx}].${key} 缺少有效内容。`)
      const content = data as Record<string, unknown>
      if (key === 'inlineData' && (typeof content.data !== 'string' || !content.data.trim() || typeof content.mimeType !== 'string' || !content.mimeType)) throw new Error(`Gemini ${path}[${idx}] 的图片数据或 MIME 类型缺失。`)
      if ((key === 'functionCall' || key === 'functionResponse') && (typeof content.name !== 'string' || !content.name)) throw new Error(`Gemini ${path}[${idx}] 的函数名称缺失。`)
    }
    for (const key of DATA_FIELDS) if (part[key] === null) delete part[key]
    return [part as GeminiPart]
  })
}
