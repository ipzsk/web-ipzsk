import { create } from 'zustand'
import { toast } from '@/ui'
import {
  LIMITS, TEMPLATES, activeProject, checkpoint, isView, spaceProjects, uid,
  type Project, type Space, type Template, type View,
} from './model'
import { commit, loadImages, useWorkspace } from './store'

// UI-level actions shared by several views (legacy click handlers).

export type DialogKind = 'space' | 'project' | 'versions' | 'ai' | null
export const useNav = create<{ view: View; sidebarOpen: boolean; dialog: DialogKind }>(() => ({
  view: isView(location.hash.slice(1)) ? location.hash.slice(1) as View : 'overview',
  sidebarOpen: false,
  dialog: null,
}))

export function show(v: string) {
  const view: View = isView(v) ? v : 'overview'
  useNav.setState({ view, sidebarOpen: false })
  history.replaceState(null, '', `#${view}`)
  window.scrollTo({ top: 0, behavior: 'instant' })
  if (view === 'images' && !useWorkspace.getState().images.length) void loadImages()
}

export const openDialog = (dialog: DialogKind) => useNav.setState({ dialog })

export function selectProject(id: string, persist = true) {
  commit(d => { d.activeProject = id }, persist)
}

export function switchSpace(id: string) {
  commit(d => { d.activeSpace = id; d.activeProject = spaceProjects(d)[0]?.id || null })
}

/** Legacy #create-form submit. Returns false (dialog stays open) when a limit is hit. */
export function createItem(mode: 'space' | 'project', rawTitle: string, template: Template = 'blank'): boolean {
  const title = rawTitle.trim()
  if (!title) return false
  const { data } = useWorkspace.getState()
  if (mode === 'space' && data.spaces.length >= LIMITS.spaces) { toast({ title: '最多创建 30 个内容空间', tone: 'error' }); return false }
  if (mode !== 'space' && data.projects.length >= LIMITS.projects) { toast({ title: '最多保存 500 篇稿件，请先导出整理。', tone: 'error' }); return false }
  const id = uid()
  commit(d => {
    if (mode === 'space') {
      d.spaces.push({ id, name: title, focus: '', reader: '', voice: '', sources: '' })
      d.activeSpace = id
      d.activeProject = null
    } else {
      d.projects.push({ id, space: d.activeSpace, title, outline: TEMPLATES[template] || '', body: '', tags: '', platform: template === 'article' ? 'article' : 'note', status: 'draft', priority: 'normal', due: '', versions: [], updated: Date.now() })
      d.activeProject = id
    }
  })
  show(mode === 'space' ? 'settings' : 'editor')
  return true
}

type EditableField = 'title' | 'outline' | 'body' | 'tags' | 'status' | 'due' | 'priority'
/** Legacy [data-field] oninput: text fields take a throttled checkpoint and reset status to draft. */
export function editField(field: EditableField, value: string) {
  commit(d => {
    const p = activeProject(d)
    if (!p) return
    const text = field === 'body' || field === 'outline' || field === 'title'
    if (text) checkpoint(p, '编辑前', true)
    ;(p as unknown as Record<string, string>)[field] = value
    p.updated = Date.now()
    if (text) p.status = 'draft'
  })
}

export function updateProject(fn: (p: Project) => void, persist = true) {
  let found = false
  const ok = commit(d => { const p = activeProject(d); if (p) { found = true; fn(p) } }, persist)
  return found && ok
}

export function saveSpace(values: Pick<Space, 'name' | 'focus' | 'reader' | 'voice' | 'sources'>) {
  const ok = commit(d => {
    const s = d.spaces.find(x => x.id === d.activeSpace)
    if (!s) return
    for (const f of ['name', 'focus', 'reader', 'voice', 'sources'] as const) s[f] = values[f].trim()
    if (!s.name) s.name = '我的内容空间'
  })
  if (ok) toast({ title: '空间偏好已保存', tone: 'success' })
}

export function restoreProject(id: string) {
  commit(d => {
    const p = d.projects.find(x => x.id === id)
    if (!p) return
    delete p.deleted
    d.activeProject = p.id
  })
}

export function trashProject() {
  const p = activeProject(useWorkspace.getState().data)
  if (!p) return
  commit(d => {
    const q = activeProject(d)!
    checkpoint(q, '移入回收站前')
    q.deleted = Date.now()
    d.activeProject = spaceProjects(d)[0]?.id || null
  })
  show('trash')
  toast({ title: '已移入回收站，可随时恢复。', action: { label: '撤销', onClick: () => restoreProject(p.id) } })
}

export async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); toast({ title: '已复制', tone: 'success' }) }
  catch { toast({ title: '无法访问剪贴板，请使用导出按钮。', tone: 'error' }) }
}
