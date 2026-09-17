import { mountPage } from '@/pages/shared/auth/mount'
import { AccountPage } from './AccountPage'

// F9 migration of the legacy /account page (preview at /next/account until cutover).
mountPage(<AccountPage />)
