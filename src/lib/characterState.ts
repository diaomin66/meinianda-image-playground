import type { Character, CharacterConversation, CharacterData, CharacterLifeSchedule, CharacterMessage, CharacterToolTurn, GeminiPart, ResponsesOutputItem } from '../types'
import { parseCharacterImageRequest } from './characterImageTool'
import { normalizeCharacterImageJobs } from './characterImageJobState'

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function string(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function ids(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string' && Boolean(id)))] : []
}

function timestamp(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : Date.now()
}

function lifeSchedule(value: unknown): CharacterLifeSchedule | undefined {
  const item = record(value)
  const date = string(item.date)
  const outfit = string(item.outfit)
  const schedule = string(item.schedule)
  if (!date || (!outfit && !schedule)) return undefined
  return { date, outfitStyle: string(item.outfitStyle), outfit, schedule, generatedAt: timestamp(item.generatedAt) }
}

export function normalizeCharacterData(value: unknown): CharacterData {
  const data = record(value)
  const characters: Character[] = (Array.isArray(data.characters) ? data.characters : [])
    .map((item) => {
      const char = record(item)
      const normalized: Character = {
        id: string(char.id),
        name: string(char.name).trim(),
        avatarImageId: string(char.avatarImageId) || undefined,
        personality: string(char.personality),
        appearance: string(char.appearance),
        opening: string(char.opening),
        referenceImageIds: ids(char.referenceImageIds),
        autoImages: char.autoImages !== false,
        createdAt: timestamp(char.createdAt),
        updatedAt: timestamp(char.updatedAt),
      }
      const life = lifeSchedule(char.lifeSchedule)
      const history = (Array.isArray(char.lifeScheduleHistory) ? char.lifeScheduleHistory : []).map(lifeSchedule).filter((item): item is CharacterLifeSchedule => Boolean(item)).slice(-7)
      if (typeof char.lifeSchedulerEnabled === 'boolean') normalized.lifeSchedulerEnabled = char.lifeSchedulerEnabled
      if (/^([01]?\d|2[0-3]):[0-5]\d$/.test(string(char.lifeScheduleTime))) normalized.lifeScheduleTime = string(char.lifeScheduleTime)
      if (life) normalized.lifeSchedule = life
      if (history.length) normalized.lifeScheduleHistory = history
      return normalized
    })
    .filter((char) => char.id && char.name)
  const conversations: CharacterConversation[] = (Array.isArray(data.conversations) ? data.conversations : [])
    .map((item) => {
      const convo = record(item)
      const messages: CharacterMessage[] = (Array.isArray(convo.messages) ? convo.messages : [])
        .map((item) => {
          const msg = record(item)
          const interrupted = msg.status === 'replying' || msg.status === 'imaging'
          let imageRequest: CharacterMessage['imageRequest']
          if (msg.imageRequest) {
            try {
              imageRequest = parseCharacterImageRequest(msg.imageRequest)
            } catch {
              // 老版本或损坏的参数不用于重试，仍保留聊天文本与图片。
            }
          }
          const toolTurns: CharacterToolTurn[] = (Array.isArray(msg.toolTurns) ? msg.toolTurns : []).flatMap((item) => {
            const turn = record(item)
            const content = record(turn.content)
            const outputItems = Array.isArray(turn.outputItems) ? turn.outputItems.filter((item) => typeof record(item).type === 'string') as ResponsesOutputItem[] : undefined
            const parts = Array.isArray(content.parts) ? content.parts.filter((part) => part && typeof part === 'object') as GeminiPart[] : undefined
            if (!outputItems && !parts) return []
            return [{
              outputItems,
              content: parts ? { role: 'model' as const, parts } : undefined,
              results: (Array.isArray(turn.results) ? turn.results : []).map((item) => {
                const result = record(item)
                return { callId: string(result.callId) || undefined, name: string(result.name), output: record(result.output), imageIds: ids(result.imageIds) }
              }),
            }]
          })
          return {
            id: string(msg.id),
            role: msg.role === 'user' ? ('user' as const) : ('assistant' as const),
            content: string(msg.content),
            imageIds: ids(msg.imageIds),
            status: interrupted || msg.status === 'error' ? ('error' as const) : ('done' as const),
            error: interrupted ? '上次生成已中断，可以重试。' : string(msg.error) || undefined,
            imagePrompt: string(msg.imagePrompt) || undefined,
            imageReferenceIds: ids(msg.imageReferenceIds),
            imageRequest,
            imageError: string(msg.imageError) || undefined,
            imageJobs: normalizeCharacterImageJobs(msg.imageJobs),
            imageNotificationIds: ids(msg.imageNotificationIds),
            toolTurns,
            textProfileId: string(msg.textProfileId) || undefined,
            textModel: string(msg.textModel) || undefined,
            createdAt: timestamp(msg.createdAt),
          }
        })
        .filter((msg) => msg.id)
      return {
        id: string(convo.id),
        characterId: string(convo.characterId),
        title: string(convo.title) || '新对话',
        messages,
        createdAt: timestamp(convo.createdAt),
        updatedAt: timestamp(convo.updatedAt),
      }
    })
    .filter((convo) => convo.id && characters.some((char) => char.id === convo.characterId))
  return { characters, conversations }
}

export function getCharacterImageIds(data: CharacterData) {
  return new Set([
    ...data.characters.flatMap((char) => [...(char.avatarImageId ? [char.avatarImageId] : []), ...char.referenceImageIds]),
    ...data.conversations.flatMap((convo) => convo.messages.flatMap((msg) => [
      ...msg.imageIds,
      ...(msg.imageReferenceIds ?? []),
      ...(msg.imageRequest?.referenceIds ?? []),
      ...(msg.imageRequest?.maskImageId ? [msg.imageRequest.maskImageId] : []),
      ...(msg.toolTurns ?? []).flatMap((turn) => turn.results.flatMap((result) => result.imageIds)),
      ...(msg.imageJobs ?? []).flatMap((job) => [...job.request.referenceIds, ...(job.request.maskImageId ? [job.request.maskImageId] : []), ...job.items.flatMap((item) => item.imageIds)]),
    ])),
  ])
}

export function mergeCharacterData(current: CharacterData, imported: unknown): CharacterData {
  const next = normalizeCharacterData(imported)
  const characters = new Map(current.characters.map((char) => [char.id, char]))
  const conversations = new Map(current.conversations.map((convo) => [convo.id, convo]))
  for (const char of next.characters) {
    if ((characters.get(char.id)?.updatedAt ?? -1) <= char.updatedAt) characters.set(char.id, char)
  }
  for (const convo of next.conversations) {
    if ((conversations.get(convo.id)?.updatedAt ?? -1) <= convo.updatedAt) conversations.set(convo.id, convo)
  }
  return { characters: [...characters.values()], conversations: [...conversations.values()] }
}
