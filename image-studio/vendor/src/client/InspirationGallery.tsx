/**
 * Inspiration wall for the studio's empty canvas: a progressively loaded grid
 * of all bundled template cases. Clicking a card hands its prompt to the form. On
 * failure the wall collapses to nothing (the panel falls back to the plain
 * empty-state hint).
 */

import { useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ImageGenApi } from './api.ts'
import { tt } from './helpers.ts'
import { TEMPLATES_API, type TemplateSample } from '../protocol.ts'
import css from './inspiration.module.css'
import { templateAuthor } from './template-author.ts'

/** Progressive rendering keeps the full catalog reachable without a huge initial grid. */
const PAGE_SIZE = 24

/** Same-origin proxy URL of one sampled case's reference image. */
function imageUrlOf(sample: TemplateSample): string {
  return sample.case.thumbnail || sample.case.image
}

/** One thumbnail that degrades to a text tile when the image 404s. */
function SampleThumb(props: { sample: TemplateSample }) {
  const [failed, setFailed] = useState(false)
  return (
    <span className={css.thumbWrap}>
      {props.sample.case.image !== '' && !failed ? (
        <img className={css.thumb} src={imageUrlOf(props.sample)} alt={props.sample.case.title} loading="lazy" decoding="async" onError={() => { setFailed(true) }} />
      ) : (
        <span className={css.thumbFallback} aria-hidden="true">{props.sample.case.title}</span>
      )}
      <span className={css.thumbTitle}>{props.sample.case.title}<span className={css.thumbAuthor}>作者：{templateAuthor(props.sample.case.sourceLabel)}</span></span>
    </span>
  )
}

/** The complete case catalog shown while the canvas has no results. */
export function InspirationGallery(props: {
  api: ImageGenApi
  /** Hand the picked prompt back to the studio form. */
  onUse: (prompt: string) => void
  onBrowse: () => void
}) {
  const { api, onUse } = props
  const [samples, setSamples] = useState<TemplateSample[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [category, setCategory] = useState('')
  const [query, setQuery] = useState('')
  const categories = [...new Set((samples || []).map(sample => sample.case.categoryZh || sample.case.category))]
  const filtered = (samples || []).filter(sample => (!category || (sample.case.categoryZh || sample.case.category) === category) && (!query.trim() || `${sample.case.title} ${sample.case.prompt}`.toLowerCase().includes(query.trim().toLowerCase())))
  useEffect(() => setVisibleCount(PAGE_SIZE), [category, query])

  const deal = (): void => {
    if (loading) return
    setLoading(true)
    api.templatesList('ipzsk')
      .then(result => setSamples(result.cases.map(item => ({ sourceId: 'ipzsk', case: item }))))
      .catch(() => { setSamples(current => current ?? []) })
      .finally(() => { setLoading(false) })
  }

  // Deal once on mount; shuffles re-use the same handler.
  useEffect(() => {
    deal()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sample fetch failed or the libraries are empty: collapse to the plain
  // empty-state hint so the canvas never looks broken.
  if (samples !== null && samples.length === 0) {
    return (
      <div className={css.wrap} aria-label={tt('inspiration.title')}>
        <span className={css.emptyIcon}>
          <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
        </span>
        <span className={css.emptyTitle}>{tt('canvas.emptyTitle')}</span>
        <span className={css.emptyHint}>{tt('canvas.emptyHint')}</span>
      </div>
    )
  }

  return (
    <div className={css.wrap} aria-label={tt('inspiration.title')}>
      <span className={css.title}>案例灵感{samples ? ` · 共 ${samples.length} 个` : ''}</span>
      <Button variant="outline" size="sm" onClick={props.onBrowse}>打开素材库 · 分类浏览全部案例</Button>
      <input className="web-case-search" aria-label="搜索灵感案例" placeholder="搜索案例，例如：人像、商品、海报…" value={query} onChange={event => setQuery(event.target.value)} />
      <div className="web-case-filters"><Button aria-pressed={!category} onClick={() => setCategory('')}>全部 {samples?.length || 0}</Button>{categories.map(label => <Button key={label} aria-pressed={category === label} onClick={() => setCategory(label)}>{label} {(samples || []).filter(s => (s.case.categoryZh || s.case.category) === label).length}</Button>)}</div>
      {samples === null ? (
        <span className={css.spinner} aria-hidden="true" />
      ) : (
        <>
          <div className={css.grid}>
            {filtered.slice(0, visibleCount).map(sample => (
              <button
                key={`${sample.sourceId}:${sample.case.id}`}
                type="button"
                className={css.tile}
                title={tt('inspiration.useHint')}
                onClick={() => { onUse(sample.case.prompt) }}
              >
                <SampleThumb sample={sample} />
              </button>
            ))}
          </div>
          <span>{filtered.length ? `已展示 ${Math.min(visibleCount, filtered.length)} / ${filtered.length} 个案例` : '没有匹配的案例，试试其他关键词或分类。'}</span>
          {visibleCount < filtered.length && <Button variant="outline" size="sm" onClick={() => setVisibleCount(count => count + PAGE_SIZE)}>加载更多案例</Button>}
        </>
      )}
    </div>
  )
}
