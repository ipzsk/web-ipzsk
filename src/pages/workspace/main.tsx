import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { LucideProvider } from 'lucide-react'
import '@/ui/ui.css'
import { queryClient } from '@/shared/query'
import { Toaster, TooltipProvider } from '@/ui'
import { loadLocal } from './store'
import { App } from './App'

// Guest drafts load synchronously (legacy: load() before auth()), so the first paint already shows them.
loadLocal()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <LucideProvider size={16} strokeWidth={1.75}>
        <TooltipProvider>
          <App />
          <Toaster />
        </TooltipProvider>
      </LucideProvider>
    </QueryClientProvider>
  </StrictMode>,
)
