import { afterEach, describe, expect, it, vi } from 'vitest'

describe('IndexedDB 事务提交', () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each(['complete', 'abort'] as const)('请求成功后等待事务 %s', async (outcome) => {
    vi.resetModules()
    const req = { result: 'image-id', onsuccess: null as null | (() => void), onerror: null }
    const tx = { objectStore: () => ({ put: () => req }), oncomplete: null as null | (() => void), onerror: null, onabort: null as null | (() => void), error: null }
    const open = { result: { transaction: () => tx }, onsuccess: null as null | (() => void) }
    vi.stubGlobal('indexedDB', { open: () => { queueMicrotask(() => open.onsuccess?.()); return open } })
    const { putImage } = await import('./db')
    const saved = vi.fn()
    const pending = putImage({ id: 'image-id', dataUrl: 'data:image/png;base64,AA==', source: 'upload', createdAt: 1 })
    void pending.then(saved, () => {})
    await Promise.resolve()
    await Promise.resolve()
    req.onsuccess?.()
    await Promise.resolve()
    expect(saved).not.toHaveBeenCalled()
    if (outcome === 'abort') {
      tx.onabort?.()
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    } else {
      tx.oncomplete?.()
      await expect(pending).resolves.toBe('image-id')
    }
  })
})
