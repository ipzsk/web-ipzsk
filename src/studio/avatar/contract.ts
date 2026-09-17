/**
 * 数字人（HeyGen via lanehub）契约，官网侧的唯一出处。类型全部来自网关生成类型（ipzsk-api-gateway src/avatar-contract.mjs /
 * contracts-schema.mjs，已同步到 src/shared/contracts/generated）；这里只放常量、文案和网关没有生成的小类型。
 */
import type { AvatarCapability, AvatarItem, AvatarRef, ModelSpec, VoiceItem } from '@/shared/contracts'

export type { AvatarCapability, AvatarItem, AvatarRef, VoiceItem }

/** 型号 id（lanehub 价目行）。只用于 mock 与排序；判定一律读 ModelSpec.mode / ModelSpec.avatar。 */
export const AVATAR_MODEL_IDS = { iv: 'heygen-avatar', iii: 'heygen-avatar-iii', photo: 'heygen-image' } as const
export type AvatarTier = 'iv' | 'iii'

/** 工作台能生成的数字人型号 = 带 avatar 能力块的型号（cinematic_avatar / studio 只有 mode 没有 avatar 块）。 */
export const isAvatarModel = (m: Pick<ModelSpec, 'avatar'>) => !!m.avatar
/** 普通视频列表要排除所有 HeyGen 产品线（有 mode 的型号）。 */
export const isHeygenModel = (m: Pick<ModelSpec, 'mode'>) => !!m.mode

/** avatar 列表 engines 值：含 avatar_iii 的形象才能用 III 型号（网关不校验，界面必须拦）。 */
export const engineKey = (tier: string) => `avatar_${tier}`

export const SCRIPT_MAX = 5000
/** lanehub providers/heygen/pricing/estimate.go：CJK 3.5 字/秒，其余 2 词/秒，夹在 [60, 1800]。 */
export const CJK_CHARS_PER_SECOND = 3.5
export const WORDS_PER_SECOND = 2
export const MIN_BILL_SECONDS = 60
export const MAX_BILL_SECONDS = 1800

/** 网关 UploadRequest.content_type：只收 mp3 / wav（m4a 不收），≤32MB，时长 1s–10min 服务端实测。 */
export const AUDIO_TYPES = ['audio/mpeg', 'audio/wav', 'audio/x-wav'] as const
export const AUDIO_MAX_BYTES = 32 * 1024 * 1024
/** HeyGen 不收 WebP：照片与背景图只能 PNG / JPEG。 */
export const PHOTO_TYPES = ['image/png', 'image/jpeg'] as const

/**
 * 提交 body 里的数字人字段（GenerationBody）。队列项把它们放在 `params` 里（与 aspect_ratio / resolution 同层），
 * 发送时原样展开到 body 顶层，不带 prompt / reference_asset_ids。
 */
export const AVATAR_WIRE_FIELDS = ['avatar_id', 'photo_asset_id', 'script', 'voice_id', 'audio_asset_id', 'captions', 'background_color', 'background_asset_id'] as const
export type AvatarWireField = typeof AVATAR_WIRE_FIELDS[number]

/** 生成记录上网关补的参数（records.params）：avatar_source / voice_source / audio_duration_ms / subtitles_srt。 */
export const RECORD_ONLY_FIELDS = ['avatar_source', 'voice_source', 'audio_duration_ms', 'subtitles_srt'] as const

/** 列表接口错误。 */
export const AVATAR_LIST_ERRORS: Record<string, string> = {
  avatar_catalog_unavailable: '数字人通道暂不可用，请稍后重试',
  avatar_catalog_upstream_error: '数字人服务暂时出错，请稍后重试',
}

/** 控件定位：constraint_violation.field 等错误落到哪个控件上。 */
export type AvatarControl = 'avatar' | 'consent' | 'voice' | 'script' | 'audio' | 'background' | 'captions' | 'tier'

/**
 * 提交 / 任务失败码 → 原因 + 下一步。code 来自 lanehub 透传（avatar_consent_required / content_policy_violation …）
 * 与网关自有码（avatar_photo_no_face / avatar_source_conflict …）。
 */
export const AVATAR_ERRORS: Record<string, { message: string; control?: AvatarControl }> = {
  constraint_violation: { message: '参数组合不符合该型号要求，请按提示修改' },
  avatar_consent_required: { message: '该数字人需要先完成肖像授权 · 请换一个公共形象，或在 HeyGen 完成授权后再试', control: 'avatar' },
  content_policy_violation: { message: '内容未通过审核 · 请修改脚本、照片或录音后重试', control: 'script' },
  avatar_photo_no_face: { message: '照片里没有识别到清晰人脸 · 请换一张正脸、光线充足的 PNG/JPEG 人像', control: 'avatar' },
  avatar_source_conflict: { message: '形象只能选一个 · 保留形象库数字人或你的照片其中之一', control: 'avatar' },
  avatar_source_required: { message: '还没有选择形象 · 从形象库挑一个，或上传你的照片', control: 'avatar' },
  avatar_source_unsupported: { message: '该型号不支持这种形象来源 · 请换一种形象来源', control: 'avatar' },
  avatar_voice_conflict: { message: '声音只能选一个 · 保留脚本或录音其中之一', control: 'script' },
  avatar_voice_required: { message: '还没有声音 · 输入脚本，或上传录音', control: 'script' },
  avatar_prompt_not_supported: { message: '数字人不收提示词 · 请把要念的文字写进脚本', control: 'script' },
  voice_id_required: { message: '照片数字人朗读脚本需要选择音色 · 选一个音色，或改为上传录音', control: 'voice' },
  script_too_long: { message: `脚本超过 ${SCRIPT_MAX} 字 · 请删减，或改为上传录音`, control: 'script' },
  script_too_short: { message: '脚本太短，合成语音不足 1 秒 · 请多写几个字', control: 'script' },
  tts_text_invalid: { message: '脚本无法合成语音 · 请检查特殊符号后重试', control: 'script' },
  invalid_script: { message: '脚本不能为空 · 输入要念的文字，或改为上传录音', control: 'script' },
  avatar_not_found: { message: '形象不存在或已下架 · 请重新选择形象', control: 'avatar' },
  voice_not_found: { message: '音色不存在 · 请换一个音色', control: 'voice' },
  voice_not_usable: { message: '该音色当前不可用 · 请换一个音色', control: 'voice' },
  audio_asset_not_found: { message: '录音不存在或未上传完成 · 请重新上传 MP3/WAV', control: 'audio' },
  audio_duration_unknown: { message: '录音时长未知 · 请重新上传', control: 'audio' },
  avatar_photo_not_found: { message: '照片不存在或未上传完成 · 请重新上传', control: 'avatar' },
  avatar_photo_unsupported_type: { message: '照片只支持 PNG 或 JPEG · 请转换格式后重新上传', control: 'avatar' },
  background_unsupported_type: { message: '背景图只支持 PNG 或 JPEG · 请转换格式后重新上传', control: 'background' },
  background_asset_not_found: { message: '背景图不存在或未上传完成 · 请重新上传', control: 'background' },
  background_conflict: { message: '背景只能选一个 · 纯色或图片', control: 'background' },
  invalid_background_color: { message: '背景色需为 #RRGGBB', control: 'background' },
  avatar_engine_unavailable: { message: '该形象不支持 Avatar III · 请切回 Avatar IV，或换一个支持 III 的形象', control: 'tier' },
  captions_unsupported: { message: '该型号不支持字幕 · 请关闭字幕', control: 'captions' },
  download_failed: { message: '上游拉取照片或录音失败 · 请稍后重试' },
  video_result_missing: { message: '上游没有返回成片 · 请重试，未成功不扣点' },
}

/** constraint_violation / 400 的 field（含 `script|audio_url` 这种互斥写法）→ 控件。 */
export function controlOfField(field: string | undefined): AvatarControl | null {
  if (!field) return null
  const f = field.split('|')[0]!
  if (f === 'avatar_id' || f === 'photo_asset_id' || f === 'image_urls') return 'avatar'
  if (f === 'script') return 'script'
  if (f === 'voice_id') return 'voice'
  if (f === 'audio_url' || f === 'audio_asset_id') return 'audio'
  if (f.startsWith('background')) return 'background'
  if (f === 'captions') return 'captions'
  return null
}
