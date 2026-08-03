import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useStore } from '../store'
import { useTooltip } from '../hooks/useTooltip'
import { dismissAllTooltips } from '../lib/tooltipDismiss'
import ViewportTooltip from './ViewportTooltip'
import HelpModal from './HelpModal'
import HistoryModal from './HistoryModal'
import { useFavoriteCollectionTitle } from './FavoriteCollections'
import { EditIcon, HelpCircleIcon, HistoryIcon, InstallIcon, MoonIcon, SettingsIcon, SunIcon } from './icons'
import type { AppMode } from '../types'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

const APP_MODES: { mode: AppMode; label: string }[] = [
  { mode: 'canvas', label: '无限画布' },
  { mode: 'gallery', label: '画廊' },
  { mode: 'agent', label: 'Agent' },
]

function isInstalledPwa() {
  const nav = window.navigator as Navigator & { standalone?: boolean }
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true
}

function AppModeNav({
  appMode,
  mobile = false,
  onChange,
}: {
  appMode: AppMode
  mobile?: boolean
  onChange: (mode: AppMode) => void
}) {
  const activeIndex = APP_MODES.findIndex((item) => item.mode === appMode)
  const activeLabel = APP_MODES[activeIndex]?.label || ''

  return (
    <div className={mobile
      ? 'relative mx-2 grid h-[42px] grid-cols-3 items-center gap-1 rounded-xl border border-gray-200 bg-gray-100/70 p-1 dark:border-white/[0.08] dark:bg-white/[0.04]'
      : 'app-mode-nav relative mr-4 hidden h-[42px] w-[238px] self-center grid-cols-3 items-center gap-1 rounded-xl border border-gray-200 bg-gray-100/70 p-1 dark:border-white/[0.08] dark:bg-white/[0.04] sm:grid'}
    >
      <motion.span
        data-app-mode-indicator
        aria-hidden="true"
        className="absolute bottom-1 left-1 top-1 flex items-center justify-center overflow-hidden rounded-lg bg-white shadow-sm dark:bg-white/10"
        style={{ width: 'calc((100% - 1rem) / 3)' }}
        initial={false}
        animate={{ x: `calc(${activeIndex * 100}% + ${activeIndex * 0.25}rem)` }}
        transition={{ type: 'spring', stiffness: 500, damping: 31, mass: 0.74 }}
      >
        <AnimatePresence initial={false} mode="popLayout">
          <motion.span
            key={appMode}
            className="whitespace-nowrap"
            initial={{ opacity: 0, y: 6, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.94 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          >
            {activeLabel}
          </motion.span>
        </AnimatePresence>
      </motion.span>
      {APP_MODES.map((item) => {
        const active = appMode === item.mode
        return (
          <button
            key={item.mode}
            type="button"
            onClick={() => onChange(item.mode)}
            aria-pressed={active}
            className={`relative h-8 min-w-0 whitespace-nowrap rounded-lg text-sm transition-colors duration-200 ${mobile ? 'px-1' : 'px-2'} ${
              active
                ? 'font-medium text-gray-900 dark:text-white'
                : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'
            }`}
          >
            <motion.span
              className="relative z-10 block whitespace-nowrap"
              animate={{ opacity: active ? 0 : 1, y: active ? 3 : 0, scale: active ? 0.97 : 1 }}
              transition={{ type: 'spring', stiffness: 520, damping: 34, mass: 0.68 }}
            >
              {item.label}
            </motion.span>
          </button>
        )
      })}
    </div>
  )
}

export default function Header() {
  const appMode = useStore((s) => s.appMode)
  const setAppMode = useStore((s) => s.setAppMode)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const themePreference = useStore((s) => s.settings.theme)
  const setSettings = useStore((s) => s.setSettings)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const agentMobileHeaderVisible = useStore((s) => s.agentMobileHeaderVisible)
  const agentConversations = useStore((s) => s.agentConversations)
  const activeAgentConversationId = useStore((s) => s.activeAgentConversationId)
  const filterFavorite = useStore((s) => s.filterFavorite)
  const activeFavoriteCollectionId = useStore((s) => s.activeFavoriteCollectionId)
  const activeConversation = agentConversations.find((item) => item.id === activeAgentConversationId)
  const favoriteCollectionTitle = useFavoriteCollectionTitle()
  const showFavoriteCollectionTitle = appMode === 'gallery' && Boolean(activeFavoriteCollectionId)
  const [showHelp, setShowHelp] = useState(false)
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isPwaInstalled, setIsPwaInstalled] = useState(isInstalledPwa)
  const [hintVisible, setHintVisible] = useState(false)
  const [scrollDirection, setScrollDirection] = useState<'up' | 'down'>('up')
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  const [showHistoryModal, setShowHistoryModal] = useState(false)
  const historyButtonRef = useRef<HTMLButtonElement>(null)
  const createConversation = useStore((s) => s.createAgentConversation)
  const switchAppMode = (mode: AppMode) => {
    if (mode === appMode) return
    setAppMode(mode)
  }

  useEffect(() => {
    if (appMode !== 'agent') setShowHistoryModal(false)
  }, [appMode])

  useEffect(() => {
    if (appMode === 'agent') {
      setScrollDirection('up')
      return
    }

    let lastScrollY = window.scrollY
    let ticking = false

    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          const currentScrollY = window.scrollY
          if (currentScrollY < 20) {
            setScrollDirection('up')
          } else if (currentScrollY > lastScrollY + 10) {
            setScrollDirection('down')
          } else if (currentScrollY < lastScrollY - 10) {
            setScrollDirection('up')
          }
          lastScrollY = currentScrollY
          ticking = false
        })
        ticking = true
      }
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [appMode])

  useEffect(() => {
    if (appMode === 'agent' && !agentMobileHeaderVisible) {
      setHintVisible(true)
      const timer = setTimeout(() => {
        setHintVisible(false)
      }, 1500)
      return () => clearTimeout(timer)
    }
  }, [appMode, agentMobileHeaderVisible])

  const installTooltip = useTooltip()
  const helpTooltip = useTooltip()
  const themeTooltip = useTooltip()
  const settingsTooltip = useTooltip()
  const dark = themePreference === 'dark' || (themePreference === 'system' && systemDark)

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const updateSystemTheme = () => setSystemDark(media.matches)
    updateSystemTheme()
    media.addEventListener('change', updateSystemTheme)
    return () => media.removeEventListener('change', updateSystemTheme)
  }, [])

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as BeforeInstallPromptEvent)
      setIsPwaInstalled(false)
    }

    const handleAppInstalled = () => {
      setInstallPrompt(null)
      setIsPwaInstalled(true)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  const handleInstallClick = async () => {
    if (installPrompt) {
      const promptEvent = installPrompt
      setInstallPrompt(null)

      try {
        await promptEvent.prompt()
        const choice = await promptEvent.userChoice
        setIsPwaInstalled(choice.outcome === 'accepted')
      } catch {
        setIsPwaInstalled(isInstalledPwa())
      }
    } else {
      const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
      if (isIos) {
        setConfirmDialog({
          title: '安装为应用',
          message: '在 Safari 浏览器中，点击底部「分享」按钮，选择「添加到主屏幕」即可安装此应用。',
          showCancel: false,
          confirmText: '我知道了',
          icon: 'info',
          action: () => {},
        })
      } else {
        setConfirmDialog({
          title: '安装为应用',
          message: '请在浏览器的菜单中选择「添加到主屏幕」或「安装应用」。\n\n（如果在微信等内置浏览器中，请先在外部浏览器打开）',
          showCancel: false,
          confirmText: '我知道了',
          icon: 'info',
          action: () => {},
        })
      }
    }
  }

  return (
    <>
      <header data-no-drag-select className={`app-header safe-area-top fixed top-0 left-0 right-0 z-40 overflow-x-clip bg-white/80 dark:bg-gray-950/80 backdrop-blur border-b border-gray-200 dark:border-white/[0.08] transition-transform duration-300 ease-in-out ${appMode === 'canvas' ? 'app-header-canvas' : ''} ${appMode === 'agent' && !agentMobileHeaderVisible ? '-translate-y-full sm:translate-y-0' : 'translate-y-0'}`}>
        <div className="app-header-inner safe-area-x safe-header-inner max-w-7xl mx-auto flex items-center justify-between relative">
          <div className="flex-1 min-w-0 pr-2 flex items-center gap-2">
            <h1 className="app-header-brand relative mr-2 inline-flex min-w-0 max-w-[52vw] items-start sm:max-w-none">
              {showFavoriteCollectionTitle ? (
                <>
                  <span className="min-w-0 truncate text-[17px] font-bold tracking-tight text-gray-800 dark:text-gray-100 sm:hidden" title={favoriteCollectionTitle}>{favoriteCollectionTitle}</span>
                  <span className="hidden text-lg font-bold tracking-tight text-gray-800 dark:text-gray-100 sm:inline">
                    Meinianda Image Playground
                  </span>
                </>
              ) : (
                <span className="min-w-0 truncate text-[17px] sm:text-lg font-bold tracking-tight text-gray-800 dark:text-gray-100">
                  Meinianda Image Playground
                </span>
              )}
            </h1>
            {appMode === 'agent' && <div className="hidden sm:flex items-center gap-1 relative">
              <button
                ref={historyButtonRef}
                type="button"
                onClick={() => setShowHistoryModal((visible) => !visible)}
                className="p-1.5 text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/[0.04] rounded-lg transition-colors"
                title="历史任务"
              >
                <HistoryIcon className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setAppMode('agent')
                  createConversation()
                }}
                className="p-1.5 text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/[0.04] rounded-lg transition-colors"
                title="新对话"
              >
                <EditIcon className="w-5 h-5" />
              </button>
              {showHistoryModal && (
                <HistoryModal onClose={() => setShowHistoryModal(false)} ignoreOutsideClickRef={historyButtonRef} />
              )}
            </div>}
          </div>
          {appMode === 'agent' && activeConversation && (
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 hidden sm:flex max-w-[30%]">
              <button
                type="button"
                onClick={() => {
                  setShowHistoryModal(true)
                  // Use setTimeout to ensure HistoryModal is mounted before setting editing id
                  setTimeout(() => {
                    useStore.getState().setAgentEditingConversationId(activeConversation.id)
                  }, 0)
                }}
                className="text-sm font-semibold text-gray-700 dark:text-gray-300 truncate hover:bg-gray-100 dark:hover:bg-white/[0.04] px-2 py-1 rounded transition-colors"
              >
                {activeConversation.title || 'Agent'}
              </button>
            </div>
          )}
          {showFavoriteCollectionTitle && (
            <div className="absolute left-1/2 top-1/2 hidden max-w-[30%] -translate-x-1/2 -translate-y-1/2 sm:flex">
              <div className="truncate rounded px-2 py-1 text-sm font-semibold text-gray-700 dark:text-gray-300" title={favoriteCollectionTitle}>
                {favoriteCollectionTitle}
              </div>
            </div>
          )}
          {appMode === 'canvas' && <div id="canvas-header-slot" className="canvas-header-slot" />}
          <AppModeNav appMode={appMode} onChange={switchAppMode} />
          <div className="app-header-actions flex items-center gap-1 shrink-0">
            {!isPwaInstalled && (
              <div
                className="relative"
                {...installTooltip.handlers}
              >
                <button
                  onClick={() => {
                    dismissAllTooltips()
                    handleInstallClick()
                  }}
                  className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-900 transition-colors"
                  aria-label="安装为应用"
                >
                  <InstallIcon className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                </button>
                <ViewportTooltip visible={installTooltip.visible} className="whitespace-nowrap">
                  安装为应用
                </ViewportTooltip>
              </div>
            )}
            <div
              className="relative"
              {...helpTooltip.handlers}
            >
              <button
                onClick={() => {
                  dismissAllTooltips()
                  setShowHelp(true)
                }}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-900 transition-colors"
                aria-label="操作指南"
              >
                <HelpCircleIcon className="w-5 h-5 text-gray-600 dark:text-gray-400" />
              </button>
              <ViewportTooltip visible={helpTooltip.visible} className="whitespace-nowrap">
                操作指南
              </ViewportTooltip>
            </div>
            <div
              className="relative"
              {...themeTooltip.handlers}
            >
              <button
                type="button"
                onClick={() => {
                  dismissAllTooltips()
                  setSettings({ theme: dark ? 'light' : 'dark' })
                }}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-900 transition-colors"
                aria-label={dark ? '切换到浅色模式' : '切换到深色模式'}
              >
                {dark
                  ? <SunIcon className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                  : <MoonIcon className="w-5 h-5 text-gray-600 dark:text-gray-400" />}
              </button>
              <ViewportTooltip visible={themeTooltip.visible} className="whitespace-nowrap">
                {dark ? '切换到浅色模式' : '切换到深色模式'}
              </ViewportTooltip>
            </div>
            <div
              className="relative"
              {...settingsTooltip.handlers}
            >
              <button
                onClick={() => setShowSettings(true)}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-900 transition-colors"
                aria-label="设置"
              >
                <SettingsIcon className="w-5 h-5 text-gray-600 dark:text-gray-400" />
              </button>
              <ViewportTooltip visible={settingsTooltip.visible} className="whitespace-nowrap">
                设置
              </ViewportTooltip>
            </div>
          </div>
        </div>
        <div className={`safe-area-x sm:hidden overflow-hidden transition-all duration-300 ease-in-out ${appMode === 'gallery' && scrollDirection === 'down' ? 'max-h-0 opacity-0 pb-0' : 'max-h-20 opacity-100 pb-2'}`}>
          <AppModeNav appMode={appMode} mobile onChange={switchAppMode} />
        </div>
      </header>
      
      {/* Hint for sliding down */}
      <div className={`fixed top-0 left-0 right-0 z-30 flex justify-center pointer-events-none transition-all duration-300 ease-in-out sm:hidden ${appMode === 'agent' && hintVisible && !agentMobileHeaderVisible ? 'translate-y-[env(safe-area-inset-top,0px)] opacity-100' : '-translate-y-full opacity-0'}`}>
        <div className="bg-black/60 backdrop-blur-sm text-white text-xs px-3 py-1.5 rounded-b-xl shadow-lg">
          下拉展示顶栏
        </div>
      </div>

      <div className={`app-header-spacer safe-area-top invisible shrink-0 pointer-events-none transition-all duration-300 ease-in-out ${appMode === 'canvas' ? 'app-header-spacer-canvas' : ''} ${appMode === 'agent' && !agentMobileHeaderVisible ? 'max-h-0 sm:max-h-[500px] opacity-0 sm:opacity-100 overflow-hidden sm:overflow-visible' : 'max-h-[500px] opacity-100'}`} aria-hidden="true">
        <div className="safe-header-inner" />
        <div className={`safe-area-x sm:hidden overflow-hidden transition-all duration-300 ease-in-out ${appMode === 'gallery' && scrollDirection === 'down' ? 'max-h-0 pb-0' : 'max-h-20 pb-2'}`}>
          <div className="p-1">
            <div className="py-1.5 text-sm">占位</div>
          </div>
        </div>
      </div>
      {showHelp && <HelpModal appMode={appMode} isFavoriteCollectionOverview={appMode === 'gallery' && filterFavorite && !activeFavoriteCollectionId} onClose={() => setShowHelp(false)} />}
    </>
  )
}
