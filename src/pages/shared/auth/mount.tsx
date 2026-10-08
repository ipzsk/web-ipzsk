import { StrictMode, type ReactNode } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { LucideProvider } from 'lucide-react'
import '@/ui/ui.css'
import { queryClient } from '@/shared/query'
import { Toaster, TooltipProvider } from '@/ui'
import { SiteHeader } from '@/studio/SiteHeader'

/** Shared bootstrap for the F9 account / developer / workstation pages: providers + site header. */
export function PageRoot({ children }: { children: ReactNode }) {
  return (
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <LucideProvider size={16} strokeWidth={1.75}>
          <TooltipProvider>
            <SiteHeader />
            {children}
            <Toaster />
          </TooltipProvider>
        </LucideProvider>
      </QueryClientProvider>
    </StrictMode>
  )
}

export function mountPage(page: ReactNode) {
  const root = document.getElementById('root')!
  const tree = <PageRoot>{page}</PageRoot>
  if (root.hasChildNodes()) hydrateRoot(root, tree)
  else createRoot(root).render(tree)
}
