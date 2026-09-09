import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
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
  const reducedMotion = useReducedMotion()

  return (
    <nav aria-label="工作区" className={mobile
      ? 'app-mode-nav relative mx-2 grid h-[42px] grid-cols-3 items-center gap-1 rounded-xl border border-gray-200/80 bg-gray-100/70 p-1 dark:border-white/[0.08] dark:bg-white/[0.04]'
      : 'app-mode-nav relative mr-3 hidden h-[42px] w-[238px] shrink-0 self-center grid-cols-3 items-center gap-1 rounded-xl border border-gray-200/80 bg-gray-100/70 p-1 dark:border-white/[0.08] dark:bg-white/[0.04] sm:grid'}
    >
      <motion.span
        data-app-mode-indicator
        aria-hidden="true"
        className="pointer-events-none absolute bottom-1 left-1 top-1 rounded-lg bg-white shadow-sm ring-1 ring-black/[0.04] dark:bg-white/10 dark:ring-white/[0.06]"
        style={{ width: 'calc((100% - 1rem) / 3)' }}
        initial={false}
        animate={{ x: `calc(${activeIndex * 100}% + ${activeIndex * 0.25}rem)` }}
        transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 38, mass: 0.8 }}
      />
      {APP_MODES.map((item) => {
        const active = appMode === item.mode
        return (
          <button
            key={item.mode}
            type="button"
            onClick={() => onChange(item.mode)}
            aria-pressed={active}
            className={`relative flex h-8 min-w-0 items-center justify-center whitespace-nowrap rounded-lg text-sm font-medium leading-none transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 ${mobile ? 'px-1' : 'px-2'} ${
              active
                ? 'text-gray-900 dark:text-white'
                : 'text-gray-500 hover:bg-black/[0.03] hover:text-gray-800 dark:hover:bg-white/[0.04] dark:hover:text-gray-200'
            }`}
          >
            {item.label}
          </button>
        )
      })}
    </nav>
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
            {appMode === 'agent' && <div className="relative hidden shrink-0 items-center gap-1 sm:flex">
              <button
                ref={historyButtonRef}
                type="button"
                onClick={() => setShowHistoryModal((visible) => !visible)}
                className="app-header-action"
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
                className="app-header-action"
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
            <div className="mr-3 hidden min-w-0 max-w-[24%] items-center lg:flex">
              <button
                type="button"
                onClick={() => {
                  setShowHistoryModal(true)
                  // 等历史面板挂载后再进入重命名。
                  setTimeout(() => {
                    useStore.getState().setAgentEditingConversationId(activeConversation.id)
                  }, 0)
                }}
                className="h-9 min-w-0 truncate rounded-lg px-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 dark:text-gray-300 dark:hover:bg-white/[0.04]"
              >
                {activeConversation.title || 'Agent'}
              </button>
            </div>
          )}
          {showFavoriteCollectionTitle && (
            <div className="mr-3 hidden min-w-0 max-w-[24%] items-center lg:flex">
              <div className="truncate rounded px-2 py-1 text-sm font-semibold text-gray-700 dark:text-gray-300" title={favoriteCollectionTitle}>
                {favoriteCollectionTitle}
              </div>
            </div>
          )}
          {appMode === 'canvas' && <div id="canvas-header-slot" className="canvas-header-slot" />}
          <AppModeNav appMode={appMode} onChange={switchAppMode} />
          <div className="app-header-actions flex shrink-0 items-center gap-1 sm:border-l sm:border-gray-200/80 sm:pl-3 dark:sm:border-white/[0.08]">
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
                  className="app-header-action"
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
                className="app-header-action"
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
                className="app-header-action"
                aria-label={dark ? '切换到浅色模式' : '切换到深色模式'}
              >
                <span key={dark ? 'dark' : 'light'} className="app-header-theme-icon">
                  {dark
                    ? <SunIcon className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                    : <MoonIcon className="w-5 h-5 text-gray-600 dark:text-gray-400" />}
                </span>
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
                className="app-header-action"
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

      <div className={`app-header-spacer safe-area-top invisible shrink-0 border-b border-transparent pointer-events-none transition-[max-height,opacity] duration-300 ease-in-out ${appMode === 'canvas' ? 'app-header-spacer-canvas' : ''} ${appMode === 'agent' && !agentMobileHeaderVisible ? 'max-h-0 sm:max-h-[500px] opacity-0 sm:opacity-100 overflow-hidden sm:overflow-visible' : 'max-h-[500px] opacity-100'}`} aria-hidden="true">
        <div className="safe-header-inner" />
        <div className={`safe-area-x sm:hidden overflow-hidden transition-all duration-300 ease-in-out ${appMode === 'gallery' && scrollDirection === 'down' ? 'max-h-0 pb-0' : 'max-h-20 pb-2'}`}>
          <div className="h-[42px]" />
        </div>
      </div>
      {showHelp && <HelpModal appMode={appMode} isFavoriteCollectionOverview={appMode === 'gallery' && filterFavorite && !activeFavoriteCollectionId} onClose={() => setShowHelp(false)} />}
    </>
  )
}
