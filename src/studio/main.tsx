import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { LucideProvider } from 'lucide-react'
import '@/ui/ui.css'
import { queryClient } from '@/shared/query'
import { Toaster, TooltipProvider } from '@/ui'
import { readKindOnce } from './store'
import { App } from './App'

readKindOnce(location.search)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <LucideProvider size={16} strokeWidth={1.75}>
        <TooltipProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
          <Toaster />
        </TooltipProvider>
      </LucideProvider>
    </QueryClientProvider>
  </StrictMode>,
)
