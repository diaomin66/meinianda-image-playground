import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Character, CharacterConversation } from './types'
import { DEFAULT_PARAMS } from './types'
import { saveCharacters, useCharacterStore } from './characterStore'
import { putCharacterData } from './lib/db'
import { recordCharacterLog, useCharacterLogStore } from './lib/characterLogs'

vi.mock('./lib/db', () => ({ getCharacterData: vi.fn(), putCharacterData: vi.fn(async () => 'main') }))

const char: Character = { id: 'lin', name: '林夏', personality: '摄影师', appearance: '', opening: '你好。', referenceImageIds: ['face'], avatarImageId: 'avatar', autoImages: true, createdAt: 1, updatedAt: 1 }
const chats: CharacterConversation[] = [
  { id: 'old', characterId: char.id, title: '旧对话', messages: [], createdAt: 1, updatedAt: 2 },
  { id: 'latest', characterId: char.id, title: '最近对话', messages: [], createdAt: 1, updatedAt: 3 },
  { id: 'current', characterId: char.id, title: '当前对话', messages: [], createdAt: 1, updatedAt: 4 },
  { id: 'other', characterId: 'other-person', title: '另一人物的对话', messages: [], createdAt: 1, updatedAt: 5 },
]

beforeEach(async () => {
  await saveCharacters()
  useCharacterStore.setState({ loaded: false })
  useCharacterStore.setState({ loaded: true, characters: [char, { ...char, id: 'other-person', name: '小雨' }], conversations: structuredClone(chats), activeCharacterId: char.id, activeConversationId: 'current', storageError: null })
  vi.clearAllMocks()
  useCharacterLogStore.setState({ entries: [], storageError: null })
})

describe('删除人物历史对话', () => {
  it('批量删除可删除对话，跳过进行中的对话并清理对应日志', () => {
    for (const convo of chats) recordCharacterLog({ conversationId: convo.id, stage: 'chat', status: 'info', title: convo.title })
    useCharacterStore.setState({ conversations: [
      { ...chats[0], messages: [] },
      { ...chats[2], messages: [{ id: 'busy', role: 'assistant', content: '', imageIds: [], status: 'replying', createdAt: 1 }] },
      chats[3],
    ], activeCharacterId: char.id, activeConversationId: chats[0].id })
    expect(useCharacterStore.getState().deleteConversations(['old', 'current', 'other'])).toBe(2)
    expect(useCharacterStore.getState().conversations.map((item) => item.id)).toEqual(['current'])
    expect(useCharacterStore.getState().activeConversationId).toBe('current')
    expect(useCharacterLogStore.getState().entries.map((entry) => entry.conversationId)).toEqual(['latest', 'current'])
  })

  it('删除对话与人物同步删除对应日志，不影响其他人物的记录', () => {
    for (const convo of chats) recordCharacterLog({ conversationId: convo.id, stage: 'chat', status: 'info', title: '用户发送消息', details: convo.title })
    useCharacterStore.getState().deleteConversation('old')
    expect(useCharacterLogStore.getState().entries.map((entry) => entry.conversationId)).toEqual(['latest', 'current', 'other'])
    useCharacterStore.getState().deleteCharacter(char.id)
    expect(useCharacterLogStore.getState().entries.map((entry) => entry.conversationId)).toEqual(['other'])
  })
  it('删除非当前对话不切换界面，自动保存后不再包含已删除记录', async () => {
    expect(useCharacterStore.getState().deleteConversation('old')).toBe(true)
    expect(useCharacterStore.getState().activeConversationId).toBe('current')
    await vi.waitFor(() => expect(putCharacterData).toHaveBeenCalled())
    const data = vi.mocked(putCharacterData).mock.calls.slice(-1)[0][0]
    expect(data.conversations.map((convo) => convo.id)).toEqual(['latest', 'current', 'other'])
    expect(data.characters[0]).toEqual(char)
  })

  it('删除当前对话切换到同一人物最近对话，不跳转到其他人物', () => {
    expect(useCharacterStore.getState().deleteConversation('current')).toBe(true)
    expect(useCharacterStore.getState().activeConversationId).toBe('latest')
    expect(useCharacterStore.getState().activeCharacterId).toBe(char.id)
    expect(useCharacterStore.getState().conversations.some((convo) => convo.id === 'other')).toBe(true)
  })

  it('删除最后一段对话后开启新对话，保留人格、头像、参考图及开场白', async () => {
    useCharacterStore.setState({ conversations: [chats[2], chats[3]] })
    expect(useCharacterStore.getState().deleteConversation('current')).toBe(true)
    const state = useCharacterStore.getState()
    const current = state.conversations.find((convo) => convo.id === state.activeConversationId)!
    expect(current.id).not.toBe('current')
    expect(current).toMatchObject({ characterId: char.id, title: '新对话', messages: [{ content: char.opening, status: 'done' }] })
    expect(state.characters[0]).toEqual(char)
    await saveCharacters()
    expect(vi.mocked(putCharacterData).mock.calls.slice(-1)[0][0].conversations.map((convo) => convo.id)).toEqual(['other', current.id])
  })

  it.each(['replying', 'imaging'] as const)('正在 %s 的对话禁止删除，其他历史对话仍可删除', (status) => {
    useCharacterStore.setState({ conversations: [{ ...chats[2], messages: [{ id: 'busy', role: 'assistant', content: '', imageIds: [], status, createdAt: 1 }] }, chats[0]] })
    expect(useCharacterStore.getState().deleteConversation('current')).toBe(false)
    expect(useCharacterStore.getState().activeConversationId).toBe('current')
    expect(useCharacterStore.getState().deleteConversation('old')).toBe(true)
  })

  it.each(['queued', 'optimizing', 'generating'] as const)('后台任务 %s 时禁止删除，任务结束后可删除', (status) => {
    const msg = { id: 'job-msg', role: 'assistant' as const, content: '已接单', imageIds: [], status: 'done' as const, createdAt: 1, imageJobs: [{ id: 'job', callKey: 'call', status, notification: 'done' as const, createdAt: 1, request: { profileId: 'fixed-images', model: 'gpt-image-2', prompt: '照片', referenceIds: [], maskImageId: null, params: DEFAULT_PARAMS }, items: [] }] }
    useCharacterStore.setState({ conversations: [{ ...chats[2], messages: [msg] }] })
    expect(useCharacterStore.getState().deleteConversation('current')).toBe(false)
    useCharacterStore.getState().updateMessage('current', msg.id, { imageJobs: [{ ...msg.imageJobs[0], status: 'cancelled' }] })
    expect(useCharacterStore.getState().deleteConversation('current')).toBe(true)
  })

  it('重复删除或不存在的对话不影响当前状态', () => {
    useCharacterStore.getState().deleteConversation('old')
    const state = useCharacterStore.getState()
    expect(state.deleteConversation('old')).toBe(false)
    expect(state.deleteConversation('missing')).toBe(false)
    expect(useCharacterStore.getState()).toBe(state)
  })
})
