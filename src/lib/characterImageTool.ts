import type { AppSettings, Character, CharacterImageRequest, CharacterLogContext, CharacterReferenceRole, TaskParams } from '../types'
import { callImageApi } from './api'
import { createSettingsForApiProfile, getAgentImageApiProfile } from './apiProfiles'
import { storeImageWithSize } from './db'
import { cacheImage, ensureImageCached } from './imageCache'
import { GEMINI_FLASH_ASPECT_RATIOS, GEMINI_FLASH_IMAGE_MODEL, GEMINI_FLASH_IMAGE_SIZES, GEMINI_PRO_IMAGE_MODEL, GEMINI_PRO_IMAGE_SIZES, GEMINI_STANDARD_ASPECT_RATIOS, GPT_IMAGE_MODELS, getImageQualityOptions } from './imageModels'
import { getOutputImageLimitForSettings, normalizeParamsForSettings } from './paramCompatibility'
import { getCharacterImageFrame } from './characterImageSettings'
import { recordCharacterLog, updateCharacterLog } from './characterLogs'

const PARAM_PROPERTIES = {
  size: { type: 'string', description: 'OpenAI 使用 auto 或宽x高像素；Gemini 使用 512px、1K、2K、4K（以模型能力为准）。' },
  aspect_ratio: { type: 'string', enum: [...GEMINI_FLASH_ASPECT_RATIOS], description: 'Gemini 图片比例；OpenAI 使用 size 指定比例，此项填 auto。' },
  thinking_level: { type: 'string', enum: ['minimal', 'high'], description: 'Gemini Flash 图片推理强度；其余模型填 minimal。' },
  quality: { type: 'string', enum: ['auto', 'low', 'medium', 'high', 'xhigh', 'max'], description: 'OpenAI 图片质量；Gemini 填 auto。' },
  background: { type: 'string', enum: ['auto', 'opaque', 'transparent'], description: 'OpenAI 背景；Gemini 填 auto。JPEG 不支持透明背景。' },
  output_format: { type: 'string', enum: ['png', 'jpeg', 'webp'], description: '图片格式，Gemini 不支持 webp。' },
  output_compression: { type: ['integer', 'null'], minimum: 0, maximum: 100, description: 'OpenAI JPEG/WebP 压缩质量，0–100；PNG、Gemini 或默认值填 null。' },
  moderation: { type: 'string', enum: ['auto', 'low'], description: 'OpenAI 图片审核参数；Gemini 填 auto。' },
  n: { type: 'integer', minimum: 1, maximum: 10, description: '本次调用生成的独立图片张数。按用户要求填写，例如“发3张自拍”填 3；“一张合影里有3个人”填 1，人物数和参考图数不计入张数。未指定数量时单张填 1，只说“几张／多张”时可先给 2 张。不要把多张独立图片合并成一张拼图。遵守所选配置的 maxImagesPerCall。' },
  transparent_output: { type: 'boolean', description: '请求原生透明背景并输出 PNG，通过 background 参数实现，不附加背景提示词；默认 false，Gemini 不支持。' },
}

export const CHARACTER_REFERENCE_ROLES: CharacterReferenceRole[] = ['identity', 'subject', 'style', 'clothing', 'object', 'pose', 'background']

export function createCharacterImageTool(settings: AppSettings, char: Character) {
  const profiles = settings.profiles.filter((profile) => profile.apiMode === 'images')
  const defaultId = settings.characterImageProfileId || getAgentImageApiProfile(settings)?.id
  const frame = getCharacterImageFrame(settings.characterImageSize)
  const frameDescription = frame
    ? `用户选择的画幅固定为 ${frame.aspect_ratio}：Gemini 的 params.aspect_ratio 填 ${frame.aspect_ratio}，params.size 仍填模型支持的分辨率档位；其他图片接口的 params.size 填 ${frame.size}。发送图片请求前会落实此选择，prompt 中的构图也应与此比例一致。`
    : '画幅设为自动，可按用户本次要求选择比例；Gemini 用 params.aspect_ratio，其他图片接口用 params.size。'
  return {
    type: 'function',
    name: 'generate_image',
    description: `生成或编辑图片。用于人物日常聊天中的照片分享，调用前后自然接话，不向用户播报正在生图、排队、副脑、提示词、参数或任务详情。按用户本轮要求决定总张数：同主题的多张变化可一次调用并设置 params.n；用户逐张指定不同场景、服装或画面时，每张分别调用并设置 n=1，prompt 只写该张画面。多次调用的 n 之和应等于用户要求的总张数，已接单的数量计入总数，不重复生成。${settings.characterImageBackground !== false ? '提交后返回 accepted 和 taskId，表示已接单而非已经出图；后台完成后图片会自动作为新消息送达，届时再根据图片继续聊天。可通过 image_task_status 内部查询进度，不要为查询进度重复生图。' : '完成后返回图片 ID、图片内容、实际参数或错误。'} 全部生成参数由本工具指定。默认配置 ${defaultId}，默认质量 ${settings.characterImageQuality || 'medium'}。${frameDescription} 可用配置：${JSON.stringify(profiles.map((profile) => ({ id: profile.id, provider: profile.provider, defaultModel: profile.model, maxImagesPerCall: getOutputImageLimitForSettings({ ...settings, activeProfileId: profile.id }), models: profile.provider === 'openai' ? GPT_IMAGE_MODELS : profile.provider === 'gemini' ? [GEMINI_FLASH_IMAGE_MODEL, GEMINI_PRO_IMAGE_MODEL] : [profile.model] })))}。`,
    strict: true,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        profileId: { type: 'string', enum: profiles.map((profile) => profile.id), description: '已配置的生图接口 ID。' },
        model: { type: 'string', description: '该配置支持的生图模型 ID。' },
        prompt: { type: 'string', description: '由你根据聊天生成完整提示词，包含主体、外貌、动作、服装、场景、参考图用途及必须保留或修改的内容。固定人物参考图只向语言模型提供 ID，原图仅发送给图片接口；外貌未写明时要求图片模型遵循身份参考图，不臆测参考图细节。数量单独放在 params.n；多图时写明共同主题、保持一致的特征与允许变化的姿势或视角，不要要求图片模型在同一画面塞进多张照片。用户说“再来／换一张”时根据本轮要求重新设计画面，不直接复用上一张的提示词或改图，除非用户明确要求编辑旧图。此文本原样交给提示词优化副脑；副脑输出直接用于生图，之后不会追加人物设定或参考图说明。用户明确要求跳过优化时，设置 optimize=false。' },
        mode: { type: 'string', enum: ['draw', 'edit', 'selfie'], description: 'draw 生成新图；edit 编辑选定图片，必须包含 subject 参考；selfie 使用人物固定参考图保持身份，可附加服装、物体等参考。' },
        referenceIds: { type: 'array', items: { type: 'string' }, maxItems: 8, description: '按顺序明确选择上下文图片 ID；不会自动选择历史图片。selfie 会把人物固定参考图作为身份图放在前面。' },
        referenceRoles: { type: 'array', items: { type: 'string', enum: CHARACTER_REFERENCE_ROLES }, maxItems: 8, description: '与 referenceIds 一一对应的用途：identity 身份、subject 编辑主体、style 画风、clothing 服装、object 动物或物体、pose 姿势、background 背景。同一图片可承担多个明确用途。' },
        optimize: { type: 'boolean', description: '默认 true：将你生成的 prompt 交给提示词优化副脑处理，最终提示词直接发送给图片接口。只有用户明确要求不优化时填 false；设置中关闭副脑时自动跳过。' },
        maskImageId: { type: ['string', 'null'], description: '可选遮罩图片 ID，编辑 referenceIds 中第一张图；无须遮罩时填 null。Gemini 不支持。' },
        intent: { type: 'string', enum: char.autoImages ? ['requested', 'spontaneous'] : ['requested'], description: 'requested 为用户要求生图；spontaneous 为自主生图。' },
        params: { type: 'object', additionalProperties: false, properties: PARAM_PROPERTIES, required: Object.keys(PARAM_PROPERTIES) },
      },
      required: ['profileId', 'model', 'prompt', 'mode', 'referenceIds', 'referenceRoles', 'optimize', 'maskImageId', 'intent', 'params'],
    },
  }
}

// 工具参数与备份都属于外部输入；同一份校验也用于恢复待重试请求。
export function parseCharacterImageRequest(value: unknown): CharacterImageRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('生图参数必须是 JSON 对象。')
  const call = value as Record<string, unknown>
  if (typeof call.profileId !== 'string' || !call.profileId || typeof call.model !== 'string' || !call.model) throw new Error('缺少生图配置或模型。')
  if (typeof call.prompt !== 'string' || !call.prompt.trim()) throw new Error('缺少完整生图提示词。')
  if (!Array.isArray(call.referenceIds) || call.referenceIds.some((id) => typeof id !== 'string' || !id)) throw new Error('referenceIds 必须是图片 ID 数组。')
  if (call.maskImageId !== undefined && call.maskImageId !== null && typeof call.maskImageId !== 'string') throw new Error('maskImageId 必须是图片 ID 或 null。')
  if (!call.params || typeof call.params !== 'object' || Array.isArray(call.params)) throw new Error('缺少 params 生图参数。')
  const params = call.params as Record<string, unknown>
  for (const [key, schema] of Object.entries(PARAM_PROPERTIES)) {
    const value = params[key]
    if ('enum' in schema && !schema.enum.includes(value as never)) throw new Error(`params.${key} 无效，可选值：${schema.enum.join('、')}。`)
    if (key === 'size' && (typeof value !== 'string' || !/^(auto|\d+x\d+|512px|[124]K)$/.test(value))) throw new Error('params.size 格式无效。')
    if (key === 'transparent_output' && typeof value !== 'boolean') throw new Error('params.transparent_output 必须是布尔值。')
    if (key === 'n' && (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 10)) throw new Error('params.n 必须是 1–10 的整数。')
    if (key === 'output_compression' && value !== null && (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 100)) throw new Error('params.output_compression 必须是 0–100 的整数或 null。')
  }
  const unknownKeys = Object.keys(params).filter((key) => !(key in PARAM_PROPERTIES))
  if (unknownKeys.length) throw new Error(`不支持的生图参数：${unknownKeys.join('、')}。`)
  if (call.mode !== undefined && !['draw', 'edit', 'selfie'].includes(String(call.mode))) throw new Error('mode 必须为 draw、edit 或 selfie。')
  if (call.optimize !== undefined && typeof call.optimize !== 'boolean') throw new Error('optimize 必须为布尔值。')
  if (call.referenceRoles !== undefined && (!Array.isArray(call.referenceRoles) || call.referenceRoles.length !== call.referenceIds.length || call.referenceRoles.some((role) => !CHARACTER_REFERENCE_ROLES.includes(role)))) throw new Error('referenceRoles 必须与参考图一一对应，且用途有效。')
  if (call.mode && call.referenceRoles === undefined) throw new Error('请为每张参考图指定 referenceRoles。')
  return {
    profileId: call.profileId, model: call.model, prompt: call.prompt,
    referenceIds: call.referenceRoles ? [...call.referenceIds as string[]] : [...new Set(call.referenceIds as string[])],
    maskImageId: call.maskImageId ?? null, params: { ...params } as unknown as TaskParams,
    ...(call.mode ? { mode: call.mode as CharacterImageRequest['mode'] } : {}),
    ...(call.referenceRoles ? { referenceRoles: [...call.referenceRoles as CharacterReferenceRole[]] } : {}),
    ...(typeof call.optimize === 'boolean' ? { optimize: call.optimize } : {}),
  }
}

export function parseCharacterImageCall(args: unknown, settings: AppSettings, char: Character, availableIds: Set<string>) {
  const value: unknown = typeof args === 'string' ? JSON.parse(args) : args
  const request = parseCharacterImageRequest(value)
  const intent = (value as Record<string, unknown>).intent
  if (intent !== 'requested' && intent !== 'spontaneous') throw new Error('intent 必须为 requested 或 spontaneous。')
  if (!char.autoImages && intent === 'spontaneous') throw new Error('此人物已关闭自主生图。')
  if (request.mode === 'selfie') {
    if (!char.referenceImageIds.length) throw new Error('人物参考模式需要先上传人物参考图。头像不能代替参考图。')
    const refs = request.referenceIds.map((id, idx) => ({ id, role: request.referenceRoles![idx] }))
    const extra = refs.filter((ref) => ref.role !== 'identity' || !char.referenceImageIds.includes(ref.id))
    request.referenceIds = [...char.referenceImageIds, ...extra.map((ref) => ref.id)]
    request.referenceRoles = [...char.referenceImageIds.map(() => 'identity' as const), ...extra.map((ref) => ref.role)]
  }
  if (request.mode === 'edit' && !request.referenceRoles?.includes('subject')) throw new Error('改图必须明确选择 subject 主体参考图。')
  if (request.referenceIds.length > 8) throw new Error('本次最多使用 8 张参考图（含人物身份图）。')
  const profile = settings.profiles.find((profile) => profile.id === request.profileId && profile.apiMode === 'images')
  if (!profile) throw new Error('指定的生图配置不存在。')
  const models: readonly string[] = profile.provider === 'openai' ? GPT_IMAGE_MODELS : profile.provider === 'gemini' ? [GEMINI_FLASH_IMAGE_MODEL, GEMINI_PRO_IMAGE_MODEL] : [profile.model]
  if (!models.includes(request.model)) throw new Error(`该配置可用的模型：${models.join('、')}。`)
  const ids = [...request.referenceIds, ...(request.maskImageId ? [request.maskImageId] : [])]
  if (ids.some((id) => !availableIds.has(id))) throw new Error('引用了上下文中不存在的图片 ID。')
  if (request.maskImageId && !request.referenceIds.length) throw new Error('使用遮罩时需要至少一张参考图。')
  if (request.maskImageId && request.referenceRoles && request.referenceRoles[0] !== 'subject') throw new Error('遮罩作用于第一张参考图，该图的用途必须是 subject。')
  // 接单时落实用户选择并写入任务快照，避免模型的 auto/方图覆盖设置；重试沿用此快照。
  const frame = getCharacterImageFrame(settings.characterImageSize)
  if (frame) {
    request.params = profile.provider === 'gemini'
      ? { ...request.params, aspect_ratio: frame.aspect_ratio }
      : { ...request.params, size: frame.size }
  }
  const params = request.params
  if (profile.provider === 'gemini') {
    const flash = request.model === GEMINI_FLASH_IMAGE_MODEL
    if (!(flash ? GEMINI_FLASH_IMAGE_SIZES : GEMINI_PRO_IMAGE_SIZES).some((size) => size === params.size)) throw new Error(`该 Gemini 模型的 size 可选：${(flash ? GEMINI_FLASH_IMAGE_SIZES : GEMINI_PRO_IMAGE_SIZES).join('、')}。`)
    if (!(flash ? GEMINI_FLASH_ASPECT_RATIOS : GEMINI_STANDARD_ASPECT_RATIOS).some((ratio) => ratio === params.aspect_ratio)) throw new Error('该 Gemini 模型不支持指定的 aspect_ratio。')
    if (request.maskImageId || params.transparent_output || params.output_format === 'webp') throw new Error('Gemini 不支持遮罩、透明背景或 WebP。')
    if (params.quality !== 'auto' || params.background !== 'auto' || params.moderation !== 'auto' || params.output_compression !== null) throw new Error('Gemini 的 quality、background、moderation 须为 auto，output_compression 须为 null。')
    if (!flash && params.thinking_level !== 'minimal') throw new Error('此 Gemini 生图模型不支持设置 thinking_level。')
  }
  if (profile.provider === 'openai') {
    if (!/^(auto|[1-9]\d*x[1-9]\d*)$/.test(params.size)) throw new Error('OpenAI 的 size 必须为 auto 或宽x高像素。')
    if (params.aspect_ratio !== 'auto' || params.thinking_level !== 'minimal') throw new Error('OpenAI 使用 size 指定比例，aspect_ratio 须为 auto，thinking_level 须为 minimal。')
  }
  if (!getImageQualityOptions({ ...profile, model: request.model }).includes(params.quality)) throw new Error('该生图模型不支持指定的 quality。')
  if (params.output_format === 'png' && params.output_compression !== null) throw new Error('PNG 不支持 output_compression，请填 null。')
  if (params.output_format === 'jpeg' && params.background === 'transparent') throw new Error('JPEG 不支持透明背景。')
  if (params.transparent_output && params.output_format !== 'png') throw new Error('透明输出须使用 PNG 格式。')
  if (params.n > getOutputImageLimitForSettings({ ...settings, activeProfileId: profile.id })) throw new Error('生成数量超过该接口上限。')
  return request
}

export async function executeCharacterImage(request: CharacterImageRequest, settings: AppSettings, signal: AbortSignal, snapshot?: Map<string, string>, logContext?: CharacterLogContext) {
  const profile = settings.profiles.find((profile) => profile.id === request.profileId && profile.apiMode === 'images')
  if (!profile?.apiKey.trim()) throw new Error('请先在设置 → API 配置中填写对应的生图密钥。')
  const imageSettings = createSettingsForApiProfile(settings, { ...profile, model: request.model })
  const normalized = normalizeParamsForSettings(request.params, imageSettings, { hasInputImages: Boolean(request.referenceIds.length) })
  const params = request.params.transparent_output ? { ...normalized, background: 'transparent' as const, output_format: 'png' as const, output_compression: null } : normalized
  const prompt = request.prompt
  const images = new Map<string, string>()
  for (const id of [...request.referenceIds, ...(request.maskImageId ? [request.maskImageId] : [])]) {
    const url = snapshot?.get(id) ?? await ensureImageCached(id)
    if (!url) throw new Error('生图所需的参考图或遮罩已丢失，请重新上传。')
    images.set(id, url)
  }
  signal.throwIfAborted()
  const logId = logContext ? recordCharacterLog({ ...logContext, stage: 'image', status: 'running', title: '发送生图请求', details: { provider: profile.provider, model: request.model, prompt, params, referenceIds: request.referenceIds, referenceRoles: request.referenceRoles, maskImageId: request.maskImageId } }) : undefined
  try {
    const result = await callImageApi({ settings: imageSettings, prompt, params, inputImageDataUrls: request.referenceIds.map((id) => images.get(id)!), maskDataUrl: request.maskImageId ? images.get(request.maskImageId) : undefined, signal,
      onRequest: logId ? (url, body) => updateCharacterLog(logId, { details: { provider: profile.provider, model: request.model, url, body, referenceIds: request.referenceIds, referenceRoles: request.referenceRoles, maskImageId: request.maskImageId } }) : undefined,
      onProgress: logContext ? (title, details) => { recordCharacterLog({ ...logContext, stage: 'image', status: 'info', title, details }) } : undefined,
    })
    signal.throwIfAborted()
    if (!result.images.length) throw new Error('生图接口没有返回图片。')
    const imageIds: string[] = []
    const actualParamsList: Partial<TaskParams>[] = []
    for (const [idx, url] of result.images.entries()) {
      signal.throwIfAborted()
      const stored = await storeImageWithSize(url, 'generated')
      cacheImage(stored.id, url)
      imageIds.push(stored.id)
      const actual = { ...result.actualParams, ...result.actualParamsList?.[idx] }
      if (stored.width && stored.height) {
        actual.size = `${stored.width}x${stored.height}`
        const ratio = stored.width / stored.height
        actual.aspect_ratio = GEMINI_FLASH_ASPECT_RATIOS.find((value) => {
          const [w, h] = value.split(':').map(Number)
          return Math.abs(ratio / (w / h) - 1) < 0.01
        }) ?? 'auto'
      }
      actualParamsList.push(actual)
    }
    const output = { success: true, imageIds, profileId: profile.id, model: request.model, prompt, referenceIds: request.referenceIds, maskImageId: request.maskImageId, requestedParams: request.params, actualParams: { ...params, ...actualParamsList[0] }, actualParamsList, revisedPrompts: result.revisedPrompts, failedRequests: result.failedRequests }
    if (logId) updateCharacterLog(logId, { status: 'success', result: output })
    return { imageIds, output }
  } catch (err) {
    if (logId) updateCharacterLog(logId, { status: signal.aborted ? 'warning' : 'error', result: { error: err, transport: err && typeof err === 'object' && 'transport' in err ? err.transport : undefined, rawResponse: err && typeof err === 'object' && 'rawResponsePayload' in err ? err.rawResponsePayload : undefined } })
    throw err
  }
}
