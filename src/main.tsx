import 'core-js/actual/array/at'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MotionConfig } from 'motion/react'
import App from './App'
import 'streamdown/styles.css'
import 'katex/dist/katex.min.css'
import './index.css'
import { installMobileViewportGuards } from './lib/viewport'
import { MOTION_DURATION, MOTION_EASE } from './lib/motion'
import { usePrefersReducedMotion } from './hooks/usePrefersReducedMotion'

installMobileViewportGuards()

if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((error) => {
        console.error('Service worker registration failed:', error)
      })
    })
  } else {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => registration.unregister())
    })
  }
}

function Root() {
  const reducedMotion = usePrefersReducedMotion()
  return (
    <MotionConfig reducedMotion={reducedMotion ? 'always' : 'never'} transition={{ duration: reducedMotion ? 0 : MOTION_DURATION.standard / 1000, ease: MOTION_EASE }}>
      <App />
    </MotionConfig>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
