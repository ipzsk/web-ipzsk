import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Check, ImageOff } from 'lucide-react'
import type { TemplateVariable } from '@/shared/contracts'
import { MediaImage } from '@/media'
import { Button, Checkbox, Dialog, DialogContent, DialogFooter, Input, SegmentedControl, cn, toast } from '@/ui'
import { templateErrorMessage } from '../api/templates'
import { applyTemplate, createTemplateOptimistic, openApplyTemplate, useTemplateDialogs, type SaveRequest } from './actions'
import { TEMPLATE_NAME_MAX, buildTemplate, mergeVariables, resolveValues, slotsOf, validateTemplate, variableNames, type RefMode } from './logic'
import type { UserTemplate } from '../api/templates'

/** Mounted once in the studio Layout. */
export function TemplateDialogsHost() {
  const save = useTemplateDialogs(s => s.save)
  const apply = useTemplateDialogs(s => s.apply)
  return (
    <>
      <SaveTemplateDialog req={save} onClose={() => useTemplateDialogs.setState({ save: null })} />
      <ApplyTemplateDialog template={apply} onClose={() => useTemplateDialogs.setState({ apply: null })} />
    </>
  )
}

function SaveTemplateDialog({ req, onClose }: { req: SaveRequest | null; onClose: () => void }) {
  const [name, setName] = useState('')
  const [cover, setCover] = useState<string | null>(null)
  const [refMode, setRefMode] = useState<RefMode>('slot')
  const [vars, setVars] = useState<TemplateVariable[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sources = useMemo(() => req?.sources ?? [], [req])
  const names = useMemo(() => variableNames(sources.map(s => s.prompt)), [sources])
  const refCount = sources.reduce((n, s) => n + s.reference_asset_ids.length, 0)

  useEffect(() => {
    if (!req) return
    setName(''); setCover(req.covers[0]?.id ?? null); setRefMode('slot'); setError(null); setBusy(false)
    setVars(mergeVariables(variableNames(req.sources.map(s => s.prompt)), []))
  }, [req])

  const patchVar = (n: string, p: Partial<TemplateVariable>) => setVars(vs => vs.map(v => v.name === n ? { ...v, ...p } : v))
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!req || busy) return
    const invalid = validateTemplate(name, sources, vars)
    if (invalid) { setError(invalid); return }
    setBusy(true); setError(null)
    try {
      const body = buildTemplate({ name, cover_id: cover, items: sources, variables: mergeVariables(names, vars), refMode })
      await createTemplateOptimistic(body, req.covers.find(c => c.id === cover) ?? null)
      toast({ title: `已存为模板「${body.name}」`, description: '在灵感「我的模板」或素材「我的模板」里查看', tone: 'success' })
      onClose()
    } catch (err) {
      setError(templateErrorMessage(err))
    } finally { setBusy(false) }
  }

  return (
    <Dialog open={!!req} onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent title="存为模板" description={req?.origin === 'batch' ? `把这个批次的 ${sources.length} 项存成可复用的模板。` : `把队列里的 ${sources.length} 项存成可复用的模板。`} className="max-h-[88dvh] max-w-xl overflow-y-auto">
        <form onSubmit={e => void submit(e)} className="grid gap-5">
          <Input label="名称" value={name} maxLength={TEMPLATE_NAME_MAX} placeholder="例如：电商主图三件套" autoFocus required onChange={e => setName(e.target.value)}
            hint={`${[...name.trim()].length}/${TEMPLATE_NAME_MAX}`} />

          <fieldset className="grid gap-2">
            <legend className="text-[13px] font-semibold">封面<span className="font-normal text-muted">（可选）</span></legend>
            {req?.covers.length ? (
              <div role="radiogroup" aria-label="封面" className="flex gap-2 overflow-x-auto pb-1">
                <button type="button" role="radio" aria-checked={cover === null} onClick={() => setCover(null)}
                  className={cn('grid size-16 shrink-0 cursor-pointer place-items-center rounded-[10px] border-2 bg-subtle text-[11px] text-muted', cover === null ? 'border-ink' : 'border-transparent')}>
                  <ImageOff className="size-4" />不设
                </button>
                {req.covers.slice(0, 12).map(a => (
                  <button key={a.id} type="button" role="radio" aria-checked={cover === a.id} aria-label="设为封面" onClick={() => setCover(a.id)}
                    className={cn('relative size-16 shrink-0 cursor-pointer overflow-hidden rounded-[10px] border-2', cover === a.id ? 'border-ink' : 'border-transparent')}>
                    <MediaImage asset={a} alt="" hideBadge className="size-full" />
                    {cover === a.id && <span className="absolute right-0.5 top-0.5 grid size-4 place-items-center rounded-full bg-ink text-acid"><Check className="size-3" /></span>}
                  </button>
                ))}
              </div>
            ) : <p className="text-xs text-muted">队列还没有生成结果；保存后可在「我的模板」里从素材中选封面。</p>}
          </fieldset>

          <fieldset className="grid gap-2">
            <legend className="text-[13px] font-semibold">变量</legend>
            {!vars.length ? (
              <p className="text-xs text-muted">提示词里写 <code className="rounded bg-subtle px-1">{'{{颜色}}'}</code> 这样的占位，应用模板时会要求填写。</p>
            ) : (
              <ul className="grid gap-2">
                {vars.map(v => (
                  <li key={v.name} className="grid grid-cols-[auto_1fr_1fr_auto] items-center gap-2 rounded-card border border-line p-2 max-sm:grid-cols-2">
                    <code className="rounded bg-subtle px-1.5 py-0.5 text-xs max-sm:col-span-2">{`{{${v.name}}}`}</code>
                    <input aria-label={`${v.name} 显示名称`} placeholder="显示名称" value={v.label} maxLength={30} onChange={e => patchVar(v.name, { label: e.target.value })}
                      className="h-9 min-w-0 rounded-control border border-line bg-card px-2 text-sm focus:border-ink" />
                    <input aria-label={`${v.name} 默认值`} placeholder="默认值（可空）" value={v.default ?? ''} maxLength={200} onChange={e => patchVar(v.name, { default: e.target.value })}
                      className="h-9 min-w-0 rounded-control border border-line bg-card px-2 text-sm focus:border-ink" />
                    <Checkbox label="必填" checked={v.required} onCheckedChange={c => patchVar(v.name, { required: c === true })} />
                  </li>
                ))}
              </ul>
            )}
          </fieldset>

          {refCount > 0 && (
            <fieldset className="grid gap-2">
              <legend className="text-[13px] font-semibold">参考图（共 {refCount} 张）</legend>
              <SegmentedControl label="参考图保存方式" value={refMode} onValueChange={setRefMode}
                options={[{ value: 'slot', label: '应用时放入' }, { value: 'asset', label: '保留我的素材' }]} />
              <p className="text-xs text-muted">{refMode === 'slot' ? '保存为「图1、图2…」占位，应用模板时提示放入新的参考图。' : '保存素材引用；素材被删除后应用时会提示重新放入。'}</p>
            </fieldset>
          )}

          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <DialogFooter className="mt-0">
            <Button type="button" onClick={onClose}>取消</Button>
            <Button type="submit" variant="primary" loading={busy} loadingText="保存中" disabled={!name.trim()} disabledReason="先填写名称">保存模板</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Apply: fill variables (defaults prefilled), see which items need references, then expand into the queue. */
function ApplyTemplateDialog({ template, onClose }: { template: UserTemplate | null; onClose: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (template) { setValues(Object.fromEntries(template.variables.map(v => [v.name, v.default ?? '']))); setError(null); setBusy(false) } }, [template])
  const slotItems = template?.items.map((it, i) => ({ i, slots: slotsOf(it) })).filter(x => x.slots.length) ?? []

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!template || busy) return
    const r = resolveValues(template.variables, values)
    if (r.error) { setError(r.error); return }
    setBusy(true)
    const err = await applyTemplate(template, r.values)
    setBusy(false)
    if (err) setError(err); else onClose()
  }

  return (
    <Dialog open={!!template} onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent title={`应用模板「${template?.name ?? ''}」`} description={`将加入 ${template?.items.length ?? 0} 项到队列，不会自动发送。`} className="max-h-[88dvh] overflow-y-auto">
        <form onSubmit={e => void submit(e)} className="grid gap-4">
          {template?.variables.map((v, i) => (
            <Input key={v.name} label={`${v.label}${v.required ? '' : '（可选）'}`} value={values[v.name] ?? ''} autoFocus={i === 0} maxLength={200}
              placeholder={v.default ? `默认：${v.default}` : `填写${v.label}`} onChange={e => setValues(x => ({ ...x, [v.name]: e.target.value }))} />
          ))}
          {slotItems.length > 0 && (
            <div className="rounded-card bg-subtle px-3 py-2 text-xs leading-5">
              <p className="font-semibold">需要放入参考图</p>
              {slotItems.map(x => <p key={x.i}>第 {x.i + 1} 项：{x.slots.map(n => `图${n + 1}`).join('、')}</p>)}
              <p className="text-muted">这些项加入队列后标红，编辑并放入参考图后才能发送。</p>
            </div>
          )}
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <DialogFooter className="mt-0">
            <Button type="button" onClick={onClose}>取消</Button>
            <Button type="submit" variant="primary" loading={busy} loadingText="加入中">加入队列</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Card / menu entry: templates without variables go straight into the queue. */
export async function startApply(t: UserTemplate) {
  if (t.variables.length || t.items.some(i => slotsOf(i).length)) { openApplyTemplate(t); return }
  const err = await applyTemplate(t, {})
  if (err) toast({ title: '无法应用模板', description: err, tone: 'error' })
}
