import { useLayoutEffect, useState } from 'react'
import { App, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom'
import CanvasPage from './pages/canvas'
import CanvasProjectPage from './pages/canvas/project'
import CanvasAgentPanelHost from './CanvasAgentPanelHost'
import { ClientRootInit } from './components/layout/client-root-init'
import { getAntThemeConfig } from './lib/app-theme'
import { setCanvasOverlayHost } from './lib/overlay-host'
import { useThemeStore } from './stores/use-theme-store'
import { useAgentStore } from './stores/use-agent-store'
import './canvas.css'
import './integration.css'
import './responsive.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
})

export default function InfiniteCanvasModule() {
  const theme = useThemeStore((state) => state.theme)
  const dark = theme === 'dark'
  const [overlayRoot, setOverlayRoot] = useState<HTMLDivElement | null>(null)

  useLayoutEffect(() => {
    const root = document.createElement('div')
    root.className = 'infinite-canvas-module infinite-canvas-overlay-root'
    root.style.fontFamily = '"SF Pro Display","SF Pro Text","PingFang SC","Microsoft YaHei","Helvetica Neue",sans-serif'
    document.body.appendChild(root)
    setCanvasOverlayHost(root)
    setOverlayRoot(root)

    return () => {
      setCanvasOverlayHost(null)
      root.remove()
    }
  }, [])

  useLayoutEffect(() => {
    overlayRoot?.classList.toggle('dark', dark)
  }, [dark, overlayRoot])

  useLayoutEffect(() => () => {
    const agent = useAgentStore.getState()
    agent.closePanel()
    agent.setPanelProjectId(null)
  }, [])

  return (
    <div
      className={`infinite-canvas-module canvas-module-host ${dark ? 'dark' : ''}`}
      style={{
        fontFamily: '"SF Pro Display","SF Pro Text","PingFang SC","Microsoft YaHei","Helvetica Neue",sans-serif',
      }}
    >
      {overlayRoot && (
        <ConfigProvider
          locale={zhCN}
          theme={getAntThemeConfig(dark)}
          getPopupContainer={() => overlayRoot}
        >
          <App className="h-full min-h-0">
            <QueryClientProvider client={queryClient}>
              <ClientRootInit>
                <MemoryRouter initialEntries={['/canvas']}>
                  <div className="canvas-module-shell relative flex h-full min-h-0 overflow-hidden">
                    <div className="min-w-0 flex-1 overflow-hidden">
                      <Routes>
                        <Route path="/" element={<Navigate to="/canvas" replace />} />
                        <Route path="/canvas" element={<CanvasPage />} />
                        <Route path="/canvas/:id" element={<CanvasProjectPage />} />
                        <Route path="*" element={<Navigate to="/canvas" replace />} />
                      </Routes>
                    </div>
                    <CanvasAgentPanelHost />
                  </div>
                </MemoryRouter>
              </ClientRootInit>
            </QueryClientProvider>
          </App>
        </ConfigProvider>
      )}
    </div>
  )
}
