import { lazy, Suspense, useEffect, useRef } from 'react'
import { initStore, useStore } from './store'
import Header from './components/Header'
import SearchBar from './components/SearchBar'
import TaskGrid from './components/TaskGrid'
import InputBar from './components/InputBar'
import Lightbox from './components/Lightbox'
import ConfirmDialog from './components/ConfirmDialog'
import Toast from './components/Toast'
import ImageContextMenu from './components/ImageContextMenu'
import SupportPromptModal from './components/SupportPromptModal'
import { FavoriteCollectionPickerModal, FavoriteCollectionsView, ManageCollectionsModal } from './components/FavoriteCollections'
import { useGlobalClickSuppression } from './lib/clickSuppression'
import { useThemeStore as useCanvasThemeStore } from './infiniteCanvas/stores/use-theme-store'

const AgentWorkspace = lazy(() => import('./components/AgentWorkspace'))
const InfiniteCanvasWorkspace = lazy(() => import('./components/InfiniteCanvasWorkspace'))
const DetailModal = lazy(() => import('./components/DetailModal'))
const SettingsModal = lazy(() => import('./components/SettingsModal'))
const MaskEditorModal = lazy(() => import('./components/MaskEditorModal'))

export default function App() {
  const appMode = useStore((s) => s.appMode)
  const showSettings = useStore((s) => s.showSettings)
  const detailTaskId = useStore((s) => s.detailTaskId)
  const maskEditorImageId = useStore((s) => s.maskEditorImageId)
  const filterFavorite = useStore((s) => s.filterFavorite)
  const activeFavoriteCollectionId = useStore((s) => s.activeFavoriteCollectionId)
  const themePreference = useStore((s) => s.settings.theme)
  const hasConfiguredApiKey = useStore((s) => s.settings.profiles.some((profile) => Boolean(profile.apiKey.trim())))
  const setShowSettings = useStore((s) => s.setShowSettings)
  const missingApiKeyPromptedRef = useRef(false)
  useGlobalClickSuppression()

  useEffect(() => {
    void initStore().catch((error) => {
      console.error('初始化本地数据失败', error)
      useStore.getState().showToast('本地数据加载失败，请刷新后重试', 'error')
    })
  }, [])

  useEffect(() => {
    if (hasConfiguredApiKey) {
      missingApiKeyPromptedRef.current = false
      return
    }
    if (missingApiKeyPromptedRef.current) return

    missingApiKeyPromptedRef.current = true
    setShowSettings(true, 'api')
  }, [hasConfiguredApiKey, setShowSettings])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const applyTheme = () => {
      const dark = themePreference === 'dark' || (themePreference === 'system' && media.matches)
      document.documentElement.classList.toggle('dark', dark)
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#111827' : '#f9fafb')
      useCanvasThemeStore.setState({ theme: dark ? 'dark' : 'light' })
    }

    applyTheme()
    if (themePreference !== 'system') return
    media.addEventListener('change', applyTheme)
    return () => media.removeEventListener('change', applyTheme)
  }, [themePreference])

  useEffect(() => {
    const preventPageImageDrag = (e: DragEvent) => {
      if ((e.target as HTMLElement | null)?.closest('img')) {
        e.preventDefault()
      }
    }

    document.addEventListener('dragstart', preventPageImageDrag)
    return () => document.removeEventListener('dragstart', preventPageImageDrag)
  }, [])

  return (
    <div className={appMode === 'canvas' ? 'canvas-app-shell flex h-dvh min-h-0 flex-col overflow-hidden' : 'min-h-dvh'}>
      <Header />
      <div className={appMode === 'canvas' ? 'app-mode-stage app-mode-stage-canvas' : 'app-mode-stage'}>
        <Suspense fallback={<div className="p-6" role="status">正在加载工作区…</div>}>
        {appMode === 'canvas' ? (
          <InfiniteCanvasWorkspace />
        ) : appMode === 'agent' ? (
          <AgentWorkspace />
        ) : (
          <main data-home-main data-drag-select-surface className="pb-48">
            <div className="safe-area-x max-w-7xl mx-auto">
              <SearchBar />
              {filterFavorite && !activeFavoriteCollectionId ? <FavoriteCollectionsView /> : <TaskGrid />}
            </div>
          </main>
        )}
        </Suspense>
      </div>
      {appMode !== 'canvas' && (
        <>
          <InputBar />
          <Suspense fallback={null}>{detailTaskId && <DetailModal />}</Suspense>
          <Lightbox />
          <SupportPromptModal />
          <FavoriteCollectionPickerModal />
          <ManageCollectionsModal />
          <Suspense fallback={null}>{maskEditorImageId && <MaskEditorModal />}</Suspense>
          <ImageContextMenu />
        </>
      )}
      <Suspense fallback={null}>{showSettings && <SettingsModal />}</Suspense>
      <ConfirmDialog />
      <Toast />
    </div>
  )
}
