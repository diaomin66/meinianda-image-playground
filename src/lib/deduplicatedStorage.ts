import type { PersistStorage, StateStorage, StorageValue } from 'zustand/middleware'

export function createDeduplicatedStorage<T>(getStorage: () => StateStorage): PersistStorage<T> {
  let storage: StateStorage | undefined
  try { storage = getStorage() } catch { /* SSR 或浏览器禁用本地存储时保持内存可用 */ }
  let previous: StorageValue<T> | undefined
  let serialized: string | null = null
  return {
    getItem: (name) => {
      const parse = (value: string | null) => {
        serialized = value
        return value ? JSON.parse(value) : null
      }
      const value = storage?.getItem(name) ?? null
      return value instanceof Promise ? value.then(parse) : parse(value)
    },
    setItem: (name, value) => {
      if (previous?.state === value.state && previous?.version === value.version) return
      const json = JSON.stringify(value)
      if (json === serialized) {
        previous = value
        return
      }
      const result = storage?.setItem(name, json)
      if (result instanceof Promise) {
        return result.then(() => { previous = value; serialized = json })
      }
      previous = value
      serialized = json
    },
    removeItem: (name) => {
      previous = undefined
      serialized = null
      return storage?.removeItem(name)
    },
  }
}
