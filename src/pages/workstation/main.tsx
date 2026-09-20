import { mountPage } from '@/pages/shared/auth/mount'
import { WorkstationPage } from './WorkstationPage'

// F9 migration of the legacy /workstation page (preview at /next/workstation until cutover).
mountPage(<WorkstationPage />)
