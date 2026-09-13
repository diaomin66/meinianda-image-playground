import { describe, expect, it } from 'vitest'
import type { Character, CharacterData } from '../types'
import { getCharacterImageIds, mergeCharacterData, normalizeCharacterData } from './characterState'
import { DEFAULT_PARAMS } from '../types'
import { hasActiveDataOperations } from './dataOperations'
import { normalizeSettings } from './apiProfiles'

const char: Character = {
  id: 'lin',
  name: '林夏',
  personality: '摄影师',
  appearance: '',
  opening: '',
  referenceImageIds: ['face'],
  autoImages: true,
  createdAt: 1,
  updatedAt: 2,
}

describe('人物持久化', () => {
  it('后台任务刷新后标记中断，保留已完成图片、输入及方案，纳入备份与回收保护', () => {
    const source = { characters: [char], conversations: [{ id: 'chat', characterId: char.id, messages: [{ id: 'job-msg', status: 'done', imageIds: [], imageJobs: [{ id: 'job', callKey: 'call', status: 'generating', notification: 'pending', createdAt: 1, request: { profileId: 'fixed-images', model: 'gpt-image-2', prompt: '自拍', mode: 'selfie', referenceIds: ['identity', 'cat'], referenceRoles: ['identity', 'object'], maskImageId: null, params: { ...DEFAULT_PARAMS, n: 2 } }, items: [{ prompt: '第一张完整方案', status: 'completed', optimizerStatus: 'optimized', imageIds: ['done-image'] }, { prompt: '第二张完整方案', status: 'running', optimizerStatus: 'fallback', optimizerNote: '副脑请求超时', imageIds: [] }] }] }] }] }
    const data = normalizeCharacterData(source)
    const job = data.conversations[0].messages[0].imageJobs![0]
    expect(job.status).toBe('interrupted')
    expect(job.notification).toBe('failed')
    expect(job.items.map((item) => item.status)).toEqual(['completed', 'interrupted'])
    expect(job.items.map((item) => item.optimizerStatus)).toEqual(['optimized', 'fallback'])
    expect(job.items[1].optimizerNote).toBe('副脑请求超时')
    expect([...getCharacterImageIds(data)]).toEqual(['face', 'identity', 'cat', 'done-image'])
    expect(mergeCharacterData({ characters: [], conversations: [] }, JSON.parse(JSON.stringify(data))).conversations[0].messages[0].imageJobs).toEqual([job])
    expect(hasActiveDataOperations([], [], data.conversations)).toBe(false)
    job.status = 'generating'
    expect(hasActiveDataOperations([], [], data.conversations)).toBe(true)
    expect(normalizeSettings({ characterImageBackground: false, characterImageOptimizer: { enabled: false, model: 'model', profileId: null, style: 'custom', customPrompt: '水彩', timeout: 30 } })).toMatchObject({ characterImageBackground: false, characterImageOptimizer: { enabled: false, customPrompt: '水彩', timeout: 30 } })
  })
  it('头像单独保存并参与图片回收保护，旧人物不会把参考图当头像', () => {
    const data = normalizeCharacterData({ characters: [{ ...char, avatarImageId: 'avatar' }], conversations: [] })
    expect(data.characters[0].avatarImageId).toBe('avatar')
    expect(data.characters[0].referenceImageIds).toEqual(['face'])
    expect([...getCharacterImageIds(data)]).toEqual(['avatar', 'face'])
    const imported = mergeCharacterData({ characters: [], conversations: [] }, JSON.parse(JSON.stringify(data)))
    expect(imported.characters[0]).toEqual(data.characters[0])
    expect(normalizeCharacterData({ characters: [char] }).characters[0].avatarImageId).toBeUndefined()
    expect(normalizeCharacterData({ characters: [{ ...char, avatarImageId: 42 }] }).characters[0].avatarImageId).toBeUndefined()
    expect([...getCharacterImageIds({ ...data, characters: [{ ...data.characters[0], referenceImageIds: [] }] })]).toEqual(['avatar'])
  })
  it('清洗无效外部数据，将中断的生成恢复为可重试状态', () => {
    const data = normalizeCharacterData({
      characters: [null, { ...char, referenceImageIds: ['face', 'face', 1] }],
      conversations: [
        {
          id: 'chat',
          characterId: 'lin',
          messages: [
            {
              id: 'image',
              role: 'assistant',
              status: 'imaging',
              imagePrompt: '在河边',
              imageReferenceIds: ['face'],
              content: '给你看看。',
            },
          ],
        },
        { id: 'orphan', characterId: 'missing' },
      ],
    })
    expect(data.characters).toEqual([char])
    expect(data.conversations).toHaveLength(1)
    expect(data.conversations[0].messages[0]).toMatchObject({
      status: 'error',
      imagePrompt: '在河边',
      imageReferenceIds: ['face'],
      content: '给你看看。',
    })
    expect(normalizeCharacterData(null)).toEqual({ characters: [], conversations: [] })
  })

  it('图片回收同时保护人物形象、聊天图片和待重试的参考图', () => {
    const data = normalizeCharacterData({
      characters: [char],
      conversations: [
        {
          id: 'chat',
          characterId: char.id,
          messages: [
            { id: 'user', role: 'user', imageIds: ['clothes'] },
            { id: 'assistant', role: 'assistant', imageIds: ['generated'], imageReferenceIds: ['previous'] },
          ],
        },
      ],
    })
    expect([...getCharacterImageIds(data)]).toEqual(['face', 'clothes', 'generated', 'previous'])
  })

  it('导入旧备份不覆盖更新的人物，重复导入不增加副本', () => {
    const current: CharacterData = { characters: [char], conversations: [] }
    const imported = { characters: [{ ...char, name: '旧名字', updatedAt: 1 }], conversations: [] }
    const merged = mergeCharacterData(current, imported)
    expect(merged.characters).toEqual([char])
    expect(mergeCharacterData(merged, imported)).toEqual(merged)
    expect(mergeCharacterData(current, { characters: [{ ...char, name: '新名字', updatedAt: 3 }] }).characters[0].name).toBe('新名字')
  })
})
