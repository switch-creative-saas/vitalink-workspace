// Entry for the VitaCard page alone (card.html): what a phone opens when a patient's card is tapped
// or scanned. It loads only this page, not the hospital app, so it opens fast on any connection,
// and it reads the same records through the vitacard edge function.
import { createRoot } from 'react-dom/client'
import './index.css'
import { CardPage } from './pages/CardPage.tsx'

createRoot(document.getElementById('root')!).render(<CardPage />)
