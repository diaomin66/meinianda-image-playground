// 生成历史中的 references 使用字符串键，回收和导出必须与节点资源一起收集。
export function collectStorageKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (typeof value === 'string') {
    if (/^(image|video|audio|file|video-reference|audio-reference):.+/.test(value)) keys.add(value)
    return keys
  }
  if (!value || typeof value !== 'object') return keys
  if ('storageKey' in value && typeof value.storageKey === 'string' && value.storageKey.includes(':')) {
    keys.add(value.storageKey)
  }
  for (const item of Object.values(value)) collectStorageKeys(item, keys)
  return keys
}
