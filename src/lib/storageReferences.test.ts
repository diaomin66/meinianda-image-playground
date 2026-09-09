import { describe, expect, it } from 'vitest'
import { collectStorageKeys } from './storageReferences'

describe('持久化媒体引用', () => {
  it('保留只存在于生成参考、会话和撤销历史中的资源', () => {
    const keys = collectStorageKeys({
      nodes: [{ metadata: { references: ['image:reference', 'video:clip', 'https://example.com/a.png'] } }],
      chatSessions: [{ images: [{ storageKey: 'image:chat' }] }],
      history: [[{ metadata: { storageKey: 'file:old' } }]],
      text: '普通文字',
    })
    expect([...keys].sort()).toEqual(['file:old', 'image:chat', 'image:reference', 'video:clip'])
  })
})
