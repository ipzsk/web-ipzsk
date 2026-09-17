import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider, createBrowserRouter } from 'react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { LucideProvider } from 'lucide-react'
import '@/ui/ui.css'
import { qk, queryClient } from '@/shared/query'
import { isMock } from '@/studio/api/catalog'
import { Toaster, TooltipProvider } from '@/ui'
import { App } from './App'

if (isMock) {
  // Mock: the site header shouldn't hit the real profile/wallet endpoints.
  for (const key of [qk.me, qk.wallet, ['me', 'roles']]) queryClient.setQueryDefaults(key, { staleTime: Infinity, refetchOnWindowFocus: false })
  queryClient.setQueryData(qk.me, { id: 'u-me', email: 'icycat@ipzsk.com' })
  queryClient.setQueryData(qk.wallet, { available_points: '1280', frozen_points: '0' })
  queryClient.setQueryData(['me', 'roles'], ['admin'])
}

// Data router: the case editor uses useBlocker for unsaved edits (§4.4).
const router = createBrowserRouter([{ path: '*', element: <App /> }])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <LucideProvider size={16} strokeWidth={1.75}>
        <TooltipProvider>
          <RouterProvider router={router} />
          <Toaster />
        </TooltipProvider>
      </LucideProvider>
    </QueryClientProvider>
  </StrictMode>,
)
