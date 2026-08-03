import { useEffect, useRef } from 'react'
import { initStore, useStore } from './store'
import Header from './components/Header'
import SearchBar from './components/SearchBar'
import TaskGrid from './components/TaskGrid'
import AgentWorkspace from './components/AgentWorkspace'
import InfiniteCanvasWorkspace from './components/InfiniteCanvasWorkspace'
import InputBar from './components/InputBar'
import DetailModal from './components/DetailModal'
import Lightbox from './components/Lightbox'
import SettingsModal from './components/SettingsModal'
import ConfirmDialog from './components/ConfirmDialog'
import Toast from './components/Toast'
import MaskEditorModal from './components/MaskEditorModal'
import ImageContextMenu from './components/ImageContextMenu'
import SupportPromptModal from './components/SupportPromptModal'
import { FavoriteCollectionPickerModal, FavoriteCollectionsView, ManageCollectionsModal } from './components/FavoriteCollections'
import { useGlobalClickSuppression } from './lib/clickSuppression'
import { useThemeStore as useCanvasThemeStore } from './infiniteCanvas/stores/use-theme-store'

export default function App() {
  const appMode = useStore((s) => s.appMode)
  const filterFavorite = useStore((s) => s.filterFavorite)
  const activeFavoriteCollectionId = useStore((s) => s.activeFavoriteCollectionId)
  const themePreference = useStore((s) => s.settings.theme)
  const hasConfiguredApiKey = useStore((s) => s.settings.profiles.some((profile) => Boolean(profile.apiKey.trim())))
  const setShowSettings = useStore((s) => s.setShowSettings)
  const missingApiKeyPromptedRef = useRef(false)
  useGlobalClickSuppression()

  useEffect(() => {
    void initStore()
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
      </div>
      {appMode !== 'canvas' && (
        <>
          <InputBar />
          <DetailModal />
          <Lightbox />
          <SupportPromptModal />
          <FavoriteCollectionPickerModal />
          <ManageCollectionsModal />
          <MaskEditorModal />
          <ImageContextMenu />
        </>
      )}
      <SettingsModal />
      <ConfirmDialog />
      <Toast />
    </div>
  )
}
