import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider, createBrowserRouter, createMemoryRouter } from 'react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { LucideProvider } from 'lucide-react'
import '@/ui/ui.css'
import { queryClient } from '@/shared/query'
import { Toaster, TooltipProvider } from '@/ui'
import { readKindOnce } from './store'
import { App } from './App'
import { EmbedNav } from './EmbedNav'
import { embedPane } from './embed'

readKindOnce(location.search)

// Data router (so the canvas leave guard's useBlocker also covers back/forward); App keeps its descendant <Routes>.
// IPZSK Desktop nav pane: a memory router mirroring the main pane, which owns the real URL.
const router = embedPane === 'nav'
  ? createMemoryRouter([{ path: '*', element: <EmbedNav /> }], { initialEntries: ['/studio'] })
  : createBrowserRouter([{ path: '*', element: <App /> }])

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
