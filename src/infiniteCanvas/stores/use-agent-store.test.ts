import { beforeEach, describe, expect, it, vi } from 'vitest'

const storage = vi.hoisted(() => ({
  readDirectAgentConversations: vi.fn(),
  saveDirectAgentConversations: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@canvas/services/agent-chat-storage', () => ({
  readDirectAgentConversations: storage.readDirectAgentConversations,
  saveDirectAgentConversations: storage.saveDirectAgentConversations,
}))

import { useAgentStore, type DirectAgentConversation } from './use-agent-store'

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
})
