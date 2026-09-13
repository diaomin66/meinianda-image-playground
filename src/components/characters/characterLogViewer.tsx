import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, Check, ChevronDown, Copy, Download, Search, Trash2, X } from 'lucide-react'
import type { CharacterLogEntry } from '../../types'
import { clearCharacterLogs, useCharacterLogStore } from '../../lib/characterLogs'

const STAGES = { chat: '聊天', tool: '工具', optimizer: '副脑', image: '生图' }
const STATUSES = { info: '记录', running: '进行中', success: '成功', warning: '注意', error: '失败' }

export default function CharacterLogViewer({ conversationId, title, closing, onClose }: { conversationId: string; title: string; closing: boolean; onClose: () => void }) {
  const entries = useCharacterLogStore((state) => state.entries)
  const storageError = useCharacterLogStore((state) => state.storageError)
  const [stage, setStage] = useState<'all' | CharacterLogEntry['stage']>('all')
  const [search, setSearch] = useState('')
  const [errorsOnly, setErrorsOnly] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [error, setError] = useState('')
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])
  const logs = useMemo(() => entries.filter((entry) => entry.conversationId === conversationId), [entries, conversationId])
  const filtered = useMemo(() => logs.filter((entry) => (stage === 'all' || entry.stage === stage)
    && (!errorsOnly || entry.status === 'error' || entry.status === 'warning')
    && (!search.trim() || `${entry.title}\n${entry.jobId ?? ''}\n${entry.messageId ?? ''}\n${entry.details ?? ''}\n${entry.result ?? ''}`.toLowerCase().includes(search.trim().toLowerCase()))).reverse(), [logs, stage, errorsOnly, search])
  const activeCount = logs.filter((entry) => entry.status === 'running').length
  return (
    <dialog ref={ref} aria-labelledby="character-log-title" data-closing={closing} inert={closing}
      className="character-dialog w-[min(1050px,calc(100%-24px))] bg-white p-0 text-gray-900 shadow-2xl backdrop:bg-gray-950/50 backdrop:backdrop-blur-sm dark:bg-gray-900 dark:text-gray-100"
      onCancel={(e) => { e.preventDefault(); onClose() }}>
      <div className="flex h-[min(800px,86dvh)] min-h-0 flex-col">
        <div className="flex items-start gap-3 px-5 pb-4 pt-6 sm:px-7">
          <span className="rounded-2xl bg-blue-50 p-3 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300"><Activity size={22} /></span>
          <div className="min-w-0 flex-1">
            <h2 id="character-log-title" className="text-lg font-semibold">对话日志</h2>
            <p className="mt-1 truncate text-xs text-gray-400">{title} · {logs.length} 条记录{activeCount > 0 ? ` · ${activeCount} 个步骤进行中` : ''}</p>
          </div>
          <button aria-label="关闭日志" className="rounded-full p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5" onClick={onClose}><X size={20} /></button>
        </div>
        <div className="space-y-3 px-5 pb-4 sm:px-7">
          <div className="flex flex-wrap items-center gap-2">
            {(['all', 'chat', 'tool', 'optimizer', 'image'] as const).map((value) => (
              <button key={value} aria-pressed={stage === value} onClick={() => setStage(value)} className={`rounded-full px-3.5 py-2 text-xs transition-colors ${stage === value ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-blue-50 dark:bg-white/5 dark:text-gray-400 dark:hover:bg-blue-500/10'}`}>{value === 'all' ? '全部' : STAGES[value]}</button>
            ))}
            <label className="ml-auto flex items-center gap-2 text-xs text-gray-500"><input type="checkbox" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} className="accent-blue-600" />仅看异常</label>
          </div>
          <div className="flex flex-wrap gap-2">
            <label className="flex min-w-40 flex-1 items-center gap-2 rounded-2xl bg-gray-50 px-3 dark:bg-white/5"><Search size={15} className="shrink-0 text-gray-400" /><input aria-label="搜索日志" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索消息、提示词、任务 ID…" className="min-w-0 flex-1 bg-transparent py-2.5 text-xs outline-none" /></label>
            <button disabled={!filtered.length} className="flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-2 text-xs text-blue-600 dark:bg-blue-500/10 dark:text-blue-300" onClick={() => {
              try {
                const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), conversationId, title, entries: [...filtered].reverse() }, null, 2)], { type: 'application/json' })
                const url = URL.createObjectURL(blob)
                const el = document.createElement('a')
                el.href = url
                el.download = `人物日志-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
                el.click()
                setTimeout(() => URL.revokeObjectURL(url), 1000)
              } catch (err) { console.warn('人物日志导出失败', err); setError('导出失败，请重试。') }
            }}><Download size={14} />导出筛选结果</button>
            <button disabled={!logs.length} className="flex items-center gap-1.5 rounded-full px-3 py-2 text-xs text-gray-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10" onClick={() => { clearCharacterLogs(conversationId); setExpanded(null) }}><Trash2 size={14} />清空日志</button>
          </div>
        </div>
        {(storageError || error) && <p role="alert" className="px-7 pb-3 text-xs text-amber-600">{storageError || error}</p>}
        <div className="min-h-0 flex-1 overflow-y-auto bg-gray-50/70 px-3 py-3 dark:bg-black/10 sm:px-5">
          {!filtered.length ? <div className="flex h-full flex-col items-center justify-center gap-3 px-5 text-center"><Activity size={30} strokeWidth={1.2} className="text-blue-300" /><p className="text-sm text-gray-500">{logs.length ? '没有匹配的日志' : '还没有这段对话的日志'}</p><p className="text-xs text-gray-400">从本次更新后的消息开始记录，新的步骤会自动出现。</p></div> : (
            <div className="space-y-2">
              {filtered.map((entry) => (
                <article key={entry.id} className="overflow-hidden rounded-2xl bg-white dark:bg-white/[0.04]">
                  <button aria-expanded={expanded === entry.id} onClick={() => setExpanded(expanded === entry.id ? null : entry.id)} className="flex w-full items-center gap-3 p-4 text-left">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${entry.status === 'error' ? 'bg-red-400' : entry.status === 'warning' ? 'bg-amber-400' : entry.status === 'running' ? 'bg-blue-500 motion-safe:animate-pulse' : 'bg-blue-300'}`} />
                    <div className="min-w-0 flex-1"><p className="text-sm font-medium">{entry.title}</p><p className="mt-1 text-[11px] leading-5 text-gray-400">{new Date(entry.createdAt).toLocaleTimeString('zh-CN', { hour12: false })} · {STAGES[entry.stage]} · {STATUSES[entry.status]}{entry.firstTokenMs !== undefined ? ` · 首字 ${(entry.firstTokenMs / 1000).toFixed(2)}s` : ''}{entry.durationMs !== undefined ? ` · 耗时 ${(entry.durationMs / 1000).toFixed(2)}s` : ''}</p></div>
                    <ChevronDown size={15} className={`shrink-0 text-gray-400 transition-transform ${expanded === entry.id ? 'rotate-180' : ''}`} />
                  </button>
                  {expanded === entry.id && <div className="space-y-3 px-4 pb-4">
                    <div className="flex flex-wrap items-center gap-2 text-[10px] text-gray-400"><span className="break-all">消息 {entry.messageId || '—'}{entry.jobId ? ` · 任务 ${entry.jobId}` : ''}</span><button className="ml-auto flex items-center gap-1 rounded-full px-2 py-1 text-xs text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-500/10" onClick={async () => { try { await navigator.clipboard.writeText(JSON.stringify(entry, null, 2)); setCopied(entry.id) } catch (err) { console.warn('复制日志失败', err); setError('复制失败，请使用导出。') } }}>{copied === entry.id ? <Check size={12} /> : <Copy size={12} />}{copied === entry.id ? '已复制' : '复制本条'}</button></div>
                    {entry.details && <div><h3 className="mb-2 text-[11px] text-gray-400">发送 / 输入</h3><pre data-selectable-text className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-2xl bg-gray-50 p-3 font-mono text-[11px] leading-5 text-gray-600 dark:bg-black/20 dark:text-gray-300">{entry.details}</pre></div>}
                    {entry.result && <div><h3 className="mb-2 text-[11px] text-gray-400">接收 / 结果</h3><pre data-selectable-text className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-2xl bg-blue-50/60 p-3 font-mono text-[11px] leading-5 text-gray-600 dark:bg-blue-500/5 dark:text-gray-300">{entry.result}</pre></div>}
                  </div>}
                </article>
              ))}
            </div>
          )}
        </div>
        <p className="px-5 py-3 text-[10px] leading-5 text-gray-400 sm:px-7">仅保存在此浏览器，所有对话合计保留最近 500 条，上限约 2 MB 文本。认证信息与图片字节已省略。清空日志不影响聊天记录。</p>
      </div>
    </dialog>
  )
}
