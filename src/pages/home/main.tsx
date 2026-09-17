import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { LucideProvider } from 'lucide-react'
import './home.css'
import { Home } from './Home'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LucideProvider size={16} strokeWidth={1.75}><Home /></LucideProvider>
  </StrictMode>,
)
