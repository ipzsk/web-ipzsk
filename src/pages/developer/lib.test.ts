import { describe, expect, it } from 'vitest'
import { DEV_ERRORS, DEV_LABELS, amount, canWithdraw, count, defaultRange, gateFor, pluginStatus, type Plugin } from './lib'

const LEGACY_LABELS = {pending:'待审核',approved:'已批准',rejected:'已驳回',disabled:'已停用',published:'已上架',withdrawn:'已撤回 / 下架'}
const LEGACY_ERRORS = {developer_approval_required:'需要管理员批准开发者申请。',developer_application_exists:'已有申请，请等待审核。',published_metadata_locked:'已上架插件的名称需要管理员修改。',invalid_release_url:'请填写当前仓库的 GitHub Release 地址。',select_one_tgz_asset:'请提供 npm pack 生成的 .tgz 附件；多个附件时需指定名称。',package_identity_mismatch:'安装包中的包名或版本与登记信息不一致。',already_exists:'插件标识、包名或版本已存在。',github_fetch_failed:'无法读取 GitHub Release，请检查是否已公开发布。',plugin_not_found:'插件不存在或你没有权限。',invalid_date_range:'日期范围不能超过一年。'}

const plugin = (o: Partial<Plugin>): Plugin => ({ id: 'p', name: 'n', repository: 'o/r', enabled: true, published_versions: 0, pending_versions: 0, active_users: null, versions: 0, revenue_share_bps: null, ...o })

describe('developer lib', () => {
  it('maps match legacy', () => { expect(DEV_LABELS).toEqual(LEGACY_LABELS); expect(DEV_ERRORS).toEqual(LEGACY_ERRORS) })
  it('gate by approval state', () => {
    expect(gateFor(null)).toEqual({ title: '申请成为开发者', body: '审核通过后，可管理自己的插件并查看使用和收益数据。', canApply: true })
    expect(gateFor({ state: 'pending', display_name: 'x' })).toMatchObject({ title: '待审核', canApply: false })
    expect(gateFor({ state: 'rejected', display_name: 'x', review_note: '补充说明' })).toMatchObject({ title: '已驳回', body: '补充说明', canApply: true })
    expect(gateFor({ state: 'approved', display_name: 'x' })).toBeNull()
  })
  it('plugin status', () => {
    expect(pluginStatus(plugin({ enabled: false, published_versions: 3 })).status).toBe('已停用')
    expect(pluginStatus(plugin({ published_versions: '1', pending_versions: '1' }))).toEqual({ status: '已上架', newPending: true })
    expect(pluginStatus(plugin({ pending_versions: 1 })).status).toBe('待审核')
    expect(pluginStatus(plugin({})).status).toBe('未上架')
  })
  it('withdraw only pending/published without request', () => {
    expect(canWithdraw({ id: '1', version: '1', state: 'published' })).toBe(true)
    expect(canWithdraw({ id: '1', version: '1', state: 'pending', withdrawal_requested: true })).toBe(false)
    expect(canWithdraw({ id: '1', version: '1', state: 'rejected' })).toBe(false)
  })
  it('formatting + default range in Asia/Shanghai', () => {
    expect(amount(null)).toBe('未确认'); expect(amount('1234.5')).toBe('1,234.50 元')
    expect(count(null)).toBe('未知'); expect(count(1834)).toBe('1,834')
    expect(defaultRange(new Date('2026-09-30T17:00:00Z'))).toEqual({ from: '2026-10-01', to: '2026-10-01' })
  })
})
