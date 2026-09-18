import { useEffect, useMemo, useRef, useState } from 'react'
import { UserRound } from 'lucide-react'
import { ArrowUp, ChevronDown, Clapperboard, Image, Info, ListPlus, LogIn, RefreshCw, Sparkles, UserPlus, Wallet, X } from 'lucide-react'
import type { GenerationParams, MediaKind, ModelSpec } from '@/shared/contracts'
import { ApiError, loginUrl } from '@/shared/api'
import { openRecharge } from '@/shared/recharge/RechargeDialog'
import { useOnline } from '@/shared/query'
import { queryClient } from '@/shared/query'
import { Button, Dialog, DialogContent, DialogFooter, IconButton, Popover, PopoverContent, PopoverTrigger, SegmentedControl, Tooltip, cn, toast } from '@/ui'
import { formatPoints } from '@/shared/points'
import { DropTarget, useUpload, type MediaAsset } from '@/media'
import { enhancePrompt, fetchModels } from '../api/catalog'
import { SUBJECT_KIND_LABEL, type Subject } from '../api/subjects'
import { openSubjectEditor } from '../subjects/SubjectEditor'
import type { ParamInput, QueueEntry } from '../api/queue'
import { clearDraft, loadDraft, useComposer } from '../store'
import { useAccount, useModels, useQueueSync, useQuote, useSubjects } from './hooks'
import {
  addManual, chipsOf, docFromText, expandModels, isSendable, itemFromDraft, normalizeParams, planSend, queueRoom, quoteEntry, referenceState, serializePrompt,
  subjectBlockReason, subjectVarLabel, subjectVarsOf,
} from './logic'
import { COMPOSER_FILL_EVENT, onStudioEvent } from '@/shared/events'
import { planFill, type FillDetail, type FillPlan } from './fill'
import { ModelPicker, ParamChips } from './ModelControls'
import { PromptEditor, focusComposer, insertSubjectMention, useEditorFlags } from './PromptEditor'
import { QueueBar, useSubmittingIds } from './QueueBar'
import { ReferenceSlots } from './ReferenceSlots'
import { sender } from './send'
import { uploadApi } from './uploadApi'
import { AvatarComposerPanel } from '../avatar/AvatarComposerPanel'
import { isHeygenModel } from '../avatar/contract'
import { hydrateAvatarDraft, rememberAvatarItems, useAvatarDraft } from '../avatar/draft'
import { avatarModels, avatarParamModel, avatarQueueItem, decideAvatar, guideAvatarError, isAvatarParams } from '../avatar/logic'

const DRAFT_KEY = 'ipzsk.composer.draft'

/** Signed-out send: stash the draft, go log in, restore on return (§2.2). */
function saveDraftAndLogin() {
  const s = useComposer.getState()
  try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ kind: s.kind, ...s.memory[s.kind], doc: s.doc, slots: s.slots })) } catch { /* ignore */ }
  location.href = loginUrl()
}

function useRestoreDraft() {
  useEffect(() => {
    let raw: string | null = null
    try { raw = sessionStorage.getItem(DRAFT_KEY); sessionStorage.removeItem(DRAFT_KEY) } catch { return }
    if (!raw) return
    try { loadDraft(JSON.parse(raw)) } catch { /* corrupt draft: ignore */ }
  }, [])
}

/** Brief highlight of params that were reset (§2.2: 1.2s). */
function useHighlight() {
  const [names, setNames] = useState<Set<string>>(new Set())
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const flash = (n: string[]) => {
    if (!n.length) return
    clearTimeout(timer.current)
    setNames(new Set(n))
    timer.current = setTimeout(() => setNames(new Set()), 1200)
  }
  useEffect(() => () => clearTimeout(timer.current), [])
  return [names, flash] as const
}

/** Apply a fill plan to the store (queue replace is confirmed by the caller). */
function applyFill(plan: FillPlan) {
  const s = useComposer.getState()
  if (plan.kind || plan.model || plan.params) {
    const kind = plan.kind ?? s.kind
    s.remember(kind, { model: plan.model ?? s.memory[kind].model, params: plan.params ?? s.memory[kind].params })
  }
  useComposer.setState(st => ({
    ...(plan.kind && { kind: plan.kind, mode: null }),
    ...(plan.doc !== undefined && { doc: plan.doc, docVersion: st.docVersion + 1, editingId: null }),
    ...(plan.slots && { slots: plan.slots }),
    ...(plan.queue && { queue: plan.queue }),
  }))
  if (plan.toast) toast({ title: '已填入输入框', tone: 'success' })
  focusComposer()
}

/**
 * `ipzsk:composer-fill` (sources: case / asset / record / batch / canvas; see ./fill.ts). Waits for the model catalog,
 * shows at most one inline notice, confirms before replacing a non-empty queue, never submits.
 */
function useComposerFill() {
  const [notice, setNotice] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<FillPlan | null>(null)
  useEffect(() => {
    const onFill = async (detail: FillDetail) => {
      // Signed out, the catalog 401s and never caches: refetching it on every fill held the fill for a full round trip.
      const catalog = queryClient.getQueryState(['media', 'models'])
      const models = catalog?.error instanceof ApiError && catalog.error.status === 401 ? []
        : await queryClient.ensureQueryData({ queryKey: ['media', 'models'], queryFn: fetchModels, staleTime: 10 * 60_000 }).catch(() => [])
      const s = useComposer.getState()
      if (detail.source === 'record' && isAvatarParams(detail.params)) { // 数字人记录「编辑后重发」→ 数字人草稿
        hydrateAvatarDraft(detail.model ?? '', detail.params ?? {}, detail.prompt ?? '', null, detail.reference_assets)
        s.remember('avatar', { model: detail.model ?? undefined, params: detail.params ?? {} })
        useComposer.setState({ kind: 'video', mode: 'avatar', editingId: null })
        toast({ title: '已填入输入框', tone: 'success' })
        return
      }
      const plan = planFill(detail, { models, kind: s.kind, memory: s.memory, slots: s.slots, queue: s.queue })
      setNotice(plan.notices.length ? plan.notices.join('；') : null)
      // A template replaces both the queue and the draft (fill.ts); ask first when either holds something.
      const draftLost = plan.queue && plan.doc === null && !!serializePrompt(s.doc, s.slots).prompt
      if (plan.queue && (s.queue.length || draftLost)) setConfirm(plan)
      else applyFill(plan)
    }
    return onStudioEvent(COMPOSER_FILL_EVENT, d => void onFill(d), raw => console.error('[composer-fill] ignored invalid detail', raw))
  }, [])
  const dialog = (
    <Dialog open={!!confirm} onOpenChange={o => { if (!o) setConfirm(null) }}>
      <DialogContent title="替换当前队列？" description={confirmText(confirm)}>
        <DialogFooter>
          <Button onClick={() => setConfirm(null)}>保留原内容</Button>
          <Button variant="primary" onClick={() => { if (confirm) applyFill(confirm); setConfirm(null) }}>替换</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
  return { notice, clearNotice: () => setNotice(null), dialog }
}

function confirmText(plan: FillPlan | null) {
  const s = useComposer.getState()
  const parts = [
    s.queue.length ? `队列里的 ${s.queue.length} 项将替换为新的 ${plan?.queue?.length ?? 0} 项（正在提交的项不受影响）` : `将加入 ${plan?.queue?.length ?? 0} 项到队列`,
    plan?.doc === null && serializePrompt(s.doc, s.slots).prompt ? '输入框里的提示词和参考图会被清空，避免随「发送」一起提交' : null,
  ]
  return parts.filter(Boolean).join('；') + '。'
}

/** {{主体:商品}} in the prompt → pick a subject (kind label match first) or create one. */
function SubjectVarPicker({ token, subjects }: { token: string; subjects: Subject[] }) {
  const label = subjectVarLabel(token)
  const sorted = [...subjects].sort((a, b) => Number(SUBJECT_KIND_LABEL[b.kind] === label) - Number(SUBJECT_KIND_LABEL[a.kind] === label))
  const kind = (Object.entries(SUBJECT_KIND_LABEL).find(([, l]) => l === label)?.[0] ?? undefined) as Subject['kind'] | undefined
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-full border border-warning/50 bg-warning/12 px-2.5 text-xs font-semibold text-warning hover:bg-warning/20">
          <UserPlus className="size-3.5" />为 {token} 选择主体
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1">
        <div className="max-h-64 overflow-y-auto">
          {sorted.map(s => (
            <button key={s.id} type="button" onClick={() => insertSubjectMention(s, token)} className="flex h-10 w-full cursor-pointer items-center gap-2 rounded-[8px] px-2 text-left text-sm hover:bg-subtle">
              <span className="min-w-0 flex-1 truncate font-semibold">{s.name}</span>
              <span className="text-xs text-muted">{SUBJECT_KIND_LABEL[s.kind]} · {s.assets.length}张</span>
            </button>
          ))}
          {!sorted.length && <p className="px-2 py-2 text-xs text-muted">还没有主体</p>}
        </div>
        <button type="button" onClick={() => openSubjectEditor({ kind, onSaved: s => insertSubjectMention(s, token) })} className="flex h-10 w-full cursor-pointer items-center gap-2 border-t border-line px-2 text-sm hover:bg-subtle">
          <UserPlus className="size-4" />创建{label}主体
        </button>
      </PopoverContent>
    </Popover>
  )
}

/**
 * Publishes how much of the viewport bottom the floating composer covers (incl. queue bar and, on mobile, the tab bar under it)
 * as `--composer-inset` on <html>: views pad their content with it.
 */
function useComposerInset(hidden: boolean, expanded: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const root = document.documentElement.style
    const el = ref.current
    if (hidden || !el) { root.removeProperty('--composer-inset'); return }
    if (expanded) return // mobile sheet is modal; keep the collapsed value
    const update = () => root.setProperty('--composer-inset', `${Math.max(0, Math.round(window.innerHeight - el.getBoundingClientRect().top))}px`)
    const ro = new ResizeObserver(update)
    ro.observe(el)
    window.addEventListener('resize', update)
    update()
    return () => { ro.disconnect(); window.removeEventListener('resize', update) }
  }, [hidden, expanded])
  useEffect(() => () => { document.documentElement.style.removeProperty('--composer-inset') }, [])
  return ref
}

// Owned by F3. Bottom floating composer shared by inspiration / create / assets views.
export function Composer({ hidden }: { hidden: boolean }) {
  const account = useAccount()
  const online = useOnline()
  const models = useModels()
  const subjects = useSubjects(account.signedIn)
  useQueueSync(account.signedIn, account.pending)
  useRestoreDraft()
  const fill = useComposerFill()

  const kind = useComposer(s => s.kind)
  const mode = useComposer(s => s.mode)
  const avatarMode = mode === 'avatar'
  const memory = useComposer(s => s.memory[s.mode === 'avatar' ? 'avatar' : s.kind])
  const avatarDraft = useAvatarDraft()
  const doc = useComposer(s => s.doc)
  const slots = useComposer(s => s.slots)
  const queue = useComposer(s => s.queue)
  const editingId = useComposer(s => s.editingId)
  const submitting = useSubmittingIds()

  const kindModels = useMemo(() => (models.data ?? []).filter(m => m.kind === kind && !isHeygenModel(m)), [models.data, kind])
  // 数字人：型号由形象来源 + 档位决定（avatar/logic.ts decideAvatar），只调比例与清晰度。
  const avatar = useMemo(() => avatarMode ? decideAvatar(avatarDraft, models.data ?? []) : null, [avatarMode, avatarDraft, models.data])
  const avatarModel = avatar && (avatar.model ?? avatarModels(models.data ?? []).library[0])
  const model = avatarMode ? avatarModel ? avatarParamModel(avatarModel) : undefined : kindModels.find(m => m.id === memory.model) ?? kindModels[0]
  const params = useMemo(() => model ? normalizeParams(model, memory.params).params : {}, [model, memory.params])
  const [highlight, flash] = useHighlight()

  const current = useMemo(() => avatar ? avatarQueueItem(avatarDraft, avatar, params) : itemFromDraft({ kind, model, params, doc, slots }), [avatar, avatarDraft, kind, model, params, doc, slots])
  const hasPrompt = !!current.prompt
  const refs = referenceState(model, slots.length)
  useEffect(() => { useEditorFlags.setState({ refsOver: refs.over ? refs.message : null }) }, [refs.over, refs.message])

  // Uploads → slots once the server asset exists.
  const upload = useUpload({ api: uploadApi, storageKey: 'ipzsk:composer-uploads' })
  useEffect(() => {
    const done = upload.items.filter(u => u.status === 'done' && u.asset)
    if (!done.length) return
    useComposer.setState(s => ({ slots: addManual(s.slots, done.map(u => u.asset!)) }))
    done.forEach(u => upload.remove(u.clientId))
    void queryClient.invalidateQueries({ queryKey: ['assets', 'list'] }) // same library as the assets view
  }, [upload.items]) // eslint-disable-line react-hooks/exhaustive-deps

  const acceptAssets = (items: MediaAsset[]): true | string => {
    if (!refs.supported) return model ? `${model.name} 不支持参考图` : '型号加载中'
    if (items.some(a => a.kind !== 'image')) return '参考图只能是图片'
    const fresh = items.filter(a => !slots.some(s => s.asset.id === a.id)).length
    return slots.length + fresh > refs.max ? `最多 ${refs.max} 张参考图` : true
  }
  const onFiles = (files: File[]) => {
    const reason = acceptAssets(files.map(() => ({ kind: 'image' }) as MediaAsset))
    if (reason !== true) { toast({ title: '无法添加参考图', description: reason, tone: 'error' }); return }
    const images = files.filter(f => f.type.startsWith('image/'))
    const errors = [...(images.length < files.length ? ['参考图只能是图片'] : []), ...upload.add(images)]
    if (errors.length) toast({ title: '部分文件未添加', description: errors.join('；'), tone: 'error' })
  }

  // ── model / params ──
  const setKind = (k: MediaKind | 'avatar') => k === 'avatar' ? useComposer.setState({ kind: 'video', mode: 'avatar' }) : useComposer.getState().setKind(k)
  const remember = (m: ModelSpec | undefined, p: GenerationParams) => useComposer.getState().remember(avatarMode ? 'avatar' : kind, { model: m?.id, params: p })
  const pickModel = (m: ModelSpec) => {
    const n = normalizeParams(m, params)
    remember(m, n.params)
    flash(n.changes.map(c => c.name))
  }
  // `undefined` = clear the param (the catalog gives it no default, e.g. seed → 随机): drop the key rather than send an empty value.
  const setParam = (name: string, v: ParamInput) =>
    remember(model, v === undefined ? Object.fromEntries(Object.entries(params).filter(([k]) => k !== name)) : { ...params, [name]: v })

  // ── quote ──
  const sendable = planSend(queue.filter(i => !submitting.has(i.item_id)), current)
  const quoteItems = useMemo(() => [...queue, ...(hasPrompt ? [current] : [])], [queue, current, hasPrompt])
  const quote = useQuote(quoteItems.map(quoteEntry), account.signedIn && !!model)
  const pointsById = new Map(quoteItems.map((it, i) => [it.item_id, quote.data?.[i]?.points ?? null]))
  const sum = (items: QueueEntry[]) => quote.data && !quote.isPlaceholderData
    ? Math.round(items.reduce((a, it) => a + (pointsById.get(it.item_id) ?? 0), 0) * 10) / 10 : null
  const total = sum(sendable)
  const queueTotal = sum(queue)

  // ── send ──
  const [sending, setSending] = useState(false)
  // Partial list (more pages) → can't tell deleted from not-yet-loaded; the server rejects deleted ones anyway.
  const subjectIds = useMemo(() => subjects.data && !subjects.hasNextPage ? new Set(subjects.data.map(s => s.id)) : undefined, [subjects.data, subjects.hasNextPage])
  const vars = subjectVarsOf(current.prompt)
  const insufficient = account.points != null && total != null && total > account.points

  const blockReason = (items: QueueEntry[], includesComposer: boolean): string | null =>
    !online ? '网络已断开，恢复后再发送'
    : !model ? '型号加载中'
    : !items.length ? (queue.some(i => i.missing) ? '队列里的项引用了已删除的素材，请编辑移除后再发送' : queue.length ? '队列里没有可发送的项（标红的项需要先编辑）' : '先输入提示词')
    : includesComposer && avatar?.reason ? avatar.reason
    : includesComposer && refs.over ? refs.message
    : subjectBlockReason(items, subjectIds)

  const send = (items: QueueEntry[], includesComposer: boolean) => {
    if (sending || blockReason(items, includesComposer)) return
    setSending(true)
    setTimeout(() => setSending(false), 300) // §2.2: only guard ~300ms against double clicks
    rememberAvatarItems(items.filter(i => isAvatarParams(i.params)).map(i => ({ ...i, fromDraft: includesComposer && i.item_id === current.item_id, points: pointsById.get(i.item_id) })))
    if (includesComposer && !avatarMode) clearDraft()
    void sender.sendBatch(items, { thread_id: useComposer.getState().threadId })
    toast({ title: `已提交 ${items.length} 项`, description: location.pathname.startsWith('/studio/create') ? undefined : '可在「创作」里查看进度' })
    setExpanded(false)
  }
  const sendComposer = () => {
    if (!account.signedIn) return saveDraftAndLogin()
    send(sendable, hasPrompt)
  }
  const allSendable = queue.filter(i => !submitting.has(i.item_id) && isSendable(i))
  const sendAll = () => send(allSendable, false)

  // ── queue ──
  const addReason = !model ? (avatarMode ? avatar?.reason ?? '型号加载中' : '型号加载中') : avatar?.reason ? avatar.reason : !hasPrompt ? '先输入提示词' : refs.over ? refs.message : subjectBlockReason([current], subjectIds) ?? queueRoom(queue.length, editingId ? 0 : 1)
  const addToQueue = () => {
    if (addReason) return
    if (avatarMode) rememberAvatarItems([{ ...current, item_id: editingId ?? current.item_id, fromDraft: true }])
    if (editingId) {
      useComposer.setState(s => ({ queue: s.queue.map(i => i.item_id === editingId ? { ...current, item_id: editingId, anchor_of: i.anchor_of } : i), editingId: null }))
      toast({ title: '已更新队列项' })
      return
    }
    useComposer.setState(s => ({ queue: [...s.queue, current] }))
  }
  const addMany = (ms: ModelSpec[]) => {
    const reason = !hasPrompt ? '先输入提示词' : queueRoom(queue.length, ms.length)
    if (reason) { toast({ title: '无法加入队列', description: reason, tone: 'error' }); return }
    useComposer.setState(s => ({ queue: [...s.queue, ...expandModels({ kind, model, params, doc, slots }, ms)] }))
  }

  // ── enhance ──
  const [enhancing, setEnhancing] = useState(false)
  const enhanceReason = !hasPrompt ? '先输入提示词' : chipsOf(doc).length ? '含 @ 标签时暂不支持增强' : !account.signedIn ? '登录后可用' : null
  const enhance = async () => {
    if (enhanceReason) return
    setEnhancing(true)
    try {
      const text = await enhancePrompt(current.prompt)
      useComposer.setState(s => ({ doc: docFromText(text), docVersion: s.docVersion + 1 }))
    } catch (e) {
      toast({ title: '增强失败', description: e instanceof Error ? e.message : '请稍后重试', tone: 'error' })
    } finally { setEnhancing(false) }
  }

  // ── mobile sheet ──
  const expanded = useEditorFlags(s => s.expanded)
  const insetRef = useComposerInset(hidden, expanded)
  const setExpanded = (v: boolean) => useEditorFlags.setState({ expanded: v })
  const sendLabel = total != null && sendable.length ? `约 ${formatPoints(total)}` : null

  const sendButton = account.pending
    ? <Button variant="primary" loading icon={<ArrowUp className="size-[18px]" />}>发送</Button>
    : !account.signedIn
      ? <Button variant="primary" icon={<LogIn className="size-[18px]" />} onClick={saveDraftAndLogin}>登录后生成</Button>
      : insufficient
        ? <Button variant="danger" icon={<Wallet className="size-[18px]" />} onClick={openRecharge}>点数不足 · 去充值</Button>
        : (() => {
          const reason = blockReason(sendable, hasPrompt)
          const btn = (
            <Button variant="primary" icon={<ArrowUp className="size-[18px]" />} loading={sending} disabled={!!reason} disabledReason={reason ?? undefined} onClick={sendComposer} aria-keyshortcuts="Meta+Enter Control+Enter">
              发送{sendLabel && <span className="font-normal opacity-80 tabular-nums">· {sendLabel}</span>}
            </Button>
          )
          return !reason && sendable.length > 1
            ? <Tooltip content={<div className="grid gap-0.5">{sendable.map((it, i) => <span key={it.item_id}>{String.fromCharCode(0x2460 + i)} {it.model} · {formatPoints(pointsById.get(it.item_id)).replace('待核实', '… 点')}</span>)}<span className="font-semibold text-white">共 {sendable.length} 项 · ⌘/Ctrl+Enter</span></div>}>{btn}</Tooltip>
            : btn
        })()

  return (
    <div hidden={hidden} className={cn('pointer-events-none fixed inset-x-0 bottom-4 z-30 px-4 max-md:bottom-[72px] md:left-52', expanded && 'max-md:bottom-0 max-md:z-50 max-md:px-0')}>
      {expanded && <div aria-hidden className="pointer-events-auto fixed inset-0 bg-ink/30 md:hidden" onClick={() => setExpanded(false)} />}
      <div ref={insetRef} className="pointer-events-auto relative mx-auto max-w-4xl">
        {/* Mobile collapsed: one line → tap opens the bottom sheet. */}
        {!expanded && (
          <button
            type="button" onClick={() => setExpanded(true)} aria-label="展开输入框"
            className="flex h-12 w-full cursor-pointer items-center gap-2 rounded-full border border-line bg-card pl-4 pr-1.5 text-left text-sm shadow-xl md:hidden"
          >
            <span className={cn('min-w-0 flex-1 truncate', !hasPrompt && 'text-muted')}>{current.prompt || '描述你想要的画面…'}</span>
            {queue.length > 0 && <span className="rounded-full bg-subtle px-2 text-xs leading-6">队列 {queue.length}</span>}
            <span className="grid size-9 place-items-center rounded-full bg-acid text-white"><ArrowUp className="size-[18px]" /></span>
          </button>
        )}
        <div className={cn(!expanded && 'max-md:hidden', expanded && 'max-md:max-h-[85dvh] max-md:overflow-y-auto max-md:rounded-t-panel max-md:bg-paper max-md:p-3 max-md:pb-[max(12px,env(safe-area-inset-bottom))]')}>
          {expanded && (
            <div className="mb-1 flex justify-end md:hidden">
              <IconButton label="收起输入框" size="icon-sm" onClick={() => setExpanded(false)}><ChevronDown className="size-4" /></IconButton>
            </div>
          )}
          <QueueBar current={current} models={new Map((models.data ?? []).map(m => [m.id, m]))} pointsById={pointsById} total={queueTotal}
            onSendAll={account.signedIn ? sendAll : saveDraftAndLogin} sendReason={account.signedIn ? blockReason(allSendable, false) : null} sending={sending} />
          <DropTarget id="composer" accept={acceptAssets} onDrop={items => useComposer.setState(s => ({ slots: addManual(s.slots, items) }))} onFiles={onFiles} className="rounded-panel">
            <div className={cn('rounded-panel border border-line bg-card p-3 shadow-xl', editingId && 'border-acid ring-3 ring-acid/10')}>
              {editingId && (
                <div className="mb-1 flex items-center gap-2 px-1 text-xs text-muted">
                  <RefreshCw className="size-3.5" />正在编辑队列第 {queue.findIndex(i => i.item_id === editingId) + 1} 项
                  <button type="button" className="ml-auto inline-flex items-center gap-0.5 rounded-control px-1 hover:bg-subtle hover:text-ink" onClick={clearDraft}><X className="size-3" />取消编辑</button>
                </div>
              )}
              {fill.notice && (
                <p role="status" className="mb-1 flex items-start gap-1.5 rounded-control bg-subtle px-2 py-1.5 text-xs text-ink">
                  <Info className="mt-px size-3.5 shrink-0" /><span className="min-w-0 flex-1">{fill.notice}</span>
                  <button type="button" aria-label="关闭提示" className="cursor-pointer text-muted hover:text-ink" onClick={fill.clearNotice}><X className="size-3.5" /></button>
                </p>
              )}
              {avatar ? (
                <AvatarComposerPanel decision={avatar} onSubmit={sendComposer} quotePending={quote.isFetching}
                  quote={hasPrompt ? quote.data?.[queue.length] : undefined}
                  fieldError={(() => { const e = queue.find(i => i.item_id === editingId)?.error; return e ? guideAvatarError(e) : null })()} />
              ) : <>
              <ReferenceSlots refs={refs} upload={upload} onFiles={onFiles} />
              <div className="flex items-start gap-1">
                <div className="min-w-0 flex-1"><PromptEditor onSubmit={sendComposer} onFiles={onFiles} placeholder="描述你想要的画面，输入 @ 引用主体或参考图…" /></div>
                <IconButton label="增强提示词" loading={enhancing} disabled={!!enhanceReason} disabledReason={enhanceReason ?? undefined} onClick={() => void enhance()}><Sparkles className="size-4" /></IconButton>
              </div>
              </>}
              {!avatar && vars.length > 0 && <div className="flex flex-wrap gap-1.5 px-1 pt-1">{vars.map(v => <SubjectVarPicker key={v} token={v} subjects={subjects.data ?? []} />)}</div>}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <SegmentedControl<MediaKind | 'avatar'> label="类型" value={avatarMode ? 'avatar' : kind} onValueChange={setKind} options={[{ value: 'image', label: '图片', icon: Image }, { value: 'video', label: '视频', icon: Clapperboard }, { value: 'avatar', label: '数字人', icon: UserRound }]} />
                {!avatarMode && <ModelPicker
                  models={kindModels} model={model} signedIn={account.signedIn} status={!account.signedIn && models.isError ? 'signedOut' : models.status} onRetry={() => void models.refetch()}
                  onPick={pickModel} onAddMany={addMany} roomFor={n => !hasPrompt ? '先输入提示词' : queueRoom(queue.length, n)}
                />}
                {model && <ParamChips model={model} params={params} highlight={highlight} onChange={setParam} />}
                <div className="ml-auto flex items-center gap-1.5">
                <Button variant="secondary" icon={<ListPlus className="size-[18px]" />} disabled={!!addReason} disabledReason={addReason ?? undefined} onClick={addToQueue}>
                  {editingId ? '更新' : '加入队列'}
                </Button>
                {sendButton}
                </div>
              </div>
            </div>
          </DropTarget>
          {fill.dialog}
        </div>
      </div>
    </div>
  )
}
