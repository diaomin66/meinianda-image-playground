import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { DEFAULT_SETTINGS } from './apiProfiles'
import { lockApiSettings, FIXED_GEMINI_TEXT_PROFILE_ID } from './fixedApiProfiles'
import { callAgentResponsesApi } from './agentApi'
import { callGeminiTextApi } from './geminiTextApi'
import { optimizeCharacterImages, parseCharacterImagePlan } from './characterImageOptimizer'
import { normalizeCharacterImageOptimizer } from './characterImageSettings'
import { createOmnidrawOptimizerPrompt } from './omnidrawOptimizerPrompt'

vi.mock('./agentApi', () => ({ callAgentResponsesApi: vi.fn() }))
vi.mock('./geminiTextApi', async (original) => ({ ...await original<typeof import('./geminiTextApi')>(), callGeminiTextApi: vi.fn() }))
const request = { profileId: 'fixed-images', model: 'gpt-image-2', prompt: ' 白猫坐在窗台，招牌写“你好”\n参考图 1 是猫。 ', referenceIds: ['cat'], referenceRoles: ['object' as const], mode: 'draw' as const, maskImageId: null, params: { ...DEFAULT_PARAMS, n: 2 } }
// 故意打乱键顺序，验证最终提示词遵循上游固定顺序。
const scene = { technical_specs: 'Phone photo', pose_and_action: 'Sitting', subject_appearance: 'White cat', environment_and_scene: 'Window', clothing_and_accessories: 'Red collar', realism_and_quality_guardrails: 'Natural proportions', lighting_and_mood: 'Daylight' }
const expected = 'single image, one natural coherent frame, no grid, no collage, no split screen, no multiple views, White cat, Red collar, Sitting, Window, Daylight, Phone photo, Natural proportions'
const plan = JSON.stringify({ results: [scene, { ...scene, pose_and_action: 'Looking up' }] })
let settings = lockApiSettings(DEFAULT_SETTINGS)

beforeEach(() => {
  vi.resetAllMocks()
  settings = lockApiSettings(DEFAULT_SETTINGS)
  settings.profiles = settings.profiles.map((profile) => ({ ...profile, apiKey: 'test' }))
  vi.mocked(callAgentResponsesApi).mockResolvedValue({ text: plan, images: [], outputItems: [] })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('OmniDraw 独立生图副脑', () => {
  it.each([['2:3', 1], ['3:2', 2], ['1:1', 1]] as const)('画幅 %s 通过生图参数传递，副脑保留上游提示词和拼接规则', async (ratio, count) => {
    const result = await optimizeCharacterImages({ ...request, params: { ...request.params, aspect_ratio: ratio, n: count } }, settings, new AbortController().signal)
    const opts = vi.mocked(callAgentResponsesApi).mock.calls[0][0]
    expect(opts.instructions).toBe(createOmnidrawOptimizerPrompt(normalizeCharacterImageOptimizer(settings.characterImageOptimizer), count))
    expect(opts.input).toEqual([{ role: 'user', content: request.prompt }])
    expect(result.prompts[0]).toBe(expected)
  })

  it('自动画幅不向副脑附加画幅约束', async () => {
    await optimizeCharacterImages(request, settings, new AbortController().signal)
    expect(vi.mocked(callAgentResponsesApi).mock.calls[0][0].instructions).toBe(createOmnidrawOptimizerPrompt(normalizeCharacterImageOptimizer(settings.characterImageOptimizer), request.params.n))
  })

  it('主 Agent 提示词原样作为唯一用户输入，使用上游七字段提示词且不传参考图、人格或工具', async () => {
    const result = await optimizeCharacterImages(request, settings, new AbortController().signal)
    expect(result.status).toBe('optimized')
    expect(result.prompts).toEqual([expected, expected.replace('Sitting', 'Looking up')])
    const opts = vi.mocked(callAgentResponsesApi).mock.calls[0][0]
    expect(opts.instructions).toContain('You are a senior prompt editor for authentic everyday smartphone photography.')
    expect(opts.instructions).toContain('Generate EXACTLY 2 distinct variations')
    expect(opts.instructions).toContain('realism_and_quality_guardrails')
    expect(opts.tools).toEqual([])
    expect(opts.input).toEqual([{ role: 'user', content: request.prompt }])
    expect(result.prompts[0]).not.toContain(request.prompt)
    expect(result.prompts[0]).not.toContain('参考图')
  })

  it('独立选择 Gemini 模型，使用原生 JSON 流式客户端及 OmniDraw 系统提示词', async () => {
    settings.characterImageOptimizer = { ...normalizeCharacterImageOptimizer({}), profileId: FIXED_GEMINI_TEXT_PROFILE_ID, model: 'configured-model', style: 'selfie' }
    vi.mocked(callGeminiTextApi).mockResolvedValue({ text: JSON.stringify(scene), content: { role: 'model', parts: [{ text: JSON.stringify(scene) }] } })
    const result = await optimizeCharacterImages({ ...request, params: { ...request.params, n: 1 } }, settings, new AbortController().signal)
    expect(result).toMatchObject({ status: 'optimized', prompts: [expected] })
    expect(callAgentResponsesApi).not.toHaveBeenCalled()
    const opts = vi.mocked(callGeminiTextApi).mock.calls[0][0]
    expect(opts).toMatchObject({ profile: { model: 'configured-model' }, tools: [], responseMimeType: 'application/json', contents: [{ role: 'user', parts: [{ text: request.prompt }] }] })
    expect(opts.instructions).toContain('an expert mobile selfie realism editor')
    expect(opts.instructions).toContain('Output ONLY ONE valid JSON object')
  })

  it('Gemini 省略结束标记但完整返回副脑 JSON 时仍优化成功', async () => {
    settings.characterImageOptimizer = { ...normalizeCharacterImageOptimizer({}), profileId: FIXED_GEMINI_TEXT_PROFILE_ID }
    const native = await vi.importActual<typeof import('./geminiTextApi')>('./geminiTextApi')
    vi.mocked(callGeminiTextApi).mockImplementation(native.callGeminiTextApi)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: plan }] } }] }) + '\n\n', { headers: { 'Content-Type': 'text/event-stream' } })))
    expect(await optimizeCharacterImages(request, settings, new AbortController().signal)).toMatchObject({ status: 'optimized', prompts: [expected, expected.replace('Sitting', 'Looking up')] })
  })

  it('单图对象、多图 results、根数组与代码围栏均按七字段顺序解析', () => {
    expect(parseCharacterImagePlan(JSON.stringify(scene), 1)).toEqual([expected])
    expect(parseCharacterImagePlan('```json\n' + plan + '\n```', 2)).toEqual([expected, expected.replace('Sitting', 'Looking up')])
    expect(parseCharacterImagePlan(JSON.stringify([scene]), 3)).toEqual([expected, expected, expected])
    expect(parseCharacterImagePlan(plan, 1)).toEqual([expected])
    expect(parseCharacterImagePlan(JSON.stringify({ ...scene, subject_appearance: 'White\n  cat', unknown: 'ignore' }), 1)).toEqual([expected])
  })

  it('无效或截断结果回退主 Agent 原文，数量不足时复用首个有效方案', async () => {
    expect(() => parseCharacterImagePlan('{"results":', 1)).toThrow()
    expect(() => parseCharacterImagePlan('{"results":[{"unknown":"value"}]}', 2)).toThrow('没有返回有效')
    expect(parseCharacterImagePlan(JSON.stringify({ results: [null, scene] }), 2)).toEqual([expected, expected])
    vi.mocked(callAgentResponsesApi).mockResolvedValue({ text: '{"results":[]}', images: [], outputItems: [] })
    expect(await optimizeCharacterImages(request, settings, new AbortController().signal)).toMatchObject({ status: 'fallback', prompts: [request.prompt, request.prompt] })
  })

  it('关闭副脑或本次明确跳过时不请求模型，也不修改原始提示词', async () => {
    expect(await optimizeCharacterImages({ ...request, optimize: false }, settings, new AbortController().signal)).toMatchObject({ status: 'disabled', prompts: [request.prompt, request.prompt] })
    settings.characterImageOptimizer = { ...normalizeCharacterImageOptimizer({}), enabled: false }
    expect(await optimizeCharacterImages(request, settings, new AbortController().signal)).toMatchObject({ status: 'disabled', prompts: [request.prompt, request.prompt] })
    expect(callAgentResponsesApi).not.toHaveBeenCalled()
  })

  it('默认及旧版 follow 迁移为手机日常原生感，自定义中文风格保留真实内容', () => {
    expect(normalizeCharacterImageOptimizer({ style: 'follow' }).style).toBe('photo')
    expect(normalizeCharacterImageOptimizer({}).style).toBe('photo')
    expect(createOmnidrawOptimizerPrompt(normalizeCharacterImageOptimizer({ style: 'custom', customPrompt: '清透蓝调，自然光' }), 1)).toContain('this exact style: 清透蓝调，自然光')
  })

  it('多图使用 1.5 倍等待上限，超时回退但用户取消不继续生图', async () => {
    vi.useFakeTimers()
    vi.mocked(callAgentResponsesApi).mockImplementation((opts) => new Promise((resolve, reject) => { opts.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }) }))
    const result = optimizeCharacterImages(request, settings, new AbortController().signal)
    await vi.advanceTimersByTimeAsync(45001)
    expect(vi.mocked(callAgentResponsesApi).mock.calls[0][0].signal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(22500)
    expect(await result).toMatchObject({ status: 'fallback', note: '副脑超时，使用主 Agent 提示词。' })
    const controller = new AbortController()
    const cancelled = optimizeCharacterImages(request, settings, controller.signal)
    const rejection = expect(cancelled).rejects.toThrow('abort')
    controller.abort()
    await rejection
  })
})
