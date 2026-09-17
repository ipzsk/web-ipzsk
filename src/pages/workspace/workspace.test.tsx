import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '@/shared/query'
import { TooltipProvider } from '@/ui'
import { backupOf, content, htmlOf, importInto, loadFrom, markdownOf, safeFilename, spaceProjects, storageKey, type WorkspaceState } from './model'
import { __resetWorkspace, commit, connectCloud, pushCloud, setOwner, statusText, useWorkspace, SYNC_DELAY } from './store'
import { show, switchSpace, useNav } from './actions'
import { App } from './App'

// Exactly what legacy workspace.js writes: JSON.stringify(state) under ipzsk.workspace.v1.<owner>, meta under .sync.
const legacyState: WorkspaceState = {
  spaces: [
    { id: 's1', name: '我的内容空间', focus: 'AI 工具', reader: '新手', voice: '简洁', sources: 'a.com' },
    { id: 's2', name: '旅行号', focus: '', reader: '', voice: '', sources: '' },
  ],
  projects: [
    { id: 'p1', space: 's1', title: '老稿件一', outline: '提纲', body: '正文一', tags: '#a', platform: 'note', status: 'draft', priority: 'high', due: '2026-09-20', versions: [{ title: '老稿件一', body: '旧', outline: '', time: 1, label: '编辑前' }], updated: 200, checks: [true, null, true] as unknown as boolean[] },
    { id: 'p2', space: 's1', title: '老稿件二', outline: '', body: '正文二', tags: '', platform: 'article', status: 'ready', priority: 'normal', due: '', versions: [], updated: 300 },
    { id: 'p3', space: 's2', title: '京都', outline: '', body: '', tags: '', status: 'draft', updated: 100 },
    { id: 'p4', space: 's1', title: '已删除', outline: '', body: '', tags: '', updated: 400, deleted: 500 },
  ],
  activeSpace: 's1',
  activeProject: 'p1',
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const renderApp = () => render(<QueryClientProvider client={queryClient}><TooltipProvider><App /></TooltipProvider></QueryClientProvider>)

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); __resetWorkspace()
  history.replaceState(null, '', '/next/workspace')
  useNav.setState({ view: 'overview', dialog: null, sidebarOpen: false })
  window.scrollTo = vi.fn() as never
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('storage compatibility', () => {
  it('reads a legacy signed-in draft byte-for-byte and renders it', async () => {
    localStorage.setItem(storageKey('42'), JSON.stringify(legacyState))
    localStorage.setItem(storageKey('42') + '.sync', JSON.stringify({ revision: 7, dirty: false }))
    const loaded = loadFrom(localStorage, '42')
    expect(loaded.corrupt).toBe(false)
    expect(loaded.state).toEqual(legacyState)
    expect(loaded.meta).toEqual({ revision: 7, dirty: false })

    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('/api/me/profile')
      ? json({ user: { id: 42, email_verified: true } })
      : url.includes('/api/me/workspace') ? json({ revision: 7, payload: legacyState }) : json({ rows: [] })))
    renderApp()
    show('archive')
    expect(await screen.findByText('老稿件一')).toBeTruthy()
    expect(screen.getByText('老稿件二')).toBeTruthy()
    expect(screen.queryByText('京都')).toBeNull()   // other space
    expect(screen.queryByText('已删除')).toBeNull() // in trash
    await act(async () => { await vi.waitFor(() => expect(useWorkspace.getState().cloudReady).toBe(true)) })
    expect(screen.getByTestId('save-status').textContent).toBe('已同步到账号')
    // Saving keeps the exact legacy shape (sparse checks → null, versions preserved).
    act(() => { commit(() => {}) })
    expect(JSON.parse(localStorage.getItem(storageKey('42'))!)).toEqual(legacyState)
  })

  it('guest drafts live in sessionStorage under the guest key; missing .sync meta marks owner drafts dirty', () => {
    sessionStorage.setItem('ipzsk.workspace.v1.guest', JSON.stringify(legacyState))
    expect(loadFrom(sessionStorage, null).state.projects).toHaveLength(4)
    localStorage.setItem(storageKey('9'), JSON.stringify(legacyState))
    expect(loadFrom(localStorage, '9').meta.dirty).toBe(true)
  })

  it('corrupt storage ⇒ blank space, flagged', () => {
    localStorage.setItem(storageKey('9'), JSON.stringify({ spaces: [], projects: [] }))
    const r = loadFrom(localStorage, '9')
    expect(r.corrupt).toBe(true)
    expect(r.state.spaces).toHaveLength(1)
  })
})

describe('revision conflict handling', () => {
  it('dirty local edits + different cloud revision ⇒ keep local, stop syncing, show notice', async () => {
    localStorage.setItem(storageKey('42'), JSON.stringify(legacyState))
    localStorage.setItem(storageKey('42') + '.sync', JSON.stringify({ revision: 3, dirty: true }))
    const fetchMock = vi.fn(async () => json({ revision: 5, payload: { ...legacyState, projects: [] } }))
    vi.stubGlobal('fetch', fetchMock)
    setOwner('42')
    await vi.waitFor(() => expect(useWorkspace.getState().notice).toContain('另一台设备已更新稿件'))
    const s = useWorkspace.getState()
    expect(s.cloudReady).toBe(false)
    expect(s.data.projects).toHaveLength(4)
    expect(statusText(s)).toBe('本机已保存 · 云端未连接')
  })

  it('push sends {revision, payload}; 409 ⇒ cloudReady false + notice; success bumps revision', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    localStorage.setItem(storageKey('42'), JSON.stringify(legacyState))
    localStorage.setItem(storageKey('42') + '.sync', JSON.stringify({ revision: 3, dirty: false }))
    const calls: { method?: string; body?: string }[] = []
    let conflict = false
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      calls.push({ method: init.method, body: init.body as string })
      if (init.method === 'POST') return conflict ? json({ error: { code: 'revision_conflict' } }, 409) : json({ revision: 4 })
      return json({ revision: 3, payload: legacyState })
    }))
    setOwner('42')
    await vi.waitFor(() => expect(useWorkspace.getState().cloudReady).toBe(true))
    commit(d => { d.projects[0]!.title = '改了' })
    expect(useWorkspace.getState().dirty).toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(SYNC_DELAY) })
    await vi.waitFor(() => expect(useWorkspace.getState().cloudRevision).toBe(4))
    const post = calls.find(c => c.method === 'POST')!
    expect(JSON.parse(post.body!)).toMatchObject({ revision: 3, payload: { projects: expect.arrayContaining([expect.objectContaining({ title: '改了' })]) } })
    expect(useWorkspace.getState().dirty).toBe(false)
    expect(JSON.parse(localStorage.getItem(storageKey('42') + '.sync')!)).toEqual({ revision: 4, dirty: false })

    conflict = true
    commit(d => { d.projects[0]!.title = '又改了' })
    await pushCloud()
    const s = useWorkspace.getState()
    expect(s.cloudReady).toBe(false)
    expect(s.dirty).toBe(true)
    expect(s.notice).toContain('检测到其他设备的更新')
  })

  it('edits made while reading the cloud are not overwritten', async () => {
    localStorage.setItem(storageKey('42'), JSON.stringify(legacyState))
    let resolve!: (r: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(r => { resolve = r })))
    useWorkspace.setState({ owner: '42', data: structuredClone(legacyState) })
    const p = connectCloud()
    commit(d => { d.projects[0]!.body = 'mid-flight' })
    resolve(json({ revision: 9, payload: { ...legacyState, projects: [] } }))
    await p
    expect(useWorkspace.getState().data.projects[0]!.body).toBe('mid-flight')
    expect(useWorkspace.getState().notice).toContain('读取云端期间有新修改')
  })
})

describe('space switching', () => {
  it('switching selects the newest project of that space and persists', () => {
    useWorkspace.setState({ data: structuredClone(legacyState) })
    switchSpace('s2')
    const d = useWorkspace.getState().data
    expect(d.activeSpace).toBe('s2')
    expect(d.activeProject).toBe('p3')
    expect(spaceProjects(d).map(p => p.id)).toEqual(['p3'])
    expect(JSON.parse(sessionStorage.getItem('ipzsk.workspace.v1.guest')!).activeSpace).toBe('s2')
    switchSpace('s1')
    expect(useWorkspace.getState().data.activeProject).toBe('p2') // newest (updated 300)
  })
})

describe('export output', () => {
  const p = legacyState.projects[0]!
  it('matches legacy text formats', () => {
    expect(content(p)).toBe('老稿件一\n\n正文一\n\n#a')
    expect(markdownOf(p)).toBe('# 老稿件一\n\n正文一\n\n#a')
    expect(htmlOf({ ...p, title: '<b>&"\'', body: 'x<y' })).toBe('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>&lt;b&gt;&amp;&quot;&#39;</title><body style="max-width:720px;margin:40px auto;padding:24px;font:17px/1.9 system-ui;color:#161916"><h1>&lt;b&gt;&amp;&quot;&#39;</h1><div style="white-space:pre-wrap">x&lt;y</div><p>#a</p></body></html>')
    expect(JSON.parse(backupOf(legacyState))).toEqual({ version: 1, ...legacyState })
    expect(backupOf(legacyState).startsWith('{\n  "version": 1,\n  "spaces"')).toBe(true)
    expect(safeFilename('a/b:c?.md')).toBe('a_b_c_.md')
  })

  it('backup round-trips through import as new, re-keyed spaces without overwriting', () => {
    const next = importInto(legacyState, 'ipzsk-workspace-backup.json', 100, backupOf(legacyState))
    expect(next.spaces).toHaveLength(4)
    expect(next.spaces[2]!.name).toBe('导入 · 我的内容空间')
    expect(next.projects).toHaveLength(8)
    expect(next.projects.slice(0, 4)).toEqual(legacyState.projects)
    expect(() => importInto(legacyState, 'x.md', 3_000_000, '')).toThrow('文件过大')
  })
})
