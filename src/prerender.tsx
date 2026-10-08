import { renderToString } from 'react-dom/server'
import { PageRoot } from './pages/shared/auth/mount'
import { Home } from './pages/home/Home'
import { WorkstationPage } from './pages/workstation/WorkstationPage'

export const render = (page: string) => renderToString(
  <PageRoot>{page === 'home' ? <Home /> : <WorkstationPage />}</PageRoot>,
)
