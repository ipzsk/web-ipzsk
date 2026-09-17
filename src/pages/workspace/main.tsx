import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/styles/theme.css'

// F9 migration target for the legacy /workspace page (preview at /next/workspace until cutover).
createRoot(document.getElementById('root')!).render(<StrictMode><main className="p-8 text-sm text-muted">迁移中</main></StrictMode>)
