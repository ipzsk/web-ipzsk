# 2026-09-20 首页钱包与微信充值发布

## 发布结果

- 正式地址：https://www.ipzsk.com/#wallet
- 环境与状态：Production / READY；正式域名已切换。
- Vercel 部署：`dpl_EsAfVqfwTwBsujTZVxHMLMu45rvR`
- 部署地址：https://ipzsk-dp54v8wu2-jaycehuangs-projects.vercel.app
- 代码版本：前端基于 `e70e5d7` 的本地未提交改动；本次未执行 Git commit 或 push。
- 框架：静态 HTML / JavaScript，保留两项现有 Vercel Functions。
- 构建耗时：353 ms；部署约 18 秒。
- 发布方式：按 Vercel 部署技能先构建、验收候选部署，再切换正式域名；保留回滚版本。

## 用户可见改动

- 首页一级入口提供人民币余额、充值、近期消费和充值订单；账户页提供分页消费记录。
- 仅保留微信付款入口，充值档位仍为 ¥10 / ¥50 / ¥100；未新增海外支付渠道。
- 后端使用登录账户邮箱创建收银台会话，并传入中国账单国家 `CN`；付款返回首页钱包。
- 保留新用户完成注册与邮箱验证后一次性赠送 ¥5 的逻辑。
- 生图、生视频和其他原有页面保持不变。

## 后端变更与回滚准备

- 工作树：`/Users/jaycehuang/Projects/ipzsk-api-gateway-waffo`。
- 生产目录：`/home/ubuntu/api-gateway`。
- 仅更新 `src/payments.mjs`，不改数据库结构、生产 Compose、密钥挂载和依赖。
- 新镜像：`ipzsk-gateway:home-20260920-jtbygo`。
- 新镜像 SHA：`sha256:f284505c0018b077775dfa1ce6e8088399ff1435dd41feaca2c1ac7f774d99eb`。
- 旧镜像：`ipzsk-gateway:rollback-home-20260920-jtbygo`。
- 旧支付源码备份：`/home/ubuntu/ipzsk-home-backup.G3VTMg/payments.mjs`。
- 旧前端部署：`dpl_DeV5Vyp1PytiZkExX4qbMjY7AAWr`。
- 回滚材料已保留，未执行回滚。

## 验证与边界

- 本轮前端测试 15/15、后端单元测试 144/144 通过。
- 六项正式站运行文件内容哈希与本地一致：`index.html`、`account.html`、`account.js`、`billing-ui.js`、`home-wallet.js`、`home-wallet.css`。
- 正式首页访客提示及登录页面浏览器验收通过；未登录时不展示虚构余额或流水。
- 公开网关健康检查 200；匿名支付选项和消费接口均为 401。
- Vercel 最近 15 分钟 error 级别日志扫描返回 0 条；不代表所有请求都成功，已知 503 见下文。
- 长期日志归档、告警规则和持续监控状态未核验，本次未新增监控配置。
- 本次未进行真实付款、修改用户余额或创建测试充值订单。真实收银台邮箱/国家显示及付款到账闭环，仍需用户本人试充验收。

## 发现的既有问题

`/api/desktop-release` 在新旧前端部署均返回 503；其依赖的公开 GitHub latest release API 返回 404。页面已按现有逻辑退回 GitHub 发布页链接。下载发布信息的可用性仍需单独处理，本次未修改此接口或仓库权限，充值流程不依赖该接口。
