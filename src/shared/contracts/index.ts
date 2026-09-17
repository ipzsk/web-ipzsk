/**
 * PLACEHOLDER contracts, hand-written from docs/studio-redesign.md §2.3/§8/§10.
 * Will be replaced by generated `ipzsk-api.d.ts` synced from the gateway (§11, `npm run contracts:sync`).
 * Do not add logic here.
 */

export type MediaKind = 'image' | 'video'
export type Uuid = string
export type IsoTime = string

export interface Page<T> { items: T[]; next_cursor: string | null }
export interface ApiErrorBody { error: { code: string; message: string } }

/** One parameter declared by a model in the catalog (derived from lanehub). Values used verbatim, e.g. '1K'|'2K'|'4K'. */
export interface ParamSpec {
  name: string // aspect_ratio | resolution | n | duration …
  label?: string
  type: 'enum' | 'integer' | 'boolean' | 'string'
  values?: (string | number)[]
  min?: number
  max?: number
  default?: string | number | boolean
}

export interface ModelSpec {
  id: string
  kind: MediaKind
  name: string
  description?: string
  billing_unit?: string
  params: ParamSpec[]
  unsupported?: string[]
  /** Gateway-maintained capability table (§10.1). Absent = no reference images. */
  references?: { max: number; first_last_frame?: boolean }
}

export type GenerationParams = Record<string, string | number | boolean>

/** composer_queues.items[] (§8.5). */
export interface QueueItem {
  item_id: Uuid
  kind: MediaKind
  model: string
  prompt: string
  params: GenerationParams
  reference_asset_ids: Uuid[]
  /** item_id of the anchor item in the same batch (§2.3 锚定). */
  anchor_of?: Uuid | null
}

export type GenerationStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export interface MediaAsset {
  id: Uuid
  kind: MediaKind
  status: 'pending' | 'ready' | 'failed' | 'deleted'
  width: number | null
  height: number | null
  duration_ms: number | null
  /** Time-sliced signed URLs (§7.2). */
  urls: { w480: string; w960: string; orig: string }
  poster?: MediaAsset | null
  created_at?: IsoTime
}

export interface GenerationRecord {
  id: Uuid
  thread_id: Uuid | null
  batch_id: Uuid | null
  batch_position: number | null
  anchor_record_id: Uuid | null
  parent_record_id: Uuid | null
  kind: MediaKind
  model: string
  prompt: string
  params: GenerationParams
  status: GenerationStatus
  failure_code: string | null
  /** null until settled → UI shows 「结算中」. Decimal string. */
  charged_points: string | null
  source: 'studio' | 'template' | 'canvas'
  source_case_id: string | null
  references: MediaAsset[]
  results: MediaAsset[]
  created_at: IsoTime
  updated_at: IsoTime
}

export interface Thread { id: Uuid; title: string; created_at: IsoTime; updated_at: IsoTime }

export type TemplateReference = { slot: string } | { asset_id: Uuid }
export interface TemplateItem extends Omit<QueueItem, 'reference_asset_ids'> { references: TemplateReference[] }
export interface TemplateVariable { name: string; label: string; default?: string; required?: boolean }

export interface UserTemplate {
  id: Uuid
  name: string
  cover_id: Uuid | null
  items: TemplateItem[]
  variables: TemplateVariable[]
  created_at: IsoTime
  updated_at: IsoTime
}

export interface InspirationCase {
  id: string
  title: string
  prompt: string
  category: string
  tags: string[]
  model: string | null
  params: GenerationParams & { template?: { items: TemplateItem[]; variables?: TemplateVariable[] } }
  cover: MediaAsset
  references: MediaAsset[]
  author: string | null
  source_url: string | null
  license_note: string | null
}
