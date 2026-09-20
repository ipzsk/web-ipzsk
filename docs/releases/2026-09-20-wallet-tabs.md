# 2026-09-20 账单 Tab 交互修正

## 发布结果

- **URL**：https://www.ipzsk.com/
- **Target**：production
- **Status**：READY，正式域名已切换
- **Commit**：基于 `e70e5d7` 的本地未提交改动，本次未 commit / push
- **Framework**：静态 HTML / JavaScript，保留现有 Vercel Functions
- **Build Duration**：317 ms，部署约 14 秒
- **Deployment**：`dpl_GJFWkwXn8m8t7YmHwxK46ipN1ciy`
- **Deployment URL**：https://ipzsk-99ppv3g9f-jaycehuangs-projects.vercel.app
- **上一版本**：`dpl_EsAfVqfwTwBsujTZVxHMLMu45rvR`，保留用于回滚

## 修正范围

默认首页只显示功能介绍。点击顶部“余额与账单”后切换到 `#wallet`，隐藏介绍页并加载账户数据；点击“首页”或“下载客户端”切回介绍页。浏览器前进/后退与当前 Tab 保持一致。微信支付回跳仍进入账单 Tab，余额和付款逻辑未修改。

与上一发布目录逐文件对比，只有 `index.html`、`home-wallet.js`、`home-wallet.css` 三个运行文件变化。未部署或重启后端，未修改数据库或支付配置。

## 验证

- 前端 15 项相关测试全部通过，语法与 diff 空白检查通过。
- 本地浏览器验证：默认介绍页、点击账单 Tab、切回首页、后退返回账单。
- 正式网站浏览器验证：默认介绍页、点击账单加载访客登录提示、切回首页。
- 三个运行文件在候选部署和正式域名均通过内容哈希比对；先验收候选版本，再切换正式域名。
- 未执行真实付款，未重新验收登录用户的支付到账流程；本次改动不涉及后端。

## 发布后观测

- **Error scan**：新部署最近 15 分钟 error 级别日志 0 条。
- **Drains**：未核验，不新增或修改。
- **Monitoring**：完成即时浏览器和文件检查；持续监控及告警状态未核验。
- 既有桌面客户端下载接口异常仍保留，不在本次 Tab 修正范围内。
