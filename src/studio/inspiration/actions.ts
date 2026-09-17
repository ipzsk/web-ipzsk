import { toast } from '@/ui'
import { CANVAS_ADD_EVENT, dispatchStudioEvent } from '@/shared/events'
import type { MediaAsset } from '@/media'
import { dispatchComposerFill, fillDetail, type CaseItem } from './lib'

export const caseAsset = (c: CaseItem): MediaAsset => ({
  id: c.id, kind: 'image', status: 'ready', width: c.image.width, height: c.image.height, duration_ms: null,
  urls: { w480: c.image.url, orig: c.image.orig },
})

export function fillComposer(c: CaseItem, promptOnly = false) {
  dispatchComposerFill(fillDetail(c, promptOnly))
  toast({ title: '已填入输入框', tone: 'success' })
}

/** 放到画布: URL-only image node + prompt text node (canvas receiver asks which project). */
export const addCaseToCanvas = (c: CaseItem) =>
  dispatchStudioEvent(CANVAS_ADD_EVENT, { source: 'case', case_id: c.id, image: { url: c.image.orig, width: c.image.width, height: c.image.height }, prompt: c.prompt })

export async function copyPrompt(c: CaseItem) {
  try {
    await navigator.clipboard.writeText(c.prompt)
    toast({ title: '已复制提示词', tone: 'success' })
  } catch {
    toast({ title: '复制失败', description: '浏览器没有授予剪贴板权限，请在详情里手动选择文本复制', tone: 'error' })
  }
}
