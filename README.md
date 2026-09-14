# 星际留白 · Punk 生图工作室

`ipzsk.com` 的静态网页源码。

## 线上地址

- <https://ipzsk.com>
- <https://www.ipzsk.com>

## 本地预览

直接在浏览器中打开 `index.html` 即可。

## 生图链路

线上页面通过同源 Vercel Functions 提交异步任务，Functions 使用服务器端环境变量访问 APIMart。浏览器无法读取 API Key。

相关文件：

- `api/images/generations.js`：提交 GPT Image 2 生图任务。
- `api/tasks.js`：查询 APIMart 异步任务结果。

Vercel Production 环境需要配置敏感变量 `APIMART_API_KEY`。API 地址可通过可选变量 `APIMART_BASE_URL` 覆盖，默认使用 `https://api.apimart.ai/v1`。密钥不得写入仓库。

## DSH PPT 文本代理

桌面端通过 `POST /api/v1/chat/completions` 请求受限的 GPT-5 文本代理，用于生成 PPT 大纲。代理强制使用 `gpt-5`，最多接收 32 条消息、返回 3,000 tokens，并且只在 `Authorization: Bearer <token>` 与服务器端 `DSH_PPT_PROXY_TOKEN` 一致时转发请求。

Vercel Production 还需要配置 `DSH_PPT_PROXY_TOKEN`。它是可单独撤销的桌面代理凭据，不能与 `APIMART_API_KEY` 使用相同值。


## 账户注册与登录

`https://www.ipzsk.com/account` 为统一入口，`/login` 和 `/register` 跳转至此。页面与静态资源部署到本 Vercel 项目；认证、用户、钱包和 API 凭证保存在腾讯云 `api.ipzsk.com`。浏览器使用 credentials: include 请求 API，后端仅对 www 主站开放用户接口的精确 CORS 来源。Cookie 保留为 API 域名下 Secure / HttpOnly / SameSite=Lax，不使用 localStorage 保存会话，也不共享管理员权限。

后端实现位于 `../jayce_blog/services/api-gateway`。原 API 域名 `/account` 跳转到主站。邮箱验证码需要腾讯云 SES 配置，尚未完成实际收信验证。现有生图、任务查询与 PPT 代理路由保持现状。

### 2026-09-07 账户中心升级

`/account` 支持独立命名、多把 API 凭证、有效期、限速和单独吊销；显示账户可用余额、冻结金额和充值/消费流水。服务端实施文档位于 jayce_blog/services/api-gateway/docs/ACCOUNT-ARCHITECTURE.md。邮箱发信仍等待腾讯云模板审核；生产实际扣费开关关闭，需确认售价后启用。

### 登录与注册分离（2026-09-07）

/account 默认显示邮箱 + 密码登录；/register 跳转 /account?mode=register。注册设置密码并验证邮箱后返回登录页；忘记密码使用邮箱验证码，成功后旧会话失效。密码至少 12 位。发信未开放时，登录页面可用，注册/找回密码等待邮件服务。

### 登录返回首页（2026-09-07）

密码登录成功后跳转 https://www.ipzsk.com/；首页通过现有用户会话显示“个人中心”，未登录时显示“登录 / 注册”。/account 在已登录时展示个人中心，余额、充值码和 API 凭证保留在该页面。首页统一 www 域名，以匹配现有跨域会话配置；手机端入口同步显示登录状态。

### 开发者中心与三角色权限（2026-09-07）

`/developer` 复用账户登录，提供开发者资格申请、自己的插件与版本、成功使用人数和计费收入/应计分成。审批、所有者绑定、比例配置与充值码在 API 超级管理员后台。所有权限由后端检查；前端不持有管理员凭证。`/account?next=developer` 登录后回到开发者中心，其余登录继续回首页。个人账户新增分页调用记录。尚不执行佣金结算与打款。

### 2026-09-10 预付点数

账户中心和生图、内容工作台显示后台点数，1 元 = 100 点。新账号无赠送点数，需要充值码兑换。旧生图、PPT 代理不再持有或使用公共上游凭据，统一要求账户凭证；生图网页直接使用 api.ipzsk.com 的已登录用户接口。

后端部署说明位于 ../ipzsk-api-gateway/docs/POINTS-BILLING.md。必须先上线后台和 schema 16，再切换本网站，否则新接口不可用。点数余额与消息费用由后台结算，网页仅显示；不在浏览器决定扣款。
