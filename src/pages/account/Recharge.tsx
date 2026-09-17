import { queryClient } from '@/shared/query'
import { RechargeDialog as SharedRechargeDialog, WALLET_KEY, fetchWallet as sharedFetchWallet, type AccountWallet } from '@/shared/recharge/RechargeDialog'
import { PROFILE_KEY } from './lib'

// The dialog lives in src/shared/recharge (the studio opens it in-app); here a 401 also signs the account page out.
export { WALLET_KEY, type AccountWallet }
const signOut = () => queryClient.setQueryData(PROFILE_KEY, null)
export const fetchWallet = () => sharedFetchWallet(signOut)
export const RechargeDialog = (p: { open: boolean; onOpenChange: (o: boolean) => void }) => <SharedRechargeDialog {...p} onUnauthorized={signOut} />
