import { describe, expect, it, vi } from 'vitest'
import worker from '../../public/sw.js?raw'
import { version } from '../../package.json'

describe('Service Worker 缓存隔离', () => {
  it('激活只删除旧应用壳，保留业务图片和其他缓存', async () => {
    const handlers = new Map<string, (event: { waitUntil: (promise: Promise<unknown>) => void }) => void>()
    const keys = ['meinianda-image-playground-v0.8.0', 'meinianda-image-playground-v0.8.1', `meinianda-image-playground-v${version}`, 'infinite-canvas-image-files-v1', 'another-app']
    const caches = { keys: async () => keys, delete: vi.fn(async () => true) }
    const self = { registration: { scope: 'https://example.com/' }, addEventListener: (type: string, handler: (event: { waitUntil: (promise: Promise<unknown>) => void }) => void) => handlers.set(type, handler), clients: { claim: vi.fn() } }
    new Function('self', 'caches', worker)(self, caches)
    let completed = Promise.resolve<unknown>(undefined)
    handlers.get('activate')!({ waitUntil: (promise) => { completed = promise } })
    await completed
    expect(caches.delete.mock.calls).toEqual([['meinianda-image-playground-v0.8.0'], ['meinianda-image-playground-v0.8.1']])
  })
})
