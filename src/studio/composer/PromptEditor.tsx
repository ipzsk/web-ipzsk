import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react'
import type { Editor } from '@tiptap/core'
import { EditorContent, Extension, NodeViewWrapper, ReactNodeViewRenderer, ReactRenderer, useEditor, type NodeViewProps } from '@tiptap/react'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import HardBreak from '@tiptap/extension-hard-break'
import Mention from '@tiptap/extension-mention'
import { Placeholder } from '@tiptap/extensions'
import { PluginKey } from '@tiptap/pm/state'
import type { SuggestionOptions, SuggestionProps } from '@tiptap/suggestion'
import { create } from 'zustand'
import { ImagePlus, TriangleAlert, UserPlus } from 'lucide-react'
import { Skeleton, Tooltip, cn } from '@/ui'
import { MediaImage, MissingMedia, type MediaAsset } from '@/media'
import { SUBJECT_KIND_LABEL, isMissingAsset, presentAssets, presentCover, type Subject } from '../api/subjects'
import { useComposer } from '../store'
import { openSubjectEditor } from '../subjects/SubjectEditor'
import { addFromChip, chipsOf, docFromText, fillSubjectVar, pruneChips, refLabel, type ChipAttrs } from './logic'
import { useSubjects } from './hooks'

/** Editor-wide flags the chip node views read (they live outside Composer's props). */
export const useEditorFlags = create<{ refsOver: string | null; expanded: boolean }>(() => ({ refsOver: null, expanded: false }))

let activeEditor: Editor | null = null
const live = () => activeEditor && !activeEditor.isDestroyed ? activeEditor : null

/** Bring the composer into view (opens the mobile sheet) and focus the prompt. */
export function focusComposer() {
  useEditorFlags.setState({ expanded: true })
  requestAnimationFrame(() => live()?.commands.focus('end'))
}

/**
 * Insert a subject chip programmatically (subject cards 「@ 到输入框」, @ panel 「创建主体」, {{主体:…}} picker).
 * Adds the subject's references to the slots (deduped, tracked by chip uid). With `token`, replaces that placeholder instead of inserting at the cursor.
 */
export function insertSubjectMention(subject: Subject, token?: string) {
  const uid = crypto.randomUUID()
  const attrs: ChipAttrs = { id: subject.id, label: subject.name, kind: 'subject', uid }
  useComposer.setState(s => ({ slots: addFromChip(s.slots, uid, presentAssets(subject)) }))
  const ed = live()
  if (!token && ed) {
    ed.chain().focus().insertContent([{ type: 'mention', attrs }, { type: 'text', text: ' ' }]).run()
    useEditorFlags.setState({ expanded: true })
    return
  }
  useComposer.setState(s => {
    const doc = s.doc ?? docFromText('')
    const next = token ? fillSubjectVar(doc, token, attrs)
      : { ...doc, content: [...(doc.content ?? []), { type: 'paragraph', content: [{ type: 'mention', attrs }, { type: 'text', text: ' ' }] }] }
    return { doc: next, docVersion: s.docVersion + 1 }
  })
  focusComposer()
}

// ── chip ──────────────────────────────────────────────────────────────────

function ChipView({ node, selected }: NodeViewProps) {
  const { id, label, kind } = node.attrs as ChipAttrs
  const slots = useComposer(s => s.slots)
  const over = useEditorFlags(s => s.refsOver)
  const { data: subjects, hasNextPage } = useSubjects(kind === 'subject')
  const subject = subjects?.find(s => s.id === id)
  const refAsset = kind === 'reference' ? slots.find(s => s.asset.id === id)?.asset : undefined
  const missing = kind === 'subject' ? !!subjects && !subject && !hasNextPage : !refAsset
  const cover = kind === 'subject' ? (subject && presentCover(subject)) : refAsset
  const name = kind === 'reference' ? refLabel(slots, id) : `@${label}`
  const warn = (kind === 'subject' && over) || missing
  const chip = (
    <span
      className={cn(
        'mx-px inline-flex h-6 select-none items-center gap-1 rounded-full border py-0 pl-0.5 pr-2 align-middle text-[13px] font-semibold leading-none',
        warn ? 'border-warning/50 bg-warning/12 text-warning' : 'border-line bg-subtle text-ink',
        selected && 'outline-2 outline-offset-1 outline-ink',
      )}
    >
      {cover
        ? <MediaImage asset={cover} alt="" hideBadge className="size-5 shrink-0 overflow-hidden rounded-full" />
        : <span className="grid size-5 place-items-center rounded-full bg-card">{missing ? <TriangleAlert className="size-3" /> : <ImagePlus className="size-3" />}</span>}
      {missing && kind === 'subject' ? `${name}（主体已删除）` : name}
    </span>
  )
  const tip = missing ? (kind === 'subject' ? '主体已删除，请移除这个标签后再发送' : '这张参考图已被移除')
    : kind === 'subject' && subject ? (
      <div className="grid gap-1.5">
        <span>{subject.name} · {SUBJECT_KIND_LABEL[subject.kind]} · {subject.assets.length} 张参考图</span>
        <span className="flex gap-1">{subject.assets.slice(0, 8).map(a => isMissingAsset(a) ? <MissingMedia key={a.id} label="已删除" className="size-10 overflow-hidden rounded-[6px]" /> : <MediaImage key={a.id} asset={a} alt="" hideBadge className="size-10 overflow-hidden rounded-[6px]" />)}</span>
        {over && <span className="text-acid">{over}</span>}
      </div>
    ) : null
  return (
    <NodeViewWrapper as="span" data-chip={kind}>
      {tip ? <Tooltip content={tip}>{chip}</Tooltip> : chip}
    </NodeViewWrapper>
  )
}

// ── suggestion panel ──────────────────────────────────────────────────────

type Item = { type: 'subject'; subject: Subject } | { type: 'reference'; asset: MediaAsset; index: number } | { type: 'create' }
interface PanelHandle { onKeyDown: (e: KeyboardEvent) => boolean }

function itemsFor(query: string, subjects: Subject[]): Item[] {
  const q = query.trim().toLowerCase()
  const slots = useComposer.getState().slots
  return [
    ...subjects.filter(s => s.name.toLowerCase().includes(q)).slice(0, 8).map((subject): Item => ({ type: 'subject', subject })),
    ...slots.map((s, index): Item => ({ type: 'reference', asset: s.asset, index })).filter(r => !q || `图${(r as { index: number }).index + 1}`.includes(q)),
    { type: 'create' },
  ]
}

const MentionPanel = forwardRef<PanelHandle, SuggestionProps<unknown, Item>>(function MentionPanel({ query, command }, ref) {
  const { data: subjects, isPending, isError, refetch, hasNextPage, fetchNextPage, isFetchingNextPage } = useSubjects(true)
  const items = itemsFor(query, subjects ?? [])
  const [index, setIndex] = useState(0)
  useEffect(() => setIndex(0), [query])
  const pick = (it: Item | undefined) => { if (it) command(it) }
  useImperativeHandle(ref, () => ({
    onKeyDown: e => {
      if (e.key === 'ArrowDown') { setIndex(i => (i + 1) % items.length); return true }
      if (e.key === 'ArrowUp') { setIndex(i => (i - 1 + items.length) % items.length); return true }
      if (e.key === 'Enter' || e.key === 'Tab') { pick(items[index]); return true }
      return false // Escape: the plugin closes the panel itself
    },
  }))
  const row = (it: Item, i: number, body: ReactNode) => (
    <div
      key={i} role="option" aria-selected={i === index} id={`mention-opt-${i}`}
      onMouseDown={e => { e.preventDefault(); pick(it) }} onMouseEnter={() => setIndex(i)}
      className={cn('flex h-11 cursor-pointer items-center gap-2.5 rounded-[8px] px-2 text-sm', i === index && 'bg-subtle')}
    >{body}</div>
  )
  const subjectRows = items.filter(i => i.type === 'subject')
  const refRows = items.filter(i => i.type === 'reference')
  return (
    <div role="listbox" aria-label="提及" aria-activedescendant={`mention-opt-${index}`} className="z-50 flex max-h-80 w-72 flex-col rounded-card border border-line bg-card shadow-xl motion-safe:animate-fade-in">
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        <p className="px-2 pb-1 pt-1.5 text-xs text-muted">主体</p>
        {isPending ? <div className="grid gap-1 p-1"><Skeleton className="h-9" /><Skeleton className="h-9" /></div>
          : isError ? <p className="px-2 py-2 text-xs text-danger">主体加载失败 · <button type="button" className="underline" onMouseDown={e => { e.preventDefault(); void refetch() }}>重试</button></p>
          : !subjectRows.length ? <p className="px-2 py-2 text-xs text-muted">{query ? `已加载的主体里没有「${query}」` : '还没有主体'}</p>
          : subjectRows.map(it => {
            const s = (it as Extract<Item, { type: 'subject' }>).subject
            return row(it, items.indexOf(it), <>
              {presentCover(s) ? <MediaImage asset={presentCover(s)!} alt="" hideBadge className="size-8 shrink-0 overflow-hidden rounded-full" /> : <span className="size-8 rounded-full bg-subtle" />}
              <span className="min-w-0 flex-1 truncate font-semibold">{s.name}</span>
              <span className="text-xs text-muted">{SUBJECT_KIND_LABEL[s.kind]} · {s.assets.length}张</span>
            </>)
          })}
        {hasNextPage && !isPending && (
          <button type="button" disabled={isFetchingNextPage} onMouseDown={e => { e.preventDefault(); void fetchNextPage() }}
            className="flex h-8 w-full cursor-pointer items-center justify-center gap-1 rounded-[8px] text-xs font-semibold text-muted hover:bg-subtle hover:text-ink disabled:cursor-wait">
            {isFetchingNextPage ? '加载中…' : '加载更多主体'}
          </button>
        )}
        {refRows.length > 0 && <p className="px-2 pb-1 pt-2 text-xs text-muted">参考图</p>}
        {refRows.map(it => {
          const r = it as Extract<Item, { type: 'reference' }>
          return row(it, items.indexOf(it), <>
            <MediaImage asset={r.asset} alt="" hideBadge className="size-8 shrink-0 overflow-hidden rounded-[6px]" />
            <span className="font-semibold">图{r.index + 1}</span>
          </>)
        })}
      </div>
      <div className="border-t border-line p-1">
        {row(items[items.length - 1]!, items.length - 1, <><UserPlus className="size-4" /><span>创建主体</span></>)}
      </div>
    </div>
  )
})

function suggestion(char: string, key: string): Omit<SuggestionOptions<Item, Item>, 'editor'> {
  return {
    char,
    pluginKey: new PluginKey(key),
    allowedPrefixes: null, // Chinese has no spaces: 「一只@橘猫」 must trigger
    placement: 'top-start',
    items: () => [], // the panel derives items itself so late-loading subjects show up without another keystroke
    command: ({ editor, range, props }) => {
      if (props.type === 'create') {
        const name = editor.state.doc.textBetween(range.from + 1, range.to).trim().slice(0, 30)
        editor.chain().focus().deleteRange(range).run()
        openSubjectEditor({ name, onSaved: s => insertSubjectMention(s) })
        return
      }
      const uid = crypto.randomUUID()
      const attrs: ChipAttrs = props.type === 'subject'
        ? { id: props.subject.id, label: props.subject.name, kind: 'subject', uid }
        : { id: props.asset.id, label: `图${props.index + 1}`, kind: 'reference', uid }
      if (props.type === 'subject') useComposer.setState(s => ({ slots: addFromChip(s.slots, uid, presentAssets(props.subject)) }))
      editor.chain().focus().insertContentAt(range, [{ type: 'mention', attrs }, { type: 'text', text: ' ' }]).run()
    },
    render: () => {
      let component: ReactRenderer<PanelHandle, SuggestionProps<unknown, Item>> | undefined
      let unmount: (() => void) | undefined
      return {
        onStart: props => {
          component = new ReactRenderer(MentionPanel, { props, editor: props.editor })
          component.element.style.zIndex = '60' // above the fixed composer / mobile sheet
          unmount = props.mount(component.element)
        },
        onUpdate: props => component?.updateProps(props),
        onKeyDown: ({ event }) => component?.ref?.onKeyDown(event) ?? false,
        onExit: () => { unmount?.(); component?.destroy() },
      }
    },
  }
}

const Chip = Mention.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      kind: { default: 'subject', parseHTML: el => el.getAttribute('data-kind'), renderHTML: a => ({ 'data-kind': a.kind }) },
      uid: { default: null, parseHTML: el => el.getAttribute('data-uid'), renderHTML: a => ({ 'data-uid': a.uid }) },
    }
  },
  addNodeView() { return ReactNodeViewRenderer(ChipView, { as: 'span' }) },
}).configure({
  renderText: ({ node }) => node.attrs.kind === 'reference' ? node.attrs.label : `@${node.attrs.label}`,
  // Mention types its command props as MentionNodeAttrs; our command inserts richer attrs itself.
  suggestions: [suggestion('@', 'mention-at'), suggestion('＠', 'mention-at-fullwidth')] as unknown as Omit<SuggestionOptions, 'editor'>[],
})

// ── editor ────────────────────────────────────────────────────────────────

function syncFromDoc(doc: ReturnType<NonNullable<ReturnType<typeof useEditor>>['getJSON']>) {
  const chips = chipsOf(doc)
  const live = new Set(chips.filter(c => c.kind === 'subject').map(c => c.uid))
  const refd = new Set(chips.filter(c => c.kind === 'reference').map(c => c.id))
  useComposer.setState(s => ({ doc, slots: pruneChips(s.slots, live, refd) }))
}

export function PromptEditor({ onSubmit, onFiles, placeholder }: { onSubmit: () => void; onFiles: (files: File[]) => void; placeholder: string }) {
  const submitRef = useRef(onSubmit)
  submitRef.current = onSubmit
  const filesRef = useRef(onFiles)
  filesRef.current = onFiles

  const editor = useEditor({
    immediatelyRender: true,
    extensions: [
      Document, Paragraph, Text, HardBreak, Chip,
      Placeholder.configure({ placeholder }),
      Extension.create({
        name: 'submitShortcut',
        addKeyboardShortcuts: () => ({
          // IME composition never submits (§2.2); plain Enter keeps its default: new line.
          'Mod-Enter': ({ editor }) => { if (editor.view.composing) return false; submitRef.current(); return true },
        }),
      }),
    ],
    content: useComposer.getState().doc,
    onUpdate: ({ editor }) => syncFromDoc(editor.getJSON()),
    editorProps: {
      attributes: {
        'aria-label': '提示词', role: 'textbox', 'aria-multiline': 'true',
        class: cn(
          'max-h-[calc(8*1.5rem+.5rem)] min-h-12 overflow-y-auto px-2 py-1 text-sm leading-6 outline-none',
          '[&_p.is-editor-empty:first-child]:before:pointer-events-none [&_p.is-editor-empty:first-child]:before:float-left [&_p.is-editor-empty:first-child]:before:h-0',
          '[&_p.is-editor-empty:first-child]:before:text-muted [&_p.is-editor-empty:first-child]:before:content-[attr(data-placeholder)]',
        ),
      },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? [])
        if (!files.length) return false
        filesRef.current(files)
        return true
      },
    },
  })

  useEffect(() => {
    activeEditor = editor
    return () => { if (activeEditor === editor) activeEditor = null }
  }, [editor])

  // Doc replaced from outside (edit queue item, restore draft, enhance).
  const docVersion = useComposer(s => s.docVersion)
  const seen = useRef(docVersion)
  useEffect(() => {
    if (!editor || seen.current === docVersion) return
    seen.current = docVersion
    editor.commands.setContent(useComposer.getState().doc ?? '', { emitUpdate: false })
  }, [editor, docVersion])

  return <EditorContent editor={editor} />
}
