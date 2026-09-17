import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/styles/theme.css'

function Studio() {
  return <main className="min-h-dvh p-8"><h1 className="text-2xl font-bold">创作工作台</h1></main>
}

createRoot(document.getElementById('root')!).render(<StrictMode><Studio /></StrictMode>)
