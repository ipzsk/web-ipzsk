import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { LucideProvider } from 'lucide-react'
import '@/ui/ui.css'
import { queryClient } from '@/shared/query'
import { Toaster, TooltipProvider } from '@/ui'
import { SiteHeader } from '@/studio/SiteHeader'

/** Shared bootstrap for the F9 account / developer / workstation pages: providers + site header. */
export function mountPage(page: ReactNode) {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <LucideProvider size={16} strokeWidth={1.75}>
          <TooltipProvider>
            <SiteHeader />
            {page}
            <Toaster />
          </TooltipProvider>
        </LucideProvider>
      </QueryClientProvider>
    </StrictMode>,
  )
}
