// 同步开始后的本地编辑、删除和新增优先；未修改项目才接收远端合并结果。
export function preserveConcurrentChanges<T extends { id?: string }>(before: T[], current: T[], merged: T[]): T[] {
  const initial = new Map(before.map((item) => [item.id, item]))
  const latest = new Map(current.map((item) => [item.id, item]))
  const result = merged.flatMap((item) => {
    const local = latest.get(item.id)
    if (initial.has(item.id) && !local) return []
    if (local && local !== initial.get(item.id)) return [local]
    return [item]
  })
  const ids = new Set(result.map((item) => item.id))
  return [...current.filter((item) => !ids.has(item.id)), ...result]
}
