import { useState, type ComponentProps, type ReactNode } from 'react'
import { Dialog as D } from 'radix-ui'
import { X } from 'lucide-react'
import { Badge, Button, DialogContent, DialogFooter, Dialog, IconButton, cn, focusRing } from '@/ui'
import { ApiError } from '@/shared/api'
import { STATUS_LABEL, type CaseStatus } from './lib'

/** Right-side panel (Radix dialog: focus trap, Esc, focus returns to trigger). */
export function Drawer({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  return (
    <D.Root open={open} onOpenChange={o => { if (!o) onClose() }}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-ink/30 motion-safe:animate-fade-in" />
        <D.Content tabIndex={-1} onOpenAutoFocus={e => { e.preventDefault(); (e.currentTarget as HTMLElement).focus() }} className={cn('fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-line bg-card shadow-2xl outline-none motion-safe:animate-fade-in', wide ? 'max-w-3xl' : 'max-w-xl')}>
          <div className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-5">
            <D.Title className="min-w-0 flex-1 truncate text-base font-bold">{title}</D.Title>
            <D.Description className="sr-only">详情</D.Description>
            <D.Close asChild><IconButton label="关闭" size="icon-sm"><X /></IconButton></D.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
          {footer && <div className="flex shrink-0 justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}

/** Danger/permission confirmation. `onConfirm` is awaited: the dialog stays open with a spinner until the server answers (§6 exceptions). */
export function Confirm({ open, onOpenChange, title, description, confirmLabel, loadingText, danger, onConfirm, children }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description: ReactNode; confirmLabel: string; loadingText?: string; danger?: boolean
  onConfirm: () => Promise<unknown>; children?: ReactNode
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <Dialog open={open} onOpenChange={o => { if (!busy) { setError(null); onOpenChange(o) } }}>
      <DialogContent title={title} description={description}>
        {children}
        {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} disabled={busy}>取消</Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            loading={busy}
            loadingText={loadingText ?? '处理中'}
            onClick={async () => {
              setBusy(true); setError(null)
              try { await onConfirm(); onOpenChange(false) } catch (e) { setError(adminErrorText(e)) } finally { setBusy(false) }
            }}
          >{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const ADMIN_ERRORS: Record<string, string> = {
  forbidden_role: '你的角色没有这个操作的权限。',
  admin_session_expired: '登录会话已失效，请重新登录。',
  case_publish_invalid: '发布前还有字段没填好。',
  case_conflict: '案例已被其他人修改，已载入最新版本，请重新编辑。',
  case_order_conflict: '列表顺序已变化，已刷新，请重新拖动。',
  case_not_draft: '只能删除草稿；已发布过的案例请隐藏。',
  case_id_taken: '这个 id 已被使用。',
  cannot_revoke_own_admin: '不能撤销自己的管理员角色。',
  last_admin: '这是最后一位管理员，不能撤销。',
  email_not_verified: '该用户邮箱未验证，不能授予管理角色。',
  generation_not_cancellable: '这条记录现在不能标记取消（需要卡住超过 2 小时）。',
  generation_not_syncable: '这条记录不需要同步。',
  upstream_unavailable: '上游暂时不可用，请稍后重试。',
  asset_not_ready: '图片还在处理，请稍后再设为封面。',
  storage_copy_failed: '封面复制失败，请重试。',
  invalid_amount: '金额为 0.01–1000 元，最多两位小数。',
  invalid_reason: '原因需 2–200 字。',
  idempotency_conflict: '这次提交与之前的内容不一致，请关闭后重新发起。',
  lanehub_account_missing: '该用户的计费账户开通失败，请稍后重试。',
  lanehub_adjustment_review: 'LaneHub 入账结果未知，已转人工核对。请勿改金额或原因重发；核对确认后按原内容重新提交即可补齐，不会重复入账。',
  lanehub_adjustment_not_applied: 'LaneHub 入账正在执行或已被终止，请稍后刷新；已终止的需要用新的原因重新发起。',
}
/** A message written for the operator (form validation inside onConfirm), shown as is. */
export const inputError = (message: string) => Object.assign(new Error(message), { userFacing: true })
export const adminErrorText = (e: unknown) =>
  e instanceof ApiError ? ADMIN_ERRORS[e.code] ?? e.message
    : e instanceof Error && (e as { userFacing?: boolean }).userFacing ? e.message : '操作未成功，请稍后重试。'

export function StatusBadge({ status }: { status: CaseStatus }) {
  return <Badge tone={status === 'published' ? 'acid' : status === 'hidden' ? 'neutral' : 'outline'}>{STATUS_LABEL[status]}</Badge>
}

const selectClass = cn('h-9 rounded-control border border-line bg-card px-2.5 text-sm text-ink hover:border-muted focus:border-acid focus:ring-3 focus:ring-acid/10', focusRing, 'focus-visible:outline-offset-0')

export function Select({ label, className, children, ...props }: ComponentProps<'select'> & { label: string }) {
  return (
    <label className="grid gap-1 text-xs font-semibold text-muted">
      <span className={props.hidden ? 'sr-only' : undefined}>{label}</span>
      <select className={cn(selectClass, className)} {...props}>{children}</select>
    </label>
  )
}

/** Compact filter input with a visible label (not placeholder-only). */
export function FilterInput({ label, className, ...props }: ComponentProps<'input'> & { label: string }) {
  return (
    <label className="grid gap-1 text-xs font-semibold text-muted">
      {label}
      <input className={cn(selectClass, 'px-3 placeholder:text-muted', className)} {...props} />
    </label>
  )
}

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <h1 className="text-2xl font-black tracking-[-0.5px]">{title}</h1>
      <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>
    </div>
  )
}

export function KV({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[112px_1fr] gap-3 py-1.5 text-sm">
      <dt className="text-muted">{k}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  )
}
