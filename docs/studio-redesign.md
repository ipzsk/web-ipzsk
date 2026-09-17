# IPZSK 创作工作台改造方案（v5）

> 状态：已定稿 · 2026-09-17（v5）
> 相对 v4 的变化：
> - 电商不再是独立视图，改为输入框的「套图模板」能力，结果进对话流（§2.2、§2.4、§2.7）。
> - 输入框支持**多选型号**，一次发出多条请求，结果按型号并排展示（§2.2）。
> - 缩略图改用 Cloudflare Worker + R2 绑定 + WebAssembly 编解码，不加服务器容器（§7.2-3）。
> 相对 v3 的变化：
> - **媒体访问改为私有 bucket + 签名 URL**，不做公开读、不绑自定义域名、不用 Cloudflare 图片变换；缩略图由后端归档时生成（§7）。DNS 不需要迁移。
> - 计费段按 lanehub 模式重写：网关不冻结不扣款，报价用用户自己的 lanehub key（§10.3）。
> - 数据库：所有外键改 `uuid`，数组引用改联结表，大小校验改 `octet_length`；去掉「顺带修复 v11 回填」（§8）。
> - B1 增加 CORS 扩展、R2 客户端补预签名 PUT / Range GET / DELETE、用户配额（§10、§13）。
> - 案例三套数据与旧归档的宽高回填、会话时区、电商批次卡片、工期重估（§2、§8、§13）。
> - 新增 §16 灰度、回滚、日志与限流。
> 适用仓库：`ipzsk`（官网，Vercel）与 `ipzsk-api-gateway`（后端，腾讯云）
> 相对 v2 的变化（按 2026-09-16 评审意见）：
> - 创作视图改为**对话式**：每条消息就是一次独立生成请求，不携带上下文；对话历史保存在后端（§2.4、§8.5）。
> - 案例授权结论（§14）：awesome-gpt-image-2 仓库为 MIT，但 README 明确「不保证第三方内容可商用」；Punk-Skill 为 MIT 已授权。
> - 用户媒体访问控制定为方案 A；R2 公开自定义域名；说明图片变换的用途（§7）。
> - 型号与价格真源改为 lanehub（§10.3）：flare 已在 lanehub 登记，网关不再维护型号 JSON；报价改为透传 lanehub `/v1/quote`。
> - 取消管理员两步验证，管理员用普通邮箱登录 + 角色（§9）。
> - lanehub 模式下参考图直接传 R2 签名 URL（§7.2-6）。
> - 电商模式保留为独立视图（§2.7）。
> - 导航只显示一项「创作工作台」；生图/生视频作为分类入口，带参数进入并预设输入框类型（§2.1）。
>
> 相对 v1 的变化：
> - 确定入口为 `/studio`，Vercel 已跟随 main 自动构建。
> - 第一期只做图片案例；灵感页改为 Pinterest 式瀑布流。
> - 新增：数据库设计与迁移（§8）、R2 媒体存储与缓存（§7）、角色权限与管理中台（§9）、仓库是否合并（§11）、`gpt-image-2.5-flare` 支持（§10.3）。
> - 新增：媒体通用组件（§5）、乐观更新规范（§6）、完整交互设计语言（§4）。
> - 图标统一用 Lucide。
>
> 评审重点：§2 交互规则、§4 交互设计语言、§7 媒体存储、§8 数据库、§9 权限、§13 分期、§15 待确认。

---

## 0. 结论摘要

1. **入口**：新工作台 `/studio` 把生图和生视频放在一起。首页是 **Pinterest 式瀑布流案例库**，底部悬浮输入框。验收后替换 `/image`、`/video`。
2. **生成方式**：提交时判断，界面上不显示模式。有参考图就是图生，没有就是文生。
3. **前端技术栈**：Vite + React 19 + TypeScript + Tailwind v4 + shadcn/ui（Radix）+ **Lucide 图标**。无限画布用 @xyflow/react。以上全是 MIT/ISC/Apache 协议。
4. **媒体**：
   - 复用后端已配置的私有 R2 bucket，全部走网关签发的签名 URL，不公开读。
   - 签名 URL 按 6 小时时间片对齐，让浏览器缓存生效。
   - 缩略图由 Cloudflare Worker（R2 绑定 + jSquash wasm）生成两档 WebP，不占服务器资源。
   - 前端统一使用媒体组件：图片、视频、瀑布流、预览、上传。
5. **数据**：在后端 `schema.sql` 按现有幂等方式增加到 v18–v21。新增 9 张表：用户角色、媒体资产、文件夹、文件夹项、收藏、生成记录、生成引用、会话、画布项目、案例库（案例库与角色算改造）。所有外键类型与现有表一致（`uuid`）。
6. **权限**：用户体系统一用 better-auth。角色至少有 `user` 和 `admin`（admin 下再分 superadmin、operator、viewer）。管理中台放在官网 `/admin`，技术栈与设计系统和工作台一致，逐步替换现有的 `api.ipzsk.com/admin`。
7. **交互**：所有写操作默认乐观更新。每个组件都要完整定义以下状态，不允许出现「看不出在干什么」的状态：
   - 悬停、按下、聚焦、选中、禁用（附原因）
   - 加载、空、错误、离线
   - 拖拽、上传、同步中、页面切换
8. **仓库**：**暂不合并**。两个仓库部署目标完全不同，合并不会简化发布。改为建立共享契约：生成类型文件，加跨仓契约测试。理由见 §11。
9. **100xspeed**：不使用它的任何代码、样式、组件结构或视觉设计。

---

## 1. 背景与问题

| 现状 | 问题 |
|---|---|
| `/image` 是从桌面插件移植的专业面板，打包产物提交进仓库 | 残留桌面概念；参数区占空间；画布体验差；曾经漏构建 |
| `/video` 与 `/image` 各写一套 | 登录拦截、任务队列、结果操作都是重复实现 |
| 其余页面是纯 HTML + JS | 没有类型检查，公共部分靠复制，样式变量分散 |
| 441 个图片案例只是页面右侧的一块 | 主打内容没有放在主导位置 |
| R2 只归档生成图片：私有 bucket，5 分钟签名 URL，没有缓存头，没有缩略图 | 列表加载的是原图，每次访问都拿新签名，浏览器和 CDN 都缓存不上 |
| 参考图不进 R2，而是转成 data URL 上传给 APIMart（总计 ≤3MB） | 用户素材不能复用，大小受限，也没有「我的上传」 |
| 用户（better-auth）和管理员（独立账号密码）是两套体系 | 管理员不能用正常账户登录；新中台难以复用官网的设计系统 |
| 官网调用了 `/api/me/image-requests/:key`，后端没有这个路由；`gpt-image-2.5-flare` 没有登记在型号目录 | 前后端各自手写接口约定，已经出现不一致 |

---

## 2. 交互规则（核心）

### 2.1 页面结构

```text
┌ 站点导航 ─────────────────────────────────────────────────────────┐
├ 左侧栏 ┬ 主区 ─────────────────────────────────────────────────────┤
│ 灵感   │ [搜索]  全部 · 海报 · 人像 · 电商 · 品牌 · 信息图 …          │
│ 创作   │ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐                        │
│ 素材   │ │3:4 │ │1:1 │ │    │ │16:9│ │    │  ← Pinterest 式瀑布流    │
│ 画布   │ │    │ └────┘ │2:3 │ └────┘ │9:16│    不同比例同列共存      │
│ ────   │ └────┘ ┌────┐ │    │ ┌────┐ │    │    固定列宽、按比例占位   │
│ 进行中 │ ┌────┐ │4:3 │ └────┘ │1:1 │ │    │                          │
│  (2)   │ ╭───────────────── 悬浮输入框 ─────────────────╮           │
│        │ │ [+] [参考图][参考图]   描述你想要的画面…       │           │
│        │ │ [图片|视频]  GPT Image 2 ▾  1:1 ▾ 2K ▾ 4张 ▾  约 12 点 [发送] │ │
│        │ ╰──────────────────────────────────────────────╯           │
└────────┴──────────────────────────────────────────────────────────┘
```

| 视图 | URL | 作用 |
|---|---|---|
| 灵感（默认） | `/studio`；案例详情 `/studio?case=:id` | 案例瀑布流、分类、搜索、收藏、做同款 |
| 创作 | `/studio/create`；会话 `/studio/create/:threadId` | **对话式**生成记录：一条消息 = 一次生成请求（§2.4） |
| 素材 | `/studio/assets`；文件夹 `/studio/assets/:folderId` | 上传、生成结果、收藏、文件夹 |
| 画布 | `/studio/canvas`、`/studio/canvas/:projectId` | 画布项目列表、画布编辑 |

- **导航**：站点导航只显示一项「创作工作台」→ `/studio`。首页和其他页面里的「生图」「生视频」分类入口分别链接到 `/studio?kind=image` 和 `/studio?kind=video`，进入后输入框预设为对应类型；`kind` 只在进入时读取一次，之后以用户切换为准。

- **输入框**在灵感、创作、素材三个视图悬浮在底部，切换视图时内容保留。在画布视图里，输入框跟随选中的节点。
- **手机端**：左侧栏收进底部标签栏，输入框折叠成一行，点击后展开成底部抽屉。

### 2.2 输入框

组成（所有图标用 Lucide，括号内是图标名）：

1. **参考槽位**
   - 添加按钮（`Plus`）加已添加素材的缩略图；每张缩略图有删除（`X`），可拖动排序。
   - 添加方式：点击上传、粘贴、拖入文件、从瀑布流/结果卡片/素材拖入、从画布节点「加入输入框」。
   - 槽位数量和类型由当前型号声明，例如 GPT Image 2 最多 15 张。型号不支持参考图时隐藏添加按钮。
2. **提示词**：随内容自动增高，最多约 8 行。附「增强」按钮（`Sparkles`），调用 `/api/me/image-prompt`。
3. **类型切换**：「图片（`Image`）| 视频（`Clapperboard`）」分段按钮。切换时恢复该类型上次用的型号和参数。
4. **型号选择**：下拉按钮（`ChevronDown`）。弹层列出名称、说明、计费单位，以及能力标签：参考图（`Images`）、时长（`Timer`）。
5. **参数小按钮**：比例（`RectangleHorizontal`）、清晰度（`Gauge`）、张数（`Layers`）、时长（`Timer`）。完全按型号的参数声明显示，型号没声明的不显示。
6. **发送按钮**：`ArrowUp`，上面标「约 N 点」（多型号或套图时为总和，悬停可看明细）。未登录时显示「登录后生成」（`LogIn`）。

**生成方式（只在提交时判断，界面不提示、不切换）：**

| 类型 | 提交时有没有参考素材 | 请求 |
|---|---|---|
| 图片 | 没有 | 文生图：`prompt` + 参数 |
| 图片 | 有 | 图生图：`prompt` + 参数 + 参考素材 id（后端换成可访问的 URL） |
| 视频 | 没有 | 文生视频 |
| 视频 | 有 | 图生视频。**目前所有视频型号都不支持**（见 §10.4）；型号不支持时，视频类型下隐藏添加按钮 |

- **换型号后有残留素材**（新型号不支持参考图）：隐藏添加按钮，但保留已有槽位；素材变半透明，并提示「当前型号不使用参考图」，提交时不带。**不自动删除用户的素材。**
- **报价请求**：参数变化后 300ms 防抖，按请求体哈希去重，避免每次点击都打 lanehub。
- **参数超出新型号范围**：改成该型号的默认值，对应的参数小按钮高亮 1.2 秒。
- **快捷键**：Enter 换行，Cmd/Ctrl+Enter 提交，输入法组字时不触发。
- **未登录**：点发送后保存草稿，跳转登录，回来后恢复。
- **连续提交**：可以连着提交多个任务，只在请求发出的约 300ms 内防止重复点击。
- **点数不足**：发送按钮改为「点数不足 · 去充值」（`Wallet`），点击打开充值弹窗。

### 2.3 灵感（Pinterest 式瀑布流）

- **布局**：
  - 固定列宽，列数随容器宽度变化：≥1600px 6 列、≥1280px 5 列、≥1024px 4 列、≥768px 3 列、手机 2 列；列间距 16px（手机 8px）。
  - 每张卡片按「列宽 × 高/宽」提前算好高度，图片没加载完也不会让布局跳动。所以案例数据必须带 `width/height`（§8.8）。
  - 新卡片放进当前最矮的一列，不同比例的图片自然混排。
  - 使用虚拟滚动，只渲染视口附近的卡片，上千张也流畅。
  - 滚动到底前 2 屏开始加载下一页，每页 60 条。
- **卡片**：
  - 默认只显示封面。
  - 悬停时出现底部渐变遮罩，显示标题、作者、「做同款」按钮（`WandSparkles`）、收藏（`Heart`），右上角有「更多」（`Ellipsis`）：复制提示词、在新标签打开。
  - 手机端：点一下进详情；长按弹出操作菜单。
- **分类与搜索**：
  - 分类标签固定在瀑布流顶部，横向滚动。
  - 搜索覆盖标题、提示词、标签，停止输入 200ms 后搜索。
  - URL 同步保存分类和关键词（`?cat=&q=`），可以分享、可以前进后退。
- **详情弹层**（深链接 `?case=:id`）：
  - 左侧大图，支持缩放和拖动。
  - 右侧：提示词（可复制）、型号、参数、参考图、作者和来源链接、标签。
  - 操作：「做同款」「只用提示词」「收藏」。
  - 底部是「相似案例」小瀑布流。
  - 键盘：← → 切换上一个/下一个，Esc 关闭；关闭后回到原来的滚动位置。
- **做同款**：写入提示词、类型、型号、参数、参考图，然后聚焦输入框，**不自动提交**。型号不可用时换成同类型默认型号，并在输入框上方提示一次。

### 2.4 创作（对话式）

**形态**：主区是一条对话流；右侧（用户）是提交的请求，左侧（系统）是该请求的结果。底部输入框就是发送框。

**规则：**

- **一条消息 = 一次独立生成请求**。发送时**不携带任何上下文**：不带前面的消息、不带上一条结果。请求体只由输入框当时的内容决定（提示词、类型、型号、参数、参考槽位）。
- **会话（thread）只是分组**：用来整理和回看，不影响生成。默认每天一个会话，用户可以新建、重命名、删除会话；也可以把某条消息移到别的会话。
- **历史保存在后端**（§8.5 `generation_records` 增加 `thread_id`），换设备、刷新后都能看到；旧的浏览器本地历史提供一键导入。
- **从结果继续**：结果上的操作（以此为参考、编辑后重试）只是把内容**填回输入框**，由用户再次发送。这样每一次生成仍然是独立请求，用户能清楚看到这次到底发了什么。

**消息卡片：**

- 右侧请求卡片：提示词全文（超过 4 行折叠）、类型、型号、参数小标签、参考图缩略图、时间。操作：编辑后重发（`PencilLine`，回填输入框）、复制提示词（`Copy`）。
- 左侧结果卡片：结果网格（图片或视频）、状态、实际扣点。
  - 排队中 / 生成中（进度或已等待时长）/ 完成 / 失败（中文原因、是否扣点、「重试」）/ 已取消。
  - 操作：再生成（`RefreshCw`，相同请求体、新幂等键）、以此为参考（`ImagePlus`）、放大预览（`Maximize2`）、下载（`Download`）、放到画布（`LayoutDashboard`）、存入素材（`FolderPlus`）、删除（`Trash2`，可撤销）。
- **批次卡片**（多型号或套图，共用 `batch_id`）：一次发送只产生**一张**请求卡片和**一张**结果卡片。
  - 多型号：结果卡片按型号分列，每列顶部是型号名和该列扣点，同一行是同一规格/序号，便于对比；列内单张可独立「再生成」「以此为参考」；卡片右上角有「选最佳」（`Star`），标记后该张排到最前并可一键存入素材。
  - 套图：结果卡片按规格分组（主图 / 详情 / 横幅），锚图带「锚」角标；单张可「重做此规格」，整套可「全部下载」「整套放到画布」。
  - 批次内每条请求仍是独立请求、独立状态、独立扣点；其中一条失败只影响该格。
- **多条并行**：可以连续发送，多条结果按提交顺序排列，各自更新状态。
- **滚动**：新消息出现时，如果用户正在看历史，不强制滚动，底部显示「有新结果 ↓」。
- **任务恢复**：从服务端读取未完成的记录继续轮询，不依赖浏览器本地。

### 2.5 素材

- **分组**：全部、我的上传、生成结果、收藏的案例；另有用户自建的文件夹。
- **视图**：瀑布流和紧凑网格两种，偏好保存在本地。
- **多选**：
  - 点击缩略图左上角的选择框，或按住 Shift 连续选、按住 Cmd/Ctrl 单独加选。
  - 选中后，底部出现批量操作条：移动到文件夹、下载、删除。
- **拖拽**：素材可以拖到输入框槽位、画布或左侧文件夹。能放的目标高亮，不能放的目标显示禁止光标并说明原因。

### 2.6 无限画布

**定位**：适合多步创作，比如「参考图 → 生成 → 挑选 → 转视频」，每一步的来源都能追溯。它不是自由绘图白板。

**节点：**

| 节点 | 内容 | 输出 |
|---|---|---|
| 文本（`Type`） | 一段提示词 | 文本 |
| 图片（`Image`） | 素材、案例图或生成结果 | 图片 |
| 生成·图片（`Sparkles`） | 型号、参数；引用上游的文本和图片 | 图片 1–4 张 |
| 生成·视频（`Clapperboard`） | 型号、参数；引用上游的文本和图片 | 视频 |
| 视频（`Film`） | 生成结果或上传的视频 | 视频 |
| 编组 | 带标题的区域 | — |

**交互**（参考 Flora、Krea Nodes、Freepik Spaces、Figma Weave、Lovart、Google Flow 的公开交互；视觉按 IPZSK 自行设计）：

- **添加节点**：双击空白处，或按 `/` 打开节点菜单；从输出端口拖到空白处松开，弹出「接一个什么节点」。
- **连线**：只能从上游输出连到下游输入。拖动时，所有可连的端口高亮，类型不匹配的端口变灰；松开在不可连的端口上时，提示原因。
- **运行**：选中生成节点后，底部输入框切换为「编辑此节点」，内容与节点双向同步，提交就运行该节点。上游文本拼进提示词，上游图片放进参考槽位；同样在提交时判断文生还是图生。
- **结果**：显示在节点内部。有多张时，选一张「主结果」（`Star`）传给下游，其余折叠显示。
- **互通**：
  - 结果卡片、素材、案例都能「放到画布」。
  - 画布上选中的图片节点可以「加入输入框」或「存入素材」。
- **基础编辑**：
  - 选择：框选、Shift 多选。
  - 剪贴板：复制、粘贴、复制一份，连线一起带上。
  - 撤销重做：≥100 步。
  - 编组、对齐吸附（显示参考线）。
  - 视图：小地图、适应视图（`Maximize`）、缩放到 100%。
  - 删除：Delete/Backspace。
  - 锁定节点：`Lock`。
- **保存**：
  - 本地优先：每次改动立即写入 IndexedDB，停手 1.5 秒后同步到服务端（§8.6）。
  - 顶栏显示保存状态：已保存（`Check`）、保存中、离线（`CloudOff`）、冲突（`TriangleAlert`）。
- **性能**：
  - 只渲染视口内节点（`onlyRenderVisibleElements`）。
  - 缩放比例小于 0.5 时，图片节点只加载 240 宽缩略图。
  - 视频节点不自动播放，悬停时才播放。

### 2.7 电商套图（并入对话式创作）

不做独立视图。电商能力由三部分组成，全部复用现有结构：

| 部分 | 落在哪 |
|---|---|
| 模板 | 案例库里 `category=电商`、`params.template` 有值的案例（中台维护） |
| 输入 | 输入框的「套图模板」状态（§2.2-4b） |
| 结果 | 对话流的批次卡片，按规格分组（§2.4） |

用户路径：灵感页选电商模板 → 做同款 → 输入框出现模板条 → 放商品图 → 发送 → 对话流出现一张套图卡片。旧工作台里的电商案例导入为带 `template` 的案例。

---

## 3. 视觉规范（IPZSK 设计系统）

### 3.1 Tailwind 主题

```css
@theme {
  --color-paper: #f4f2eb;   --color-card: #fffefb;   --color-subtle: #ebe8de;
  --color-line: #e3e4da;    --color-ink: #161916;    --color-muted: #767970;
  --color-label: #4e651e;   --color-acid: #c9ff4a;   --color-acid-deep: #89bd13;
  --color-danger: #a63c2f;  --color-warning: #9a6a12; --color-success: #4e651e;
  --radius-control: 10px;   --radius-card: 16px;     --radius-panel: 24px;
  --font-sans: -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
  --ease-standard: cubic-bezier(.2, 0, 0, 1);
  --duration-fast: 120ms;   --duration-base: 180ms;  --duration-slow: 240ms;
}
```

### 3.2 基本规则

- **按钮**：
  - 主按钮：ink 底 + acid 字。
  - 次按钮：card 底 + line 边框。
  - 文字按钮：无底色，悬停时出现 subtle 底。
  - 危险操作：danger 文字，确认弹窗里的按钮用 danger 底。
- **选中态**：ink 底 + acid 字。导航当前页用 acid 底 + ink 字。
- **图标**：只用 `lucide-react`。
  - 尺寸：界面 16px，按钮 18px，空状态 32px；描边宽度 1.75。
  - 纯图标按钮必须有 `aria-label` 和悬停提示。
  - 界面里不再用文字符号代替图标（如 ☰ ↗ ➤ ×）。
- **暗色**：第一期不做，只保留变量层。
- **组件底座**：shadcn/ui（复制进仓库）+ Radix。无障碍交给 Radix，外观全部按 IPZSK 重写。

---

## 4. 交互设计语言（全部组件必须满足）

原则：**没有黑盒**。

- 任何操作在 100ms 内必须有可见反馈。
- 任何异步过程都要让用户看得出进展。
- 任何不可用都要说明原因。
- 任何失败都要给出原因和下一步。

### 4.1 状态矩阵

每个可交互组件在设计稿和实现里都要覆盖下表各状态，并在组件的 Storybook 或测试页里逐一展示。

| 状态 | 视觉规则 | 时长 |
|---|---|---|
| 默认 | — | — |
| 悬停 hover | 背景 subtle 或边框加深；可点击区域光标变为 pointer；卡片轻微上浮 1px 并加阴影 | 120ms |
| 聚焦 focus-visible | 2px ink 描边，偏移 2px；只在键盘操作时显示 | 即时 |
| 按下 active | 缩放到 0.98，或背景加深一级 | 80ms |
| 选中 selected | ink 底 + acid 字，或 2px ink 边框（卡片） | 120ms |
| 禁用 disabled | 不透明度 0.45，光标 not-allowed；**悬停必须出现原因提示**（如「当前型号不支持参考图」） | — |
| 加载 loading | 见 §4.2 | — |
| 空 empty | 插画位置用 32px Lucide 图标 + 一句说明 + 一个主操作（如「上传第一张图」） | — |
| 错误 error | 就地显示：原因（中文）+ 下一步（重试、去充值、重新登录）；表单错误显示在字段下方 | — |
| 离线 offline | 顶部细条「网络已断开，操作会在恢复后同步」（`WifiOff`）；需要联网的按钮禁用并说明原因 | — |
| 同步中 pending（乐观更新） | 内容已经显示，右上角出现小的同步指示；失败时回滚并提示 | 见 §6 |

### 4.2 加载

- **首次加载列表或网格**：显示与真实布局一致的骨架屏（瀑布流骨架按真实宽高比），不用全屏转圈。
- **局部操作**（按钮提交）：按钮内显示转圈，按钮宽度不变，文字改为进行时，如「生成中」。
- **避免闪烁**：请求在 300ms 内完成就不显示加载态；一旦显示了，至少保持 500ms。
- **长任务**（生成）：显示阶段（排队、生成中、处理结果）、已等待时长、进度（有就显示）；可以离开页面，完成后在左侧栏「进行中」计数和浏览器标题上提示。
- **图片**：先显示占位（§5.2），加载完成后淡入 180ms；缓存命中时不做淡入。

### 4.3 拖拽

| 阶段 | 规则 |
|---|---|
| 可拖起 | 悬停时光标变 grab；拖动距离超过 4px 才开始拖（避免误触） |
| 拖动中 | 原位置保留半透明占位；跟随光标显示缩略图，多选时显示叠放效果和数量角标 |
| 目标检测 | 可放置的目标高亮成 acid 虚线框；不可放置的目标显示禁止光标，并在目标上方提示原因 |
| 放下 | 目标处出现 180ms 的插入动画；乐观更新立即生效 |
| 取消 | Esc 或拖回原处，缩略图回弹到原位 180ms |
| 键盘替代 | 所有拖拽操作都有菜单或键盘替代（「移动到…」「加入输入框」） |

- 拖入文件（从系统拖进来）：整个页面显示放置提示层，并按落点区分行为：放在输入框就加入参考槽位，放在素材区就上传，放在画布就创建图片节点。

### 4.4 页面与视图切换

- **工作台内切换视图**：输入框、进行中的任务、画布未保存的改动都保留；每个视图记住自己的滚动位置。
- **导航**：鼠标悬停到导航项 100ms 后，预取该视图的数据。
- **过渡**：只做 180ms 淡入，不做整页滑动。
- **弹层**（详情、对话框）：打开时焦点移到弹层内，关闭后焦点回到触发元素，URL 同步。
- **后退**：浏览器后退能关闭弹层、回到上一个视图，不丢失输入。
- **离开时有未保存的内容**（画布离线改动、上传中）：提示确认。

### 4.5 反馈与提示

- **Toast**（右下角，最多 3 条，停留 4 秒，悬停时暂停计时）：
  - 用于：乐观更新失败回滚、可撤销操作（删除后 5 秒内可撤销）、后台任务完成。
- **不使用浏览器原生 `alert`/`confirm`**。危险操作用确认对话框，写清后果，如「删除后无法恢复，已生成的扣点不退回」。
- **数字**（点数、进度）：变化时滚动过渡 240ms；结算中显示「结算中」，不显示可能错误的数字。

### 4.6 动效

- **时长和曲线**统一使用 §3.1 的变量。
- **遵守 `prefers-reduced-motion`**：开启后关闭位移和缩放，只保留透明度变化。

---

## 5. 媒体通用组件

所有展示或处理图片、视频的地方，只能使用下面这些组件，不直接写 `<img>`/`<video>`。

### 5.1 组件清单

| 组件 | 职责 | 依赖（协议） |
|---|---|---|
| `MediaImage` | 按 `sizes` 生成 `srcset`（4 档宽度，通过 Cloudflare 图片变换）；占位；懒加载；前几张优先加载；失败重试 2 次后回退原图，再失败显示占位图标（`ImageOff`）；缓存命中不淡入 | 无 |
| `MediaVideo` | poster 占位；`preload="none"`，悬停播放、移开暂停归零；**全局同一时间只播放一个**；详情页 `preload="metadata"` + 控制条 | media-chrome（MIT） |
| `MasonryGrid` | Pinterest 式瀑布流：按宽高比预先算高度、响应式列数、虚拟滚动、无限加载、键盘导航 | @virtuoso.dev/masonry（MIT）；备选 @tanstack/react-virtual 自己实现 |
| `MediaLightbox` | 大图和视频预览：缩放、拖动、手势、键盘、预加载相邻 2 张、URL 深链接、下载 | yet-another-react-lightbox（MIT） |
| `useUpload` / `UploadDropzone` | 选择、粘贴、拖入文件 → 本地预览 → 预签名直传 R2（有进度、可取消、可重试）→ 完成后替换为服务端地址 | 无 |
| `MediaCard` | 瀑布流和网格中的通用卡片：悬停遮罩、选择框、拖拽源、状态角标（上传中、生成中、失败） | @dnd-kit（MIT） |
| `DropTarget` | 统一的放置目标：可放/不可放的高亮和原因提示 | @dnd-kit（MIT） |

### 5.2 占位与缩略图

- **宽高**：后端在资产入库时写入 `width/height/duration_ms`。PNG、JPEG、WebP 解析文件头获得，MP4 解析 `moov` 获得，不引入依赖（§8.1）。
- **占位**：第一期使用 Cloudflare 图片变换生成的 32px 模糊小图（`width=32,blur=20,format=webp`），作为 CSS 背景，同一 URL 永久缓存。之后可以升级为 ThumbHash（MIT）存进元数据。
- **缩略图宽度固定 4 档**：240、480、960、1920。列表只用 480 及以下，详情用 960 或 1920，原图只用于下载。

### 5.3 视频封面

- 生成视频完成后，后端归档时保存上游返回的封面。上游没有封面时，在前端首次播放时截取第一帧，上传为封面（乐观更新，失败不影响播放）。
- **视频格式**：视频为 5–10 秒短片，直接用 MP4，不做 HLS。

---

## 6. 乐观更新规范

默认所有写操作都用乐观更新。**以下情况例外：**

- 金额相关：扣点、充值码兑换、结算。
- 权限变更。
- 不可撤销的删除（清空回收站）。

例外操作显示明确的进行中状态，等服务端确认后才更新界面。

| 操作 | 做法 | 失败处理 |
|---|---|---|
| 提交生成 | 立即在创作视图插入占位卡片（取正在提交的请求数据渲染），状态为「提交中」 | 占位卡片变为失败卡片：显示原因 + 重试；草稿不丢 |
| 上传素材 | 本地图片立即显示为卡片，显示上传进度；完成后预加载服务端地址，再替换本地地址并释放 | 卡片显示「上传失败 · 重试」，保留本地文件 |
| 收藏 / 取消收藏 | 立即更新缓存数据，图标切换 | 回滚 + Toast |
| 删除素材 / 记录 | 立即从列表移除，Toast「已删除 · 撤销」5 秒；服务端做软删除 | 恢复到原来的位置 + Toast |
| 移动到文件夹、重命名、排序 | 立即更新缓存数据 | 回滚 + Toast |
| 画布编辑 | 本地优先，立即生效；停手 1.5 秒后带 `revision` 保存 | 版本冲突：弹出「远端有更新」，可选择覆盖远端或另存副本 |
| 做同款 / 加入输入框 | 纯前端，立即生效 | — |

**实现约定：**

- **只影响一处列表**：用 TanStack Query 的 `useMutationState` 取正在进行的请求数据，渲染占位卡片。
- **影响多处**：在 `onMutate` 里取消正在进行的查询、保存快照、写入新数据；在 `onError` 里回滚；在 `onSettled` 里刷新相关查询。
- **幂等**：每个写请求都带幂等键（生成请求沿用后端 `requests` 表的唯一约束），重试不会重复扣点或重复创建。

---

## 7. 媒体存储与缓存（复用现有 R2）

### 7.1 现状（后端已配置）

- **配置**：`R2_CONFIG_FILE` 指向一个 JSON 文件，字段有 `accountId`、`bucket`、`accessKeyId`、`secretAccessKey`、`archiveFrom`。只有一个私有 bucket。
- **签名**：后端自己实现 SigV4，只支持 PUT 和 5 分钟有效的预签名 GET，没有引入依赖（`src/r2-storage.mjs`）。
- **存储内容**：只归档生成的图片，key 为 `users/{user_id}/imagegen/{task_id}/{index}-{sha256}.{ext}`（`src/image-archive.mjs`）。没有缩略图，没有缓存头，没有清理。
- **读取**：`GET /api/me/images` 返回 5 分钟签名 URL，URL 每次都不同，浏览器和 CDN 都缓存不上。

### 7.2 目标方案：私有 bucket + 签名 URL

**决定**：第一期用户媒体和案例都**不公开读**。现有 bucket 保持私有，浏览器只通过网关签发的 URL 读取。不绑自定义域名，不用 Cloudflare 图片变换，因此 `ipzsk.com` 的 DNS 不需要迁到 Cloudflare。

1. **对象 key 规则**（永不覆盖，需要修改时写新 key）：

```text
cases/{asset_id}/orig.{ext}  cases/{asset_id}/w480.webp  cases/{asset_id}/w960.webp
u/{user_id}/{asset_id}/orig.{ext}   u/{user_id}/{asset_id}/w480.webp   u/{user_id}/{asset_id}/w960.webp
u/{user_id}/{asset_id}/poster.webp  canvas/{project_id}/thumb.webp
```

   `asset_id` 为 uuid（上传前就能确定），`sha256` 只作为去重字段写进 `media_assets`。bucket 私有，key 是否可猜无所谓。

2. **签名 URL 的缓存策略**（签名 URL 不经过 CDN，所以要让浏览器缓存生效）：
   - 网关签发 GET URL 时，过期时间对齐到**固定的 6 小时时间片**（例如 00/06/12/18 点整），签名的 `X-Amz-Date` 也用时间片起点。同一对象在同一时间片内签出的 URL 完全相同，浏览器和 TanStack Query 都能命中缓存。
   - 时间片剩余不足 30 分钟时，签发下一个时间片的 URL，避免用户刚拿到就过期。
   - 对象写入时带 `Cache-Control: private, max-age=21600`，浏览器缓存 6 小时。
   - 列表接口一次返回整页的签名 URL（每张 3 档：w480 / w960 / orig），不逐张签。签名是本地 HMAC 计算，每张约 0.1ms。
   - 前端图片失败重试时先刷新元数据拿新 URL 再重试。
3. **缩略图：Cloudflare Worker + R2 绑定（不加服务器容器）**
   - **为什么不用容器**：网关机器只有 2 核 1.9GB，sharp 容器常驻约 150MB，4K 解码峰值再加 200MB 以上。
   - **方案**：新建 `ipzsk-media-worker`（Cloudflare Worker，与现有 `license-worker` 同平台）。
     - 用 R2 **绑定**直接读写同一个 bucket，不走公网、不产生出口流量、不需要签名。
     - 编解码用 WebAssembly 库 **jSquash**（`@jsquash/png`、`@jsquash/jpeg`、`@jsquash/webp`、`@jsquash/resize`，Apache-2.0，Squoosh 的代码提取版），Worker 上可用，无原生依赖。
     - 触发：网关在上传完成或归档写入后 `POST https://media-worker/thumb`（带共享密钥）传 key；Worker 生成 `w480.webp`、`w960.webp` 写回并返回宽高。失败由网关重试队列兜底（沿用归档的指数退避）。
     - 视频 poster：Worker 不解码视频。上游返回封面就存封面；没有则前端首次播放时截第一帧上传（§5.3）。
   - **限制与兜底**：Worker 内存上限 128MB，4K PNG 解码约 64MB，能处理；超过 4K 或解码失败时，Worker 返回 `skip`，前端用 `orig` 兜底并显示「处理中」角标。
   - **备选**：如果不想多一个 Worker，在网关镜像里用独立 `package.json` 起第二个 Node 进程跑同一套 jSquash（纯 wasm，无原生依赖，空闲约 40MB），不改网关主进程依赖。
   - **费用**：Worker 免费额度每天 10 万次请求，绰绰有余。
4. **上传（参考图、素材）**：
   1. `POST /api/me/uploads`（body：`kind`、`content_type`、`bytes`）→ 校验类型（png/jpeg/webp/mp4）、大小（图片 ≤20MB、视频 ≤200MB）、**用户配额**（第一期每人 2GB / 2,000 个）、速率（每分钟 20 次），创建 `pending` 资产，返回 10 分钟有效的预签名 PUT URL。预签名把 `content-type` 和 `content-length` 签进 SignedHeaders，超出即被 R2 拒绝。
   2. 浏览器直接 PUT 到 R2，带进度。bucket CORS 只允许 `https://www.ipzsk.com` 的 PUT。
   3. `POST /api/me/uploads/:id/complete` → 网关 HEAD 取实际大小；用 Range GET 读文件头识别真实类型和宽高（PNG/JPEG/WebP 头部；MP4 的 `moov` 可能在尾部，需要 Range 读尾部），不信任客户端声明的 content-type；资产变 `ready`，触发缩略图。
   4. 生成请求只传 `reference_asset_ids`。网关校验资产属于当前用户且 `ready`，换成 **1 小时签名 GET URL** 放进 `image_urls` 发给 lanehub。**永远不给上游公开 URL。** lanehub 是否接受外部 https URL，B1 第一天用真实型号实测（lanehub 侧目前没有 URL 校验代码，但也没有证据证明上游一定能拉取）。
5. **生成结果归档**：沿用现有归档任务，改写到新 key 规则并写入 `media_assets`；视频新增同样的归档（当前只归档图片）。现有 `archived_images` 的旧对象**复制到新 key**（旧 key 含真实用户 id 的路径不再对外签发），复制时顺带解析宽高。
6. **清理**：`pending` 超过 24 小时的上传删除对象和记录；软删除超过 30 天的资产删除对象。由网关现有的定时循环执行。
7. **R2 客户端**（`r2-storage.mjs`）需要补：预签名 PUT（带 content-length/type 约束）、HEAD、Range GET、DELETE、Copy。仍然自实现 SigV4，不新增依赖。
8. **以后要公开分享时**：再新建一个公开 bucket，把用户主动分享的对象复制过去，并绑定自定义域名。私有 bucket 的规则不变。

### 7.3 浏览器端缓存

- **媒体文件**：签名 URL 在 6 小时时间片内稳定，配合 `Cache-Control: private, max-age=21600` 由浏览器缓存；不引入 Service Worker。
- **元数据**：用 TanStack Query 缓存。
  - 案例列表：新鲜期 10 分钟。
  - 素材和生成记录：新鲜期 30 秒，窗口重新聚焦时刷新。
  - 任务状态由轮询驱动。
- **IndexedDB**（idb-keyval）：只存输入框草稿、未完成的上传队列、画布的本地副本。
- **内存**：虚拟滚动卸载视口外的元素；列表不加载原图。

---

## 8. 数据库设计（ipzsk-api-gateway）

### 8.1 现状与迁移规则

- **定义方式**：唯一的 `src/schema.sql`，幂等执行（`CREATE … IF NOT EXISTS` / `ALTER … ADD COLUMN IF NOT EXISTS`），每次启动时由 `db.migrate()` 整体执行，`schema_version` 当前为 17。better-auth 只管理 `auth_*` 表。
- **遵守 AGENTS.md**：
  - 不新增生产依赖（所以宽高由文件头解析获得，不引入 sharp）。
  - 集成测试只用 `gateway_test` 库。
  - 金额按 8 位小数，未知值不当作 0。
  - 冻结和结算放在事务里，并保证幂等。
  - 迁移和部署都需要明确授权。
- **本次迁移**：按功能拆成 v18–v21，每个版本一段，追加在 `schema.sql` 末尾。
- **现有问题不在本次处理**：v14/v15 版本号重复写入无实际影响；v11 回填从未执行，修复它会在生产跑一次历史数据回填，需要单独立项评估，不「顺带」做。
- **部署前**：
  - 先执行 `ops/backup.sh` 备份。
  - 在 `gateway_test` 上跑完整集成测试。
  - 发布走现有的 `ops/deploy-prod.sh`（带漂移检测）。

### 8.2 v18 角色（§9）

```sql
CREATE TABLE IF NOT EXISTS user_roles (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        text   NOT NULL CHECK (role IN ('admin','operator','viewer')),
  granted_by  uuid REFERENCES users(id),
  granted_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role)
);
-- 没有记录 = 普通 user；developer 仍由 developer_profiles.status='approved' 推导
```

> 外键类型以现有 `users.id` 为准，实施时核对。

### 8.3 v19 媒体资产与上传

```sql
CREATE TABLE IF NOT EXISTS media_assets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid REFERENCES users(id) ON DELETE CASCADE,     -- 案例资产为 NULL
  kind         text NOT NULL CHECK (kind IN ('image','video')),
  source       text NOT NULL CHECK (source IN ('upload','generation','case','poster')),
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready','failed','deleted')),
  object_key   text NOT NULL UNIQUE,
  content_type text NOT NULL CHECK (content_type IN ('image/png','image/jpeg','image/webp','video/mp4')),
  bytes        bigint CHECK (bytes > 0),
  sha256       text,
  width        int, height int, duration_ms int,
  poster_id    uuid REFERENCES media_assets(id),
  task_id      uuid REFERENCES media_tasks(id),      -- 生成结果使用
  result_index int,                                    -- 同一任务的第几张
  created_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);
CREATE INDEX IF NOT EXISTS media_assets_user_recent ON media_assets (user_id, created_at DESC) WHERE status <> 'deleted';
CREATE INDEX IF NOT EXISTS media_assets_pending ON media_assets (created_at) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS asset_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  position double precision NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);
CREATE TABLE IF NOT EXISTS asset_folder_items (
  folder_id uuid NOT NULL REFERENCES asset_folders(id) ON DELETE CASCADE,
  asset_id  uuid NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  position  double precision NOT NULL DEFAULT 0,
  PRIMARY KEY (folder_id, asset_id)
);
```

- **回填**：把现有 `archived_images` 逐行写入 `media_assets`（source=`generation`），对象复制到新 key，并解析宽高。`archived_images` 也没有宽高字段，必须逐个读取文件头。
- **排序**：`position` 用浮点数，插入到中间时取前后两项的中点，拖动排序只需要更新一行。

### 8.4 v20 收藏

```sql
CREATE TABLE IF NOT EXISTS favorites (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type text   NOT NULL CHECK (target_type IN ('case','asset')),
  target_id   text   NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, target_type, target_id)
);
```

### 8.5 v20 生成记录

现有的 `requests` 和 `media_tasks` 负责计费与上游任务。创作视图还需要提示词、参数、参考素材和结果资产，因此新增一张面向用户的记录表。**实施前需要核对 `requests` 是否已经保存了请求体，避免重复保存。**

```sql
CREATE TABLE IF NOT EXISTS generation_records (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id      uuid UNIQUE REFERENCES requests(id),
  task_id         uuid UNIQUE REFERENCES media_tasks(id),
  batch_id        uuid,                                -- 电商套图等一次多张时共用，聊天流按批次渲染一张卡
  kind            text NOT NULL CHECK (kind IN ('image','video')),
  model           text NOT NULL,
  prompt          text NOT NULL,
  params          jsonb NOT NULL DEFAULT '{}',
  status          text NOT NULL CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
  failure_code    text,
  charged_points  numeric(20,8),                       -- 结算后写入；未结算为 NULL，前端显示「结算中」
  thread_id       uuid REFERENCES generation_threads(id) ON DELETE SET NULL,
  source          text NOT NULL DEFAULT 'studio' CHECK (source IN ('studio','ecommerce','canvas')),
  source_case_id  text,                                -- 做同款来源
  canvas_node     jsonb,                               -- {project_id,node_id}，来自画布时写入
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);
CREATE INDEX IF NOT EXISTS generation_records_user_recent ON generation_records (user_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS generation_records_thread ON generation_records (thread_id, created_at) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS generation_references (   -- 替代 uuid[]，保证引用完整性
  record_id uuid NOT NULL REFERENCES generation_records(id) ON DELETE CASCADE,
  asset_id  uuid NOT NULL REFERENCES media_assets(id),
  position  int  NOT NULL,
  PRIMARY KEY (record_id, position)
);
-- 结果不单独存：由 media_assets.task_id + result_index 反查

CREATE TABLE IF NOT EXISTS generation_threads (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      text NOT NULL DEFAULT '' CHECK (char_length(title) <= 80),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS generation_threads_user ON generation_threads (user_id, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS generation_records_active ON generation_records (user_id) WHERE status IN ('queued','running');
```

- **会话**：记录只是按 `thread_id` 分组，生成请求不读取任何历史记录。缺省会话由**客户端**按本地日期决定并创建（服务端不猜时区）；`generation_threads` 表要先于 `generation_records` 创建。
- **写入**：生成入口在创建 `requests` 的同一个事务里写入记录；`syncMediaTasks` 更新状态时同步更新；结算完成后写入 `charged_points`。
- **幂等**：沿用 `requests (user_id, idempotency_key)` 唯一约束。**同时补上官网已经在调用、但后端缺失的 `GET /api/me/generations?idempotency_key=`**，用来替代不存在的 `/api/me/image-requests/:key`。

### 8.6 v21 画布项目

```sql
CREATE TABLE IF NOT EXISTS canvas_projects (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       text NOT NULL DEFAULT '未命名画布' CHECK (char_length(title) <= 80),
  document    jsonb NOT NULL,             -- {version,nodes,edges,groups,viewport}
  revision    int  NOT NULL DEFAULT 1,
  thumb_id    uuid REFERENCES media_assets(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  CHECK (octet_length(document::text) <= 2500000)   -- 与 content_workspaces 一致
);
CREATE INDEX IF NOT EXISTS canvas_projects_user_recent ON canvas_projects (user_id, updated_at DESC) WHERE deleted_at IS NULL;
```

- **保存**：`PUT /api/me/canvas/:id` 携带 `revision`，执行 `UPDATE … WHERE revision = $n`；0 行受影响时返回 409 和远端最新版本（沿用 `content_workspaces` 的做法）。
- **节点里的媒体**：只存 `media_assets.id`，不存 URL。

### 8.7 v21 案例库（由管理中台维护）

```sql
CREATE TABLE IF NOT EXISTS inspiration_cases (
  id            text PRIMARY KEY,                    -- 沿用现有案例 id
  title         text NOT NULL,
  prompt        text NOT NULL,
  category      text NOT NULL,
  tags          text[] NOT NULL DEFAULT '{}',
  model         text,
  params        jsonb NOT NULL DEFAULT '{}',
  cover_id      uuid NOT NULL REFERENCES media_assets(id),
  reference_ids uuid[] NOT NULL DEFAULT '{}',
  author        text, source_url text, license_note text,
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','hidden')),
  position      double precision NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inspiration_cases_feed ON inspiration_cases (status, category, position);
```

- **导入**：一次性脚本读取三套数据：`cases.json`（441）、`canghe-cases.json`（541，前者是其子集，按 id 去重）、`punk-cases.json`（38）。封面是本地文件名，**没有宽高**，导入时逐张解析后上传到 `cases/{asset_id}/`，写入 `media_assets` 和本表。
- **读取**：`GET /api/public/cases?cat=&q=&cursor=` 游标分页；响应里的封面是签名 URL，所以整体 `Cache-Control: private, max-age=300`（要显式覆盖 `app.mjs` 全局的 `no-store`）。
- **搜索**：第一期用 `ILIKE` 加分类过滤（案例量在千级以内）。量大以后再加 `pg_trgm` 索引（PostgreSQL 自带扩展，不属于新增依赖）。

### 8.8 数据流一览

```text
上传：浏览器 ─POST uploads→ 网关(media_assets pending) ─预签名 PUT→ R2 ─complete→ 网关(ready, 宽高)
生成：浏览器 ─POST generations(资产id)→ 网关(requests + generation_records，不冻结) → lanehub(扣额度) → 上游
      同步任务 → 网关(media_tasks) → 归档 R2(media_assets) → generation_records.result_ids → 结算
读取：浏览器 ─GET→ 网关(元数据 + 6 小时时间片签名 URL) ；媒体文件 ─GET→ R2 签名 URL(浏览器缓存 6 小时)
```

---

## 9. 权限与管理中台

### 9.1 角色模型

| 角色 | 来源 | 能力 |
|---|---|---|
| `user` | 所有已验证邮箱的用户（默认） | 工作台、账户、自己的数据 |
| `developer` | `developer_profiles.state='approved'`（现有字段名为 `state`） | 开发者中心 |
| `viewer` | `user_roles` | 管理中台只读 |
| `operator` | `user_roles` | 案例库、充值码、用户支持类操作 |
| `admin` | `user_roles` | 全部权限，包括财务、角色授予、计费策略 |

- **统一身份**：管理员也使用 better-auth 账户登录。原有 `administrators` 表的 superadmin/operator/viewer 映射为 `admin`/`operator`/`viewer`。迁移期内两套登录并存，新中台达到同等功能后停用旧登录。
- **服务端校验**：新增 `requireRole(req, ...roles)` 钩子，用于 `/api/admin/*`。每次请求都查询 `user_roles`（可以做 30 秒进程内缓存，角色变更时清除）。**前端隐藏入口只是体验层，不作为安全措施。**
- **管理员登录**：与普通用户相同的邮箱 + 密码登录，不做两步验证。区别只在角色：
  - 管理接口的会话有效期 12 小时：better-auth 会话全局 7 天，`requireRole` 额外检查 session 创建时间。
  - 所有写操作写入现有的 `audit_events`，该表目前没有操作者列，v18 增加 `actor_user_id uuid`。
  - 管理员账户密码长度要求提高到 16 位（服务端校验）。
- **CORS**：`/api/admin/*` 只允许 `https://www.ipzsk.com`，带凭据，非 GET 请求校验 Origin（与现有 `/api/me/*` 一致）。

### 9.2 管理中台 `/admin`（官网仓库）

- **技术栈与设计系统**：与工作台相同，共用组件和 Tailwind 主题。
- **入口**：站点导航的账户菜单里，有管理角色的用户才显示「管理中台」（`ShieldCheck`）。
- **模块与分期**：
  1. 案例库：列表、编辑、上传封面、发布/隐藏、拖动排序、预览瀑布流效果。
  2. 用户与角色：搜索用户、授予/撤销角色、查看用量和钱包。
  3. 生成记录与任务：按用户、型号、状态筛选；失败原因；人工核销。
  4. 从旧中台迁移：充值码、计费策略、上游账户和 Key、开发者审核、插件、分成、审计。
- **旧中台**：迁移期间 `api.ipzsk.com/admin` 保持可用；全部模块迁移并验收后下线。

---

## 10. 后端接口与改动清单

### 10.1 新增接口

| 接口 | 权限 | 用途 |
|---|---|---|
| `GET /api/public/cases` | 公开 | 案例瀑布流（游标分页、分类、搜索） |
| `GET /api/public/cases/:id` | 公开 | 案例详情和相似案例 |
| `GET /api/me/media/models` | user | 网页用型号目录：参数声明、`unsupported`、参考素材能力（最多几张、首尾帧）、计费单位 |
| `POST /api/me/media/quote` | user | 预计点数：透传 lanehub `/v1/quote`，叠加用户级折扣 |
| `GET/POST/PATCH/DELETE /api/me/threads` | user | 对话会话分组 |
| `POST /api/me/uploads`、`POST /api/me/uploads/:id/complete` | user | 预签名直传 |
| `GET /api/me/assets`、`PATCH/DELETE /api/me/assets/:id` | user | 素材列表、重命名、软删除 |
| `GET/POST/PATCH/DELETE /api/me/folders`，`PUT /api/me/folders/:id/items` | user | 文件夹 |
| `PUT/DELETE /api/me/favorites/:type/:id`、`GET /api/me/favorites` | user | 收藏（PUT 幂等） |
| `GET /api/me/generations`、`GET /api/me/generations/:id`、`DELETE …/:id`、`PATCH …/:id`（移动会话） | user | 生成记录；支持 `?thread=`、`?status=active`、`?idempotency_key=` |
| `GET/POST /api/me/canvas`、`GET/PUT/DELETE /api/me/canvas/:id` | user | 画布项目（带 revision） |
| `/api/admin/*` | viewer/operator/admin | 管理中台 |

- **现有生成接口**：`/api/me/images/generations`、`/api/videos/generations` 新增参数 `reference_asset_ids`，保留对 `image_urls` 的兼容。

### 10.2 契约

- **错误格式**：统一为 `{ error: { code, message } }`，`code` 为稳定的英文标识，官网维护中文映射。
- **分页**：统一为 `{ items, next_cursor }`。
- **CORS 必须扩展**（现有 `app.mjs` 只匹配 `/api/(auth|me|account)/`，只放行 GET/POST，只允许 `Content-Type` 头）：前缀加入 `/api/public/`、`/api/admin/`；方法加入 PUT/PATCH/DELETE；头加入 `Idempotency-Key`。放在 B1，配预检测试。

### 10.3 型号目录与价格的真源是 lanehub；`gpt-image-2.5-flare` 已在其中

调研结论（`lanehub/docs/ipzsk-integration.md`、`pricing-single-source.md`，网关 `src/lanehub-catalog.mjs`）：

- **网关的 `model-catalog.json` 是旧快照**，lanehub 模式下不再是真源。网关每 10 分钟拉取 lanehub `GET /api/catalog`，型号、参数、价格都以它为准（快照只有 5 个型号，lanehub 可卖 113 个）。
- **flare 已经登记在 lanehub**：`providers/xiaoguai/params.go` 中 `gpt-image-2.5-flare` 允许 `prompt`、`aspect_ratio`（16 种含 `auto`）、`resolution`（1K/2K/4K）、`image_urls`、`n`；同系列还有 `gpt-image-2.5-sunburst`。价格在 lanehub 价目表（后台维护），代码里不写死。
- **因此本方案不在网关新增型号 JSON**。要做的是：
  1. 确认生产的 `app_settings.lanehub_mode` 已开启，且 lanehub 渠道白名单包含 flare 系列。
  2. 网页型号目录接口 `GET /api/me/media/models` 直接由 lanehub 目录派生（复用桌面端 bootstrap 的转换，补上 `references` 能力字段）。
  3. **报价**：网关的 `POST /api/me/media/quote` 透传 lanehub `POST /v1/quote`（已存在：`lanehub/controller/quote.go`），请求体就是真实生成请求体。**必须用该用户自己的 lanehub key**（`lanehub_accounts.key_id`）调用，因为 lanehub 按令牌所在档位报价。网关不另算档位、不加折扣。
  4. **计费事实**：lanehub 模式下网关**不冻结、不扣款**（`gateway.mjs:237` 只在非 lanehub 时 `reserveRequest`），额度在 lanehub。`generation_records.charged_points` 由 `recordLanehubCharge` 异步回填，回填前前端显示「结算中」。
  5. **对账**：B2 验收改为「quote 金额 == lanehub 消费日志实扣」，并在日志里记录每次差异。
  6. 旧模式的 `resolveTier` / `model-catalog.json` 只保留给尚未切换的桌面客户端，网页不再依赖。

### 10.4 图生视频

目前所有视频型号都不支持：`seedance-2.0-mini` 声明暂不开放图生视频，旧模式下带参考图会返回 400。第一期视频类型下不显示参考槽位；上游开放后，在型号声明中补充 `references` 能力即可，前端不需要改动。

---

## 11. 仓库：合并还是分开

**建议：暂不合并，建立共享契约。**

| 考虑 | 说明 |
|---|---|
| 部署目标完全不同 | 网关是有状态的长驻进程：Postgres、定时任务、Docker/Caddy，腾讯云单机，rsync 发布并做漂移检测。官网是 Vercel 静态站加 Functions，跟随 main 自动构建。合并后两边仍各自部署，还要额外配置路径过滤。 |
| 流程约束不同 | 网关的 AGENTS.md 要求：迁移、部署、提交都需要授权，集成测试只用专门的测试库。合并后这些规则需要限定在子目录，容易误触。 |
| 真正的问题是契约漂移 | `image-requests` 缺失、`flare` 未登记，都是两边各自手写接口造成的。合并仓库并不能自动解决这个问题。 |

**共享契约的做法：**

1. **类型文件**：网关新增 `scripts/export-contracts.mjs`，从 lanehub 目录快照、错误码清单、接口清单生成 `contracts/ipzsk-api.d.ts` 和 `contracts/endpoints.json`。
2. **官网同步**：官网执行 `npm run contracts:sync` 拉取指定版本的契约文件，提交到 `src/shared/contracts/`。
3. **契约测试**：官网 CI 检查代码里调用的每个接口都在 `endpoints.json` 中；网关 CI 检查 `endpoints.json` 中的每个接口都有路由。

**什么时候再考虑合并**：团队需要频繁同时修改前后端，并且网关迁移到支持 monorepo 路径构建的平台时。

---

## 12. 前端技术方案

### 12.1 选型

| 项 | 选择 | 协议 |
|---|---|---|
| 构建 | Vite | MIT |
| 语言 | TypeScript（strict） | Apache-2.0 |
| UI | React 19 | MIT |
| 样式 | Tailwind CSS v4 | MIT |
| 组件 | shadcn/ui + Radix Primitives | MIT |
| 图标 | lucide-react | ISC |
| 路由 | React Router（library 模式） | MIT |
| 服务端状态 / 乐观更新 | TanStack Query | MIT |
| 本地状态 | Zustand | MIT |
| 画布 | @xyflow/react | MIT |
| 瀑布流 | @virtuoso.dev/masonry（备选 @tanstack/react-virtual） | MIT |
| 预览 | yet-another-react-lightbox | MIT |
| 播放器 | media-chrome | MIT |
| 拖拽 | @dnd-kit | MIT |
| 本地存储 | idb-keyval | Apache-2.0 |
| 测试 | Vitest、Testing Library、Playwright | MIT / Apache-2.0 |

**不采用：**

- tldraw：生产环境需要商业 key。
- Jaaz：需要商业授权。
- ComfyUI 前端：GPL。
- Immich、PhotoPrism：AGPL，只参考设计。
- 100xspeed：见 §14。

### 12.2 目录结构

```text
ipzsk/
├── src/
│   ├── shared/        # api 客户端、contracts、auth、站点导航、点数、toast
│   ├── ui/            # shadcn/ui 组件（IPZSK 样式）+ 状态矩阵示例页
│   ├── media/         # MediaImage / MediaVideo / MasonryGrid / MediaLightbox / useUpload / MediaCard / DropTarget
│   ├── studio/        # composer · inspiration · create · assets · canvas
│   ├── admin/         # 管理中台
│   └── pages/         # 迁移后的首页、账户、开发者、内容工作台
├── studio.html  admin.html  index.html …   # Vite 多页面入口
├── api/               # Vercel Functions（保持）
└── docs/studio-redesign.md
```

### 12.3 构建与部署

- **自动构建**：Vercel 已绑定 main 分支。`vercel.json` 配置 `buildCommand: vite build`、`outputDirectory: dist`，`api/` 目录的 Functions 不受影响。
- **过渡期**：未迁移的静态页也作为 Vite 入口一起构建。打包产物不再提交。
- **CSP**：为 `/studio(.*)`、`/admin(.*)` 配置：
  - `img-src`、`media-src`：`https://*.r2.cloudflarestorage.com blob: data:`（blob 用于本地预览和首帧截取）
  - `connect-src`：`https://api.ipzsk.com https://*.r2.cloudflarestorage.com`
  - 深路径（`/studio/create/:id` 等）需要 `vercel.json` rewrite 到 `studio.html`
- **本地开发**：`vite dev` 通过代理转发 `/api` 并改写 Cookie，替代 `dev-server.mjs`。

---

## 13. 分期、工作量与验收

### 13.1 后端（ipzsk-api-gateway）

| 步 | 内容 | 估时 | 验收 |
|---|---|---|---|
| B1 | 迁移 v18–v19（角色、媒体资产、文件夹、audit actor）；`requireRole`；**CORS 扩展**；R2 客户端补预签名 PUT/HEAD/Range GET/DELETE/Copy；上传接口与配额；时间片签名 URL；`ipzsk-media-worker`（Cloudflare）；归档改新 key；**实测 lanehub 接受 R2 签名 URL** | 5 天 | 集成测试全部通过；上传 → 完成 → 缩略图 → 读取完整链路；同一时间片内两次列表返回相同 URL |
| B2 | 网页型号目录接口（由 lanehub 目录派生）、报价透传 lanehub `/v1/quote`、生成接口支持资产 id 并转成 R2 签名 URL | 2 天 | 报价与实际冻结金额一致；flare 走 lanehub 能生成；参考图经 R2 URL 成功送达上游 |
| B3 | v20：生成记录、收藏；`/api/me/generations`（含幂等键查询） | 2 天 | 记录状态与 `media_tasks` 一致；重复提交不重复记录 |
| B4 | v21：画布项目（revision 冲突）、案例库表、三套案例导入（解析宽高）、`archived_images` 回填与复制、公开案例接口 | 4 天 | 全部案例和旧归档都有宽高与缩略图；冲突时返回 409 和最新版本 |
| B5 | `/api/admin/*` 第一批（案例库、用户与角色、生成记录、会话） | 2.5 天 | 权限测试覆盖每个角色 × 每个接口；未授权返回 403 |
| B6 | 契约导出脚本、契约测试 | 1 天 | 官网或网关任一边的接口漂移都会导致 CI 失败 |

后端合计约 17 个工作日。每一步部署前都需要备份，并获得明确授权。

### 13.2 前端（ipzsk）

| 步 | 内容 | 估时 | 验收 |
|---|---|---|---|
| F1 | 工程骨架：Vite+TS+Tailwind+shadcn+Lucide、主题、状态矩阵示例页、站点导航、api 与 contracts、Toast、Vite 代理、CSP | 2 天 | `/studio` 可以访问；示例页展示 §4.1 全部状态；其他页面行为不变 |
| F2 | 媒体通用组件：MediaImage、MediaVideo、MasonryGrid、MediaLightbox、useUpload、MediaCard、DropTarget；先验证 @virtuoso.dev/masonry 能否按 index 恢复滚动，不行就换 @tanstack/react-virtual | 6 天 | 1000 张图瀑布流滚动 ≥ 55fps（实测记录）；布局偏移 CLS < 0.02；断网上传可以恢复 |
| F3 | 输入框：型号目录适配、参数小按钮、槽位、提交时判断、报价、登录拦截和草稿、点数不足 | 4 天 | 对照 §2.2 逐条勾选；未登录提交不产生生成请求 |
| F4 | 灵感：瀑布流、分类和搜索（URL 同步）、详情深链接、做同款、收藏（乐观更新） | 3 天 | 首屏 LCP < 2.5s（4G 模拟）；返回时恢复滚动位置 |
| F5 | 创作：占位卡片、任务状态、卡片操作、服务端恢复；素材：分组、文件夹、多选、拖拽、软删除和撤销 | 4.5 天 | 同时提交 3 个任务，刷新后都能恢复；删除后 5 秒内可以撤销 |
| F6 | 画布：节点、连线校验、运行节点、互通、编辑能力、本地优先保存和冲突处理 | 11 天 | 200 个图片节点时拖动 ≥ 50fps；撤销重做覆盖所有编辑类型；离线编辑恢复网络后能同步 |
| F7 | 管理中台第一批：案例库、用户与角色、生成记录 | 3.5 天 | 按角色显示入口；viewer 看不到任何写操作按钮 |
| F8 | 替换 `/image`、`/video`；旧本地历史导入 | 1.5 天 | 旧 URL 正确跳转；旧历史可以一键导入 |
| F9 | 其他页面迁移到 TS + Tailwind | 5–7 天 | 每页有冒烟测试；删除旧 JS/CSS |

前端合计约 46–48 个工作日。依赖关系：F3 依赖 B2，F4 依赖 B4，F5 依赖 B1 和 B3，F6 的云端保存依赖 B4，F7 依赖 B5。F1、F2 可以和后端并行开始。

---

## 14. 版权与合规

- **100xspeed**：代码中存在从第三方产品反编译移植的内容。本项目**不复制它的任何代码、样式、组件结构或视觉设计**，型号参数完全基于 lanehub 目录实现。
- **市面产品**（Lovart、Flora、Krea、Freepik、Figma Weave、Midjourney、Pinterest、即梦、Higgsfield 等）：只参考公开可见的交互模式，不复制界面细节、图标、文案和配色。
- **开源依赖**：只用 MIT/ISC/Apache-2.0 协议，在 `THIRD_PARTY_NOTICES` 中列出。AGPL 项目（Immich、PhotoPrism）只阅读设计，不复制代码。
- **dsh-imagegen**（Apache-2.0）：旧工作台下线后，如果仍保留派生内容，保留 NOTICE。
- **案例内容（已核实 2026-09-16）**：
  - **Punk-Skill**（adrianpunk，MIT，已授权）：可以展示，保留作者署名。
  - **awesome-gpt-image-2**（freestylefly）：仓库代码为 MIT，但 README 写明「本仓库不保证第三方内容可商用，商用前请向原权利人取得授权」，并说明内容来自 YouMind、OpenNana 等公开社区，尽量保留了原作者主页和原帖链接。
    - **结论**：MIT 只覆盖仓库本身，不覆盖案例图片和提示词的商用权。
    - **处理**：可以展示，但每个案例必须标明「来源：awesome-gpt-image-2」，并带上原作者与原帖链接（数据里已有的字段）；详情页加一行「示例内容版权归原作者，仅供学习参考」；`license_note` 记录来源仓库和采集时间；提供邮箱供权利人要求下架，中台可一键隐藏。
    - **待决定**：是否在正式上线前联系仓库作者取得书面许可（§15-1）。

---

## 15. 已确认决定（2026-09-17）

| 事项 | 决定 |
|---|---|
| 入口 | `/studio`；导航单项「创作工作台」，生图/生视频分类入口带 `?kind=` |
| 构建 | Vercel 跟随 main 自动构建，产物不提交 |
| 案例 | 第一期只做图片案例；awesome-gpt-image-2 按 §14 展示并标明来源，不另行联系作者 |
| 创作视图 | 对话式；一条消息一次请求，不带上下文；历史存后端 |
| 媒体访问 | ~~方案 A；自定义域名；图片变换~~（v4 撤销，见下） |
| 型号与价格 | 真源为 lanehub，生产已开启 lanehub 模式；报价透传 `/v1/quote` |
| 参考图 | 上传到 R2，以签名 URL 交给 lanehub |
| 管理员 | 普通邮箱登录 + 角色，不做两步验证 |
| 电商 | 并入对话式创作：案例库模板 + 输入框套图状态 + 批次卡片（v5） |
| 媒体访问 | **改为**：私有 bucket + 签名 URL，不公开读，不绑域名，不用图片变换 |

| 缩略图 | Cloudflare Worker + R2 绑定 + jSquash（v5） |

---

## 16. 灰度、回滚、观测与限流

- **灰度开关**：`/studio` 先作为隐藏入口上线；替换 `/image`、`/video` 时通过 `vercel.json` 的 redirect 切换，回退只需改回 redirect。旧页面代码保留两周。
- **数据库回滚**：schema 只增不减；回滚代码不回滚 schema，新表留空无害。
- **日志与指标**（网关）：上传成功率与耗时、缩略图生成失败数、quote 与实扣差异（每日汇总）、签名 URL 401 次数（过期问题）、生成失败按错误码分布。
- **限流**：上传每分钟 20 次、报价每分钟 60 次、生成沿用现有 rpm；超限返回 `rate_limited`。
- **无障碍测试**：状态矩阵示例页跑 axe；键盘走完提交、做同款、画布连线三条路径。
- **国际化**：第一期只做中文；文案集中在一个模块，不散落在组件里。

---

## 附录 A：参考资料

- 后端现状（2026-09-16 只读调研）：`ipzsk-api-gateway/src/schema.sql`、`database.mjs`、`customer-auth.mjs`、`admin.mjs`、`gateway.mjs`、`r2-storage.mjs`、`image-archive.mjs`、`image-upload.mjs`、`image-references.mjs`、`model-catalog.json`、`AGENTS.md`、`DEPLOYMENT.md`
- 型号与价格真源：`lanehub/docs/ipzsk-integration.md`、`lanehub/docs/pricing-single-source.md`、`lanehub/providers/xiaoguai/params.go`（flare 参数）
- 案例来源许可：https://github.com/freestylefly/awesome-gpt-image-2 （MIT，README 声明第三方内容不保证可商用）；`image-studio/vendor/src/punk-source/SOURCE.json`（Punk-Skill MIT）
- 画布：@xyflow/react https://github.com/xyflow/xyflow ；tldraw 许可 https://github.com/tldraw/tldraw/blob/main/LICENSE.md ；Jaaz 许可 https://github.com/11cafe/jaaz/blob/main/LICENSE
- 瀑布流：https://virtuoso.dev/masonry/ ；CSS grid-lanes 现状 https://webkit.org/blog/17758/when-will-css-grid-lanes-arrive-how-long-until-we-can-use-it/
- 占位：ThumbHash https://github.com/evanw/thumbhash ；Immich 缩略图优化 https://github.com/immich-app/immich/pull/15435 、https://github.com/immich-app/immich/pull/20773
- Cloudflare：图片变换 https://developers.cloudflare.com/images/transform-images/transform-via-url/ ；价格 https://developers.cloudflare.com/images/pricing ；R2 自定义域名 https://developers.cloudflare.com/r2/buckets/public-buckets/ ；边缘令牌 https://developers.cloudflare.com/cache/interaction-cloudflare-products/waf-snippets/
- 预览：https://yet-another-react-lightbox.com/plugins
- 乐观更新：https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates
- 交互参考：Midjourney https://docs.midjourney.com/hc/en-us/articles/33329460426765-Website-Overview ；Higgsfield https://higgsfield.ai/blog/higgsfield-chat-social-network ；Google Flow https://blog.google/innovation-and-ai/models-and-research/google-labs/flow-updates-february-2026/ ；Freepik Spaces https://www.freepik.com/ai/docs/introduction-to-spaces ；Lovart https://www.lovart.ai/blog/chatcanvas-vs-traditional-design-tools
