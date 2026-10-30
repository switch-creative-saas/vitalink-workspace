import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initTheme } from './lib/theme.ts'
import { applyDataSaver } from './lib/network/dataSaver.ts'

initTheme()
applyDataSaver()

createRoot(document.getElementById('root')!).render(
  <App />,
)

// Offline app shell (production builds only; the dev server reloads too often for it). After
// sign-in, lib/offline/prepare.ts asks it to download every page too.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => undefined)
  })
}
