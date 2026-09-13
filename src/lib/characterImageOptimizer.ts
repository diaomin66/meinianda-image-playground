import type { AppSettings, CharacterImageRequest, CharacterLogContext } from '../types'
import { DEFAULT_PARAMS } from '../types'
import { callAgentResponsesApi } from './agentApi'
import { getAgentTextApiProfile } from './apiProfiles'
import { forwardAbort } from './abort'
import { normalizeCharacterImageOptimizer } from './characterImageSettings'
import { callGeminiTextApi } from './geminiTextApi'
import { createOmnidrawOptimizerPrompt, OMNIDRAW_ANTI_COLLAGE, OMNIDRAW_FIELDS } from './omnidrawOptimizerPrompt'
import { recordCharacterLog, updateCharacterLog } from './characterLogs'

export function parseCharacterImagePlan(text: string, count: number): string[] {
  const raw = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const data: unknown = JSON.parse(raw)
  const items = Array.isArray(data) ? data : data && typeof data === 'object'
    ? 'results' in data ? data.results : count === 1 ? [data] : []
    : []
  if (!Array.isArray(items)) throw new Error('副脑返回的画面方案格式无效。')
  const prompts = items.slice(0, count).flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const parts = OMNIDRAW_FIELDS.flatMap((key) => typeof item[key] === 'string' && item[key].trim() ? [item[key].trim()] : [])
    if (!parts.length) return []
    // 与 OmniDraw 一致：按七字段顺序拼接、加入防拼贴前缀并压缩空白。
    const prompt = `${OMNIDRAW_ANTI_COLLAGE}, ${parts.join(', ')}`.replace(/\s+/g, ' ')
    if (prompt.length > 16000) throw new Error('副脑画面方案过长。')
    return [prompt]
  })
  if (!prompts.length) throw new Error('副脑没有返回有效的画面方案。')
  while (prompts.length < count) prompts.push(prompts[0])
  return prompts
}

export async function optimizeCharacterImages(request: CharacterImageRequest, settings: AppSettings, signal: AbortSignal, logContext?: CharacterLogContext, variation?: { index: number; count: number; excludePrompts: string[] }) {
  signal.throwIfAborted()
  const config = normalizeCharacterImageOptimizer(settings.characterImageOptimizer)
  const original = Array.from({ length: request.params.n }, () => request.prompt)
  if (!config.enabled || request.optimize === false) {
    if (logContext) recordCharacterLog({ ...logContext, stage: 'optimizer', status: 'info', title: '副脑已跳过', details: { reason: request.optimize === false ? '本次工具调用关闭优化' : '设置中关闭优化', prompts: original } })
    return { prompts: original, status: 'disabled' as const }
  }
  const selected = config.profileId || settings.characterTextProfileId
  const profile = selected ? settings.profiles.find((item) => item.id === selected) : getAgentTextApiProfile(settings)
  const controller = new AbortController()
  const detach = forwardAbort(signal, controller)
  const timeoutSeconds = config.timeout * (request.params.n > 1 ? 1.5 : 1)
  const timeout = setTimeout(() => controller.abort(), timeoutSeconds * 1000)
  const startedAt = Date.now()
  const logId = logContext ? recordCharacterLog({ ...logContext, stage: 'optimizer', status: 'running', title: variation ? `副脑优化 · 第 ${variation.index + 1} / ${variation.count} 张` : `副脑优化 · ${request.params.n} 张`, details: { prompt: request.prompt, variation, style: config.style, model: config.model || profile?.model, timeoutSeconds, referenceImageCount: 0 } }) : undefined
  const onRequest = (url: string, body: unknown) => { if (logId) updateCharacterLog(logId, { details: { url, body, variation, style: config.style, timeoutSeconds, referenceImageCount: 0 } }) }
  let received = ''
  const onTextDelta = (delta: string) => {
    if (!received && logId) updateCharacterLog(logId, { firstTokenMs: Date.now() - startedAt })
    received += delta
  }
  try {
    if (!profile?.apiKey.trim() || !['responses', 'generateContent'].includes(profile.apiMode)) throw new Error('没有可用的副脑语言接口，已保留主 Agent 提示词。')
    // 上游单图预设原文保留；并发槽位只增加选片约束，主 Agent 原文和最终成图提示词不改写。
    const variationHint = variation ? ['a candid gesture', 'a different natural camera angle', 'a different expression or moment', 'a different framing distance', 'an interaction with the surroundings', 'a different composition', 'a different gaze direction', 'a different natural posture', 'a different placement within the same setting', 'a different detail or visual emphasis'][variation.index % 10] : ''
    const instructions = createOmnidrawOptimizerPrompt(config, request.params.n) + (variation ? `\n\nBATCH VARIATION: Create only image ${variation.index + 1} of ${variation.count}. This image is planned independently in parallel. Prefer ${variationHint} where the user permits variation. Preserve every explicit identity, scene, clothing, action and style requirement; do not invent conflicting constraints. Describe one concrete, visually distinct moment, not merely different wording. Do not include the batch number in the image prompt.${variation.excludePrompts.length ? '\nAlready used image prompts; produce a different allowed moment or composition:\n' + JSON.stringify(variation.excludePrompts) : ''}` : '')
    const textProfile = { ...profile, model: config.model || profile.model, timeout: timeoutSeconds }
    // 主 Agent 的 prompt 原样作为副脑用户输入；不拼接人物设定、图片说明或聊天历史。
    const text = profile.provider === 'gemini'
      ? (await callGeminiTextApi({ profile: textProfile, instructions, tools: [], responseMimeType: 'application/json', signal: controller.signal, contents: [{ role: 'user', parts: [{ text: request.prompt }] }], onRequest, onTextDelta })).text
      : (await callAgentResponsesApi({ settings, profile: textProfile, params: DEFAULT_PARAMS, instructions, tools: [], signal: controller.signal, input: [{ role: 'user', content: request.prompt }], onRequest, onTextDelta })).text
    received = text
    controller.signal.throwIfAborted()
    const prompts = parseCharacterImagePlan(text, request.params.n)
    if (logId) updateCharacterLog(logId, { status: 'success', result: { rawText: text, prompts } })
    return { prompts, status: 'optimized' as const }
  } catch (err) {
    if (logId) updateCharacterLog(logId, { status: 'warning', result: { error: err, receivedText: received, cancelled: signal.aborted, timedOut: controller.signal.aborted && !signal.aborted, fallbackPrompts: signal.aborted || variation ? [] : original } })
    signal.throwIfAborted()
    console.warn('人物生图副脑回退', err)
    return { prompts: original, status: 'fallback' as const, note: variation ? `副脑未能生成本张独立提示词：${controller.signal.aborted ? '请求超时' : err instanceof Error ? err.message : '副脑不可用'}。本张未提交生图。` : controller.signal.aborted ? '副脑超时，使用主 Agent 提示词。' : err instanceof Error ? err.message : '副脑不可用，使用主 Agent 提示词。' }
  } finally {
    clearTimeout(timeout)
    detach()
  }
}
