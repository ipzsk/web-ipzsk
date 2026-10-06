// 版本与安装包地址与首页同源：网关 GET /api/public/desktop-release（安装包在私有 R2，URL 是限时签名）。
import { RELEASE_PAGE, fetchRelease, type Platform, type ReleasePayload } from '../home/release'

export const RELEASES_PAGE = RELEASE_PAGE
export const PLATFORMS = ['mac', 'mac-intel', 'windows'] as const
export type { Platform }

export type DesktopRelease = ReleasePayload
export interface DownloadButton { href: string | null; label: string; meta: string; external?: boolean }

/** Port of workstation.js/home-downloads.js `release()`: per-platform button state. */
export function downloadButtons(state: { status: 'loading' } | { status: 'error' } | { status: 'ok'; data: DesktopRelease }) {
  const buttons = {} as Record<Platform, DownloadButton>
  for (const p of PLATFORMS) {
    if (state.status === 'loading') buttons[p] = { href: null, label: '正在读取发布信息…', meta: '' }
    else if (state.status === 'error') buttons[p] = { href: RELEASES_PAGE, label: '前往 GitHub 下载', meta: '', external: true }
    else {
      const asset = state.data.assets?.[p]
      const version = asset?.version ?? state.data.version
      buttons[p] = asset
        ? { href: asset.url, label: '下载最新正式版', meta: `v${version}${asset.bytes ? ` · ${(asset.bytes / 1024 / 1024).toFixed(0)} MB` : ''}` }
        : { href: null, label: '此平台暂未发布', meta: '最新正式版尚无此平台安装包' }
    }
  }
  const status = state.status === 'ok' ? `当前正式版 v${state.data.version} · 生图等插件请在客户端插件市场安装和更新。`
    : state.status === 'error' ? '暂时无法读取版本，请前往 GitHub 发布页选择安装包。' : ''
  return { buttons, status }
}

export const fetchDesktopRelease = (): Promise<DesktopRelease> => fetchRelease()

export type ToolCategory = 'knowledge' | 'creation' | 'remote' | 'business'
export const FILTERS: { value: 'all' | ToolCategory; label: string }[] = [
  { value: 'all', label: '全部工具' }, { value: 'knowledge', label: '知识与文档' }, { value: 'creation', label: '内容与设计' },
  { value: 'remote', label: '语音与远程' }, { value: 'business', label: '运营与营销' },
]
// [icon key, name, category, status, description] — copy verbatim from legacy workstation.js; emoji replaced by Lucide in the view.
export const TOOLS: [string, string, ToolCategory, string, string][] = [
  ['FileText', '文档四件套', 'knowledge', '直接使用', '生成和编辑 Word、Excel、PPT、PDF，配套本地文档运行环境。'],
  ['BookOpen', '文档读取与知识检索', 'knowledge', '直接使用', '从笔记、表格、演示文稿和 PDF 中提取内容，带着来源回答问题。'],
  ['Sprout', 'AI 成长档案', 'knowledge', '直接使用', '记录偏好、项目进度和经过验证的方法，让后续对话接得上。'],
  ['Wrench', '技能创建', 'knowledge', '直接使用', '把反复使用的工作流程整理成自己的 Skill。'],
  ['Palette', '图片生成与编辑', 'creation', '需要模型额度', '描述画面生成图片，也可传入参考图片调整风格、场景和构图。'],
  ['Presentation', 'PPT 制作与风格图册', 'creation', '随包工具', '从内容大纲到可编辑演示文稿，附带风格与版式参考。'],
  ['PenLine', '新媒体 AI 员工', 'creation', '随包工具', '策划、内容、制作三个角色配合，完成选题、写稿和视觉物料。'],
  ['Newspaper', '新媒体排版工具', 'creation', '随包工具', '公众号排版、图片整理和社交内容设计，包含源码和参考资料。'],
  ['LayoutTemplate', '网页设计套件', 'creation', '随包工具', '从设计方向、页面结构和文案，到网页实现与自检。'],
  ['CodeXml', 'HTML 页面生成', 'creation', '随包工具', '制作 H5、落地页、文章页和可分享的内容页面。'],
  ['Feather', '自然写作工具', 'creation', '随包工具', '检查套话、表达节奏和具体细节，让文案更贴近你的语气。'],
  ['Clapperboard', '视频与音频', 'creation', '随包工具', '视频生成、下载、抽帧和音频转写；按任务选择本地或云端处理。'],
  ['BellRing', '任务语音通知', 'remote', '可选工具说明', '附带系统语音脚本；自动通知需按 Codex 工作流配置。'],
  ['Volume2', 'AI 语音朗读', 'remote', '系统语音', '可让 Codex 调用系统语音朗读简短回复，支持离线朗读。'],
  ['MessageCircle', '个人微信接入', 'remote', '需要平台授权', '附带接入代码和部署手册，用微信发送指令、收取结果。'],
  ['Building', '企业微信接入', 'remote', '需要平台授权', '把 AI 接到团队消息入口，包含本地与服务器部署说明。'],
  ['ChartColumn', '视频号评论导出', 'business', '需要平台登录', '导出自己账号的评论，整理为表格，再分析反馈和选题。'],
  ['Headset', '网站 AI 客服', 'business', '需要部署', '把知识库问答接到网站客服窗口，附带前后端参考实现。'],
  ['TrendingUp', '营销与增长', 'business', '随包工具', '整理用户需求、竞品信息、定价思路和营销计划。'],
]
