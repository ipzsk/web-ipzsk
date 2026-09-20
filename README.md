# 星际留白 · Punk 生图工作室

`ipzsk.com` 的静态网页源码。

## 线上地址

- <https://ipzsk.com>
- <https://www.ipzsk.com>

## 本地预览

直接在浏览器中打开 `index.html` 即可。

## 生图链路

浏览器**直接调网关** `https://api.ipzsk.com`，用登录用户自己的令牌：

1. 登录（`/account.html`）→ 会话 cookie（www 与 api 同属 ipzsk.com，算同站，cookie 会被带上）
2. `POST /api/me/web/session-key` → 拿一把绑这次登录会话的令牌（刷新页面只轮换同一行，退出即失效）
3. `POST /v1/images/generations` → `GET /v1/tasks/<id>` 轮询

**网站这侧不再持有任何上游密钥**。原先是同源 Function 拿一把共享的 `APIMART_API_KEY`
匿名转发，生成的图谁都记不到人头上——额度、扣费、插件分成因此全部落空。
`api/images/generations.js` 与 `api/tasks.js` 已删除，`APIMART_API_KEY` 可以从 Vercel 移除。

## 账户

`account.html` + `account.js`：注册（图形验证码 + 邮箱 6 位验证码）、登录、余额、在线充值、退出。新用户完成邮箱验证赠送 5 元，每位用户仅限一次。
余额读 `/api/me/wallet`；开启 lanehub 模式后它返回的是 lanehub 侧的真实额度（`source: "lanehub"`）。
面向用户统一显示人民币：使用接口的 `*_cny` 字段，充值 ¥10.00 显示到账 ¥10.00，不再显示点数。余额通常显示两位小数，小于一分的非零金额及账单明细最多保留八位；显示格式不改变服务端计费和扣款精度。

首页默认仅展示功能介绍，不加载账户数据。点击顶部“余额与账单”切换到 `/#wallet`，才展示登录用户的余额、10 / 50 / 100 元充值档位、最近 5 条消费及最近充值；点击“首页”切回介绍页。支付回跳保留 `#wallet`，浏览器前进/后退同步切换视图。未登录仅展示登录入口，不展示模拟余额。`home-wallet.js` / `home-wallet.css` 负责首页 Tab 与账户区，`billing-ui.js` 与账户页共用金额格式、接口调用和消费行渲染。
主页和账户页在裸域名 `ipzsk.com` 打开时先转到支持登录的 `www.ipzsk.com`，保留路径与支付回跳参数；不扩大网关的 CORS 白名单。
消费明细读取 `/api/me/usage` 的 `charged_cny` 与 `billing_state`（含 LaneHub 回传的实际扣款）；尚未结算显示“待结算”，不使用上游成本或估算值。账户页 `#usageCard` 支持每页 30 条翻页。
当前 Waffo CNY 一次性付款仅支持微信，按维护者要求页面只保留微信入口。跳转前提示第三方收银台、登录邮箱及中国账单国家；付款回跳不作为到账依据。

## DSH PPT 文本代理

`POST /api/v1/chat/completions` 现在**只做转发**：把调用方自己的 IPZSK 令牌
（`ipz_…`，桌面端登录后由网关签发）原样转给网关，计费与归属由网关负责。
服务端不再有共享口令，`DSH_PPT_PROXY_TOKEN` 与 `APIMART_API_KEY` 都可以从 Vercel 删掉。
可选变量 `IPZSK_GATEWAY_URL` 覆盖网关地址，默认 `https://api.ipzsk.com`。

桌面端改成直连 `api.ipzsk.com/v1` 之后，这个文件可以整个删除。

## 测试

```
node --test
```
