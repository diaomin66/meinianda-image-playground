import { describe, expect, it } from 'vitest'
import { preserveConcurrentChanges } from './syncMerge'

describe('同步并发修改', () => {
  it('保留同步期间新增、编辑和删除，同时接收未修改项目的远端更新', () => {
    const before = [{ id: 'edit', title: 'old' }, { id: 'delete', title: 'old' }, { id: 'keep', title: 'old' }]
    const current = [{ id: 'new', title: 'new' }, { id: 'edit', title: 'local' }, before[2]]
    const remote = before.map((item) => ({ ...item, title: 'remote' }))
    expect(preserveConcurrentChanges(before, current, remote)).toEqual([current[0], current[1], remote[2]])
  })
})
