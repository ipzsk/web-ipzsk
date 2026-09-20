import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowLeft, CircleCheck, Eye, EyeOff, ShieldCheck } from 'lucide-react'
import { Button, IconButton, Input, cn, focusRing } from '@/ui'
import { useHumanProof, type CaptchaAction } from './Captcha'
import {
  AccountError, FLOW_KEY, call, clearPendingFlow, cooldownSeconds, normalizeEmail, readFlow, rememberFlow,
  type Flow, type FlowKind,
} from './lib'

// Port of auth-ui.js: login / register + email OTP / password reset, one view at a time, URL-synced (?mode=&step=).
export type View = 'login' | 'register' | 'verify' | 'reset' | 'reset-confirm' | 'success'

const VIEWS: Record<View, [string, string, string]> = {
  login: ['欢迎回来', '登录你的 IPZSK 账户，继续工作。', ''],
  register: ['创建账户', '用邮箱创建账户，验证后即可登录。', '第 1 步，共 2 步 · 设置账户'],
  verify: ['验证你的邮箱', '输入邮件中的验证码，完成账户注册。', '第 2 步，共 2 步 · 验证邮箱'],
  reset: ['找回密码', '输入注册邮箱，我们会发送重置密码的验证码。', '第 1 步，共 2 步 · 确认邮箱'],
  'reset-confirm': ['设置新密码', '如果该邮箱已注册，你会收到验证码邮件。', '第 2 步，共 2 步 · 验证并重置'],
  success: ['操作成功', '', ''],
}

export interface Notice { text: string; error?: boolean }
type Fields = { email: string; password: string; otp: string }
type FieldName = keyof Fields

const loadFlow = () => { try { return readFlow(sessionStorage.getItem(FLOW_KEY)) } catch { return readFlow(null) } }

function viewFromURL(flow: Flow): { view: View; email?: string } {
  const params = new URLSearchParams(location.search)
  const mode = params.get('mode')
  const kind = mode === 'register' ? 'register' : mode === 'reset' ? 'reset' : 'login'
  const item = kind === 'login' ? undefined : flow.pending[kind]
  const view: View = kind === 'register' && params.get('step') === 'verify' && item ? 'verify'
    : kind === 'reset' && params.get('step') === 'password' && item ? 'reset-confirm' : kind
  return { view, email: item?.email }
}

function syncURL(view: View, replace: boolean) {
  const url = new URL(location.href)
  const mode = ['register', 'verify'].includes(view) ? 'register' : ['reset', 'reset-confirm'].includes(view) ? 'reset' : 'login'
  if (mode === 'login') url.searchParams.delete('mode'); else url.searchParams.set('mode', mode)
  if (view === 'verify') url.searchParams.set('step', 'verify')
  else if (view === 'reset-confirm') url.searchParams.set('step', 'password')
  else url.searchParams.delete('step')
  if (url.href !== location.href) history[replace ? 'replaceState' : 'pushState']({}, '', url)
}

function validate(view: View, f: Fields): Partial<Record<FieldName, string>> {
  const errors: Partial<Record<FieldName, string>> = {}
  const needs: FieldName[] = view === 'login' ? ['email', 'password'] : view === 'register' ? ['email', 'password']
    : view === 'verify' ? ['otp'] : view === 'reset' ? ['email'] : view === 'reset-confirm' ? ['otp', 'password'] : []
  for (const name of needs) {
    const v = f[name]
    if (!v) errors[name] = name === 'email' ? '请输入邮箱地址。' : name === 'otp' ? '请输入邮箱验证码。' : '请输入密码。'
    else if (name === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) errors[name] = '请输入有效的邮箱地址，例如 you@example.com。'
    else if (name === 'otp' && !/^\d{6}$/.test(v)) errors[name] = '验证码需要填写 6 位数字。'
    else if (name === 'password' && view !== 'login' && v.length < 12) errors[name] = '密码至少需要 12 个字符。'
    else if (v.length > (name === 'email' ? 254 : name === 'otp' ? 6 : 128)) errors[name] = '输入内容过长，请检查。'
  }
  return errors
}

export function AuthFlow({ ready, onSignedIn, notice, setNotice }: {
  /** null while /api/account/status is loading. */
  ready: boolean | null
  onSignedIn: () => void
  notice: Notice | null
  setNotice: (n: Notice | null) => void
}) {
  const [flow, setFlow] = useState<Flow>(loadFlow)
  const flowRef = useRef(flow)
  const [initial] = useState(() => viewFromURL(flow))
  const [view, setView] = useState<View>(initial.view)
  const [fields, setFields] = useState<Fields>({ email: initial.email ?? '', password: '', otp: '' })
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({})
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState<string | null>(null) // id of the working button
  const [completion, setCompletion] = useState<FlowKind>('register')
  const [, tick] = useState(0)
  const revision = useRef(0)
  const heading = useRef<HTMLHeadingElement>(null)
  const noticeRef = useRef<HTMLParagraphElement>(null)
  const inputs = useRef<Partial<Record<FieldName, HTMLInputElement | null>>>({})
  const focusAfter = useRef<(() => void) | null>(null)
  const { humanProof, cancel: cancelCaptcha, dialog } = useHumanProof()

  const saveFlow = (next: Flow) => {
    flowRef.current = next; setFlow(next)
    try { sessionStorage.setItem(FLOW_KEY, JSON.stringify(next)) } catch { /* private mode */ }
  }

  const show = useCallback((next: View, { email, url = true, replace = false, focus = true }: { email?: string; url?: boolean; replace?: boolean; focus?: boolean } = {}) => {
    revision.current++
    cancelCaptcha()
    setBusy(null); setErrors({}); setNotice(null); setShowPassword(false)
    setFields(f => ({ email: normalizeEmail(email ?? f.email), password: '', otp: '' }))
    setView(next)
    if (url) syncURL(next, replace)
    if (focus) focusAfter.current = () => heading.current?.focus()
  }, [cancelCaptcha, setNotice])

  useEffect(() => { syncURL(initial.view, true) }, [initial.view])
  useEffect(() => {
    const onPop = () => { const v = viewFromURL(flowRef.current); show(v.view, { email: v.email, url: true, replace: true }) }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [show])
  // Resend countdown: re-render every second while any cooldown is live.
  useEffect(() => {
    const t = setInterval(() => tick(n => n + 1), 1000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => { const f = focusAfter.current; focusAfter.current = null; f?.() })

  const [title, description, step] = VIEWS[view]
  const headingText = view === 'success' ? (completion === 'register' ? '账户已创建' : '密码已重置') : title
  const descriptionText = view === 'success' ? (completion === 'register' ? '邮箱验证成功，现在可以登录了。' : '请使用新密码重新登录。') : description
  useEffect(() => { document.title = headingText + ' · IPZSK' }, [headingText])

  const set = (name: FieldName, value: string) => {
    setFields(f => ({ ...f, [name]: value }))
    setErrors(e => { if (!e[name]) return e; const n = { ...e }; delete n[name]; return n })
  }

  const remember = (kind: FlowKind, email: string, sent = true) => saveFlow(rememberFlow(flowRef.current, kind, email, sent))
  const clearPending = (kind: FlowKind) => saveFlow(clearPendingFlow(flowRef.current, kind))

  async function send(path: string, body: Record<string, unknown>, isCurrent: () => boolean) {
    if (!ready) throw new Error('邮箱验证服务暂不可用，请稍后再试。')
    const action: CaptchaAction = path === '/api/auth/sign-up/email' ? 'register' : path === '/api/auth/email-otp/send-verification-otp' ? 'resend' : 'reset'
    const captcha = await humanProof(action, String(body.email))
    if (!isCurrent()) return false
    await call(path, { ...body, captcha })
    return isCurrent()
  }

  /** Legacy `run`: validate → busy → operation → errors land on the notice and the relevant field. */
  async function run(buttonId: string, operation: (f: Fields, isCurrent: () => boolean) => Promise<void>, validateForm = true) {
    if (busy) return
    const f = { ...fields, email: normalizeEmail(fields.email) }
    if (validateForm) {
      setFields(f)
      const errs = validate(view, f)
      setErrors(errs)
      const first = (['email', 'password', 'otp'] as const).find(n => errs[n])
      if (first) { setNotice({ text: '请检查下方填写的内容。', error: true }); inputs.current[first]?.focus(); return }
    }
    const rev = revision.current
    const isCurrent = () => revision.current === rev
    setBusy(buttonId); setNotice(null)
    try {
      await operation(f, isCurrent)
    } catch (error) {
      if (!isCurrent()) return
      const message = (error as Error).message || '操作未完成，请稍后再试。'
      setNotice({ text: message, error: true })
      const code = error instanceof AccountError ? error.code : undefined
      const field: FieldName | null = ['INVALID_OTP', 'OTP_EXPIRED', 'TOO_MANY_ATTEMPTS'].includes(code ?? '') ? 'otp' : code === 'PASSWORD_TOO_SHORT' ? 'password' : null
      if (field && view !== 'login' && view !== 'reset') { setErrors({ [field]: message }); inputs.current[field]?.focus() }
      else focusAfter.current = () => noticeRef.current?.focus()
    } finally {
      if (isCurrent()) setBusy(null)
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (view === 'login') return run('login', async ({ email, password }, isCurrent) => {
      const body = { email, password }
      try {
        try { await call('/api/auth/sign-in/email', body) } catch (error) {
          if (!(error instanceof AccountError) || error.code !== 'captcha_required') throw error
          const captcha = await humanProof('login', email)
          if (!isCurrent()) return
          await call('/api/auth/sign-in/email', { ...body, captcha })
        }
      } catch (error) {
        if (!isCurrent()) return
        const code = error instanceof AccountError ? error.code : undefined
        if (code === 'EMAIL_NOT_VERIFIED') {
          remember('register', email, false); show('verify', { email })
          setNotice({ text: '该邮箱尚未验证。请输入已收到的验证码，或点击重新发送。' }); return
        }
        if (code === 'INVALID_EMAIL_OR_PASSWORD') setFields(f => ({ ...f, password: '' }))
        throw error
      }
      if (isCurrent()) { setFields(f => ({ ...f, password: '' })); onSignedIn() }
    })
    if (view === 'register') return run('register', async ({ email, password }, isCurrent) => {
      try { if (!await send('/api/auth/sign-up/email', { email, password, name: email }, isCurrent)) return }
      catch (error) {
        if (isCurrent() && error instanceof AccountError && ['USER_ALREADY_EXISTS', 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL'].includes(error.code ?? '')) {
          show('login', { email }); setNotice({ text: '该邮箱已注册，请登录；忘记密码可以通过邮箱找回。' }); return
        }
        throw error
      }
      remember('register', email); show('verify', { email })
    })
    if (view === 'verify') return run('verify', async ({ email, otp }, isCurrent) => {
      await call('/api/auth/email-otp/verify-email', { email, otp })
      if (!isCurrent()) return
      clearPending('register'); setCompletion('register'); show('success', { email })
    })
    if (view === 'reset') return run('reset', async ({ email }, isCurrent) => {
      if (!await send('/api/auth/email-otp/request-password-reset', { email }, isCurrent)) return
      remember('reset', email); show('reset-confirm', { email })
    })
    if (view === 'reset-confirm') return run('reset-confirm', async ({ email, otp, password }, isCurrent) => {
      await call('/api/auth/email-otp/reset-password', { email, otp, password })
      if (!isCurrent()) return
      clearPending('reset'); setCompletion('reset'); show('success', { email })
    })
  }

  const resend = (kind: FlowKind) => run('resend', async ({ email }, isCurrent) => {
    const path = kind === 'register' ? '/api/auth/email-otp/send-verification-otp' : '/api/auth/email-otp/request-password-reset'
    const body = { email, ...(kind === 'register' ? { type: 'email-verification' } : {}) }
    if (!await send(path, body, isCurrent)) return
    remember(kind, email); setErrors({}); setFields(f => ({ ...f, otp: '' }))
    inputs.current.otp?.focus()
    setNotice({ text: '如果邮箱存在对应账户，你会收到新的验证码，请使用最新邮件中的验证码。' })
  }, false)

  const nav = (next: View) => { if (!busy) show(next) }
  const back = (kind: FlowKind) => {
    if (busy) return
    clearPending(kind); show(kind); focusAfter.current = () => inputs.current.email?.focus()
  }

  const cooldown = cooldownSeconds(flow, fields.email)
  const serviceReason = ready === null ? '正在检查验证服务…' : ready ? undefined : '邮箱验证服务暂不可用，请稍后再试。'
  const sendReason = (label: string) => busy ? '正在处理，请稍候' : serviceReason ?? (cooldown > 0 ? `${cooldown} 秒后可以重新发送` : label)
  const sendBlocked = !!busy || !ready || cooldown > 0
  const sendLabel = (label: string) => cooldown > 0 ? `${cooldown} 秒后重发` : label

  const emailInput = (label = '邮箱') => (
    <Input
      ref={el => { inputs.current.email = el }} label={label} name="email" type="email" autoComplete="username" placeholder="you@example.com"
      maxLength={254} required readOnly={!!busy} value={fields.email} error={errors.email} onChange={e => set('email', e.target.value)}
      onBlur={e => set('email', normalizeEmail(e.target.value))}
    />
  )
  const passwordInput = (label: string, autoComplete: 'current-password' | 'new-password', hint?: string, labelAction?: ReactNode) => (
    <div className="relative">
      {labelAction && <div className="absolute right-0 -top-1 z-10">{labelAction}</div>}
      <Input
        ref={el => { inputs.current.password = el }} label={label} name="password" type={showPassword ? 'text' : 'password'} autoComplete={autoComplete}
        minLength={autoComplete === 'new-password' ? 12 : undefined} maxLength={128} required readOnly={!!busy} value={fields.password}
        error={errors.password} hint={hint} onChange={e => set('password', e.target.value)} className="pr-11"
      />
      <IconButton
        label={showPassword ? '隐藏密码' : '显示密码'} aria-pressed={showPassword} size="icon-sm" className="absolute right-1 top-[29px] text-muted"
        onClick={() => setShowPassword(v => !v)}
      >{showPassword ? <EyeOff /> : <Eye />}</IconButton>
    </div>
  )
  const otpInput = (hint: string) => (
    <Input
      ref={el => { inputs.current.otp = el }} label="邮箱验证码" name="otp" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}"
      placeholder="6 位数字验证码" required readOnly={!!busy} value={fields.otp} error={errors.otp} hint={hint}
      className="h-12 font-mono text-lg tracking-[.35em] placeholder:font-sans placeholder:text-sm placeholder:tracking-normal"
      // Paste "123 456" / "验证码：123456" → digits only.
      onChange={e => set('otp', e.target.value.replace(/\D/g, '').slice(0, 6))}
    />
  )
  const primary = (id: string, label: string, busyLabel: string, extra?: { blocked?: boolean; reason?: string }) => (
    <Button
      type="submit" variant="primary" size="lg" className="w-full" loading={busy === id} loadingText={busyLabel}
      disabled={(!!busy && busy !== id) || extra?.blocked} disabledReason={extra?.reason ?? '正在处理，请稍候'}
    >{label}</Button>
  )
  const textButton = (label: ReactNode, onClick: () => void, className?: string) => (
    <button type="button" onClick={onClick} aria-disabled={!!busy || undefined}
      className={cn('rounded-[6px] px-1 font-semibold text-label underline decoration-label/40 underline-offset-4 hover:bg-subtle hover:decoration-label aria-disabled:cursor-not-allowed aria-disabled:opacity-45', focusRing, className)}
    >{label}</button>
  )
  const recipient = (label: string, kind: FlowKind) => (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-control bg-subtle px-3 py-2.5 text-sm">
      <span className="text-muted">{label}</span><strong className="min-w-0 flex-1 break-all">{fields.email}</strong>
      {textButton('修改邮箱', () => back(kind), 'text-[13px]')}
    </div>
  )
  const resendRow = (kind: FlowKind) => (
    <div className="flex flex-wrap items-center justify-center gap-2 text-sm text-muted">
      <span>没收到邮件？</span>
      <Button size="sm" variant="ghost" loading={busy === 'resend'} loadingText="正在发送" onClick={() => void resend(kind)}
        disabled={sendBlocked && busy !== 'resend'} disabledReason={sendReason('重新发送')} className="text-label">{sendLabel('重新发送')}</Button>
    </div>
  )
  const serviceStatus = ready !== true && <p role="status" className="text-center text-xs text-muted">{serviceReason}</p>

  return (
    <div className="rounded-panel border border-line bg-card p-8 shadow-[0_1px_0_rgba(29,31,32,.04)] max-sm:rounded-card max-sm:p-5">
      <header className="mb-6">
        {step && <p className="mb-2 text-xs font-semibold tracking-wide text-label">{step}</p>}
        <h1 ref={heading} tabIndex={-1} className="text-[28px] font-black tracking-[-.5px] outline-none">{headingText}</h1>
        {descriptionText && <p className="mt-2 text-sm leading-6 text-muted">{descriptionText}</p>}
      </header>
      {notice && (
        <p ref={noticeRef} tabIndex={-1} role={notice.error ? 'alert' : 'status'}
          className={cn('mb-5 rounded-control px-3 py-2.5 text-sm leading-6 outline-none', notice.error ? 'bg-danger/8 text-danger' : 'bg-acid-soft text-[#2867bd]')}
        >{notice.text}</p>
      )}

      {view === 'success' ? (
        <div className="grid justify-items-center gap-4 text-center">
          <CircleCheck className="size-12 text-success" strokeWidth={1.5} aria-hidden />
          <p className="break-all text-sm text-muted">{fields.email}</p>
          <Button variant="primary" size="lg" className="w-full" onClick={() => nav('login')}>去登录</Button>
        </div>
      ) : (
        <form noValidate onSubmit={submit} className="grid gap-5">
          {view === 'login' && <>
            {emailInput()}
            {passwordInput('密码', 'current-password', undefined, textButton('忘记密码？', () => nav('reset'), 'text-[13px]'))}
            {primary('login', '登录', '正在登录')}
          </>}
          {view === 'register' && <>
            {emailInput()}
            {passwordInput('设置密码', 'new-password', '至少 12 个字符，建议使用一句容易记住的话。')}
            {primary('register', '继续，验证邮箱', '正在发送', { blocked: sendBlocked, reason: sendReason('继续，验证邮箱') })}
            {serviceStatus}
          </>}
          {view === 'verify' && <>
            {recipient('验证邮箱', 'register')}
            {otpInput('验证码 5 分钟内有效，请勿与他人分享。')}
            {primary('verify', '验证并完成注册', '正在验证')}
            {resendRow('register')}
            <p className="-mt-3 text-center text-xs text-muted">也可以检查垃圾邮件，或确认上方邮箱是否正确。</p>
          </>}
          {view === 'reset' && <>
            {emailInput('注册邮箱')}
            {primary('reset', '发送重置验证码', '正在发送', { blocked: sendBlocked, reason: sendReason('发送重置验证码') })}
            {serviceStatus}
          </>}
          {view === 'reset-confirm' && <>
            {recipient('注册邮箱', 'reset')}
            {otpInput('验证码有效期 5 分钟。')}
            {passwordInput('新密码', 'new-password', '至少 12 个字符。重置后，其他设备需要重新登录。')}
            {primary('reset-confirm', '确认重置密码', '正在重置')}
            {resendRow('reset')}
          </>}
        </form>
      )}

      <div className="mt-6 grid gap-3 border-t border-line pt-5 text-center text-sm text-muted">
        {view === 'login' && <p>还没有账户？{textButton('创建账户', () => nav('register'))}</p>}
        {view === 'register' && <p>已有账户？{textButton('去登录', () => nav('login'))}</p>}
        {view === 'reset' && <p>{textButton(<span className="inline-flex items-center gap-1"><ArrowLeft aria-hidden className="size-3.5" />返回登录</span>, () => nav('login'))}</p>}
        {(view === 'verify' || view === 'reset-confirm') && <p>{textButton('返回登录', () => nav('login'))}</p>}
        <p className="inline-flex items-center justify-center gap-1.5 text-xs"><ShieldCheck aria-hidden className="size-3.5" />由安全验证保护你的账户</p>
      </div>
      {dialog}
    </div>
  )
}
