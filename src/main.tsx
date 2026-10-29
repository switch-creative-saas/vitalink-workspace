import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initTheme } from './lib/theme.ts'
import { applyDataSaver, isLowData, onDataSaverChange } from './lib/network/dataSaver.ts'

initTheme()
applyDataSaver()

createRoot(document.getElementById('root')!).render(
  <App />,
)

// Offline app shell (production builds only; the dev server reloads too often for it). The rest of
// the app is cached in the background only while the connection is good and data saver is off.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
      .then(async () => {
        const ready = await navigator.serviceWorker.ready
        const warm = () => { if (navigator.onLine && !isLowData()) ready.active?.postMessage({ type: 'warm' }) }
        window.setTimeout(warm, 10_000)
        window.addEventListener('online', warm)
        onDataSaverChange(warm)
      })
      .catch(() => undefined)
  })
}
