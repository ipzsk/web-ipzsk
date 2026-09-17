import { describe, expect, it } from 'vitest'
import type { MediaAsset } from '@/media'
import { ApiError } from '@/shared/api'
import {
  avatarItemFromWire, avatarItemToWire, avatarQueueItem, avatarSubmitBody, avatarSummary, checkAvatarParams, decideAvatar, emptyAvatarDraft, estimateBillSeconds, guideAvatarError,
  isAvatarParams, speechSeconds, tierIIIReason, validateAudioFile, validatePhotoFile, type AvatarDraft,
} from './logic'
import { MOCK_AVATARS, MOCK_AVATAR_MODELS, MOCK_VOICES } from './mock'

const models = MOCK_AVATAR_MODELS
const lin = MOCK_AVATARS[0]! // IV + III, default voice
const sara = MOCK_AVATARS[2]! // IV only
const noVoice = MOCK_AVATARS.find(a => !a.default_voice_id && a.type === 'avatar')!
const voice = MOCK_VOICES[0]!
const asset = (id: string, kind: 'image' | 'audio' = 'image', duration_ms: number | null = null): MediaAsset => ({ id, kind, status: 'ready', width: null, height: null, duration_ms, urls: { orig: id } })
const draft = (o: Partial<AvatarDraft> = {}): AvatarDraft => ({ ...emptyAvatarDraft(), ...o })
const photo = asset('11111111-1111-4111-8111-111111111111')
const audio = asset('22222222-2222-4222-8222-222222222222', 'audio', 45_000)

describe('decideAvatar: 形象来源 × 声音来源', () => {
  // [avatar, photo, script, audio] → expected source / voice / first blocking control
  const table: [string, Partial<AvatarDraft>, { source: string | null; voice: string | null; block: string | null; fields: string[] }][] = [
    ['library + script', { avatar: lin, script: '你好' }, { source: 'library', voice: 'script', block: null, fields: ['avatar_id', 'script', 'captions'] }],
    ['library + script + voice', { avatar: lin, script: '你好', voice }, { source: 'library', voice: 'script', block: null, fields: ['avatar_id', 'script', 'voice_id', 'captions'] }],
    ['library + audio', { avatar: lin, audio, voiceTab: 'audio' }, { source: 'library', voice: 'audio', block: null, fields: ['avatar_id', 'audio_asset_id', 'captions'] }],
    ['photo + script + voice', { photo, consent: true, script: 'hi', voice }, { source: 'photo', voice: 'script', block: null, fields: ['photo_asset_id', 'script', 'voice_id', 'captions'] }],
    ['photo + audio', { photo, consent: true, audio }, { source: 'photo', voice: 'audio', block: null, fields: ['photo_asset_id', 'audio_asset_id', 'captions'] }],
    ['both sources', { avatar: lin, photo, consent: true, script: 'x' }, { source: null, voice: 'script', block: 'avatar', fields: ['avatar_id', 'photo_asset_id', 'script', 'captions'] }],
    ['neither source', { script: 'x' }, { source: null, voice: 'script', block: 'avatar', fields: ['script', 'captions'] }],
    ['both voices', { avatar: lin, script: 'x', audio }, { source: 'library', voice: null, block: 'script', fields: ['avatar_id', 'script', 'audio_asset_id', 'captions'] }],
    ['neither voice (script tab)', { avatar: lin }, { source: 'library', voice: null, block: 'script', fields: ['avatar_id', 'captions'] }],
    ['neither voice (audio tab)', { avatar: lin, voiceTab: 'audio' }, { source: 'library', voice: null, block: 'audio', fields: ['avatar_id', 'captions'] }],
    ['photo without consent', { photo, script: 'x', voice }, { source: 'photo', voice: 'script', block: 'consent', fields: ['photo_asset_id', 'script', 'voice_id', 'captions'] }],
    ['photo + script without voice', { photo, consent: true, script: 'x' }, { source: 'photo', voice: 'script', block: 'voice', fields: ['photo_asset_id', 'script', 'captions'] }],
    ['library without default voice', { avatar: noVoice, script: 'x' }, { source: 'library', voice: 'script', block: 'voice', fields: ['avatar_id', 'script', 'captions'] }],
  ]
  it.each(table)('%s', (_, d, want) => {
    const r = decideAvatar(draft(d), models)
    expect(r.source).toBe(want.source)
    expect(r.voiceSource).toBe(want.voice)
    expect(r.blocks[0]?.control ?? null).toBe(want.block)
    expect(Object.keys(r.fields).sort()).toEqual([...want.fields].sort())
    if (want.block) expect(r.reason).toMatch(/或|只能选一个|请勾选/) // every blocking reason names the alternatives
  })

  it('model follows source and tier', () => {
    expect(decideAvatar(draft({ avatar: lin, script: 'x' }), models).model?.id).toBe('heygen-avatar')
    expect(decideAvatar(draft({ avatar: lin, script: 'x', tier: 'iii' }), models).model?.id).toBe('heygen-avatar-iii')
    const p = decideAvatar(draft({ photo, consent: true, script: 'x', voice, tier: 'iii' }), models)
    expect(p.model?.id).toBe('heygen-image')
    expect(p.controls.tier.visible).toBe(false)
    expect(p.controls.defaultVoiceReason).toMatch(/音色/)
  })

  it('script length limit', () => {
    const r = decideAvatar(draft({ avatar: lin, script: '字'.repeat(5001) }), models)
    expect(r.reason).toContain('5000')
    expect(decideAvatar(draft({ avatar: lin, script: '字'.repeat(5000) }), models).reason).toBeNull()
  })

  it('background and captions are mutually exclusive / validated', () => {
    expect(decideAvatar(draft({ avatar: lin, script: 'x', background: 'color', backgroundColor: '#00FF00' }), models).fields).toMatchObject({ background_color: '#00FF00' })
    expect(decideAvatar(draft({ avatar: lin, script: 'x', background: 'color', backgroundColor: 'red' }), models).blocks[0]?.control).toBe('background')
    const img = decideAvatar(draft({ avatar: lin, script: 'x', background: 'image', backgroundColor: '#000000', backgroundImage: photo }), models)
    expect(img.fields).toMatchObject({ background_asset_id: photo.id })
    expect(img.fields.background_color).toBeUndefined()
    expect(decideAvatar(draft({ avatar: lin, script: 'x', background: 'image' }), models).blocks[0]?.control).toBe('background')
    expect(decideAvatar(draft({ avatar: lin, script: 'x', captions: true }), models).fields.captions).toBe(true)
  })

  it('photo model absent → photo tab disabled, photo drafts blocked', () => {
    const noPhoto = models.filter(m => m.mode !== 'talking_photo')
    expect(decideAvatar(draft(), noPhoto).controls.photoReason).toBeTruthy()
    expect(decideAvatar(draft({ photo, consent: true, script: 'x', voice }), noPhoto).blocks[0]?.control).toBe('tier')
  })
})

describe('engine availability', () => {
  it('III requires the model and the avatar engine', () => {
    expect(tierIIIReason(models, lin)).toBeNull()
    expect(tierIIIReason(models, sara)).toContain('不支持 Avatar III')
    expect(tierIIIReason(models.filter(m => m.id !== 'heygen-avatar-iii'), lin)).toContain('暂未开放')
    const r = decideAvatar(draft({ avatar: sara, script: 'x', tier: 'iii' }), models)
    expect(r.blocks[0]).toMatchObject({ control: 'tier' })
    expect(r.controls.tier.iiiReason).toContain('Avatar IV')
  })
})

describe('duration estimate parity with lanehub estimate.go', () => {
  it.each([
    ['120 English words → 60s', 'hello '.repeat(120).trim(), 60],
    ['350 汉字 → 100s', '你'.repeat(350), 100],
    ['400 字无空格 → 114.29s', '你好世界'.repeat(100), 400 / 3.5],
    ['mixed 35 字 + 20 words → 20s', '中'.repeat(35) + ' ' + 'word '.repeat(20).trim(), 20],
    ['kana / hangul count as CJK', 'あア한', 3 / 3.5],
    ['punctuation is not CJK', '，。！', 0.5],
  ])('%s', (_, text, want) => expect(speechSeconds(text)).toBeCloseTo(want, 3))
  it('bill seconds clamp to [60, 1800]; audio uses measured duration', () => {
    expect(estimateBillSeconds({ script: '' })).toBe(60)
    expect(estimateBillSeconds({ script: '你好' })).toBe(60)
    expect(estimateBillSeconds({ script: '你'.repeat(10000) })).toBe(1800)
    expect(estimateBillSeconds({ script: '你'.repeat(350) })).toBe(100)
    expect(estimateBillSeconds({ audioMs: 45_000 })).toBe(60)
    expect(estimateBillSeconds({ audioMs: 125_000 })).toBe(125)
  })
})

describe('file validation', () => {
  it('photo: png/jpeg only, webp rejected with a reason', () => {
    expect(validatePhotoFile({ type: 'image/png', size: 1 })).toBeNull()
    expect(validatePhotoFile({ type: 'image/jpeg', size: 1 })).toBeNull()
    expect(validatePhotoFile({ type: 'image/webp', size: 1 })).toContain('WebP')
    expect(validatePhotoFile({ type: 'image/gif', size: 1 })).toContain('PNG')
  })
  it('audio: mp3/wav ≤32MB, m4a rejected', () => {
    expect(validateAudioFile({ type: 'audio/mpeg', size: 1 })).toBeNull()
    expect(validateAudioFile({ type: 'audio/wav', size: 1 })).toBeNull()
    expect(validateAudioFile({ type: 'audio/x-m4a', size: 1, name: 'a.m4a' })).toContain('M4A')
    expect(validateAudioFile({ type: 'audio/mpeg', size: 33 * 1024 * 1024 })).toContain('32MB')
  })
})

const pending = (item: ReturnType<typeof avatarQueueItem>) => ({
  model: item.model, prompt: item.prompt, params: item.params, batch_id: 'b', batch_position: 0, parent_record_id: null, thread_id: 't', anchor_record_id: null, mentions: [], prompt_doc: null,
})

describe('submit body mapping', () => {
  const base = { aspect_ratio: '16:9', resolution: '720p' }
  const build = (d: Partial<AvatarDraft>) => { const dd = draft(d); return avatarQueueItem(dd, decideAvatar(dd, models), base, 'i1') }
  it.each([
    ['library + script', { avatar: lin, script: '你好', voice }, { avatar_id: lin.id, script: '你好', voice_id: voice.id }, ['photo_asset_id', 'audio_asset_id']],
    ['library + audio', { avatar: lin, audio }, { avatar_id: lin.id, audio_asset_id: audio.id }, ['photo_asset_id', 'script', 'voice_id']],
    ['photo + script', { photo, consent: true, script: 'hi', voice }, { photo_asset_id: photo.id, script: 'hi', voice_id: voice.id }, ['avatar_id', 'audio_asset_id']],
    ['photo + audio', { photo, consent: true, audio }, { photo_asset_id: photo.id, audio_asset_id: audio.id }, ['avatar_id', 'script', 'voice_id']],
  ] as const)('%s', (_, d, has, absent) => {
    const item = build(d)
    const body = avatarSubmitBody(pending(item))
    expect(body).toMatchObject({ ...has, ...base, model: item.model, batch_id: 'b', thread_id: 't', captions: false })
    for (const k of absent) expect(body).not.toHaveProperty(k)
    expect(body).not.toHaveProperty('prompt')
    expect(body).not.toHaveProperty('reference_asset_ids')
    expect(checkAvatarParams(item.params, item.prompt)).toBeNull()
  })
  it('captions + background XOR', () => {
    const color = avatarSubmitBody(pending(build({ avatar: lin, script: 'x', captions: true, background: 'color', backgroundColor: '#112233', backgroundImage: photo })))
    expect(color).toMatchObject({ captions: true, background_color: '#112233' })
    expect(color).not.toHaveProperty('background_asset_id')
    const image = avatarSubmitBody(pending(build({ avatar: lin, script: 'x', background: 'image', backgroundImage: photo })))
    expect(image).toMatchObject({ background_asset_id: photo.id })
    expect(image).not.toHaveProperty('background_color')
  })
  it('precheck catches conflicts on the wire fields', () => {
    expect(checkAvatarParams({ avatar_id: 'a', photo_asset_id: 'p', script: 'x' })).toMatchObject({ code: 'avatar_source_conflict' })
    expect(checkAvatarParams({ script: 'x' })).toMatchObject({ code: 'avatar_source_required' })
    expect(checkAvatarParams({ avatar_id: 'a', script: 'x', audio_asset_id: 'u' })).toMatchObject({ field: 'script|audio_asset_id' })
    expect(checkAvatarParams({ avatar_id: 'a' })).toMatchObject({ code: 'avatar_voice_required' })
    expect(checkAvatarParams({ avatar_id: 'a', audio_asset_id: 'u', voice_id: 'v' })).toMatchObject({ field: 'voice_id' })
    expect(checkAvatarParams({ avatar_id: 'a', script: 'x', background_color: '#fff', background_asset_id: 'b' })).toMatchObject({ code: 'background_conflict' })
  })
  it('regenerate from a record restores script from prompt and drops record-only params', () => {
    const body = avatarSubmitBody({ ...pending(build({ avatar: lin, script: 'x' })), prompt: '记录里的脚本', params: { avatar_id: 'a', voice_id: 'v', avatar_source: 'library', voice_source: 'script', subtitles_srt: '1', aspect_ratio: '16:9' } })
    expect(body).toMatchObject({ avatar_id: 'a', voice_id: 'v', script: '记录里的脚本' })
    expect(body).not.toHaveProperty('avatar_source')
    expect(body).not.toHaveProperty('subtitles_srt')
    expect(isAvatarParams({ avatar_source: 'photo' })).toBe(true)
    expect(isAvatarParams({ aspect_ratio: '1:1' })).toBe(false)
  })
})

describe('queue', () => {
  it('avatar item round-trips through the queue wire format', () => {
    const d = draft({ avatar: lin, script: '你'.repeat(157), voice, captions: true, background: 'color', backgroundColor: '#000000' })
    const item = avatarQueueItem(d, decideAvatar(d, models), { aspect_ratio: '9:16', resolution: '1080p' }, 'item-1')
    const wire = avatarItemToWire(item)
    expect(wire).toMatchObject({ prompt: '', avatar_id: lin.id, script: item.params.script, voice_id: voice.id, captions: true, background_color: '#000000', reference_asset_ids: [], params: { aspect_ratio: '9:16', resolution: '1080p' } })
    const back = avatarItemFromWire(JSON.parse(JSON.stringify(wire)) as typeof wire)
    expect(back).toMatchObject({ item_id: 'item-1', kind: 'video', model: 'heygen-avatar', params: item.params, prompt: item.prompt })
    expect(back).not.toHaveProperty('avatar_id')
    expect(avatarItemFromWire({ prompt: 'x', params: { n: 1 } })).toEqual({ prompt: 'x', params: { n: 1 } })
    expect(isAvatarParams(back.params)).toBe(true)
    expect(checkAvatarParams(back.params!, back.prompt)).toBeNull()
    expect(avatarSummary(back.params!, back.prompt, undefined, id => id === lin.id ? lin.name : undefined)).toBe(`数字人 · ${lin.name} · 45s`)
    expect(avatarSummary(back.params!, back.prompt, { avatar_name: '别名', seconds: 12.2 })).toBe('数字人 · 别名 · 12s')
  })
})

describe('error guidance', () => {
  it('maps codes and fields to controls with next steps', () => {
    expect(guideAvatarError({ code: 'avatar_consent_required', message: '' })).toMatchObject({ control: 'avatar' })
    expect(guideAvatarError({ code: 'content_policy_violation', message: '' }).message).toContain('修改')
    expect(guideAvatarError({ code: 'avatar_photo_no_face', message: '' }).message).toContain('正脸')
    const raw = new ApiError('x', { status: 400, code: 'constraint_violation', body: { error: { code: 'constraint_violation', message: 'script 与 audio_url 只能给一个', field: 'script|audio_url' } } })
    expect(guideAvatarError({ code: 'constraint_violation', message: 'x', field: 'script|audio_url' }, raw)).toMatchObject({ control: 'script', message: 'script 与 audio_url 只能给一个' })
    expect(guideAvatarError({ code: 'constraint_violation', message: 'x', field: 'voice_id' }).control).toBe('voice')
  })
})
