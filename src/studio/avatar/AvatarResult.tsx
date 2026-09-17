// 创作气泡里数字人记录的附加信息，以及主体库「@ 到输入框」选中数字人。
import type { GenerationParams } from '@/shared/contracts'
import type { MediaAsset } from '@/media'
import { formatPoints } from '@/shared/points'
import { queryClient } from '@/shared/query'
import { toast } from '@/ui'
import type { Subject } from '../api/subjects'
import { useComposer } from '../store'
import { focusComposer, useEditorFlags } from '../composer/PromptEditor'
import { listAvatars } from './api'
import { avatarExtras, avatarNameOf, pickAvatar, pickPhoto, patchAvatarDraft } from './draft'
import { avatarSummary, formatSeconds, isAvatarParams } from './logic'

export { isAvatarParams }

/** 主结果之后的 captioned 版标签。 */
export const avatarTileLabel = (params: GenerationParams, index: number) => isAvatarParams(params) && params.captions === true && index === 1 ? '带字幕版' : null

/** 气泡摘要行：「数字人 · 林岚 · 45s」。 */
export const avatarItemSummary = (i: { item_id: string | null; params: GenerationParams; prompt: string }) =>
  avatarSummary(i.params, i.prompt, avatarExtras(i.item_id), avatarNameOf)

/** 结果单元格附加行：成片时长 + 「预估 N 点 → 实扣 M 点」（结算后）。 */
export function AvatarResultMeta({ item }: { item: { item_id: string | null; status: string; params: GenerationParams; charged_points: string | null; results: MediaAsset[] } }) {
  if (!isAvatarParams(item.params)) return null
  const est = avatarExtras(item.item_id)?.estimate_points
  const ms = item.results[0]?.duration_ms
  const parts = [
    ms ? `成片 ${formatSeconds(ms / 1000)}` : null,
    item.status === 'succeeded' && item.charged_points != null && est != null ? `预估 ${formatPoints(est)} → 实扣 ${formatPoints(item.charged_points)}` : null,
    item.status === 'succeeded' && item.charged_points == null ? '按实际时长结算中' : null,
    item.status === 'queued' || item.status === 'running' || item.status === 'submitting' ? (est != null ? `预估 ${formatPoints(est)} · 按实际时长多退少补` : '按实际时长结算') : null,
  ].filter(Boolean)
  return parts.length ? <p className="text-xs tabular-nums text-muted">{parts.join(' · ')}</p> : null
}

/** 切到数字人模式并展开输入框。 */
export function enterAvatarMode() {
  useComposer.setState({ kind: 'video', mode: 'avatar' })
  useEditorFlags.setState({ expanded: true })
  focusComposer()
}

/** 主体库 kind=avatar 的「@ 到输入框」：形象库数字人（external_ref）或照片主体的第一张图 → 数字人草稿。 */
export async function selectAvatarSubject(subject: Subject) {
  const ref = subject.external_ref
  const photo = subject.assets.find((a): a is Exclude<typeof a, { missing: true }> => !('missing' in a) && a.kind === 'image')
  if (ref) {
    // 列表里有就用真实项（engines / 默认音色准确）；拿不到列表时用主体里存的快照。
    const live = (await queryClient.fetchQuery({ queryKey: ['avatar', 'avatars'], queryFn: listAvatars, staleTime: 10 * 60_000 }).catch(() => []))?.find(a => a.id === ref.avatar_id)
    pickAvatar(live ?? { id: ref.avatar_id, name: ref.name ?? subject.name, type: 'avatar', avatar_type: null, gender: null, preview_image_url: ref.preview_image_url ?? null, preview_video_url: ref.preview_video_url ?? null, default_voice_id: null, engines: ['avatar_iv'] })
  } else if (photo) {
    pickPhoto(photo)
    patchAvatarDraft({ consent: false })
  } else {
    toast({ title: '这个数字人主体没有可用的形象', description: '请编辑主体，上传一张 PNG/JPEG 人像照片', tone: 'error' })
    return
  }
  enterAvatarMode()
  toast({ title: `已选中数字人「${subject.name}」`, tone: 'success' })
}
