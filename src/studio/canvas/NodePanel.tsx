import { useId, useMemo } from 'react'
import { Play, TextCursorInput, X } from 'lucide-react'
import { Button, IconButton, Textarea, cn } from '@/ui'
import { MediaImage } from '@/media'
import { NODE_LABEL, assembleInputs, type AssetRef, type CanvasNode } from './graph'
import { defaultParams, findModel, modelsFor, useAssetUrls } from './mock'
import { KIND_ICON } from './nodes'
import { paramLabel } from '../composer/logic'
import { runBlocker, runNode, sendToComposer, updateData, useCanvas } from './store'

const selectClass = 'h-9 w-full cursor-pointer rounded-control border border-line bg-card px-2.5 text-sm hover:border-muted focus:border-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-not-allowed disabled:opacity-45'

function RefChip({ asset, index, dimmed }: { asset: AssetRef; index: number; dimmed: boolean }) {
  const urls = useAssetUrls(asset)
  return (
    <li className={cn('w-14 shrink-0', dimmed && 'opacity-45')} title={dimmed ? '当前型号不使用参考图' : `图${index + 1}`}>
      <MediaImage urls={urls ?? { orig: '' }} assetId={asset.asset_id} width={1} height={1} alt={`参考图 ${index + 1}`} className="rounded-[8px]" hideBadge />
      <span className="mt-0.5 block text-center text-[11px] text-muted">图{index + 1}</span>
    </li>
  )
}

/**
 * Compact in-canvas editor for a generation node (right panel on desktop, bottom sheet on mobile).
 * TODO(F3): replace with the real composer in 「编辑此节点」 mode (§2.7), two-way bound to node data.
 */
export function NodePanel({ node, onClose }: { node: CanvasNode; onClose: () => void }) {
  const kind = node.type === 'gen-video' ? 'video' : 'image'
  // Serialized so the selector result is stable between unrelated store updates.
  const inputsJson = useCanvas(s => JSON.stringify(assembleInputs(node.id, s.nodes, s.edges)))
  const inputs = useMemo(() => JSON.parse(inputsJson) as ReturnType<typeof assembleInputs>, [inputsJson])
  const run = useCanvas(s => s.runs[node.id])
  const blocker = useCanvas(s => (s.nodes, s.edges, runBlocker(node.id)))
  const model = findModel(node.data.model)
  const refMax = model?.references?.maxImages ?? 0
  const ids = { prompt: useId(), model: useId() }
  const Icon = KIND_ICON[node.type!]

  return (
    <aside
      aria-label={`编辑${NODE_LABEL[node.type!]}节点`}
      className={cn(
        'absolute z-20 flex flex-col overflow-hidden border border-line bg-card shadow-xl motion-safe:animate-fade-in',
        'md:bottom-3 md:right-3 md:top-3 md:w-80 md:rounded-panel',
        'max-md:inset-x-0 max-md:bottom-0 max-md:max-h-[58%] max-md:rounded-t-panel',
      )}
    >
      <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-line md:hidden" aria-hidden />
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4">
        <Icon className="size-[18px]" aria-hidden />
        <h2 className="flex-1 text-sm font-bold">编辑此节点 · {NODE_LABEL[node.type!]}</h2>
        <IconButton size="icon-sm" label="关闭面板" onClick={onClose}><X /></IconButton>
      </header>

      <div className="grid gap-4 overflow-y-auto p-4">
        {inputs.texts.length > 0 && (
          <section>
            <h3 className="mb-1.5 text-[13px] font-semibold">来自上游的文本 <span className="font-normal text-muted">· {inputs.texts.length} 段</span></h3>
            <p className="max-h-24 overflow-y-auto whitespace-pre-wrap rounded-control bg-subtle px-3 py-2 text-xs leading-5 text-muted">{inputs.texts.join('\n')}</p>
          </section>
        )}

        <Textarea
          id={ids.prompt}
          label="提示词"
          value={node.data.prompt ?? ''}
          readOnly={!!node.data.locked}
          placeholder={inputs.texts.length ? '补充描述（接在上游文本后面）' : '描述你想要的画面…'}
          onChange={e => updateData(node.id, { prompt: e.target.value }, `prompt:${node.id}`)}
          hint={inputs.texts.length ? '运行时：上游文本 + 这里的内容，按换行拼接' : undefined}
        />

        <section>
          <h3 className="mb-1.5 text-[13px] font-semibold">
            参考图 <span className="font-normal text-muted">· {inputs.references.length}{refMax ? ` / 最多 ${refMax}` : ''}</span>
          </h3>
          {inputs.references.length ? (
            <>
              <ul className="flex gap-2 overflow-x-auto pb-1">
                {inputs.references.map((r, i) => <RefChip key={r.id} asset={r} index={i} dimmed={i >= refMax} />)}
              </ul>
              {!refMax && <p className="mt-1 text-xs text-warning">当前型号不使用参考图，运行时不会带上</p>}
              {refMax > 0 && inputs.references.length > refMax && <p className="mt-1 text-xs text-warning">{model?.name} 最多 {refMax} 张参考图，超出的不会带上</p>}
            </>
          ) : (
            <p className="text-xs text-muted">把图片节点连到左侧「图片输入」端口即可作为参考</p>
          )}
        </section>

        <label className="grid gap-1.5 text-[13px] font-semibold" htmlFor={ids.model}>
          型号
          <select
            id={ids.model}
            className={selectClass}
            value={node.data.model}
            disabled={!!node.data.locked}
            onChange={e => {
              const m = findModel(e.target.value)!
              // Keep values the new model accepts; reset the rest to its defaults (§2.2).
              const prev = node.data.params ?? {}
              const params = Object.fromEntries(m.params.map(p => [p.field, p.values?.includes(prev[p.field] as never) ? prev[p.field]! : defaultParams(m)[p.field]!]))
              updateData(node.id, { model: m.id, params })
            }}
          >
            {modelsFor(kind).map(m => <option key={m.id} value={m.id}>{m.name}{m.references?.maxImages ? '' : '（不支持参考图）'}</option>)}
          </select>
        </label>

        {model && model.params.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            {model.params.map(p => (
              <label key={p.field} className="grid gap-1.5 text-[13px] font-semibold">
                {paramLabel(p.field)}
                <select
                  className={selectClass}
                  disabled={!!node.data.locked}
                  value={String(node.data.params?.[p.field] ?? p.default ?? '')}
                  onChange={e => {
                    const v = p.values?.find(x => String(x) === e.target.value) ?? e.target.value
                    updateData(node.id, { params: { ...node.data.params, [p.field]: v } })
                  }}
                >
                  {p.values?.map(v => <option key={String(v)} value={String(v)}>{p.field === 'duration' ? `${v} 秒` : String(v)}</option>)}
                </select>
              </label>
            ))}
          </div>
        )}
      </div>

      <footer className="flex shrink-0 items-center gap-2 border-t border-line p-3 pb-[max(12px,env(safe-area-inset-bottom))]">
        <Button size="sm" icon={<TextCursorInput className="size-4" />} onClick={() => sendToComposer(node.id)}>加入输入框</Button>
        <span className="flex-1" />
        <Button
          variant="primary"
          icon={<Play className="size-4" />}
          loading={run?.status === 'running'}
          loadingText="生成中"
          disabled={!!blocker && run?.status !== 'running'}
          disabledReason={blocker ?? undefined}
          onClick={() => void runNode(node.id)}
        >
          运行
        </Button>
      </footer>
    </aside>
  )
}
