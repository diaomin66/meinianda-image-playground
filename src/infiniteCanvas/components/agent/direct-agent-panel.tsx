import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Popover, Select, Tooltip } from 'antd'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowDown, ArrowUp, Bot, Check, Copy, History, ImagePlus, Plus, Search, Settings2, Square, Trash2, X } from 'lucide-react'

import { useStore } from '../../../store'
import MarkdownRenderer from '../../../components/MarkdownRenderer'
import { copyTextToClipboard } from '../../../lib/clipboard'
import { getDirectAgentProfile, runDirectCanvasAgentTurn } from '@canvas/lib/agent/direct-agent'
import { DIRECT_AGENT_MODEL_OPTIONS, DIRECT_AGENT_REASONING_LABELS, getDirectAgentModel, getDirectAgentReasoningEffort, getDirectAgentReasoningEfforts } from '@canvas/lib/agent/direct-agent-models'
import { canvasThemes } from '@canvas/lib/canvas-theme'
import { randomId } from '@canvas/lib/utils'
import { useThemeStore } from '@canvas/stores/use-theme-store'
import { useAgentStore, type AgentAttachment, type AgentChatItem } from '@canvas/stores/use-agent-store'

const directAgentControllers = new Map<string, AbortController>()

type DirectAgentPanelProps = {
  conversationId: string
  compact?: boolean
  onClose: () => void
}

export function DirectAgentPanel({ conversationId, compact = false, onClose }: DirectAgentPanelProps) {
  const theme = canvasThemes[useThemeStore((state) => state.theme)]
  const settings = useStore((state) => state.settings)
  const profileState = useMemo(() => getDirectAgentProfile(settings), [settings])
  const directConversations = useAgentStore((state) => state.directConversations)
  const openDirectConversationIds = useAgentStore((state) => state.openDirectConversationIds)
  const directConversationsLoaded = useAgentStore((state) => state.directConversationsLoaded)
  const setAgentState = useAgentStore((state) => state.setAgentState)
  const loadDirectConversations = useAgentStore((state) => state.loadDirectConversations)
  const createDirectConversation = useAgentStore((state) => state.createDirectConversation)
  const openDirectConversation = useAgentStore((state) => state.openDirectConversation)
  const updateDirectConversation = useAgentStore((state) => state.updateDirectConversation)
  const addDirectConversationMessage = useAgentStore((state) => state.addDirectConversationMessage)
  const replaceDirectConversationMessage = useAgentStore((state) => state.replaceDirectConversationMessage)
  const deleteDirectConversation = useAgentStore((state) => state.deleteDirectConversation)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyQuery, setHistoryQuery] = useState('')
  const [isScrolledToBottom, setIsScrolledToBottom] = useState(true)
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null)
  const activeConversation = directConversations.find((conversation) => conversation.id === conversationId)
  const prompt = activeConversation?.prompt || ''
  const attachments = activeConversation?.attachments || []
  const messages = activeConversation?.messages || []
  const sending = activeConversation?.sending || false
  const activity = activeConversation?.activity || (directConversationsLoaded ? '就绪' : '加载中')
  const selectedModel = getDirectAgentModel(activeConversation?.model || profileState.profile?.model)
  const selectedReasoningEffort = getDirectAgentReasoningEffort(selectedModel, activeConversation?.reasoningEffort || profileState.profile?.reasoningEffort)
  const reasoningOptions = getDirectAgentReasoningEfforts(selectedModel).map((value) => ({ label: DIRECT_AGENT_REASONING_LABELS[value], value }))
  const sortedConversations = useMemo(
    () => [...directConversations].sort((a, b) => b.updatedAt - a.updatedAt),
    [directConversations],
  )
  const filteredConversations = useMemo(() => {
    const query = historyQuery.trim().toLocaleLowerCase()
    if (!query) return sortedConversations
    return sortedConversations.filter((conversation) => [
      conversation.title,
      ...conversation.messages.map((message) => message.text),
    ].join('\n').toLocaleLowerCase().includes(query))
  }, [historyQuery, sortedConversations])

  useEffect(() => {
    void loadDirectConversations()
  }, [loadDirectConversations])

  useEffect(() => {
    setAgentState({ connected: Boolean(profileState.profile), enabled: true })
  }, [profileState.profile, setAgentState])

  useEffect(() => {
    const container = scrollRef.current
    if (!container || (!isScrolledToBottom && messages[messages.length - 1]?.role !== 'user')) return
    const frame = window.requestAnimationFrame(() => {
      container.scrollTo({ top: container.scrollHeight, behavior: messages.length > 1 ? 'smooth' : 'auto' })
      setIsScrolledToBottom(true)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [isScrolledToBottom, messages, sending])

  const openSettings = () => useStore.getState().setShowSettings(true, 'agent')

  const addFiles = async (files: FileList | File[] | null) => {
    if (!activeConversation) return
    const selected = Array.from(files || []).filter((file) => file.type.startsWith('image/'))
    if (!selected.length) return
    const next = await Promise.all(selected.map(readAttachment))
    updateDirectConversation(activeConversation.id, { attachments: [...attachments, ...next] })
  }

  const removeAttachment = (id: string) => {
    if (!activeConversation) return
    const item = attachments.find((attachment) => attachment.id === id)
    if (item) revokeObjectUrl(item.url)
    updateDirectConversation(activeConversation.id, { attachments: attachments.filter((attachment) => attachment.id !== id) })
  }

  const stop = () => {
    if (!activeConversation) return
    directAgentControllers.get(activeConversation.id)?.abort()
  }

  const submit = async () => {
    if (!activeConversation) return
    const activeConversationId = activeConversation.id
    const text = prompt.trim()
    if (!text && !attachments.length) return
    if (!profileState.profile) {
      openSettings()
      return
    }
    if (sending) return

    const user: AgentChatItem = {
      id: randomId(),
      role: 'user',
      text: text || `发送了 ${attachments.length} 张图片`,
      attachments,
    }
    const assistantId = randomId()
    const controller = new AbortController()
    const canvasContext = useAgentStore.getState().canvasContext
    directAgentControllers.set(activeConversationId, controller)
    updateDirectConversation(activeConversationId, { prompt: '', attachments: [], sending: true, activity: '思考中' })
    addDirectConversationMessage(activeConversationId, user)
    addDirectConversationMessage(activeConversationId, { id: assistantId, role: 'assistant', title: 'Agent', text: '', streamId: assistantId })

    try {
      const history = [...activeConversation.messages, user]
        .filter((item) => item.role === 'user' || item.role === 'assistant')
        .map((item) => ({
          role: item.role as 'user' | 'assistant',
          text: item.text,
          images: item.role === 'user' ? item.attachments?.map((attachment) => attachment.dataUrl) : undefined,
        }))
      const result = await runDirectCanvasAgentTurn({
        settings,
        messages: history,
        model: selectedModel,
        reasoningEffort: selectedReasoningEffort,
        snapshot: canvasContext?.snapshot || null,
        applyOps: (ops) => {
          if (!canvasContext) throw new Error('画布上下文尚未就绪，请先打开一个画布。')
          return canvasContext.applyOps(ops)
        },
        signal: controller.signal,
        onTool: (ops) => {
          updateDirectConversation(activeConversationId, { activity: '执行画布操作' })
          addDirectConversationMessage(activeConversationId, { id: randomId(), role: 'tool', title: '画布操作', text: `已执行：${ops.map((item) => item.type).join('、') || '无有效操作'}` })
        },
      })
      replaceDirectConversationMessage(activeConversationId, assistantId, { text: result, streamId: undefined })
      updateDirectConversation(activeConversationId, { activity: '完成' })
    } catch (error) {
      const stopped = controller.signal.aborted
      replaceDirectConversationMessage(activeConversationId, assistantId, stopped
        ? { role: 'system', title: undefined, text: '已停止。', streamId: undefined }
        : { role: 'error', title: '请求失败', text: error instanceof Error ? error.message : 'Agent 请求失败。', streamId: undefined })
      updateDirectConversation(activeConversationId, { activity: stopped ? '已停止' : '请求失败' })
    } finally {
      if (directAgentControllers.get(activeConversationId) === controller) directAgentControllers.delete(activeConversationId)
      updateDirectConversation(activeConversationId, { sending: false })
    }
  }

  const copyMessage = async (item: AgentChatItem) => {
    if (!item.text.trim()) return
    try {
      await copyTextToClipboard(item.text)
      setCopiedMessageId(item.id)
      window.setTimeout(() => setCopiedMessageId((current) => current === item.id ? null : current), 1200)
    } catch {
      setCopiedMessageId(null)
    }
  }

  const scrollToBottom = () => {
    const container = scrollRef.current
    if (!container) return
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' })
  }

  if (!activeConversation) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm" style={{ color: theme.node.muted }}>
        正在准备 Agent 对话…
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="relative shrink-0 border-b px-3 pb-3 pt-3" style={{ borderColor: theme.node.stroke }}>
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="flex min-w-0 items-start gap-2.5">
            <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl bg-blue-600 text-white shadow-sm">
              <Bot className="size-4" />
            </div>
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-sm font-semibold">画布 Agent</span>
                <span className={`size-1.5 shrink-0 rounded-full ${sending ? 'animate-pulse bg-blue-500' : profileState.profile ? 'bg-emerald-500' : 'bg-amber-500'}`} />
              </div>
              <div className="mt-0.5 truncate text-[11px]" style={{ color: theme.node.muted }} title={profileState.profile?.model || profileState.message || ''}>
                {profileState.profile ? profileState.profile.model : '未配置全局 Agent 模型'}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {!profileState.profile ? (
              <Tooltip title="配置 Agent 模型">
                <Button type="text" className="!h-8 !w-8 !min-w-8 !rounded-lg" icon={<Settings2 className="size-3.5" />} onClick={openSettings} aria-label="配置 Agent 模型" />
              </Tooltip>
            ) : null}
            <Tooltip title="收起此对话">
              <Button type="text" className="!h-8 !w-8 !min-w-8 !rounded-lg" icon={<X className="size-4" />} onClick={onClose} aria-label="收起此对话" />
            </Tooltip>
          </div>
        </div>

        <div className="mt-3 flex min-w-0 items-center gap-1.5">
          <Popover
            open={historyOpen}
            onOpenChange={setHistoryOpen}
            placement="bottomRight"
            trigger="click"
            content={(
              <div className="flex w-[min(22rem,calc(100vw-3rem))] max-w-[calc(100vw-3rem)] flex-col overflow-hidden">
                <div className="border-b p-2.5" style={{ borderColor: theme.node.stroke }}>
                  <div className="flex items-center gap-2 rounded-xl border px-2.5" style={{ background: theme.node.fill, borderColor: theme.node.stroke }}>
                    <Search className="size-3.5 shrink-0" style={{ color: theme.node.muted }} />
                    <input
                      value={historyQuery}
                      onChange={(event) => setHistoryQuery(event.target.value)}
                      placeholder="搜索历史对话"
                      className="h-9 min-w-0 flex-1 border-0 bg-transparent text-xs outline-none"
                      style={{ color: theme.node.text }}
                    />
                  </div>
                </div>
                <div className="thin-scrollbar max-h-80 overflow-y-auto p-2">
                  {filteredConversations.length ? filteredConversations.map((conversation) => {
                    const opened = openDirectConversationIds.includes(conversation.id)
                    return (
                      <div
                        key={conversation.id}
                        className="group flex items-center gap-2 rounded-xl px-2 py-2 transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.05]"
                      >
                        <button
                          type="button"
                          className="min-w-0 flex-1 text-left"
                          onClick={() => {
                            openDirectConversation(conversation.id)
                            setHistoryOpen(false)
                          }}
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="truncate text-xs font-medium">{conversation.title}</span>
                            {conversation.sending ? <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-blue-500" /> : null}
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-[10px]" style={{ color: theme.node.muted }}>
                            <span>{formatConversationTime(conversation.updatedAt)}</span>
                            {opened ? <span className="text-blue-500">已打开</span> : null}
                          </div>
                        </button>
                        <button
                          type="button"
                          className="grid size-7 shrink-0 place-items-center rounded-lg opacity-0 transition hover:bg-red-500/10 hover:text-red-500 group-hover:opacity-100 focus:opacity-100 disabled:cursor-not-allowed disabled:opacity-30"
                          disabled={conversation.sending}
                          onClick={() => deleteDirectConversation(conversation.id)}
                          aria-label={`删除对话 ${conversation.title}`}
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    )
                  }) : (
                    <div className="px-3 py-8 text-center text-xs" style={{ color: theme.node.muted }}>没有找到匹配的对话</div>
                  )}
                </div>
              </div>
            )}
          >
            <button
              type="button"
              className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-xl border px-3 text-left text-xs transition-colors"
              style={{ background: theme.node.fill, borderColor: historyOpen ? theme.node.activeStroke : theme.node.stroke, color: theme.node.text }}
              aria-expanded={historyOpen}
              aria-label="打开画布 Agent 历史对话"
            >
              <History className="size-3.5 shrink-0" style={{ color: theme.node.muted }} />
              <span className="min-w-0 flex-1 truncate">{activeConversation.title}</span>
              {openDirectConversationIds.length > 1 ? (
                <span className="shrink-0 rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
                  {openDirectConversationIds.length}
                </span>
              ) : null}
            </button>
          </Popover>
          <Tooltip title="新建并打开一个 Agent">
            <Button
              type="text"
              className="!h-9 !w-9 !min-w-9 !rounded-xl"
              icon={<Plus className="size-4" />}
              disabled={!directConversationsLoaded}
              onClick={createDirectConversation}
              aria-label="新建 Agent 对话"
            />
          </Tooltip>
          <Tooltip title={sending ? '运行中的对话无法删除' : '删除当前对话'}>
            <Button
              type="text"
              danger
              className="!h-9 !w-9 !min-w-9 !rounded-xl"
              icon={<Trash2 className="size-3.5" />}
              disabled={sending}
              onClick={() => deleteDirectConversation(activeConversation.id)}
              aria-label="删除当前对话"
            />
          </Tooltip>
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          className="thin-scrollbar h-full select-text overflow-y-auto px-3 py-4"
          onScroll={(event) => {
            const container = event.currentTarget
            setIsScrolledToBottom(container.scrollHeight - container.scrollTop - container.clientHeight < 32)
          }}
        >
          {messages.length ? (
            <div className="space-y-3">
              <AnimatePresence initial={false}>
                {messages.map((item) => (
                  <Message
                    key={item.id}
                    item={item}
                    theme={theme}
                    sending={sending}
                    copied={copiedMessageId === item.id}
                    onCopy={() => void copyMessage(item)}
                  />
                ))}
              </AnimatePresence>
            </div>
          ) : (
            <div className="flex h-full min-h-52 items-center justify-center px-6 text-center text-sm leading-6" style={{ color: theme.node.muted }}>
              {profileState.profile ? '可以提问、上传参考图，或让 Agent 直接整理当前画布。' : '请先在全局设置中配置 Agent 文本模型。'}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={scrollToBottom}
          className={`absolute bottom-3 left-1/2 z-20 grid size-9 -translate-x-1/2 place-items-center rounded-full border shadow-lg backdrop-blur transition-all duration-200 ${
            isScrolledToBottom || !messages.length ? 'pointer-events-none translate-y-2 opacity-0' : 'translate-y-0 opacity-100'
          }`}
          style={{ background: theme.toolbar.panel, borderColor: theme.node.stroke, color: theme.node.muted }}
          aria-label="滚动到底部"
        >
          <ArrowDown className="size-4" />
        </button>
      </div>

      <div className="shrink-0 p-2">
        <div className={`rounded-2xl border shadow-[0_12px_30px_rgba(24,24,27,.10)] dark:shadow-[0_12px_30px_rgba(0,0,0,.28)] ${compact ? 'p-2.5' : 'p-3'}`} style={{ background: theme.toolbar.panel, borderColor: theme.node.stroke }}>
          {attachments.length ? (
            <div className="thin-scrollbar mb-2 flex gap-2 overflow-x-auto pb-1">
              {attachments.map((item) => (
                <div key={item.id} className="group relative size-14 shrink-0 overflow-hidden rounded-xl border" style={{ borderColor: theme.node.stroke }}>
                  <img src={item.url} alt={item.name} className="size-full object-cover" />
                  <button type="button" className="absolute right-1 top-1 grid size-5 place-items-center rounded-full border opacity-0 shadow-sm transition group-hover:opacity-100" style={{ background: theme.toolbar.panel, borderColor: theme.node.stroke, color: theme.node.text }} onClick={() => removeAttachment(item.id)} aria-label="移除图片">
                    <X className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <textarea
            value={prompt}
            onChange={(event) => updateDirectConversation(activeConversation.id, { prompt: event.target.value })}
            onPaste={(event) => {
              const images = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith('image/'))
              if (!images.length) return
              event.preventDefault()
              void addFiles(images)
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
              event.preventDefault()
              void submit()
            }}
            disabled={sending}
            className={`thin-scrollbar w-full resize-none border-0 bg-transparent px-1 py-1 text-sm leading-5 outline-none placeholder:opacity-45 ${compact ? 'max-h-20 min-h-12' : 'max-h-32 min-h-20'}`}
            style={{ color: theme.node.text }}
            placeholder={profileState.profile ? '询问画布 Agent…' : '请先配置全局 Agent 模型'}
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-1">
              <input ref={fileInputRef} hidden type="file" accept="image/*" multiple onChange={(event) => {
                void addFiles(event.target.files)
                event.target.value = ''
              }} />
              <Tooltip title="上传图片">
                <Button type="text" shape="circle" className="!h-9 !w-9 !min-w-9" disabled={sending} style={{ color: theme.node.muted }} icon={<ImagePlus className="size-4" />} onClick={() => fileInputRef.current?.click()} />
              </Tooltip>
              <Select
                size="middle"
                value={selectedModel}
                options={DIRECT_AGENT_MODEL_OPTIONS.map((option) => ({ label: option.value, value: option.value }))}
                disabled={sending}
                className="!h-9 !w-32 !min-w-32 !rounded-xl [&_.ant-select-selector]:!h-9 [&_.ant-select-selector]:!rounded-xl"
                popupMatchSelectWidth={false}
                onChange={(value) => {
                  const nextModel = getDirectAgentModel(value)
                  updateDirectConversation(activeConversation.id, {
                    model: nextModel,
                    reasoningEffort: getDirectAgentReasoningEffort(nextModel, selectedReasoningEffort),
                  })
                }}
                aria-label="选择画布 Agent 模型"
              />
              <Select
                size="middle"
                value={selectedReasoningEffort}
                options={reasoningOptions}
                disabled={sending}
                className="!h-9 !w-20 !min-w-20 !rounded-xl [&_.ant-select-selector]:!h-9 [&_.ant-select-selector]:!rounded-xl"
                popupMatchSelectWidth={false}
                onChange={(value) => updateDirectConversation(activeConversation.id, { reasoningEffort: value })}
                aria-label="选择模型强度"
              />
              <span className="min-w-0 truncate text-xs" style={{ color: sending ? theme.node.activeStroke : theme.node.muted }}>{activity}</span>
            </div>
            {sending ? (
              <Button danger shape="circle" className="!h-10 !w-10 !min-w-10" icon={<Square className="size-4" />} onClick={stop} aria-label="停止" />
            ) : (
              <Button type="primary" shape="circle" className="!h-10 !w-10 !min-w-10" disabled={!profileState.profile || (!prompt.trim() && !attachments.length)} onClick={() => void submit()} aria-label="发送">
                <ArrowUp className="size-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Message({
  item,
  theme,
  sending,
  copied,
  onCopy,
}: {
  item: AgentChatItem
  theme: (typeof canvasThemes)[keyof typeof canvasThemes]
  sending: boolean
  copied: boolean
  onCopy: () => void
}) {
  if (item.role === 'tool') {
    return (
      <motion.div
        layout
        className="rounded-xl border border-blue-500/20 bg-blue-500/[0.06] px-3 py-2 text-xs leading-5"
        style={{ color: theme.node.muted }}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
      >
        <span className="font-medium text-blue-600 dark:text-blue-400">{item.title || '画布操作'}</span>
        <span className="ml-1">{item.text}</span>
      </motion.div>
    )
  }
  if (item.role === 'system') {
    return (
      <motion.div layout className="text-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <span className="inline-flex rounded-full border px-2.5 py-1 text-[11px]" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>{item.text}</span>
      </motion.div>
    )
  }
  if (item.role === 'error') {
    return (
      <motion.div
        layout
        className="rounded-xl border border-red-500/25 bg-red-500/[0.06] px-3 py-2 text-xs leading-5 text-red-600 dark:text-red-400"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
      >
        {item.title ? <div className="font-semibold">{item.title}</div> : null}
        <div className="mt-0.5 whitespace-pre-wrap break-words">{item.text}</div>
      </motion.div>
    )
  }

  const assistantThinking = item.role === 'assistant' && sending && Boolean(item.streamId) && !item.text
  return (
    <motion.div
      layout
      className={`group flex w-full ${item.role === 'user' ? 'justify-end' : 'justify-start'}`}
      initial={{ opacity: 0, y: 12, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 6, scale: 0.985 }}
      transition={{ type: 'spring', stiffness: 420, damping: 34, mass: 0.72 }}
    >
      <article
        className={`relative min-w-0 rounded-2xl border px-3 py-2.5 text-sm leading-6 ${
          item.role === 'user' ? 'max-w-[88%] rounded-tr-sm border-blue-500/20 bg-blue-500/[0.08]' : 'max-w-[96%] rounded-tl-sm'
        }`}
        style={item.role === 'user'
          ? { color: theme.node.text }
          : { background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}
      >
        <div className="mb-1 flex items-center justify-between gap-3 text-[11px] font-semibold">
          <span className={item.role === 'user' ? 'text-blue-600 dark:text-blue-400' : ''} style={item.role === 'assistant' ? { color: theme.node.muted } : undefined}>
            {item.role === 'user' ? '你' : 'Agent'}
          </span>
          {item.role === 'assistant' && item.text ? (
            <button
              type="button"
              className="grid size-6 place-items-center rounded-lg opacity-0 transition hover:bg-black/[0.05] group-hover:opacity-100 focus:opacity-100 dark:hover:bg-white/[0.06]"
              onClick={onCopy}
              aria-label="复制回复"
            >
              {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
            </button>
          ) : null}
        </div>
        {assistantThinking ? (
          <div className="flex items-center gap-2 py-1 text-xs" style={{ color: theme.node.muted }}>
            <span>正在生成回复</span>
            <span className="flex gap-1">
              <span className="size-1.5 animate-pulse rounded-full bg-current" />
              <span className="size-1.5 animate-pulse rounded-full bg-current [animation-delay:150ms]" />
              <span className="size-1.5 animate-pulse rounded-full bg-current [animation-delay:300ms]" />
            </span>
          </div>
        ) : item.role === 'assistant' ? (
          <MarkdownRenderer content={item.text} streaming={sending && Boolean(item.streamId)} />
        ) : (
          <div className="whitespace-pre-wrap break-words">{item.text}</div>
        )}
        {item.attachments?.length ? (
          <div className={`mt-2 flex gap-2 overflow-x-auto ${item.role === 'user' ? 'justify-end' : ''}`}>
            {item.attachments.map((attachment) => <img key={attachment.id} src={attachment.url} alt={attachment.name} className="size-14 shrink-0 rounded-xl border object-cover" style={{ borderColor: theme.node.stroke }} />)}
          </div>
        ) : null}
      </article>
    </motion.div>
  )
}

function formatConversationTime(value: number) {
  const date = new Date(value)
  const now = new Date()
  if (date.toDateString() === now.toDateString()) {
    return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
  }
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
}

async function readAttachment(file: File): Promise<AgentAttachment> {
  const dataUrl = await fileToDataUrl(file)
  const size = await imageSize(dataUrl)
  return {
    id: randomId(),
    name: file.name || '图片',
    type: file.type || 'image/*',
    size: file.size,
    width: size.width,
    height: size.height,
    url: URL.createObjectURL(file),
    dataUrl,
  }
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('读取图片失败。'))
    reader.readAsDataURL(file)
  })
}

function imageSize(src: string) {
  return new Promise<{ width: number; height: number }>((resolve) => {
    const image = new Image()
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => resolve({ width: 0, height: 0 })
    image.src = src
  })
}

function revokeObjectUrl(url: string) {
  if (url.startsWith('blob:')) URL.revokeObjectURL(url)
}
