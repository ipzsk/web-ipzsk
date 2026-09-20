import { toast } from '@/ui'
import { textVarsOf, varLabel } from '../composer/logic'
import { CANVAS_ADD_EVENT, dispatchStudioEvent } from '@/shared/events'
import type { MediaAsset } from '@/media'
import { caseUrls, dispatchComposerFill, fillDetail, type CaseItem } from './lib'

export const caseAsset = (c: CaseItem): MediaAsset => ({
  id: c.id, kind: 'image', status: 'ready', width: c.image.width, height: c.image.height, duration_ms: null,
  urls: caseUrls(c.image),
})

export function fillComposer(c: CaseItem, promptOnly = false) {
  dispatchComposerFill(fillDetail(c, promptOnly))
  // 案例带 {{填空}} 时直说要改哪几处：整篇提示词已经写好，用户只填这几格。
  const blanks = textVarsOf(c.prompt).map(varLabel)
  toast({
    title: '已填入输入框',
    description: blanks.length ? `把「${blanks.slice(0, 3).join('」「')}」${blanks.length > 3 ? ` 等 ${blanks.length} 处` : ''}填一下就能生成` : undefined,
    tone: 'success',
  })
}

/** 放到画布: URL-only image node + prompt text node (canvas receiver asks which project). */
export const addCaseToCanvas = (c: CaseItem) =>
  dispatchStudioEvent(CANVAS_ADD_EVENT, { source: 'case', case_id: c.id, image: { url: c.image.urls.orig, width: c.image.width, height: c.image.height }, prompt: c.prompt })

export async function copyPrompt(c: CaseItem) {
  try {
    await navigator.clipboard.writeText(c.prompt)
    toast({ title: '已复制提示词', tone: 'success' })
  } catch {
    toast({ title: '复制失败', description: '浏览器没有授予剪贴板权限，请在详情里手动选择文本复制', tone: 'error' })
  }
}
