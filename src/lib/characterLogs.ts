import { create } from 'zustand'
import { nanoid } from 'nanoid'
import type { CharacterLogEntry } from '../types'

const STORAGE_KEY = 'character-logs-v1'
const MAX_LOGS = 500
const MAX_STORAGE_CHARS = 2 * 1024 * 1024
let saveTimer: ReturnType<typeof setTimeout> | undefined

// 日志保留文本和结构，不复制图片字节、签名或认证信息。字符串中的嵌套 JSON 也需清洗。
function sanitize(value: unknown, key = '', depth = 0): unknown {
  if (/^(authorization|proxy-authorization|api[-_]?key|x-goog-api-key|access[-_]?token|refresh[-_]?token|password|secret|thought_?signature)$/i.test(key)) return '[已隐藏]'
  if (depth > 16) return '[内容层级过深，已省略]'
  if (value instanceof Error) return { name: value.name, message: sanitize(value.message, '', depth + 1) }
  if (typeof value === 'string') {
    if (/^\s*[[{]/.test(value)) {
      try { return sanitize(JSON.parse(value), '', depth + 1) } catch { /* 普通文本继续处理。 */ }
    }
    const text = value
      .replace(/data:image\/[\w.+-]+;base64,[a-z\d+/=\s]+/gi, '[图片数据已省略]')
      .replace(/([?&](?:key|api[_-]?key|access_token|token)=)[^&#\s"']+/gi, '$1[已隐藏]')
      .replace(/(Bearer\s+)[\w.+/=-]+/gi, '$1[已隐藏]')
    if (key === 'b64_json' || (text.length > 512 && /^[a-z\d+/=\s]+$/i.test(text) && (key === 'data' || key === 'result'))) return `[图片数据已省略，${value.length} 字符]`
    return text.length > 100000 ? text.slice(0, 100000) + '\n[文本过长，已截断]' : text
  }
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitize(item, '', depth + 1))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, item]) => [key,
      (key === 'inlineData' || key === 'inline_data') && item && typeof item === 'object'
        ? { mimeType: (item as Record<string, unknown>).mimeType ?? (item as Record<string, unknown>).mime_type, data: '[图片数据已省略]' }
        : sanitize(item, key, depth + 1),
    ]))
  }
  return value
}

function serialize(value: unknown) {
  if (value === undefined) return undefined
  try {
    const safe = sanitize(value)
    const text = typeof safe === 'string' ? safe : JSON.stringify(safe, null, 2) ?? String(safe)
    return text.length > 128000 ? text.slice(0, 128000) + '\n[日志内容过长，已截断]' : text
  } catch {
    return '[无法序列化此日志内容]'
  }
}

function boundLogs(entries: CharacterLogEntry[]) {
  const recent = entries.slice(-MAX_LOGS)
  let chars = 0
  for (let idx = recent.length - 1; idx >= 0; idx -= 1) {
    chars += JSON.stringify(recent[idx]).length
    if (chars > MAX_STORAGE_CHARS) return recent.slice(idx + 1)
  }
  return recent
}

function restoreLogs(): CharacterLogEntry[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    if (!Array.isArray(saved)) return []
    return boundLogs(saved.filter((entry) => entry && typeof entry.id === 'string' && typeof entry.conversationId === 'string' && typeof entry.title === 'string' && Number.isFinite(entry.createdAt) && ['chat', 'tool', 'optimizer', 'image'].includes(entry.stage) && ['info', 'running', 'success', 'warning', 'error'].includes(entry.status)).map((entry) => ({
      id: entry.id, conversationId: entry.conversationId, title: String(sanitize(entry.title)), createdAt: entry.createdAt,
      messageId: typeof entry.messageId === 'string' ? entry.messageId : undefined,
      jobId: typeof entry.jobId === 'string' ? entry.jobId : undefined,
      stage: entry.stage, status: entry.status === 'running' ? 'warning' : entry.status,
      details: entry.details === undefined ? undefined : serialize(entry.details),
      result: entry.status === 'running' ? serialize({ note: '页面关闭或刷新时此步骤尚未结束。', received: entry.result }) : entry.result === undefined ? undefined : serialize(entry.result),
      durationMs: Number.isFinite(entry.durationMs) ? entry.durationMs : undefined,
      firstTokenMs: Number.isFinite(entry.firstTokenMs) ? entry.firstTokenMs : undefined,
    })))
  } catch (err) {
    console.warn('人物日志读取失败', err)
    return []
  }
}

export const useCharacterLogStore = create<{ entries: CharacterLogEntry[]; storageError: string | null }>(() => ({ entries: restoreLogs(), storageError: null }))

export function saveCharacterLogs() {
  clearTimeout(saveTimer)
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(useCharacterLogStore.getState().entries))
    if (useCharacterLogStore.getState().storageError) useCharacterLogStore.setState({ storageError: null })
  } catch (err) {
    console.warn('人物日志保存失败', err)
    useCharacterLogStore.setState({ storageError: '日志暂未保存到本地，当前页面仍可查看和导出。' })
  }
}

export function recordCharacterLog(entry: Omit<CharacterLogEntry, 'id' | 'createdAt' | 'details' | 'result'> & { details?: unknown; result?: unknown }) {
  const id = nanoid()
  const log = { ...entry, id, createdAt: Date.now(), title: String(sanitize(entry.title)), details: serialize(entry.details), result: serialize(entry.result) }
  useCharacterLogStore.setState((state) => ({ entries: boundLogs([...state.entries, log]) }))
  clearTimeout(saveTimer)
  saveTimer = setTimeout(saveCharacterLogs, 1000)
  return id
}

export function updateCharacterLog(id: string, patch: { status?: CharacterLogEntry['status']; details?: unknown; result?: unknown; firstTokenMs?: number }) {
  useCharacterLogStore.setState((state) => ({ entries: boundLogs(state.entries.map((entry) => entry.id === id ? {
    ...entry, ...patch,
    details: patch.details === undefined ? entry.details : serialize(patch.details),
    result: patch.result === undefined ? entry.result : serialize(patch.result),
    durationMs: patch.status && patch.status !== 'running' ? Date.now() - entry.createdAt : entry.durationMs,
  } : entry)) }))
  clearTimeout(saveTimer)
  saveTimer = setTimeout(saveCharacterLogs, 1000)
}

export function clearCharacterLogs(conversationId?: string) {
  useCharacterLogStore.setState((state) => ({ entries: conversationId === undefined ? [] : state.entries.filter((entry) => entry.conversationId !== conversationId) }))
  saveCharacterLogs()
}

if (typeof window !== 'undefined') window.addEventListener('pagehide', saveCharacterLogs)
