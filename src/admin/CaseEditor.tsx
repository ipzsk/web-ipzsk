import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useBlocker, useNavigate, useParams } from 'react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AlertCircle, ArrowDown, ArrowLeft, ArrowUp, Eye, EyeOff, Heart, ImagePlus, Layers, Plus, Save, Trash2, Upload, WandSparkles, X } from 'lucide-react'
import { Badge, Button, Checkbox, ErrorState, IconButton, Input, Skeleton, Textarea, cn, focusRing, toast } from '@/ui'
import { MediaCard, MediaImage, useUpload, type MediaAsset, type UploadItem } from '@/media'
import { ApiError } from '@/shared/api'
import { queryClient } from '@/shared/query'
import { fetchModels } from '@/studio/api/catalog'
import { uploadApi } from '@/studio/composer/uploadApi'
import { paramLabel } from '@/studio/composer/logic'
import { adminApi } from './api'
import { MAX_OUTPUTS, STATUS_LABEL, publishIssues, serverIssues, templateIssues, type AdminCase, type CaseFields, type CaseStatus, type FieldIssue, type IssueField, type TemplateItem } from './lib'
import { Confirm, Select, StatusBadge, adminErrorText } from './ui'
import { useCan } from './App'

type Draft = CaseFields & { cover: MediaAsset | null; references: MediaAsset[] }

const EMPTY: Draft = {
  title: '', prompt: '', category: '', category_zh: null, tags: [], model: null, params: {}, template: null,
  author: null, author_url: null, source_repo: null, source_url: null, license_note: null, cover: null, references: [],
}
const FIELDS: (keyof CaseFields)[] = ['title', 'prompt', 'category', 'category_zh', 'tags', 'model', 'params', 'template', 'author', 'author_url', 'source_repo', 'source_url', 'license_note']
const toDraft = (c: AdminCase): Draft => ({ ...Object.fromEntries(FIELDS.map(k => [k, structuredClone(c[k])])) as unknown as CaseFields, cover: c.cover, references: c.references })
const fieldsOf = (d: Draft): CaseFields => Object.fromEntries(FIELDS.map(k => [k, d[k]])) as unknown as CaseFields
const nil = (s: string) => s.trim() || null
const caseKey = (id: string) => ['admin', 'case', id] as const

export function CaseEditor() {
  const { id } = useParams()
  const isNew = !id
  const q = useQuery({ queryKey: caseKey(id ?? ''), queryFn: () => adminApi.cases.get(id!), enabled: !isNew })
  if (!isNew && q.isPending) return <div className="grid gap-3"><Skeleton className="h-9 w-64" /><Skeleton className="h-96" /></div>
  if (!isNew && q.isError) return <ErrorState reason={q.error instanceof ApiError && q.error.status === 404 ? '案例不存在或已删除' : '案例加载失败'} action={{ label: '重试', onClick: () => void q.refetch() }} />
  // `initial` stays live (cache), so expected_updated_at follows cover/reference saves without resetting the form.
  return <Form key={id ?? 'new'} initial={q.data ?? null} />
}

function Form({ initial }: { initial: AdminCase | null }) {
  const navigate = useNavigate()
  const writable = useCan('cases.write')
  const [draft, setDraft] = useState<Draft>(initial ? toDraft(initial) : EMPTY)
  const [tagsText, setTagsText] = useState(draft.tags.join('，'))
  const [issues, setIssues] = useState<FieldIssue[]>([])
  // Focus the summary after it renders (it doesn't exist yet when submit() runs).
  const focusIssues = useRef(false)
  useEffect(() => { if (focusIssues.current && issues.length) { focusIssues.current = false; document.getElementById('issues')?.focus() } }, [issues])
  const [savedJson, setSavedJson] = useState(() => JSON.stringify(fieldsOf(draft)))
  const status: CaseStatus = initial?.status ?? 'draft'
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => { setDraft(d => ({ ...d, [k]: v })); setIssues(xs => xs.filter(i => i.field !== k)) }
  const withTags = (): Draft => ({ ...draft, tags: tagsText.split(/[,，\s]+/).map(t => t.trim()).filter(Boolean) })
  const dirty = JSON.stringify(fieldsOf(withTags())) !== savedJson
  const err = (f: IssueField) => issues.filter(i => i.field === f).map(i => i.reason).join('；') || undefined

  // §4.4 leaving with unsaved edits asks first.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => writable && dirty && currentLocation.pathname !== nextLocation.pathname)
  useEffect(() => {
    if (!dirty || !writable) return
    const on = (e: BeforeUnloadEvent) => e.preventDefault()
    addEventListener('beforeunload', on)
    return () => removeEventListener('beforeunload', on)
  }, [dirty, writable])

  const models = useQuery({ queryKey: ['models'], queryFn: fetchModels, staleTime: 10 * 60_000 })
  const cats = useQuery({ queryKey: ['admin', 'case-categories'], queryFn: adminApi.cases.categories, staleTime: 5 * 60_000 })
  const model = models.data?.find(m => m.id === draft.model)

  /* ---- save (optimistic, §6) ---- */
  const save = useMutation({
    mutationFn: async ({ next, status: to }: { next: Draft; status?: CaseStatus }) => {
      if (!initial) {
        const c = await adminApi.cases.create({ ...fieldsOf(next), cover_asset_id: next.cover!.id })
        return next.references.length ? adminApi.cases.setReferences(c.id, next.references.map(r => r.id)) : c
      }
      return adminApi.cases.update(initial.id, { ...fieldsOf(next), ...(to && { status: to }), expected_updated_at: initial.updated_at })
    },
    onMutate: ({ next, status: to }) => {
      setIssues([])
      if (!initial) return {}
      const prev = queryClient.getQueryData<AdminCase>(caseKey(initial.id))
      setSavedJson(JSON.stringify(fieldsOf(next)))
      queryClient.setQueryData<AdminCase>(caseKey(initial.id), old => old && { ...old, ...fieldsOf(next), status: to ?? old.status })
      return { prev }
    },
    onSuccess: (c, { status: to }) => {
      queryClient.setQueryData(caseKey(c.id), c)
      void queryClient.invalidateQueries({ queryKey: ['admin', 'cases'] })
      void queryClient.invalidateQueries({ queryKey: ['admin', 'case-categories'] })
      toast({ title: !initial ? '已创建草稿' : to && to !== status ? `已${STATUS_LABEL[to].replace('已', '')}` : '已保存', tone: 'success' })
      if (!initial) { setSavedJson(JSON.stringify(fieldsOf(toDraft(c)))); navigate(`/admin/cases/${encodeURIComponent(c.id)}`, { replace: true }) }
    },
    onError: (e, _v, ctx) => {
      if (initial) {
        if (e instanceof ApiError && e.code === 'case_conflict' && (e.body as { case?: AdminCase })?.case) {
          const latest = (e.body as { case: AdminCase }).case
          queryClient.setQueryData(caseKey(initial.id), latest)
          const d = toDraft(latest)
          setDraft(d); setTagsText(d.tags.join('，')); setSavedJson(JSON.stringify(fieldsOf(d)))
        } else {
          if (ctx?.prev) queryClient.setQueryData(caseKey(initial.id), ctx.prev)
          setSavedJson(JSON.stringify(fieldsOf(toDraft(initial))))
        }
      }
      if (e instanceof ApiError && e.code === 'case_publish_invalid') { focusIssues.current = true; setIssues(serverIssues(e.body)) }
      toast({ title: '未保存', description: adminErrorText(e), tone: 'error' })
    },
  })

  const submit = (to?: CaseStatus) => {
    const next = withTags()
    setDraft(next)
    const required: [boolean, FieldIssue][] = [
      [!next.title.trim(), { field: 'title', reason: '需要标题' }],
      [!next.prompt.trim(), { field: 'prompt', reason: '需要提示词' }],
      [!next.category.trim(), { field: 'category', reason: '需要分类' }],
      [!next.cover, { field: 'cover', reason: '创建草稿需要先上传封面' }],
    ]
    const found: FieldIssue[] = to === 'published' || (!to && status === 'published') ? publishIssues(next)
      : [...templateIssues(next.template).map((reason): FieldIssue => ({ field: 'template', reason })), ...(initial ? [] : required.filter(([bad]) => bad).map(([, i]) => i))]
    if (found.length) {
      setIssues(found)
      toast({ title: to === 'published' ? '还不能发布' : '还不能保存', description: found[0]!.reason + (found.length > 1 ? ` 等 ${found.length} 项` : ''), tone: 'error' })
      focusIssues.current = true
      return
    }
    save.mutate({ next, status: to })
  }

  /* ---- cover & references upload ---- */
  const coverUp = useUpload({ api: uploadApi, storageKey: 'ipzsk:admin-cover-uploads' })
  const refUp = useUpload({ api: uploadApi, storageKey: 'ipzsk:admin-ref-uploads' })
  const handled = useRef(new Set<string>())
  const coverMut = useMutation({
    mutationFn: (a: MediaAsset) => adminApi.cases.setCover(initial!.id, a.id),
    onMutate: a => { const prev = draft.cover; set('cover', a); return { prev } },
    onSuccess: c => { setDraft(d => ({ ...d, cover: c.cover })); queryClient.setQueryData<AdminCase>(caseKey(c.id), old => old && { ...old, cover: c.cover, updated_at: c.updated_at }); void queryClient.invalidateQueries({ queryKey: ['admin', 'cases'] }); toast({ title: '封面已更新', tone: 'success' }) },
    onError: (e, _a, ctx) => { set('cover', ctx?.prev ?? null); toast({ title: '封面未更新，已恢复', description: adminErrorText(e), tone: 'error' }) },
  })
  const refsMut = useMutation({
    mutationFn: (refs: MediaAsset[]) => adminApi.cases.setReferences(initial!.id, refs.map(r => r.id)),
    onMutate: refs => { const prev = draft.references; set('references', refs); return { prev } },
    onSuccess: c => queryClient.setQueryData<AdminCase>(caseKey(c.id), old => old && { ...old, references: c.references, updated_at: c.updated_at }),
    onError: (e, _r, ctx) => { set('references', ctx?.prev ?? []); toast({ title: '参考图未保存，已恢复', description: adminErrorText(e), tone: 'error' }) },
  })
  useEffect(() => {
    for (const it of coverUp.items) {
      if (it.status !== 'done' || !it.asset || handled.current.has(it.clientId)) continue
      handled.current.add(it.clientId)
      if (initial) coverMut.mutate(it.asset); else set('cover', it.asset)
    }
    const fresh = refUp.items.filter(it => it.status === 'done' && it.asset && !handled.current.has(it.clientId))
    if (fresh.length) {
      fresh.forEach(it => handled.current.add(it.clientId))
      const next = [...draft.references, ...fresh.map(it => it.asset!)].slice(0, 8)
      if (initial) refsMut.mutate(next); else set('references', next)
    }
  }) // eslint-disable-line react-hooks/exhaustive-deps
  const coverPending = coverUp.items.find(it => it.status !== 'done' && !handled.current.has(it.clientId))
  const refsPending = refUp.items.filter(it => it.status !== 'done')
  const pick = (up: typeof coverUp, multiple: boolean) => {
    const input = document.createElement('input')
    input.type = 'file'; input.accept = 'image/png,image/jpeg,image/webp'; input.multiple = multiple
    input.onchange = () => { const errors = up.add([...(input.files ?? [])]); if (errors.length) toast({ title: '有文件没有上传', description: errors.join('\n'), tone: 'error' }) }
    input.click()
  }

  const [deleting, setDeleting] = useState(false)
  const outputs = draft.template?.items.reduce((n, it) => n + it.count, 0) ?? 0

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link to="/admin/cases" className={cn('inline-flex h-9 items-center gap-1.5 rounded-control px-2 text-sm text-muted hover:bg-subtle', focusRing)}><ArrowLeft aria-hidden />案例库</Link>
        <h1 className="text-2xl font-black tracking-[-0.5px]">{initial ? (writable ? '编辑案例' : '查看案例') : '新建案例'}</h1>
        {initial && <><StatusBadge status={status} /><span className="text-xs text-muted">#{initial.id}</span></>}
        {writable && dirty && <Badge tone="warning">未保存</Badge>}
        {writable && (
          <div className="ml-auto flex flex-wrap gap-2">
            {initial?.status === 'draft' && <Button variant="danger-ghost" icon={<Trash2 />} onClick={() => setDeleting(true)}>删除草稿</Button>}
            {initial && status === 'published' && <Button icon={<EyeOff />} onClick={() => submit('hidden')}>隐藏</Button>}
            <Button icon={<Save />} loading={save.isPending && !save.variables?.status} loadingText="保存中" onClick={() => submit()}>{initial ? '保存' : '创建草稿'}</Button>
            {initial && status !== 'published' && <Button variant="primary" icon={<Eye />} loading={save.isPending && save.variables?.status === 'published'} loadingText="发布中" onClick={() => submit('published')}>保存并发布</Button>}
          </div>
        )}
      </div>

      {issues.length > 0 && (
        <div id="issues" tabIndex={-1} role="alert" className="mb-4 rounded-card border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger outline-none">
          <p className="flex items-center gap-2 font-semibold"><AlertCircle aria-hidden />还有 {issues.length} 项需要处理</p>
          <ul className="mt-1 list-disc pl-6">{issues.map((i, n) => (
            <li key={n}><button type="button" className={cn('rounded-[4px] text-left underline underline-offset-2 hover:no-underline', focusRing)} onClick={() => { const el = document.getElementById(`f-${i.field}`); el?.scrollIntoView({ block: 'center' }); el?.focus({ preventScroll: true }) }}>{i.reason}</button></li>
          ))}</ul>
        </div>
      )}

      <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_320px]">
        <fieldset disabled={!writable} className="grid min-w-0 gap-6">
          <Section title="内容">
            <Input id="f-title" label="标题" value={draft.title} onChange={e => set('title', e.target.value)} error={err('title')} maxLength={100} />
            <Textarea id="f-prompt" label="提示词" value={draft.prompt} onChange={e => set('prompt', e.target.value)} error={err('prompt')} className="max-h-[calc(16lh+1rem)] font-mono text-[13px]" />
            <div className="grid gap-4 sm:grid-cols-2">
              <Input id="f-category" label="分类 id" list="case-cats" value={draft.category} onChange={e => { const v = e.target.value; const hit = cats.data?.find(c => c.category === v); setDraft(d => ({ ...d, category: v, category_zh: hit?.category_zh ?? d.category_zh })); setIssues(xs => xs.filter(i => i.field !== 'category')) }} error={err('category')} hint="小写字母、数字、连字符；可选已有分类" />
              <datalist id="case-cats">{cats.data?.map(c => <option key={c.category} value={c.category}>{c.category_zh}</option>)}</datalist>
              <Input id="f-category_zh" label="分类中文名" value={draft.category_zh ?? ''} onChange={e => set('category_zh', nil(e.target.value))} />
            </div>
            <Input id="f-tags" label="标签" value={tagsText} onChange={e => setTagsText(e.target.value)} hint="用逗号或空格分隔" />
          </Section>

          <Section id="f-params" title="型号与参数">
            <div className="flex flex-wrap gap-4">
              <Select id="f-model" label="型号" value={draft.model ?? ''} onChange={e => set('model', e.target.value || null)}>
                <option value="">不指定</option>
                {models.data?.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                {draft.model && !model && <option value={draft.model}>{draft.model}（目录中不存在）</option>}
              </Select>
              {model?.params.filter(p => p.type === 'enum').map(p => (
                <Select key={p.field} label={paramLabel(p.field)} value={String(draft.params[p.field] ?? '')} onChange={e => set('params', e.target.value ? { ...draft.params, [p.field]: e.target.value } : Object.fromEntries(Object.entries(draft.params).filter(([k]) => k !== p.field)))}>
                  <option value="">默认</option>
                  {p.values?.map(v => <option key={String(v)} value={String(v)}>{String(v)}</option>)}
                </Select>
              ))}
            </div>
            {Object.keys(draft.params).length > 0 && <p className="text-xs text-muted">当前参数：{Object.entries(draft.params).map(([k, v]) => `${k}=${v}`).join(' · ')}</p>}
          </Section>

          <Section id="f-cover" title="封面与参考图" error={err('cover')}>
            <div className="flex flex-wrap items-start gap-4">
              <div className="w-48">
                {coverPending?.previewUrl ? <UploadPreview item={coverPending} onRetry={() => coverUp.retry(coverPending.clientId)} />
                  : draft.cover ? <MediaImage asset={draft.cover} alt="封面" sizes="detail" className="rounded-card border border-line" />
                  : <div className={cn('grid aspect-square place-items-center rounded-card border border-dashed text-sm text-muted', err('cover') ? 'border-danger' : 'border-line')}>还没有封面</div>}
                {writable && <Button size="sm" className="mt-2 w-full" icon={<Upload />} loading={coverMut.isPending || !!coverPending} loadingText="上传中" onClick={() => pick(coverUp, false)}>{draft.cover ? '更换封面' : '上传封面'}</Button>}
              </div>
              <div className="min-w-0 flex-1">
                <p className="mb-2 text-[13px] font-semibold">参考图 <span className="font-normal text-muted">{draft.references.length}/8 · 详情页展示，做同款时带入</span></p>
                <ul className="flex flex-wrap gap-2">
                  {draft.references.map(r => (
                    <li key={r.id} className="relative w-20">
                      <MediaImage asset={r} alt="参考图" className="rounded-[8px]" hideBadge />
                      {writable && <IconButton label="移除参考图" size="icon-sm" className="absolute -right-2 -top-2 size-6 rounded-full bg-card shadow" onClick={() => { const next = draft.references.filter(x => x.id !== r.id); if (initial) refsMut.mutate(next); else set('references', next) }}><X className="size-3.5" /></IconButton>}
                    </li>
                  ))}
                  {refsPending.map(it => <li key={it.clientId} className="w-20"><UploadPreview item={it} onRetry={() => refUp.retry(it.clientId)} /></li>)}
                  {writable && (
                    <li>
                      <Button size="icon" className="size-20" aria-label="添加参考图" disabled={draft.references.length >= 8} disabledReason="最多 8 张参考图" onClick={() => pick(refUp, true)}><ImagePlus className="size-5" /></Button>
                    </li>
                  )}
                </ul>
              </div>
            </div>
          </Section>

          <Section id="f-template" title="套图模板" error={err('template')} aside={draft.template && <Badge tone={outputs > MAX_OUTPUTS ? 'danger' : 'outline'} className="tabular-nums">{draft.template.items.length} 项 · {outputs}/{MAX_OUTPUTS} 张</Badge>}>
            <Checkbox
              label="这个案例是套图模板（做同款时展开为多项队列）"
              checked={!!draft.template}
              onCheckedChange={v => set('template', v ? { items: [{ key: 'main', label: '主图', count: 1, anchor: true, params: {}, references: [] }] } : null)}
            />
            {draft.template && <TemplateEditor items={draft.template.items} writable={writable} ratios={enumValues(model, 'aspect_ratio')} resolutions={enumValues(model, 'resolution')} onChange={items => set('template', { items })} />}
          </Section>

          <Section title="来源与授权" hint="发布必填：授权说明，以及来源仓库或原帖链接之一（§14）">
            <div className="grid gap-4 sm:grid-cols-2">
              <Input id="f-author" label="作者" value={draft.author ?? ''} onChange={e => set('author', nil(e.target.value))} />
              <Input id="f-author_url" label="作者主页" type="url" value={draft.author_url ?? ''} onChange={e => set('author_url', nil(e.target.value))} error={err('author_url')} placeholder="https://" />
              <Input id="f-source_repo" label="来源仓库" value={draft.source_repo ?? ''} onChange={e => set('source_repo', nil(e.target.value))} placeholder="例如 awesome-gpt-image-2" />
              <Input id="f-source_url" label="原帖链接" type="url" value={draft.source_url ?? ''} onChange={e => { set('source_url', nil(e.target.value)) }} error={err('source_url')} placeholder="https://" />
            </div>
            <Textarea id="f-license_note" label="授权说明" value={draft.license_note ?? ''} onChange={e => set('license_note', nil(e.target.value))} error={err('license_note')} placeholder="来源仓库 · 授权 · 采集时间，如「Punk-Skill (adrianpunk) · MIT · fetched 2026-09-07」" />
          </Section>
        </fieldset>

        <aside aria-label="预览" className="sticky top-20 grid gap-3">
          <p className="text-[13px] font-semibold">灵感瀑布流预览</p>
          <Preview d={withTags()} />
          <p className="text-xs leading-5 text-muted">卡片与工作台「灵感」一致：默认只显示封面，悬停显示标题、作者与操作。{status !== 'published' && '当前未发布，用户看不到。'}</p>
        </aside>
      </div>

      <Confirm
        open={deleting} onOpenChange={setDeleting} title="删除草稿？" danger confirmLabel="删除" loadingText="删除中"
        description={`「${draft.title}」会被永久删除，封面和参考图一并清理，无法撤销。`}
        onConfirm={async () => {
          await adminApi.cases.remove(initial!.id)
          setSavedJson(JSON.stringify(fieldsOf(withTags())))
          void queryClient.invalidateQueries({ queryKey: ['admin', 'cases'] })
          toast({ title: '已删除草稿', tone: 'success' })
          setTimeout(() => navigate('/admin/cases'))
        }}
      />
      <Confirm
        open={blocker.state === 'blocked'} onOpenChange={o => { if (!o) blocker.reset?.() }}
        title="离开前保存吗？" description="有未保存的修改，离开后会丢失。" confirmLabel="放弃修改并离开" danger
        onConfirm={async () => blocker.proceed?.()}
      />
    </div>
  )
}

const enumValues = (m: { params: { field: string; values?: (string | number)[] }[] } | undefined, name: string) =>
  m?.params.find(p => p.field === name)?.values?.map(String) ?? []

function Section({ id, title, hint, error, aside, children }: { id?: string; title: string; hint?: string; error?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} tabIndex={id ? -1 : undefined} className={cn('grid gap-4 rounded-panel outline-none border bg-card p-5', error ? 'border-danger/50' : 'border-line')}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-bold">{title}</h2>{aside}
        {hint && <p className="w-full text-xs text-muted">{hint}</p>}
        {error && <p className="w-full text-xs text-danger">{error}</p>}
      </div>
      {children}
    </section>
  )
}

function UploadPreview({ item, onRetry }: { item: UploadItem; onRetry: () => void }) {
  return (
    <div className="relative overflow-hidden rounded-[8px] border border-line">
      {item.previewUrl ? <img src={item.previewUrl} alt="" className="aspect-square w-full object-cover opacity-70" /> : <div className="aspect-square bg-subtle" />}
      <div className="absolute inset-x-0 bottom-0 bg-ink/70 px-2 py-1 text-[11px] text-card">
        {item.status === 'failed' || item.status === 'interrupted'
          ? <button type="button" className="underline" onClick={onRetry}>{item.error ?? '上传失败'} · 重试</button>
          : item.status === 'processing' ? '处理中…' : `上传 ${Math.round(item.progress * 100)}%`}
      </div>
    </div>
  )
}

/** Mirrors studio CaseCard (MediaCard + overlay). The studio card isn't exported because it's wired to composer fill/favorites. */
function Preview({ d }: { d: Draft }) {
  const asset = d.cover ?? { id: 'none', kind: 'image' as const, status: 'ready' as const, width: 3, height: 4, duration_ms: null, urls: { orig: '' } }
  const label = d.source_repo ? `来源：${d.source_repo}` : d.source_url ? '来源：原帖' : '未填写来源'
  return (
    <div className="grid gap-3">
      <div className="[&_[role=button]]:pointer-events-auto">
        <MediaCard
          asset={asset}
          title={d.title || '（未命名）'}
          overlay={
            <div className="grid gap-1.5">
              {d.author && <p className="truncate text-xs text-card/80">{d.author}</p>}
              <div className="flex items-center gap-1">
                <span className="inline-flex h-8 items-center gap-1.5 rounded-control bg-acid px-3 text-[13px] font-semibold text-ink"><WandSparkles aria-hidden />做同款</span>
                <span className="grid size-8 place-items-center text-card"><Heart aria-hidden /></span>
                <p className="ml-auto min-w-0 truncate text-[11px] text-card/60">{label}</p>
              </div>
            </div>
          }
        />
      </div>
      <div className="rounded-card border border-line bg-card p-3 text-xs leading-5">
        <p className="font-semibold">{d.title || '（未命名）'}</p>
        <p className="line-clamp-4 whitespace-pre-wrap text-muted">{d.prompt || '（无提示词）'}</p>
        {d.template && (
          <p className="mt-2 flex items-center gap-1 font-semibold"><Layers aria-hidden />套图模板 · {d.template.items.reduce((n, it) => n + it.count, 0)} 张</p>
        )}
        {d.tags.length > 0 && <p className="mt-1 text-muted">{d.tags.map(t => `#${t}`).join(' ')}</p>}
      </div>
    </div>
  )
}

function TemplateEditor({ items, writable, ratios, resolutions, onChange }: { items: TemplateItem[]; writable: boolean; ratios: string[]; resolutions: string[]; onChange: (items: TemplateItem[]) => void }) {
  const patch = (i: number, p: Partial<TemplateItem>) => onChange(items.map((it, n) => n === i ? { ...it, ...p } : it))
  const swap = (i: number, j: number) => { const next = items.slice(); [next[i], next[j]] = [next[j]!, next[i]!]; onChange(next) }
  const total = items.reduce((n, it) => n + it.count, 0)
  const addBlocked = items.length >= MAX_OUTPUTS || total >= MAX_OUTPUTS ? `最多 ${MAX_OUTPUTS} 张输出` : undefined
  const hasAnchor = items.some(it => it.anchor)
  const cell = 'h-9 w-full rounded-control border border-line bg-card px-2 text-sm'
  return (
    <div className="grid gap-2">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="text-left text-xs text-muted">
            <tr><th className="w-8 py-1">#</th><th className="py-1">名称</th><th className="w-20 py-1">张数</th><th className="w-28 py-1">比例</th><th className="w-24 py-1">清晰度</th><th className="w-16 py-1">锚图</th><th className="py-1">说明 / 参考槽位</th>{writable && <th className="w-28 py-1"><span className="sr-only">操作</span></th>}</tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i} className="align-top">
                <td className="py-1.5 text-muted tabular-nums">{i + 1}</td>
                <td className="py-1.5 pr-2"><input aria-label={`第 ${i + 1} 项名称`} className={cn(cell, !it.label.trim() && 'border-danger')} value={it.label} maxLength={60} onChange={e => patch(i, { label: e.target.value })} /></td>
                <td className="py-1.5 pr-2"><input aria-label={`第 ${i + 1} 项张数`} type="number" min={1} max={MAX_OUTPUTS} className={cell} value={it.count} onChange={e => patch(i, { count: Number(e.target.value) })} /></td>
                <td className="py-1.5 pr-2"><ParamCell label={`第 ${i + 1} 项比例`} values={ratios} value={it.params?.aspect_ratio ?? ''} onChange={v => patch(i, { params: { ...it.params, aspect_ratio: v || undefined } })} className={cell} /></td>
                <td className="py-1.5 pr-2"><ParamCell label={`第 ${i + 1} 项清晰度`} values={resolutions} value={it.params?.resolution ?? ''} onChange={v => patch(i, { params: { ...it.params, resolution: v || undefined } })} className={cell} /></td>
                <td className="py-1.5 pr-2">
                  <label className="inline-flex h-9 items-center gap-1.5">
                    <input type="radio" name="template-anchor" checked={!!it.anchor || (!hasAnchor && i === 0)} onChange={() => onChange(items.map((x, n) => ({ ...x, anchor: n === i })))} className="size-4 accent-ink" />
                    <span className="sr-only">第 {i + 1} 项设为锚图</span>{!hasAnchor && i === 0 && <span className="text-[11px] text-muted">默认</span>}
                  </label>
                </td>
                <td className="grid gap-1 py-1.5 pr-2">
                  <input aria-label={`第 ${i + 1} 项说明`} className={cell} placeholder="说明，如「干净背景，突出商品主体」" value={it.description ?? ''} onChange={e => patch(i, { description: e.target.value })} />
                  <input aria-label={`第 ${i + 1} 项参考槽位`} className={cell} placeholder="参考槽位，逗号分隔，如「商品图」" defaultValue={(it.references ?? []).map(r => r.slot).join('，')} onBlur={e => patch(i, { references: e.target.value.split(/[,，]/).map(s => s.trim()).filter(Boolean).map(slot => ({ slot })) })} />
                </td>
                {writable && (
                  <td className="py-1.5">
                    <div className="flex">
                      <IconButton label="上移" size="icon-sm" disabled={i === 0} disabledReason="已在最前" onClick={() => swap(i, i - 1)}><ArrowUp /></IconButton>
                      <IconButton label="下移" size="icon-sm" disabled={i === items.length - 1} disabledReason="已在最后" onClick={() => swap(i, i + 1)}><ArrowDown /></IconButton>
                      <IconButton label="删除此项" size="icon-sm" variant="danger-ghost" disabled={items.length === 1} disabledReason="至少保留 1 项；不需要模板请取消勾选" onClick={() => onChange(items.filter((_, n) => n !== i))}><Trash2 /></IconButton>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {writable && <div><Button size="sm" icon={<Plus />} disabled={!!addBlocked} disabledReason={addBlocked} onClick={() => onChange([...items, { key: `item-${items.length + 1}`, label: '', count: 1, params: {}, references: [] }])}>添加输出规格</Button></div>}
      <p className="text-xs text-muted">锚图先生成，其余项以锚图结果为参考（§2.3）。输出总张数不超过 {MAX_OUTPUTS}。</p>
    </div>
  )
}

function ParamCell({ label, values, value, onChange, className }: { label: string; values: string[]; value: string; onChange: (v: string) => void; className: string }) {
  if (!values.length) return <input aria-label={label} className={className} value={value} placeholder="如 1:1" maxLength={20} onChange={e => onChange(e.target.value)} />
  return (
    <select aria-label={label} className={className} value={value} onChange={e => onChange(e.target.value)}>
      <option value="">继承</option>
      {values.map(v => <option key={v} value={v}>{v}</option>)}
      {value && !values.includes(value) && <option value={value}>{value}</option>}
    </select>
  )
}

