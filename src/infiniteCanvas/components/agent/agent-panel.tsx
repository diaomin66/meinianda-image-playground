import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'

import { DirectAgentPanel } from './direct-agent-panel'
import { canvasThemes } from '@canvas/lib/canvas-theme'
import { CANVAS_AGENT_PANEL_MOTION_MS, useAgentStore } from '@canvas/stores/use-agent-store'
import { useThemeStore } from '@canvas/stores/use-theme-store'

const PANEL_MOTION_SECONDS = CANVAS_AGENT_PANEL_MOTION_MS / 1000

export function getCanvasAgentPanelLayout(viewportWidth: number, count: number, preferredWidth: number) {
  const compact = viewportWidth < 900
  const columns = compact
    ? 1
    : viewportWidth >= 1700 && count > 1
      ? 2
      : 1
  const cardWidth = compact
    ? Math.max(320, viewportWidth - 40)
    : columns === 1
      ? Math.min(560, Math.max(360, preferredWidth))
      : Math.min(520, Math.max(360, Math.floor((viewportWidth - 500) / columns)))
  return {
    compact,
    columns,
    cardWidth,
    rackWidth: compact ? Math.max(336, viewportWidth - 16) : columns * cardWidth + (columns - 1) * 12 + 24,
  }
}

export function AgentPanel() {
  const theme = canvasThemes[useThemeStore((state) => state.theme)]
  const width = useAgentStore((state) => state.width)
  const panelMounted = useAgentStore((state) => state.panelMounted)
  const panelOpen = useAgentStore((state) => state.panelOpen)
  const panelClosing = useAgentStore((state) => state.panelClosing)
  const openConversationIds = useAgentStore((state) => state.openDirectConversationIds)
  const focusedConversationId = useAgentStore((state) => state.focusedDirectConversationId)
  const conversations = useAgentStore((state) => state.directConversations)
  const conversationsLoaded = useAgentStore((state) => state.directConversationsLoaded)
  const conversationsLoading = useAgentStore((state) => state.directConversationsLoading)
  const setAgentState = useAgentStore((state) => state.setAgentState)
  const loadDirectConversations = useAgentStore((state) => state.loadDirectConversations)
  const openDirectConversation = useAgentStore((state) => state.openDirectConversation)
  const closeDirectConversation = useAgentStore((state) => state.closeDirectConversation)
  const focusDirectConversation = useAgentStore((state) => state.focusDirectConversation)
  const [resizing, setResizing] = useState(false)
  const [viewportWidth, setViewportWidth] = useState(() => typeof window === 'undefined' ? 1440 : window.innerWidth)

  useEffect(() => {
    void loadDirectConversations()
  }, [loadDirectConversations])

  useEffect(() => {
    const update = () => setViewportWidth(window.innerWidth)
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  useEffect(() => {
    if (!panelOpen || !conversationsLoaded || openConversationIds.length || !conversations.length) return
    openDirectConversation(conversations[0].id)
  }, [conversations, conversationsLoaded, openConversationIds.length, openDirectConversation, panelOpen])

  useEffect(() => {
    const runningCount = conversations.filter((conversation) => conversation.sending).length
    setAgentState({ activity: runningCount ? `${runningCount} 个运行中` : '就绪' })
  }, [conversations, setAgentState])

  const visibleConversationIds = useMemo(() => {
    const validIds = openConversationIds.filter((id) => conversations.some((conversation) => conversation.id === id))
    if (viewportWidth >= 900) return validIds
    const focusedId = focusedConversationId && validIds.includes(focusedConversationId)
      ? focusedConversationId
      : validIds[validIds.length - 1]
    return focusedId ? [focusedId] : []
  }, [conversations, focusedConversationId, openConversationIds, viewportWidth])
  const layout = getCanvasAgentPanelLayout(viewportWidth, Math.max(1, openConversationIds.length), width)
  const compactConversationCards = visibleConversationIds.length > layout.columns

  const startResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = width
    let nextWidth = startWidth
    const onMove = (moveEvent: PointerEvent) => {
      nextWidth = Math.min(760, Math.max(360, startWidth + startX - moveEvent.clientX))
      setAgentState({ width: nextWidth })
    }
    const onUp = () => {
      localStorage.setItem('canvas-agent-panel-width', String(nextWidth))
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setResizing(false)
    }
    setResizing(true)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  if (!panelMounted) return null

  return (
    <motion.div
      className={`canvas-agent-panel relative z-[70] flex h-full shrink-0 ${layout.compact ? 'canvas-agent-panel-compact' : ''}`}
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: panelOpen ? layout.rackWidth : 0, opacity: panelOpen ? 1 : 0 }}
      transition={{ duration: resizing ? 0 : PANEL_MOTION_SECONDS, ease: [0.22, 1, 0.36, 1] }}
      style={{ overflow: 'clip', pointerEvents: panelOpen && !panelClosing ? undefined : 'none' }}
    >
      {panelOpen && !panelClosing && !layout.compact ? (
        <button
          type="button"
          className="absolute inset-y-3 left-0 z-50 w-4 -translate-x-1/2 cursor-col-resize"
          onPointerDown={startResize}
          aria-label="调整 Agent 面板宽度"
        />
      ) : null}
      <motion.div
        className="canvas-agent-panel-grid m-3 grid min-h-0 flex-1 gap-3 overflow-y-auto overscroll-contain"
        initial={{ x: 32, scale: 0.985 }}
        animate={{ x: panelClosing ? 20 : 0, scale: panelClosing ? 0.985 : 1 }}
        transition={{ duration: resizing ? 0 : PANEL_MOTION_SECONDS, ease: [0.22, 1, 0.36, 1] }}
        style={{
          gridTemplateColumns: `repeat(${layout.columns}, minmax(0, ${layout.cardWidth}px))`,
          gridAutoRows: visibleConversationIds.length <= layout.columns ? 'minmax(0, 1fr)' : 'minmax(360px, 1fr)',
          transformOrigin: 'right center',
        }}
      >
        <AnimatePresence initial={false} mode="popLayout">
          {visibleConversationIds.map((conversationId) => (
            <motion.aside
              layout
              key={conversationId}
              data-canvas-shortcuts-ignore
              data-focused={focusedConversationId === conversationId ? 'true' : 'false'}
              className="canvas-agent-panel-content relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border shadow-[0_18px_48px_rgba(24,24,27,.14)] backdrop-blur-md dark:shadow-[0_18px_48px_rgba(0,0,0,.4)]"
              initial={{ opacity: 0, y: 20, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 14, scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 420, damping: 34, mass: 0.72 }}
              style={{
                background: theme.node.panel,
                borderColor: focusedConversationId === conversationId ? theme.node.activeStroke : theme.node.stroke,
                color: theme.node.text,
              }}
              onPointerDown={() => focusDirectConversation(conversationId)}
            >
              <DirectAgentPanel conversationId={conversationId} compact={compactConversationCards} onClose={() => closeDirectConversation(conversationId)} />
            </motion.aside>
          ))}
        </AnimatePresence>
        {!visibleConversationIds.length ? (
          <div
            className="flex min-h-[320px] items-center justify-center rounded-2xl border text-sm"
            style={{ background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.muted }}
          >
            {conversationsLoading || !conversationsLoaded ? '正在读取对话记录…' : '暂无已打开的 Agent 对话'}
          </div>
        ) : null}
      </motion.div>
    </motion.div>
  )
}
