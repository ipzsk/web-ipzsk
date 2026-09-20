# IPZSK

`ipzsk.com` 的 Web 前端。当前站点包含首页、图片/视频/数字人创作工作台、内容工作台、个人中心、开发者中心和管理中台。

## 开发

```bash
npm ci
npm run dev
```

常用检查：

```bash
npm run typecheck
npm test
npm run build
```

项目采用 Vite + React + TypeScript。Vercel 生产构建执行 `npm run build`，路由和安全响应头见 `vercel.json`。

## 账户、余额与支付

- 登录、注册、余额、消费记录和充值接口由 `https://api.ipzsk.com` 提供。
- 新用户完成注册与邮箱验证后一次性赠送 ¥5.00。
- 页面统一显示人民币余额；首页顶部“余额与账单”和个人中心都可发起在线充值。
- 在线充值使用 Waffo，提供 ¥10 / ¥50 / ¥100 三档；当前人民币收银台显示微信支付。
- 付款回跳只提示用户刷新订单，余额增加以网关核实支付结果为准。
- 充值码/激活码流程已停用，前端不保存支付密钥或用户会话凭据。

支付网关实现位于独立私有仓库 `ipzsk-api-gateway`。网站侧 API 合约同步自该仓库：

```bash
npm run contracts:sync -- --from /path/to/ipzsk-api-gateway
npm run contracts:check
```

## 法律与客服页面

- `/pricing`：产品定价
- `/aup`：AIGC 使用规范
- `/terms`：服务条款
- `/privacy`：隐私政策
- 客服邮箱：`3318984@gmail.com`

## 部署

`main` 是 Vercel 正式环境分支。GitHub 协作者推送到 `main` 后会触发生产部署；部署与回滚说明见 `docs/deploy-runbook.md`。
