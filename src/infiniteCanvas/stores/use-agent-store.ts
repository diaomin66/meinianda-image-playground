import { create } from 'zustand'

import type { CanvasAgentOp, CanvasAgentSnapshot } from '@canvas/lib/canvas/canvas-agent-ops'
import { randomId } from '@canvas/lib/utils'
import { readDirectAgentConversations, saveDirectAgentConversations } from '@canvas/services/agent-chat-storage'
import type { ReasoningEffort } from '../../types'

export type AgentChatRole = 'user' | 'assistant' | 'system' | 'tool' | 'error'
export type AgentAttachment = { id: string; name: string; type: string; size: number; width: number; height: number; url: string; dataUrl: string }
export type AgentChatItem = { id: string; role: AgentChatRole; title?: string; text: string; attachments?: AgentAttachment[]; streamId?: string }
export type AgentCanvasContext = { snapshot: CanvasAgentSnapshot; applyOps: (ops?: CanvasAgentOp[]) => CanvasAgentSnapshot; undoOps: () => CanvasAgentSnapshot | null; canUndo: boolean }
export type DirectAgentConversation = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  prompt: string
  model?: string
  reasoningEffort?: ReasoningEffort
  attachments: AgentAttachment[]
  sending: boolean
  activity: string
  messages: AgentChatItem[]
}

type AgentStore = {
  width: number
  panelOpen: boolean
  panelMounted: boolean
  panelClosing: boolean
  panelProjectId: string | null
  canvasContext: AgentCanvasContext | null
  connected: boolean
  enabled: boolean
  activity: string
  directConversations: DirectAgentConversation[]
  activeDirectConversationId: string | null
  openDirectConversationIds: string[]
  focusedDirectConversationId: string | null
  directConversationsLoading: boolean
  directConversationsLoaded: boolean
  setAgentState: (patch: Partial<Pick<AgentStore, 'width' | 'connected' | 'enabled' | 'activity'>>) => void
  setPanelProjectId: (id: string | null) => void
  openPanel: (conversationId?: string) => void
  closePanel: () => void
  togglePanel: () => void
  setCanvasContext: (context: AgentCanvasContext | null) => void
  loadDirectConversations: () => Promise<void>
  createDirectConversation: () => string
  setActiveDirectConversation: (id: string) => void
  openDirectConversation: (id: string) => void
  closeDirectConversation: (id: string) => void
  focusDirectConversation: (id: string) => void
  updateDirectConversation: (id: string, patch: Partial<Omit<DirectAgentConversation, 'id' | 'createdAt' | 'updatedAt'>>) => void
  addDirectConversationMessage: (conversationId: string, item: AgentChatItem) => void
  replaceDirectConversationMessage: (conversationId: string, messageId: string, patch: Partial<Omit<AgentChatItem, 'id'>>) => void
  deleteDirectConversation: (id: string) => void
}

export const CANVAS_AGENT_PANEL_MOTION_MS = 500

function createDirectAgentConversation(): DirectAgentConversation {
  const now = Date.now()
  return {
    id: randomId(),
    title: '新对话',
    createdAt: now,
    updatedAt: now,
    prompt: '',
    attachments: [],
    sending: false,
    activity: '就绪',
    messages: [],
  }
}

function persistDirectConversations(conversations: DirectAgentConversation[]) {
  void saveDirectAgentConversations(conversations).catch((error) => console.warn('保存画布 Agent 对话失败', error))
}

function directConversationTitle(text: string) {
  const title = text.replace(/\s+/g, ' ').trim()
  return title ? title.slice(0, 28) : '新对话'
}

export const useAgentStore = create<AgentStore>((set, get) => ({
  width: typeof window === 'undefined' ? 440 : Number(localStorage.getItem('canvas-agent-panel-width')) || 440,
  panelOpen: false,
  panelMounted: true,
  panelClosing: false,
  panelProjectId: null,
  canvasContext: null,
  connected: false,
  enabled: false,
  activity: '就绪',
  directConversations: [],
  activeDirectConversationId: null,
  openDirectConversationIds: [],
  focusedDirectConversationId: null,
  directConversationsLoading: false,
  directConversationsLoaded: false,
  setAgentState: (patch) => set(patch),
  setPanelProjectId: (panelProjectId) => set({ panelProjectId }),
  openPanel: (conversationId) => {
    const state = get()
    const targetId = conversationId && state.directConversations.some((conversation) => conversation.id === conversationId)
      ? conversationId
      : state.focusedDirectConversationId && state.directConversations.some((conversation) => conversation.id === state.focusedDirectConversationId)
        ? state.focusedDirectConversationId
        : state.activeDirectConversationId && state.directConversations.some((conversation) => conversation.id === state.activeDirectConversationId)
          ? state.activeDirectConversationId
          : state.directConversations[0]?.id ?? null
    const openDirectConversationIds = targetId && !state.openDirectConversationIds.includes(targetId)
      ? [...state.openDirectConversationIds, targetId]
      : state.openDirectConversationIds
    set({
      panelOpen: true,
      panelMounted: true,
      panelClosing: false,
      openDirectConversationIds,
      focusedDirectConversationId: targetId,
      activeDirectConversationId: targetId ?? state.activeDirectConversationId,
    })
  },
  closePanel: () => {
    if (!get().panelMounted || get().panelClosing) return
    set({ panelOpen: false, panelClosing: true })
    setTimeout(() => {
      if (get().panelClosing) set({ panelClosing: false })
    }, CANVAS_AGENT_PANEL_MOTION_MS)
  },
  togglePanel: () => (get().panelOpen ? get().closePanel() : get().openPanel()),
  setCanvasContext: (canvasContext) => set({ canvasContext }),
  loadDirectConversations: async () => {
    if (get().directConversationsLoaded || get().directConversationsLoading) return
    set({ directConversationsLoading: true })
    try {
      const saved = await readDirectAgentConversations()
      const conversations = saved.length ? saved : [createDirectAgentConversation()]
      const currentOpenIds = get().openDirectConversationIds.filter((id) => conversations.some((conversation) => conversation.id === id))
      const activeDirectConversationId = get().activeDirectConversationId && conversations.some((conversation) => conversation.id === get().activeDirectConversationId)
        ? get().activeDirectConversationId
        : conversations[0].id
      const openDirectConversationIds = currentOpenIds.length
        ? currentOpenIds
        : get().panelOpen
          ? activeDirectConversationId ? [activeDirectConversationId] : []
          : []
      set({
        directConversations: conversations,
        activeDirectConversationId,
        openDirectConversationIds,
        focusedDirectConversationId: openDirectConversationIds.includes(get().focusedDirectConversationId || '')
          ? get().focusedDirectConversationId
          : openDirectConversationIds[openDirectConversationIds.length - 1] ?? null,
        directConversationsLoading: false,
        directConversationsLoaded: true,
      })
      if (!saved.length) persistDirectConversations(conversations)
    } catch (error) {
      console.warn('读取画布 Agent 对话失败', error)
      const conversation = createDirectAgentConversation()
      set({
        directConversations: [conversation],
        activeDirectConversationId: conversation.id,
        openDirectConversationIds: get().panelOpen ? [conversation.id] : [],
        focusedDirectConversationId: get().panelOpen ? conversation.id : null,
        directConversationsLoading: false,
        directConversationsLoaded: true,
      })
    }
  },
  createDirectConversation: () => {
    const conversation = createDirectAgentConversation()
    const conversations = [...get().directConversations, conversation]
    set({
      directConversations: conversations,
      activeDirectConversationId: conversation.id,
      openDirectConversationIds: [...get().openDirectConversationIds, conversation.id],
      focusedDirectConversationId: conversation.id,
      panelOpen: true,
      panelMounted: true,
      panelClosing: false,
    })
    persistDirectConversations(conversations)
    return conversation.id
  },
  setActiveDirectConversation: (id) => get().openDirectConversation(id),
  openDirectConversation: (id) => {
    if (!get().directConversations.some((conversation) => conversation.id === id)) return
    set({
      activeDirectConversationId: id,
      openDirectConversationIds: get().openDirectConversationIds.includes(id)
        ? get().openDirectConversationIds
        : [...get().openDirectConversationIds, id],
      focusedDirectConversationId: id,
      panelOpen: true,
      panelMounted: true,
      panelClosing: false,
    })
  },
  closeDirectConversation: (id) => {
    const openDirectConversationIds = get().openDirectConversationIds.filter((conversationId) => conversationId !== id)
    const focusedDirectConversationId = get().focusedDirectConversationId === id
      ? openDirectConversationIds[openDirectConversationIds.length - 1] ?? null
      : get().focusedDirectConversationId
    set({
      openDirectConversationIds,
      focusedDirectConversationId,
      activeDirectConversationId: focusedDirectConversationId ?? get().activeDirectConversationId,
    })
    if (!openDirectConversationIds.length) get().closePanel()
  },
  focusDirectConversation: (id) => {
    if (!get().openDirectConversationIds.includes(id)) return
    set({ focusedDirectConversationId: id, activeDirectConversationId: id })
  },
  updateDirectConversation: (id, patch) => {
    if (!get().directConversations.some((conversation) => conversation.id === id)) return
    const now = Date.now()
    const conversations = get().directConversations.map((conversation) => conversation.id === id
      ? { ...conversation, ...patch, updatedAt: now }
      : conversation,
    )
    set({ directConversations: conversations })
    persistDirectConversations(conversations)
  },
  addDirectConversationMessage: (conversationId, item) => {
    if (!get().directConversations.some((conversation) => conversation.id === conversationId)) return
    const now = Date.now()
    const conversations = get().directConversations.map((conversation) => {
      if (conversation.id !== conversationId) return conversation
      const title = !conversation.messages.some((message) => message.role === 'user') && item.role === 'user'
        ? directConversationTitle(item.text)
        : conversation.title
      return { ...conversation, title, messages: [...conversation.messages, item], updatedAt: now }
    })
    set({ directConversations: conversations })
    persistDirectConversations(conversations)
  },
  replaceDirectConversationMessage: (conversationId, messageId, patch) => {
    if (!get().directConversations.some((conversation) => conversation.id === conversationId)) return
    const now = Date.now()
    const conversations = get().directConversations.map((conversation) => conversation.id === conversationId
      ? {
          ...conversation,
          messages: conversation.messages.map((message) => message.id === messageId ? { ...message, ...patch } : message),
          updatedAt: now,
        }
      : conversation,
    )
    set({ directConversations: conversations })
    persistDirectConversations(conversations)
  },
  deleteDirectConversation: (id) => {
    const current = get().directConversations
    if (!current.some((conversation) => conversation.id === id)) return
    const conversations = current.filter((conversation) => conversation.id !== id)
    const remaining = conversations.length ? conversations : [createDirectAgentConversation()]
    const activeDirectConversationId = get().activeDirectConversationId === id
      ? remaining[0].id
      : get().activeDirectConversationId
    const openDirectConversationIds = get().openDirectConversationIds.filter((conversationId) => conversationId !== id)
    const nextOpenIds = openDirectConversationIds.length ? openDirectConversationIds : [activeDirectConversationId || remaining[0].id]
    const focusedDirectConversationId = get().focusedDirectConversationId === id
      ? nextOpenIds[nextOpenIds.length - 1]
      : get().focusedDirectConversationId
    set({
      directConversations: remaining,
      activeDirectConversationId,
      openDirectConversationIds: nextOpenIds,
      focusedDirectConversationId,
    })
    persistDirectConversations(remaining)
  },
}))
