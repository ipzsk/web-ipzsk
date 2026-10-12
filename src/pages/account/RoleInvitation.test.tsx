import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ApiError, request } from '@/shared/api'
import { TooltipProvider } from '@/ui'
import { IdentityCard, captureInvitation, pendingInvitation } from './RoleInvitation'

vi.mock('@/shared/api', async importOriginal => ({ ...await importOriginal<typeof import('@/shared/api')>(), request: vi.fn() }))
const token = 'A'.repeat(40) + '_-9'
const none = { bd_active: false, developer_state: null, pending: [] }
function mount(mine: () => unknown, accept: () => unknown) {
  vi.mocked(request).mockImplementation(async (path: string) => path.endsWith('/accept') ? accept() : mine())
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><TooltipProvider><IdentityCard /></TooltipProvider></QueryClientProvider>)
}
afterEach(() => { cleanup(); vi.clearAllMocks(); sessionStorage.clear(); history.replaceState(null, '', '/account') })

describe('role invitation link', () => {
  it('moves the token out of the address bar and keeps it for the login round-trip', () => {
    history.replaceState(null, '', '/account?next=%2Fstudio#invite=' + token)
    expect(captureInvitation()).toBe(token)
    expect(location.hash).toBe('')
    expect(location.search).toBe('?next=%2Fstudio')
    expect(pendingInvitation()).toBe(token)
  })
  it('ignores malformed fragments', () => {
    history.replaceState(null, '', '/account#invite=short')
    expect(captureInvitation()).toBeNull()
    expect(location.hash).toBe('#invite=short')
  })
  it('accepts once, posts the token in the body and shows the new identity', async () => {
    sessionStorage.setItem('ipzsk.role-invitation', token)
    let accepted = false
    mount(() => accepted ? { ...none, bd_active: true } : none, () => { accepted = true; return { role: 'bd', state: 'accepted' } })
    await userEvent.click(screen.getByRole('button', { name: '接受邀请' }))
    await screen.findByText('已接受邀请，BD身份已开通。')
    expect(vi.mocked(request)).toHaveBeenCalledWith('/api/me/role-invitations/accept', { body: { token } })
    expect(pendingInvitation()).toBeNull()
    expect(screen.queryByRole('button', { name: '接受邀请' })).toBeNull()
    await waitFor(() => expect(screen.getByText('BD 邀请链接与分佣')).toBeTruthy())
  })
  it('explains a link meant for another account and drops it', async () => {
    sessionStorage.setItem('ipzsk.role-invitation', token)
    mount(() => none, () => { throw new ApiError('x', { status: 403, code: 'invitation_account_mismatch' }) })
    await userEvent.click(screen.getByRole('button', { name: '接受邀请' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/发给了另一个账号/)
    expect(pendingInvitation()).toBeNull()
  })
  it('without a link, lists pending invitations and states that access is invitation-only', async () => {
    mount(() => ({ ...none, pending: [{ id: 'i1', role: 'developer', created_at: '2026-10-12T00:00:00Z', expires_at: '2026-10-19T00:00:00Z' }] }), () => null)
    expect(await screen.findByText(/管理员已向你发出插件开发者邀请/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: '接受邀请' })).toBeNull()
  })
})
