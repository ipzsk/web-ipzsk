// §2.8 user templates — pure rules (tested in templates.test.ts).
import type { JSONContent } from '@tiptap/core'
import type { GenerationParams, MediaKind, Mention, TemplateItem, TemplateVariable, UserTemplateCreate } from '@/shared/contracts'
import type { QueueEntry } from '../api/queue'
import { AVATAR_ERRORS, AVATAR_WIRE_FIELDS } from '../avatar/contract'
import { avatarWireFields, checkAvatarParams, isAvatarParams } from '../avatar/logic'

export const TEMPLATE_NAME_MAX = 60
export const TEMPLATE_ITEMS_MAX = 12
export const VARIABLES_MAX = 20

/** What a template is saved from: a queue entry or a batch item, reduced to the wire fields. */
export interface TemplateSource {
  item_id: string
  kind: MediaKind
  model: string
  prompt: string
  params: GenerationParams
  anchor_of: string | null
  mentions: Mention[]
  prompt_doc: JSONContent | null
  reference_asset_ids: string[]
}

export type RefMode = 'slot' | 'asset'

// `{{name}}`; `{{主体:…}}` is the subject placeholder (§2.9), not a text variable.
const VAR = /\{\{\s*([^{}\s][^{}]{0,39}?)\s*\}\}/g
export const variableNames = (prompts: string[]) =>
  [...new Set(prompts.flatMap(p => [...p.matchAll(VAR)].map(m => m[1]!)).filter(n => !/^主体[:：]/.test(n)))].slice(0, VARIABLES_MAX)

/** Detected names, keeping edits the user already made to still-present ones. */
export const mergeVariables = (names: string[], prev: TemplateVariable[]): TemplateVariable[] =>
  names.map(name => prev.find(v => v.name === name) ?? { name, label: name, default: '', required: true })

export function validateTemplate(name: string, items: TemplateSource[], variables: TemplateVariable[]): string | null {
  const n = [...name.trim()].length
  if (!n) return '请填写模板名称'
  if (n > TEMPLATE_NAME_MAX) return `名称最多 ${TEMPLATE_NAME_MAX} 个字`
  if (!items.length) return '模板至少需要 1 项'
  if (items.length > TEMPLATE_ITEMS_MAX) return `模板最多 ${TEMPLATE_ITEMS_MAX} 项`
  if (variables.some(v => !v.label.trim())) return '每个变量都需要显示名称'
  if (variables.some(v => (v.default ?? '').includes('{{'))) return '变量默认值不能包含 {{'
  // Gateway: an avatar template item must be complete (only photo / audio / background may be {slot} placeholders).
  for (const [i, it] of items.entries()) {
    if (!isAvatarParams(it.params)) continue
    const f = avatarWireFields(it.params, it.prompt)
    const e = checkAvatarParams(f as GenerationParams)
    if (e) return `第 ${i + 1} 项数字人还不完整：${e.message}`
    if (f.photo_asset_id && f.script && !f.voice_id) return `第 ${i + 1} 项数字人还不完整：${AVATAR_ERRORS.voice_id_required!.message}`
  }
  return null
}

// ── 数字人素材占位（{slot:n}，0–14）──────────────────────────────────────────
const SLOT_FIELDS = ['photo_asset_id', 'audio_asset_id', 'background_asset_id'] as const
export type AvatarSlotField = typeof SLOT_FIELDS[number]
const slotLabel = (f: AvatarSlotField) => ['照片', '录音', '背景图'][SLOT_FIELDS.indexOf(f)]!
/** How many photo / audio / background assets the sources carry (the 「应用时放入」 switch covers them too). */
export const avatarAssetCount = (items: TemplateSource[]) =>
  items.reduce((n, i) => n + (isAvatarParams(i.params) ? SLOT_FIELDS.filter(k => typeof i.params[k] === 'string' && i.params[k]).length : 0), 0)

/** Queue / batch → POST body. `slot`: references become `{slot:i}` placeholders; `asset`: kept as the user's own `{asset_id}`. */
export function buildTemplate(input: { name: string; cover_id: string | null; items: TemplateSource[]; variables: TemplateVariable[]; refMode: RefMode }): UserTemplateCreate {
  const ids = new Set(input.items.map(i => i.item_id))
  // Avatar assets → one slot per distinct asset per field across the template, so items sharing a photo are filled once.
  // ≤12 items ⇒ slot ≤ 11, inside the gateway's 0–14.
  const slotNo = new Map<string, number>()
  const slotOf = (field: AvatarSlotField, id: string) => {
    const key = `${field}:${id}`
    if (!slotNo.has(key)) slotNo.set(key, [...slotNo.keys()].filter(k => k.startsWith(`${field}:`)).length)
    return slotNo.get(key)!
  }
  const items: TemplateItem[] = input.items.map(i => isAvatarParams(i.params) ? avatarTemplateItem(i, ids, input.refMode, slotOf) : ({
    item_id: i.item_id, kind: i.kind, model: i.model, prompt: i.prompt, params: i.params,
    anchor_of: i.anchor_of && ids.has(i.anchor_of) ? i.anchor_of : null,
    mentions: i.mentions, prompt_doc: i.prompt_doc as Record<string, unknown> | null,
    references: i.reference_asset_ids.map((asset_id, slot) => input.refMode === 'slot' ? { slot } : { asset_id }),
  }))
  return {
    name: input.name.trim(), cover_id: input.cover_id, items,
    variables: input.variables.map(v => ({ name: v.name, label: v.label.trim(), required: v.required, ...(v.default ? { default: v.default } : {}) })),
  }
}

function avatarTemplateItem(i: TemplateSource, ids: Set<string>, refMode: RefMode, slotOf: (f: AvatarSlotField, id: string) => number): TemplateItem {
  const fields = { ...avatarWireFields(i.params, i.prompt) } as Pick<TemplateItem, typeof AVATAR_WIRE_FIELDS[number]>
  if (refMode === 'slot') for (const k of SLOT_FIELDS) if (typeof fields[k] === 'string') fields[k] = { slot: slotOf(k, fields[k]) }
  const params = Object.fromEntries(Object.entries(i.params).filter(([k]) => k === 'aspect_ratio' || k === 'resolution'))
  // Gateway: avatar items carry no prompt / references; the script lives in `script`.
  return { item_id: i.item_id, kind: i.kind, model: i.model, prompt: '', params, anchor_of: i.anchor_of && ids.has(i.anchor_of) ? i.anchor_of : null, mentions: [], prompt_doc: null, references: [], ...fields }
}

export interface AvatarSlotNeed { key: string; field: AvatarSlotField; slot: number; label: string }
/** Placeholder assets an avatar item still needs. */
export const avatarSlotsOf = (item: TemplateItem) =>
  SLOT_FIELDS.flatMap(field => { const v = item[field]; return v && typeof v === 'object' ? [{ field, slot: v.slot }] : [] })
/** Distinct avatar slots across the template (shared by items), labelled 照片 / 照片2 when a field has several. */
export function templateAvatarSlots(items: TemplateItem[]): AvatarSlotNeed[] {
  const seen = new Map<string, AvatarSlotNeed>()
  for (const s of items.flatMap(avatarSlotsOf)) seen.set(`${s.field}:${s.slot}`, { key: `${s.field}:${s.slot}`, ...s, label: '' })
  const needs = [...seen.values()].sort((a, b) => SLOT_FIELDS.indexOf(a.field) - SLOT_FIELDS.indexOf(b.field) || a.slot - b.slot)
  return needs.map(n => {
    const same = needs.filter(x => x.field === n.field)
    return { ...n, label: same.length > 1 ? `${slotLabel(n.field)}${same.indexOf(n) + 1}` : slotLabel(n.field) }
  })
}
export const isAvatarTemplateItem = (item: TemplateItem) => AVATAR_WIRE_FIELDS.some(k => item[k] != null && item[k] !== '')

/**
 * Avatar template item → local queue entry (fields in params, prompt = display summary). Filled slots become asset ids;
 * unfilled ones leave the item red (not sendable) until edited.
 */
export function avatarQueueEntry(item: TemplateItem, filled: Record<string, string>, values: Record<string, string>, item_id: string): QueueEntry {
  const needs = templateAvatarSlots([item])
  const params: GenerationParams = { ...(item.params as GenerationParams | undefined) }
  const missing: string[] = []
  for (const k of AVATAR_WIRE_FIELDS) {
    const v = item[k]
    if (v == null || v === '') continue
    if (typeof v === 'object') {
      const id = filled[`${k}:${v.slot}`]
      if (id) params[k] = id; else missing.push(needs.find(n => n.key === `${k}:${v.slot}`)?.label ?? k)
    } else params[k] = k === 'script' && typeof v === 'string' ? fillText(v, values) : v
  }
  const prompt = typeof params.script === 'string' ? params.script : params.audio_asset_id ? '录音驱动' : ''
  const entry: QueueEntry = { item_id, kind: item.kind, model: item.model, prompt, params, reference_asset_ids: [], anchor_of: null, mentions: [], prompt_doc: null, slots: [] }
  return missing.length
    ? { ...entry, state: 'failed', error: { code: 'template_slot', message: `需要放入${missing.join('、')}（编辑此项补上后「更新」）` } }
    : entry
}

/** Value per variable (empty → default); error when a required one is still empty or a value contains `{{`. */
export function resolveValues(variables: TemplateVariable[], input: Record<string, string>): { values: Record<string, string>; error: string | null } {
  const values: Record<string, string> = {}
  for (const v of variables) {
    const val = (input[v.name] ?? '').trim() || v.default || ''
    if (val.includes('{{')) return { values, error: `「${v.label}」不能包含 {{` }
    if (v.required && !val) return { values, error: `请填写「${v.label}」` }
    values[v.name] = val
  }
  return { values, error: null }
}

/** Replace only declared `{{name}}`; undeclared ones stay literal, no escaping (§2.8). */
export const fillText = (text: string, values: Record<string, string>) =>
  text.replace(VAR, (all, name: string) => Object.hasOwn(values, name) ? values[name]! : all)

export function fillDoc(doc: JSONContent | null | undefined, values: Record<string, string>): JSONContent | null {
  if (!doc) return null
  return { ...doc, ...(doc.text !== undefined && { text: fillText(doc.text, values) }), ...(doc.content && { content: doc.content.map(c => fillDoc(c, values)!) }) }
}

/** Placeholder slots an item needs (1-based labels 图1…), and the asset ids it already owns. */
export const slotsOf = (item: TemplateItem) => (item.references ?? []).flatMap(r => 'slot' in r ? [r.slot] : [])
export const ownedIdsOf = (item: TemplateItem) => (item.references ?? []).flatMap(r => 'asset_id' in r ? [r.asset_id] : [])

/** 「名称 副本」, 「名称 副本2」… first free, ≤ 60 chars. */
export function copyTemplateName(name: string, taken: string[]): string {
  const set = new Set(taken)
  for (let i = 1; ; i++) {
    const suffix = i === 1 ? ' 副本' : ` 副本${i}`
    const n = [...name].slice(0, TEMPLATE_NAME_MAX - suffix.length).join('') + suffix
    if (!set.has(n)) return n
  }
}
