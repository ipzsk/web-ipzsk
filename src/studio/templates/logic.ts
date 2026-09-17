// §2.8 user templates — pure rules (tested in templates.test.ts).
import type { JSONContent } from '@tiptap/core'
import type { GenerationParams, MediaKind, Mention, TemplateItem, TemplateVariable, UserTemplateCreate } from '@/shared/contracts'

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
  return null
}

/** Queue / batch → POST body. `slot`: references become `{slot:i}` placeholders; `asset`: kept as the user's own `{asset_id}`. */
export function buildTemplate(input: { name: string; cover_id: string | null; items: TemplateSource[]; variables: TemplateVariable[]; refMode: RefMode }): UserTemplateCreate {
  const ids = new Set(input.items.map(i => i.item_id))
  const items: TemplateItem[] = input.items.map(i => ({
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
