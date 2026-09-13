import { create } from 'zustand'
import { nanoid } from 'nanoid'
import type { Character, CharacterData, CharacterMessage } from './types'
import { getCharacterData, putCharacterData } from './lib/db'
import { normalizeCharacterData } from './lib/characterState'
import { isCharacterImageJobActive } from './lib/characterImageJobState'
import { clearCharacterLogs } from './lib/characterLogs'

interface CharacterState extends CharacterData {
  loaded: boolean
  storageError: string | null
  activeCharacterId: string | null
  activeConversationId: string | null
  saveCharacter: (char: Character) => void
  selectCharacter: (id: string) => void
  newConversation: (id: string) => string
  deleteConversation: (id: string) => boolean
  deleteConversations: (ids: string[]) => number
  updateMessage: (conversationId: string, messageId: string, patch: Partial<CharacterMessage>) => void
  deleteCharacter: (id: string) => void
}

export const useCharacterStore = create<CharacterState>((set, get) => ({
  characters: [],
  conversations: [],
  loaded: false,
  storageError: null,
  activeCharacterId: null,
  activeConversationId: null,
  saveCharacter: (char) =>
    set((state) => ({
      characters: state.characters.some((item) => item.id === char.id)
        ? state.characters.map((item) => (item.id === char.id ? char : item))
        : [...state.characters, char],
    })),
  selectCharacter: (id) => {
    const convo = get()
      .conversations.filter((item) => item.characterId === id)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0]
    if (!convo) {
      get().newConversation(id)
      return
    }
    set({ activeCharacterId: id, activeConversationId: convo.id })
  },
  newConversation: (id) => {
    const char = get().characters.find((item) => item.id === id)
    if (!char) throw new Error('人物不存在')
    const now = Date.now()
    const conversationId = nanoid()
    set((state) => ({
      activeCharacterId: id,
      activeConversationId: conversationId,
      conversations: [
        ...state.conversations,
        {
          id: conversationId,
          characterId: id,
          title: '新对话',
          createdAt: now,
          updatedAt: now,
          messages: char.opening
            ? [{ id: nanoid(), role: 'assistant', content: char.opening, imageIds: [], status: 'done', createdAt: now }]
            : [],
        },
      ],
    }))
    return conversationId
  },
  deleteConversation: (id) => {
    const convo = get().conversations.find((item) => item.id === id)
    if (!convo || convo.messages.some((msg) => msg.status === 'replying' || msg.status === 'imaging' || msg.imageJobs?.some(isCharacterImageJobActive))) return false
    const active = get().activeConversationId === id
    clearCharacterLogs(id)
    set((state) => ({ conversations: state.conversations.filter((item) => item.id !== id) }))
    if (active) get().selectCharacter(convo.characterId)
    return true
  },
  deleteConversations: (ids) => {
    const requested = new Set(ids)
    const state = get()
    const deletable = state.conversations.filter((convo) => requested.has(convo.id) && !convo.messages.some((msg) => msg.status === 'replying' || msg.status === 'imaging' || msg.imageJobs?.some(isCharacterImageJobActive)))
    if (!deletable.length) return 0
    const deletedIds = new Set(deletable.map((convo) => convo.id))
    const activeConversation = deletable.find((convo) => convo.id === state.activeConversationId)
    deletable.forEach((convo) => clearCharacterLogs(convo.id))
    set((current) => ({ conversations: current.conversations.filter((convo) => !deletedIds.has(convo.id)) }))
    if (activeConversation) get().selectCharacter(activeConversation.characterId)
    return deletable.length
  },
  updateMessage: (conversationId, messageId, patch) =>
    set((state) => ({
      conversations: state.conversations.map((convo) =>
        convo.id === conversationId
          ? {
              ...convo,
              updatedAt: Date.now(),
              messages: convo.messages.map((msg) => (msg.id === messageId ? { ...msg, ...patch } : msg)),
            }
          : convo,
      ),
    })),
  deleteCharacter: (id) => {
    if (
      get().conversations.some(
        (convo) => convo.characterId === id && convo.messages.some((msg) => msg.status === 'replying' || msg.status === 'imaging' || msg.imageJobs?.some(isCharacterImageJobActive)),
      )
    )
      return
    get().conversations.filter((convo) => convo.characterId === id).forEach((convo) => clearCharacterLogs(convo.id))
    set((state) => ({
      characters: state.characters.filter((char) => char.id !== id),
      conversations: state.conversations.filter((convo) => convo.characterId !== id),
      ...(state.activeCharacterId === id ? { activeCharacterId: null, activeConversationId: null } : {}),
    }))
  },
}))

let loadPromise: Promise<void> | undefined
let savePromise = Promise.resolve()

export function loadCharacters() {
  if (useCharacterStore.getState().loaded) return Promise.resolve()
  if (loadPromise) return loadPromise
  loadPromise = getCharacterData()
    .then((data) => {
      useCharacterStore.setState({ ...normalizeCharacterData(data), loaded: true, storageError: null })
    })
    .catch((err) => {
      loadPromise = undefined
      console.error('人物数据加载失败', err)
      useCharacterStore.setState({ storageError: '人物数据加载失败，请重试。' })
      throw err
    })
  return loadPromise
}

export function saveCharacters() {
  const state = useCharacterStore.getState()
  const data = { characters: state.characters, conversations: state.conversations }
  // 串行写入，避免较早的聊天快照覆盖最新内容。
  savePromise = savePromise
    .catch(() => {})
    .then(async () => {
      await putCharacterData(data)
      if (useCharacterStore.getState().storageError) useCharacterStore.setState({ storageError: null })
    })
  return savePromise
}

useCharacterStore.subscribe((state, previous) => {
  if (!state.loaded || !previous.loaded) return
  if (state.characters === previous.characters && state.conversations === previous.conversations) return
  void saveCharacters().catch((err) => {
    console.error('人物数据保存失败', err)
    useCharacterStore.setState({ storageError: '人物数据尚未保存到本地，请重试保存。' })
  })
})
