import type { ApiProfile, AppSettings, Character, CharacterConversation, CharacterLifeSchedule, GeminiContent } from '../types'
import { DEFAULT_PARAMS } from '../types'
import { callAgentResponsesApi } from './agentApi'
import { getAgentTextApiProfile } from './apiProfiles'
import { callGeminiTextApi } from './geminiTextApi'

const generating = new Map<string, Promise<CharacterLifeSchedule | null>>()

function toBusinessDate(now: Date, scheduleTime: string) {
  const match = scheduleTime.match(/^([01]?\d|2[0-3]):([0-5]\d)$/)
  const boundary = new Date(now)
  boundary.setHours(match ? Number(match[1]) : 7, match ? Number(match[2]) : 0, 0, 0)
  if (now < boundary) boundary.setDate(boundary.getDate() - 1)
  return boundary
}

function dateLabel(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function weekday(date: Date) {
  return ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][date.getDay()]
}

function currentActivity(schedule: string, now = new Date()) {
  const entries = String(schedule || '').split(/\n+/).flatMap((line) => {
    const match = line.match(/(?:^|[^\d])([01]?\d|2[0-3])[:：]([0-5]?\d)\s*(.+)$/)
    return match ? [{ minute: Number(match[1]) * 60 + Number(match[2]), text: `${match[1].padStart(2, '0')}:${match[2].padStart(2, '0')} ${match[3].trim()}` }] : []
  }).sort((a, b) => a.minute - b.minute)
  if (!entries.length) return ''
  const minute = now.getHours() * 60 + now.getMinutes()
  let current = entries[entries.length - 1]
  for (const item of entries) {
    if (item.minute > minute) break
    current = item
  }
  return current.text
}

function extractObject(text: string) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const value = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>
    return value
  } catch {
    return null
  }
}

function buildPrompt(character: Character, conversation: CharacterConversation | undefined, date: Date, extra: string) {
  const history = (character.lifeScheduleHistory ?? []).slice(-7).map((item) => `[${item.date}] 穿搭：${item.outfit}；日程：${item.schedule}`).join('\n') || '无历史日程'
  const recent = (conversation?.messages ?? []).slice(-10).map((message) => `${message.role === 'user' ? '用户' : character.name}：${message.content}`).filter(Boolean).join('\n') || '无近期对话'
  return [
    '请为这个人物安排今天的生活状态。',
    `日期：${dateLabel(date)} ${weekday(date)}`,
    `人物名字：${character.name}`,
    `外貌参考：${character.appearance || '无'}`,
    `避免重复的历史日程：\n${history}`,
    `近期对话参考：\n${recent}`,
    extra.trim() && character.lifeSchedule ? `本次需要改写的日程：\n${character.lifeSchedule.outfit}\n${character.lifeSchedule.schedule}` : '',
    extra.trim() ? `用户补充要求（优先遵循）：${extra.trim()}` : '',
    '请返回 JSON 对象，不要 Markdown：{"outfit_style":"简短风格","outfit":"今天的穿搭","schedule":"按 HH:MM 开头的多段日程"}',
  ].filter(Boolean).join('\n\n')
}

async function requestSchedule(profile: ApiProfile, character: Character, prompt: string, settings: AppSettings, signal?: AbortSignal) {
  if (profile.provider === 'gemini') {
    const contents: GeminiContent[] = [{ role: 'user', parts: [{ text: prompt }] }]
    const result = await callGeminiTextApi({ profile, instructions: character.personality, contents, tools: [], responseMimeType: 'application/json', signal })
    return result.text
  }
  const result = await callAgentResponsesApi({
    settings,
    profile,
    params: DEFAULT_PARAMS,
    input: [{ role: 'user', content: prompt }],
    instructions: character.personality,
    tools: [],
    signal,
  })
  return result.text
}

export function getCharacterLifeDate(character: Character, now = new Date()) {
  return dateLabel(toBusinessDate(now, character.lifeScheduleTime || '07:00'))
}

export function getCharacterLifeContext(character: Character, now = new Date()) {
  if (character.lifeSchedulerEnabled !== true || !character.lifeSchedule) return ''
  const lifeDate = getCharacterLifeDate(character, now)
  if (character.lifeSchedule.date !== lifeDate) return ''
  const activity = currentActivity(character.lifeSchedule.schedule, now) || '按今日日程自然活动'
  return `<character_state>\n日期: ${lifeDate}\n时间: ${weekday(now)} ${now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}\n当前状态: ${activity}\n穿着: ${character.lifeSchedule.outfit}\n今日日程: ${character.lifeSchedule.schedule}\n</character_state>\n<state_following_rules>\n当用户询问人物正在做什么、穿着、安排或所在场景时，以这份生活状态为准；无关时不要主动播报。</state_following_rules>`
}

export async function ensureCharacterLifeSchedule(character: Character, conversation: CharacterConversation | undefined, settings: AppSettings, extra = '', signal?: AbortSignal) {
  signal?.throwIfAborted()
  if (character.lifeSchedulerEnabled !== true) return null
  const lifeDate = getCharacterLifeDate(character)
  if (!extra.trim() && character.lifeSchedule?.date === lifeDate) return character.lifeSchedule
  const key = `${character.id}:${lifeDate}:${extra.trim()}`
  const existing = generating.get(key)
  if (existing) return existing
  const profile = settings.profiles.find((item) => item.id === settings.characterTextProfileId) ?? getAgentTextApiProfile(settings)
  if (!profile?.apiKey.trim()) return null
  const promise = (async () => {
    const date = toBusinessDate(new Date(), character.lifeScheduleTime || '07:00')
    const payload = extractObject(await requestSchedule(profile, character, buildPrompt(character, conversation, date, extra), settings, signal))
    signal?.throwIfAborted()
    if (!payload) return null
    const schedule: CharacterLifeSchedule = {
      date: lifeDate,
      outfitStyle: typeof payload.outfit_style === 'string' ? payload.outfit_style.trim() : '',
      outfit: typeof payload.outfit === 'string' ? payload.outfit.trim() : '',
      schedule: typeof payload.schedule === 'string' ? payload.schedule.trim() : '',
      generatedAt: Date.now(),
    }
    if (!schedule.outfit || !schedule.schedule || !currentActivity(schedule.schedule)) return null
    return schedule
  })()
  generating.set(key, promise)
  try {
    return await promise
  } finally {
    generating.delete(key)
  }
}

export function applyCharacterLifeSchedule(character: Character, schedule: CharacterLifeSchedule) {
  const history = character.lifeSchedule && character.lifeSchedule.date !== schedule.date
    ? [...(character.lifeScheduleHistory ?? []), character.lifeSchedule].slice(-7)
    : character.lifeScheduleHistory ?? []
  return { ...character, lifeSchedule: schedule, lifeScheduleHistory: history, updatedAt: Date.now() }
}
