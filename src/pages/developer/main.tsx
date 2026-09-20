import { mountPage } from '@/pages/shared/auth/mount'
import { DeveloperPage } from './DeveloperPage'

// F9 migration of the legacy /developer page (preview at /next/developer until cutover).
mountPage(<DeveloperPage />)
