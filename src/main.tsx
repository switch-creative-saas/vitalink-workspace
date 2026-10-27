import { createRoot } from 'react-dom/client'
import './index.css'
import 'leaflet/dist/leaflet.css'
import App from './App.tsx'
import { initTheme } from './lib/theme.ts'

initTheme()

createRoot(document.getElementById('root')!).render(
  <App />,
)

// Offline app shell (production builds only; the dev server reloads too often for it).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => undefined);
  });
}
