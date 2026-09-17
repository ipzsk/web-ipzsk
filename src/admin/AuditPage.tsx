import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useInfiniteQuery } from '@tanstack/react-query'
import { ScrollText } from 'lucide-react'
import { Button, EmptyState, ErrorState, Skeleton } from '@/ui'
import { adminApi, type AuditQuery } from './api'
import { fmtTime } from './lib'
import { FilterInput, PageHeader, Select } from './ui'

const KEYS = ['actor', 'action', 'target', 'from', 'to'] as const
const ACTIONS = ['case.*', 'case.create', 'case.update', 'case.status', 'case.reorder', 'case.cover', 'case.references', 'case.delete', 'role.*', 'role.grant', 'role.revoke', 'generation.*', 'generation.resync', 'generation.cancel']

export function AuditPage() {
  const [sp, setSp] = useSearchParams()
  const filter: AuditQuery = useMemo(() => Object.fromEntries(KEYS.map(k => [k, sp.get(k) ?? ''])), [sp])
  const setParam = (k: string, v: string) => setSp(cur => { const p = new URLSearchParams(cur); if (v) p.set(k, v); else p.delete(k); return p }, { replace: true })
  const [text, setText] = useState({ actor: filter.actor ?? '', target: filter.target ?? '' })
  useEffect(() => {
    const t = setTimeout(() => { for (const k of ['actor', 'target'] as const) if (text[k].trim() !== filter[k]) setParam(k, text[k].trim()) }, 300)
    return () => clearTimeout(t)
  }) // eslint-disable-line react-hooks/exhaustive-deps

  const list = useInfiniteQuery({
    queryKey: ['admin', 'audit', filter],
    queryFn: ({ pageParam }) => adminApi.audit.list({ ...filter, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: last => last.next_cursor,
  })
  const rows = list.data?.pages.flatMap(p => p.items) ?? []
  const th = 'border-b border-line py-2 pr-3 text-left text-xs font-semibold text-muted'
  const td = 'border-b border-line py-2 pr-3 align-top'

  return (
    <section>
      <PageHeader title="审计日志" />
      <div role="search" className="mb-4 flex flex-wrap items-end gap-3">
        <FilterInput label="操作者" value={text.actor} onChange={e => setText(t => ({ ...t, actor: e.target.value }))} placeholder="邮箱或用户 id" className="w-56" />
        <Select label="动作" value={filter.action} onChange={e => setParam('action', e.target.value)}>
          <option value="">全部动作</option>
          {ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
        </Select>
        <FilterInput label="对象 id" value={text.target} onChange={e => setText(t => ({ ...t, target: e.target.value }))} placeholder="案例 / 用户 / 记录 id" className="w-48" />
        <FilterInput label="从" type="date" value={filter.from} onChange={e => setParam('from', e.target.value)} />
        <FilterInput label="到" type="date" value={filter.to} onChange={e => setParam('to', e.target.value)} />
      </div>
      {list.isError ? <ErrorState reason="审计日志加载失败" action={{ label: '重试', onClick: () => void list.refetch() }} />
        : list.isPending ? <div className="grid gap-1">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-10" />)}</div>
        : !rows.length ? <EmptyState icon={ScrollText} text="没有符合筛选的审计事件" />
        : (
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead><tr><th className={th}>时间</th><th className={th}>操作者</th><th className={th}>动作</th><th className={th}>对象</th><th className={th}>详情</th></tr></thead>
            <tbody>
              {rows.map(e => (
                <tr key={e.id} className="hover:bg-card">
                  <td className={`${td} whitespace-nowrap text-xs text-muted tabular-nums`}>{fmtTime(e.created_at)}</td>
                  <td className={td}>{e.actor?.email ?? <span className="text-muted">旧中台管理员 #{e.legacy_administrator_id}</span>}</td>
                  <td className={td}><code className="text-xs">{e.action}</code></td>
                  <td className={td}><code className="text-xs">{e.target_id ?? '—'}</code></td>
                  <td className={`${td} font-mono text-xs text-muted`}>{e.details ? JSON.stringify(e.details) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      {list.hasNextPage && <div className="mt-4 flex justify-center"><Button loading={list.isFetchingNextPage} loadingText="加载中" onClick={() => void list.fetchNextPage()}>加载更多</Button></div>}
    </section>
  )
}
