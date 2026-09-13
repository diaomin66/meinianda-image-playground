import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Character } from '../types'
import { DEFAULT_SETTINGS } from './apiProfiles'
import { FIXED_GEMINI_TEXT_PROFILE_ID, lockApiSettings } from './fixedApiProfiles'
import { callGeminiTextApi } from './geminiTextApi'
import { ensureCharacterLifeSchedule, getCharacterLifeContext, getCharacterLifeDate } from './characterLifeScheduler'
import { normalizeCharacterData } from './characterState'

vi.mock('./geminiTextApi', () => ({ callGeminiTextApi: vi.fn() }))
vi.mock('./agentApi', () => ({ callAgentResponsesApi: vi.fn(() => { throw new Error('测试不应调用 Responses 接口') }) }))

const char: Character = { id: 'life-test', name: '林夏', personality: ' 只用短句回答。 ', appearance: '', opening: '', referenceImageIds: ['reference'], autoImages: true, lifeSchedulerEnabled: true, lifeScheduleTime: '07:00', createdAt: 1, updatedAt: 1 }
const settings = lockApiSettings(DEFAULT_SETTINGS)
const payload = { outfit_style: '日常', outfit: '蓝色衬衫', schedule: '08:00 看书\n22:00 在家休息' }

beforeEach(() => {
  vi.resetAllMocks()
  settings.characterTextProfileId = FIXED_GEMINI_TEXT_PROFILE_ID
  settings.profiles = settings.profiles.map((profile) => ({ ...profile, apiKey: 'test-only' }))
  vi.mocked(callGeminiTextApi).mockResolvedValue({ text: JSON.stringify(payload), content: { role: 'model', parts: [] } })
})
afterEach(() => vi.restoreAllMocks())

describe('人物生活日程', () => {
  it('按本地时间跨天，非法切换时间回到默认值', () => {
    expect(getCharacterLifeDate(char, new Date(2026, 8, 13, 6, 59))).toBe('2026-09-12')
    expect(getCharacterLifeDate(char, new Date(2026, 8, 13, 7))).toBe('2026-09-13')
    expect(getCharacterLifeDate({ ...char, lifeScheduleTime: '99:99' }, new Date(2026, 8, 13, 6))).toBe('2026-09-12')
    expect(normalizeCharacterData({ characters: [{ ...char, lifeScheduleTime: '99:99' }] }).characters[0].lifeScheduleTime).toBeUndefined()
  })

  it('凌晨沿用前一生活日的最后活动，不提前进入早晨日程', () => {
    const character = { ...char, lifeSchedule: { date: '2026-09-12', outfitStyle: payload.outfit_style, outfit: payload.outfit, schedule: payload.schedule, generatedAt: 1 } }
    expect(getCharacterLifeContext(character, new Date(2026, 8, 13, 1))).toContain('当前状态: 22:00 在家休息')
    expect(getCharacterLifeContext(character, new Date(2026, 8, 13, 8))).toBe('')
  })

  it('缺少密钥后补填可以重试，Gemini 使用 JSON 流且不带参考图', async () => {
    settings.profiles = settings.profiles.map((profile) => ({ ...profile, apiKey: '' }))
    expect(await ensureCharacterLifeSchedule(char, undefined, settings)).toBeNull()
    settings.profiles = settings.profiles.map((profile) => ({ ...profile, apiKey: 'test-only' }))
    const result = await ensureCharacterLifeSchedule(char, undefined, settings)
    expect(result?.outfit).toBe(payload.outfit)
    const opts = vi.mocked(callGeminiTextApi).mock.calls[0][0]
    expect(opts).toMatchObject({ instructions: char.personality, responseMimeType: 'application/json', tools: [] })
    expect(opts.contents[0].parts).toHaveLength(1)
    expect(opts.contents[0].parts[0]).toHaveProperty('text')
  })

  it('同人物同日并行请求只生成一次，保存后复用当日状态', async () => {
    const [first, second] = await Promise.all([ensureCharacterLifeSchedule(char, undefined, settings), ensureCharacterLifeSchedule(char, undefined, settings)])
    expect(first).toEqual(second)
    expect(callGeminiTextApi).toHaveBeenCalledOnce()
    expect(await ensureCharacterLifeSchedule({ ...char, lifeSchedule: first! }, undefined, settings)).toEqual(first)
    expect(callGeminiTextApi).toHaveBeenCalledOnce()
  })

  it('缺少穿搭或有效时间日程时不保存，重试可恢复', async () => {
    vi.mocked(callGeminiTextApi).mockResolvedValueOnce({ text: JSON.stringify({ outfit: '衬衫', schedule: '随便活动' }), content: { role: 'model', parts: [] } })
    expect(await ensureCharacterLifeSchedule(char, undefined, settings)).toBeNull()
    expect((await ensureCharacterLifeSchedule(char, undefined, settings))?.schedule).toBe(payload.schedule)
  })
})
