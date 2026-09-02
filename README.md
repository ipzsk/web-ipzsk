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
