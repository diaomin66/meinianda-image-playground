import { beforeEach, describe, expect, it, vi } from 'vitest'

const storage = vi.hoisted(() => ({
  readDirectAgentConversations: vi.fn(),
  saveDirectAgentConversations: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@canvas/services/agent-chat-storage', () => ({
  readDirectAgentConversations: storage.readDirectAgentConversations,
  saveDirectAgentConversations: storage.saveDirectAgentConversations,
}))

import { CANVAS_AGENT_PANEL_MOTION_MS, useAgentStore, type DirectAgentConversation } from './use-agent-store'

function conversation(id: string, updatedAt: number): DirectAgentConversation {
  return {
    id,
    title: id,
    createdAt: updatedAt,
    updatedAt,
    prompt: '',
    attachments: [],
    sending: false,
    activity: '就绪',
    messages: [],
  }
}

describe('canvas Agent window state', () => {
  it('快速重复开关时保留本次完整退出时间', () => {
    vi.useFakeTimers()
    try {
      useAgentStore.getState().openPanel()
      useAgentStore.getState().closePanel()
      vi.advanceTimersByTime(100)
      useAgentStore.getState().openPanel()
      useAgentStore.getState().closePanel()
      vi.advanceTimersByTime(CANVAS_AGENT_PANEL_MOTION_MS - 100)
      expect(useAgentStore.getState().panelClosing).toBe(true)
      vi.advanceTimersByTime(100)
      expect(useAgentStore.getState().panelClosing).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  beforeEach(() => {
    storage.readDirectAgentConversations.mockReset()
    storage.saveDirectAgentConversations.mockClear()
    useAgentStore.setState({
      panelOpen: false,
      panelClosing: false,
      panelProjectId: null,
      directConversations: [],
      activeDirectConversationId: null,
      openDirectConversationIds: [],
      focusedDirectConversationId: null,
      directConversationsLoading: false,
      directConversationsLoaded: false,
    })
  })

  it('opens and focuses multiple conversations without replacing existing windows', () => {
    useAgentStore.setState({
      directConversations: [conversation('a', 1), conversation('b', 2)],
      directConversationsLoaded: true,
    })

    useAgentStore.getState().openDirectConversation('a')
    useAgentStore.getState().openDirectConversation('b')

    expect(useAgentStore.getState()).toMatchObject({
      panelOpen: true,
      activeDirectConversationId: 'b',
      focusedDirectConversationId: 'b',
      openDirectConversationIds: ['a', 'b'],
    })
  })

  it('keeps another window focused when one conversation is closed', () => {
    useAgentStore.setState({
      panelOpen: true,
      directConversations: [conversation('a', 1), conversation('b', 2)],
      activeDirectConversationId: 'b',
      focusedDirectConversationId: 'b',
      openDirectConversationIds: ['a', 'b'],
      directConversationsLoaded: true,
    })

    useAgentStore.getState().closeDirectConversation('b')

    expect(useAgentStore.getState()).toMatchObject({
      panelOpen: true,
      activeDirectConversationId: 'a',
      focusedDirectConversationId: 'a',
      openDirectConversationIds: ['a'],
    })
  })

  it('opens the restored conversation when the panel was requested before history loaded', async () => {
    storage.readDirectAgentConversations.mockResolvedValue([conversation('saved', 1)])
    useAgentStore.getState().openPanel()

    await useAgentStore.getState().loadDirectConversations()

    expect(useAgentStore.getState()).toMatchObject({
      panelOpen: true,
      activeDirectConversationId: 'saved',
      focusedDirectConversationId: 'saved',
      openDirectConversationIds: ['saved'],
      directConversationsLoading: false,
      directConversationsLoaded: true,
    })
  })

  it('旧加载完成时不会覆盖导入已经载入的会话', async () => {
    let finish!: () => void
    storage.readDirectAgentConversations.mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve([]) }))
    const loading = useAgentStore.getState().loadDirectConversations()
    const imported = conversation('imported', 1)
    useAgentStore.setState({ directConversations: [imported], directConversationsLoaded: true, directConversationsLoading: false })
    finish()
    await loading
    expect(useAgentStore.getState().directConversations).toEqual([imported])
    expect(useAgentStore.getState().directConversationsLoading).toBe(false)
  })
})
