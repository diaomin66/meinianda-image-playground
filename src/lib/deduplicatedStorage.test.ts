import { describe, expect, it, vi } from 'vitest'
import { createDeduplicatedStorage } from './deduplicatedStorage'

describe('持久化去重', () => {
  it('相同对象不重复序列化，相同内容不重复写入，失败后允许重试', async () => {
    const storage = { getItem: () => null, removeItem: vi.fn(), setItem: vi.fn() }
    const adapter = createDeduplicatedStorage(() => storage)
    const value = { state: { prompt: 'cat' }, version: 3 }
    await adapter.setItem('state', value)
    for (let i = 0; i < 100; i++) await adapter.setItem('state', value)
    await adapter.setItem('state', { state: { prompt: 'cat' }, version: 3 })
    expect(storage.setItem).toHaveBeenCalledTimes(1)
    const changed = { state: { prompt: 'dog' }, version: 3 }
    storage.setItem.mockImplementationOnce(() => { throw new Error('quota') })
    expect(() => adapter.setItem('state', changed)).toThrow('quota')
    await adapter.setItem('state', changed)
    expect(storage.setItem).toHaveBeenCalledTimes(3)
  })
})
