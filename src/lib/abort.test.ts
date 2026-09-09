import { describe, expect, it, vi } from 'vitest'
import { abortableDelay, forwardAbort } from './abort'

describe('请求取消', () => {
  it('转发取消原因，完成后移除监听', () => {
    const source = new AbortController()
    const target = new AbortController()
    const remove = vi.spyOn(source.signal, 'removeEventListener')
    const detach = forwardAbort(source.signal, target)
    source.abort(new DOMException('用户停止', 'AbortError'))
    expect(target.signal.aborted).toBe(true)
    expect(target.signal.reason).toBe(source.signal.reason)
    detach()
    expect(remove).toHaveBeenCalled()
  })
  it('提前取消和轮询等待均可立即终止', async () => {
    const source = new AbortController()
    const wait = abortableDelay(60_000, source.signal)
    source.abort()
    await expect(wait).rejects.toMatchObject({ name: 'AbortError' })
    const target = new AbortController()
    forwardAbort(source.signal, target)()
    expect(target.signal.aborted).toBe(true)
  })
})
