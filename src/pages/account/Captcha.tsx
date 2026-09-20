import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button, Dialog, DialogContent, Input, cn } from '@/ui'
import { AccountError, call } from './lib'

// Port of captcha-ui.js. Images and answers are checked by the server; no client-side bypass.
export type CaptchaAction = 'login' | 'register' | 'resend' | 'reset'
export interface CaptchaProof { token: string; [k: string]: unknown }
interface Pending { id: number; action: CaptchaAction; email: string; resolve: (p: CaptchaProof) => void; reject: (e: Error) => void }

let seq = 0

/** Returns `humanProof(action, email)` (resolves with the proof, rejects on cancel) plus the dialog element to render. */
export function useHumanProof() {
  const [pending, setPending] = useState<Pending | null>(null)
  const ref = useRef<Pending | null>(null)
  const humanProof = useCallback((action: CaptchaAction, email: string) => new Promise<CaptchaProof>((resolve, reject) => {
    const p = { id: ++seq, action, email, resolve, reject }; ref.current = p; setPending(p)
  }), [])
  const finish = useCallback((proof: CaptchaProof | null) => {
    const p = ref.current; if (!p) return
    ref.current = null; setPending(null)
    if (proof) p.resolve(proof); else p.reject(new Error('已取消图片验证。'))
  }, [])
  const cancel = useCallback(() => finish(null), [finish])
  const dialog = <Dialog open={!!pending} onOpenChange={o => { if (!o) cancel() }}>
    {pending && <CaptchaBody key={pending.id} pending={pending} onDone={finish} />}
  </Dialog>
  return { humanProof, cancel, dialog }
}

function CaptchaBody({ pending: { action, email }, onDone }: { pending: Pending; onDone: (p: CaptchaProof | null) => void }) {
  const [challenge, setChallenge] = useState<{ id: string; image: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ text: string; error?: boolean }>({ text: '正在加载图片验证码…' })
  const [answer, setAnswer] = useState('')
  const [invalid, setInvalid] = useState(false)
  const generation = useRef(0)
  const input = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    const attempt = ++generation.current
    setBusy(true); setChallenge(null); setAnswer(''); setInvalid(false); setStatus({ text: '正在加载图片验证码…' })
    try {
      const data = await call<{ id?: unknown; image?: unknown }>('/api/account/captcha', { action, email })
      if (attempt !== generation.current) return
      if (typeof data.id !== 'string' || typeof data.image !== 'string' || !data.image.startsWith('data:image/png;base64,')) throw new Error('图片加载失败，请点击换一张。')
      setChallenge({ id: data.id, image: data.image })
      setStatus({ text: '请输入图片中的 5 位字符，不区分大小写。图片 2 分钟内有效。' })
    } catch (e) {
      if (attempt === generation.current) setStatus({ text: (e as Error).message || '图片加载失败，请点击换一张。', error: true })
    } finally {
      if (attempt === generation.current) { setBusy(false); setTimeout(() => input.current?.focus()) }
    }
  }, [action, email])

  useEffect(() => { void load(); return () => { generation.current++ } }, [load])

  async function verify(e: React.FormEvent) {
    e.preventDefault()
    if (busy || !challenge) return
    const value = answer.trim().toUpperCase()
    if (!/^[A-Z0-9]{5}$/.test(value)) { setInvalid(true); setStatus({ text: '请输入图片中的 5 位字母或数字。', error: true }); input.current?.focus(); return }
    const attempt = generation.current
    setBusy(true); setStatus({ text: '正在校验…' })
    try {
      const proof = await call<CaptchaProof>('/api/account/captcha/verify', { id: challenge.id, answer: value, action, email })
      if (attempt !== generation.current) return
      if (typeof proof.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(proof.token)) throw new Error('验证结果无效，请换一张重试。')
      generation.current++
      onDone(proof)
    } catch (err) {
      if (attempt !== generation.current) return
      setAnswer(''); setInvalid(true)
      setStatus({ text: err instanceof AccountError && err.code === 'captcha_invalid' ? '图片验证码错误、已过期或尝试次数过多，请重新输入或换一张。' : (err as Error).message, error: true })
      setBusy(false); setTimeout(() => input.current?.focus())
    }
  }

  return (
    <DialogContent title="图片验证码" onOpenAutoFocus={e => e.preventDefault()}>
      <form onSubmit={verify} noValidate className="grid gap-3">
        <p id="captcha-status" role="status" aria-live="polite" className={cn('text-sm', status.error ? 'text-danger' : 'text-muted')}>{status.text}</p>
        <div className="grid h-[110px] w-full max-w-[300px] place-items-center overflow-hidden rounded-control border border-line bg-subtle">
          {challenge
            ? <img src={challenge.image} width={300} height={110} alt="随机字符验证码，请输入图片中的字符" className="h-full w-full object-contain" />
            : <RefreshCw aria-hidden className={cn('size-5 text-muted', busy && 'motion-safe:animate-spin-slow')} />}
        </div>
        <div><Button variant="ghost" size="sm" icon={<RefreshCw />} onClick={() => void load()} disabled={busy} disabledReason="正在处理，请稍候">看不清？换一张</Button></div>
        <Input
          ref={input} label="图片中的字符" name="answer" value={answer} onChange={e => { setAnswer(e.target.value); setInvalid(false) }}
          autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={5} required
          disabled={busy || !challenge} aria-invalid={invalid || undefined} aria-describedby="captcha-status" className="font-mono tracking-[.3em] uppercase"
        />
        <div className="mt-2 flex flex-wrap gap-2">
          <Button type="submit" variant="primary" loading={busy && !!challenge} loadingText="正在校验" disabled={busy || !challenge} disabledReason={challenge ? '正在处理，请稍候' : '图片验证码尚未加载'}>
            {action === 'login' ? '验证并登录' : '验证并发送邮件'}
          </Button>
          <Button variant="ghost" onClick={() => onDone(null)}>取消</Button>
        </div>
      </form>
    </DialogContent>
  )
}
