import { create } from 'zustand'
import { toast } from '@/ui'
import { ApiError } from '@/shared/api'
import { getCloud, getImages, putCloud } from './api'
import {
  backupOf, download, draftOf, fresh, loadFrom, storageFor, storageKey, validImage,
  type CloudImage, type WorkspaceState,
} from './model'

// Sync engine ported 1:1 from legacy workspace.js (save / load / connectCloud / pushCloud / load-cloud).
// `epoch` guards every async continuation against an owner switch; `editSeq` detects edits made mid-request.

export interface WorkspaceStore {
  data: WorkspaceState
  owner: string | null
  /** false until the first /api/me/profile answer, so the topbar can say 「正在确认登录状态…」. */
  authKnown: boolean
  epoch: number
  cloudRevision: number
  dirty: boolean
  cloudReady: boolean
  cloudBusy: boolean
  editSeq: number
  saveFailed: boolean
  /** Legacy #sync-notice text; null = hidden. */
  notice: string | null
  images: CloudImage[]
  nextOffset: number | null
  imagesLoading: boolean
  galleryStatus: string
}

const initial = (): WorkspaceStore => ({
  data: fresh(), owner: null, authKnown: false, epoch: 0, cloudRevision: 0, dirty: false, cloudReady: false, cloudBusy: false,
  editSeq: 0, saveFailed: false, notice: null, images: [], nextOffset: null, imagesLoading: false, galleryStatus: '',
})

export const useWorkspace = create<WorkspaceStore>(initial)
const get = useWorkspace.getState
const set = useWorkspace.setState

let syncTimer: ReturnType<typeof setTimeout> | undefined
export const SYNC_DELAY = 2500

export function statusText(s: Pick<WorkspaceStore, 'owner' | 'authKnown' | 'cloudBusy' | 'cloudReady' | 'dirty' | 'saveFailed'>) {
  if (!s.authKnown) return '正在确认登录状态…'
  if (s.saveFailed) return '保存失败 · 请导出备份'
  return !s.owner ? '访客草稿 · 当前标签页' : s.cloudBusy ? '正在同步…' : !s.cloudReady ? '本机已保存 · 云端未连接' : s.dirty ? '本机已保存 · 等待同步' : '已同步到账号'
}

function writeMeta() {
  const { owner, cloudRevision, dirty } = get()
  storageFor(owner).setItem(storageKey(owner) + '.sync', JSON.stringify({ revision: cloudRevision, dirty }))
}

/** Legacy save(): persist, then (signed in) mark dirty + bump editSeq + debounce a push. */
export function save(): boolean {
  const { owner, data } = get()
  try {
    storageFor(owner).setItem(storageKey(owner), JSON.stringify(data))
    if (owner) { set(s => ({ dirty: true, editSeq: s.editSeq + 1 })); writeMeta(); scheduleSync() }
    set({ saveFailed: false })
    return true
  } catch {
    set({ saveFailed: true })
    toast({ title: '浏览器存储不可用或已满，请导出备份。', tone: 'error' })
    return false
  }
}

/** Optimistic local edit: copy, apply the legacy-style in-place recipe, save. */
export function commit(recipe: (draft: WorkspaceState) => void, persist = true): boolean {
  const draft = draftOf(get().data)
  recipe(draft)
  set({ data: draft })
  return persist ? save() : true
}

export function replaceData(data: WorkspaceState) { set({ data }); return save() }

function scheduleSync() {
  clearTimeout(syncTimer)
  const { owner, cloudReady } = get()
  if (owner && cloudReady) syncTimer = setTimeout(pushCloud, SYNC_DELAY)
}

export function loadLocal() {
  const { owner } = get()
  const { state, meta, corrupt } = loadFrom(storageFor(owner), owner)
  set({ data: state, cloudReady: false, dirty: meta.dirty, cloudRevision: meta.revision })
  if (corrupt) toast({ title: '本机记录无法读取，已打开空白空间。', tone: 'error' })
}

/** Owner changed (sign in / out / switch account): drop everything tied to the previous owner. */
export function setOwner(id: string | null) {
  set({ authKnown: true })
  if (id === get().owner) return false
  clearTimeout(syncTimer)
  set(s => ({ owner: id, epoch: s.epoch + 1, cloudBusy: false, imagesLoading: false, images: [], nextOffset: null, galleryStatus: '', notice: null }))
  loadLocal()
  if (id) void connectCloud()
  return true
}

export async function connectCloud() {
  const run = get().epoch, seq = get().editSeq
  try {
    const data = await getCloud()
    if (run !== get().epoch) return
    if (get().editSeq !== seq) { set({ notice: '读取云端期间有新修改，已保存在本机。请重试同步。' }); return }
    if (get().dirty && data.revision !== get().cloudRevision) {
      set({ cloudReady: false, notice: '另一台设备已更新稿件。本机修改仍保留；请先导出备份，再载入云端版本或导入合并。' })
      return
    }
    const { owner } = get()
    if (!get().dirty && data.payload) { set({ data: data.payload }); storageFor(owner).setItem(storageKey(owner), JSON.stringify(data.payload)) }
    set({ cloudRevision: data.revision, cloudReady: true, notice: null })
    writeMeta()
    if (!data.payload) { set({ dirty: true }); writeMeta() }
    if (get().dirty) scheduleSync()
  } catch {
    if (run !== get().epoch) return
    set({ cloudReady: false, notice: '云端暂时未连接，修改已留在本机。可继续编辑，恢复连接后重试同步。' })
  }
}

export async function pushCloud() {
  const { owner, cloudReady, cloudBusy, dirty } = get()
  if (!owner || !cloudReady || cloudBusy || !dirty) return
  const run = get().epoch, seq = get().editSeq, payload = structuredClone(get().data)
  set({ cloudBusy: true })
  try {
    const d = await putCloud(get().cloudRevision, payload)
    if (run !== get().epoch) return
    set({ cloudRevision: d.revision, dirty: seq !== get().editSeq, notice: null })
    writeMeta()
  } catch (e) {
    if (run !== get().epoch) return
    const status = e instanceof ApiError ? e.status : 0
    if (status === 409) set({ cloudReady: false })
    set({
      notice: status === 409 ? '检测到其他设备的更新，本机稿件已保留。请备份本机并载入云端，再导入合并。'
        : status === 413 ? '空间容量已满，请导出备份并整理稿件后重试。' : '同步未完成，本机稿件已保留。请稍后重试。',
    })
  } finally {
    if (run === get().epoch) {
      set({ cloudBusy: false })
      const s = get()
      if (s.dirty && s.cloudReady && seq !== s.editSeq) scheduleSync()
    }
  }
}

/** 「备份本机并载入云端」: download a local backup first, then take the cloud copy wholesale. */
export async function loadCloudReplacingLocal() {
  const { owner } = get()
  if (!owner) return
  const run = get().epoch
  try {
    const d = await getCloud()
    if (run !== get().epoch) return
    download(backupOf(get().data), 'application/json', 'ipzsk-before-cloud-restore.json')
    const data = d.payload || fresh()
    set({ data, cloudRevision: d.revision, dirty: false, cloudReady: true, notice: null })
    storageFor(owner).setItem(storageKey(owner), JSON.stringify(data))
    writeMeta()
    toast({ title: '已下载本机备份，并载入云端版本。', tone: 'success' })
  } catch {
    toast({ title: '读取云端失败，本机内容未变。', tone: 'error' })
  }
}

/** Another tab wrote our key: stop pushing so neither tab silently overwrites the other. */
export function onForeignWrite(key: string | null) {
  const { owner } = get()
  if (owner && key === storageKey(owner)) set({ cloudReady: false, notice: '另一个标签页修改了工作台。请备份后载入云端，避免覆盖。' })
}

export async function loadImages(more = false) {
  const { owner, imagesLoading } = get()
  if (!owner) { set({ galleryStatus: '登录并验证邮箱后，可查看你的云端图片。' }); return }
  if (imagesLoading) return
  const run = get().epoch
  set({ imagesLoading: true, galleryStatus: '正在读取云端图片…' })
  try {
    const data = await getImages(more ? (get().nextOffset || 0) : 0)
    if (run !== get().epoch) return
    const rows = (data.rows || []).filter(validImage)
    const prev = get().images
    const images = more ? [...prev, ...rows.filter(i => !prev.some(x => x.task_id === i.task_id && x.image_index === i.image_index))] : rows
    set({
      images,
      nextOffset: Number.isInteger(data.next_offset) ? data.next_offset! : null,
      galleryStatus: images.length ? '点击图片下方按钮，可用于当前内容的预览封面。导出文稿不包含图片文件。' : '还没有云端图片，前往作图工具开始创作。',
    })
  } catch (e) {
    if (run === get().epoch) set({ galleryStatus: e instanceof ApiError && e.status === 401 ? '登录已失效，请重新登录。' : '暂时无法读取图片，请稍后重试。' })
  } finally {
    if (run === get().epoch) set({ imagesLoading: false })
  }
}

/** Test hook. */
export function __resetWorkspace() { clearTimeout(syncTimer); set(initial(), true) }
