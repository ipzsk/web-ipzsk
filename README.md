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

`account.html` + `account.js`：注册（图形验证码 + 邮箱 6 位验证码）、登录、余额、兑换码、退出。
余额读 `/api/me/wallet`；开启 lanehub 模式后它返回的是 lanehub 侧的真实额度（`source: "lanehub"`）。

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
