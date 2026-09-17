# 创作工作台首次上线 Runbook（studio rebuild）

> 编写：2026-09-17。依据：`docs/studio-redesign.md`（§7 §8 §9 §12.3 §13 §15 §16）、`docs/admin-api.md`、网关 `AGENTS.md` / `DEPLOYMENT.md` / `docs/LANEHUB-DEPLOY.md` / `scripts/ops/deploy-prod.sh`、lanehub `docs/heygen-onboarding.md`。
> 本文只是计划。文中每条命令都要在**第 0 节对应的授权勾选之后**由人执行。
> 约定：`$SRV` = `ubuntu@43.135.34.238`，服务器目录 `/home/ubuntu/api-gateway`（下称 `$GW`）。SSH 凭据 = secretctl 条目 `ipzsk-prod-server`，用 `secret_run` 注入，不落明文。
> 每一步都写了：**负责人/权限 · 命令 · 预期输出 · 验证 · 回滚**。

---

## ⚠️ 已发现的阻断项（要先处理）

| # | 问题 | 位置 | 影响 | 处理 |
|---|---|---|---|---|
| B-1 | `?mock=1` 在**生产构建**里仍然生效：`isMock = get('mock')==='1' \|\| (DEV && localStorage…)` | `src/shared/api.ts:76-80` | 任何人加 `?mock=1` 都能看到管理中台的 mock 界面，还能在本地 mock 里「生成」，容易被误当成真实数据。冒烟脚本对本地**生产构建**跑出了 `mock_active` 失败 | 合 main 前改成 `import.meta.env.DEV && (…)`，重跑 `prod-smoke.cjs` |
| B-2 | `deploy-prod.sh` 执行 `rsync -a scripts/ package.json … $REMOTE_DIR/`。`scripts/` 带了末尾斜杠，所以同步的是**目录里的内容**，落到了 `$GW/` 根目录，没进 `$GW/scripts/`。Dockerfile 的 `COPY scripts ./scripts` 读到的还是旧目录 | 网关 `scripts/ops/deploy-prod.sh` | `grant-role.mjs`、`import-cases.mjs`、`backfill-archived-images.mjs` **不会进镜像**，第 5 节全部跑不了 | 部署前手工 `rsync -a scripts/ $SRV:$GW/scripts/`（见 §4.2），或者网关仓库修脚本（改成 `scripts`，不带斜杠） |
| B-3 | `deploy-prod.sh` **不同步 `compose.yaml`**，而服务器上的 compose 本来就和仓库不同（服务器上有 lanehub 服务和 `LANEHUB_*`、`R2_CONFIG_FILE` 环境变量，仓库里没有） | 同上 | `mem_limit: 512m → 768m` 不会生效。ffmpeg 处理 8192² PNG 时峰值 389MB，加上 node，512m 下会被 OOM 杀掉 | §2.1 在服务器上手工改 `mem_limit`，**不要**用仓库的 compose.yaml 覆盖 |
| B-4 | 网关 B1–B6、ffmpeg、HeyGen 都还没提交，另一个 agent 还在改 | 网关工作区 | `deploy-prod.sh` 按 HEAD 写 `.deployed-commit`，同步的却是工作区。不提交就部署，漂移检测从下次起就失效 | §1.1 冻结并提交后再部署 |
| B-5 | 本地 `dev` 和 `origin/dev` 已分叉（origin 上有 3 个旧提交 `338621d`/`15db032`/`e70e5d7`，本地没有）。本地 `main` 落后 `origin/main` | 网站仓库 | 直接推会被拒；强推会覆盖远端 | §1.3 先决定怎么处理 |
| B-6 | 设计文档 §7.2-4 写的是「bucket CORS 只允许 PUT」，但素材页的「下载」用 `fetch(urls.orig)` | `src/studio/assets/AssetsView.tsx:60` | 不放 GET，批量下载会退回「只能在新标签打开」 | §2.3 的 CORS 同时放 GET/HEAD（URL 带签名，只读，不扩大暴露面） |

---

## 0 前置条件与授权点

依据网关 `AGENTS.md`：「生产请求、数据库迁移、SSH/部署配置变更、充值扣款及发布需要用户明确授权」「用户未明确要求时不 commit、push、创建 PR 或部署」。

| 授权点 | 涉及步骤 | 为什么需要授权 |
|---|---|---|
| A1 提交与推送（网关、lanehub、网站） | §1 | commit/push 需要明确要求 |
| A2 SSH 到生产机、改服务器上的 compose.yaml | §2.1、§2.2 | SSH/部署配置变更 |
| A3 R2 bucket CORS 变更 | §2.3 | 生产存储配置 |
| A4 lanehub 发布、建 HeyGen 渠道、改价目行 | §2.5 | 动钱（售价） |
| A5 数据库备份、恢复演练、迁移 v18→v23 | §3 | 数据库迁移 |
| A6 网关发布 | §4 | 发布 |
| A7 授予第一个 admin 角色 | §5.1 | 生产写入、权限 |
| A8 导入案例、回填旧归档（写 R2 和数据库） | §5.2、§5.3 | 生产写入 |
| A9 真实环境验证：会产生**真实扣费**的生成（图片、视频、HeyGen 各一单） | §6 | 充值扣款 |
| A10 网站 dev→main 合并（Vercel 会自动发布生产） | §1.3、§7 | 发布 |
| A11 Vercel 切换（打 cutover patch 并合 main） | §7 | 发布 |
| A12 删除旧文件 | §9 | 不可逆 |

前置检查（负责人：执行人，本机即可）：
- [ ] `secret_list` 里有 `ipzsk-prod-server`（SSH）。✅ 已确认存在
- [ ] Cloudflare 令牌：vault 里只有 `cloudflare/api-token-all`，**没有确认它有 R2 Storage:Edit，也没确认它属于 R2 所在账号 `4625b08a63fe2d8151c0df01b6d98490`**。不具备就用 Dashboard，或者新建条目 `cloudflare/r2-edit-ipzsk`
- [ ] HeyGen API 密钥：vault 里只有 `100xspeed/heygen`（100xspeed 项目的）。**缺 ipzsk 专用条目 `ipzsk/heygen-api`**。要不要共用账号由所有者决定
- [ ] Vercel：vault 里没有令牌。切换通过 Git 合并完成，不需要令牌；回滚用 Dashboard 的 Instant Rollback，由所有者登录操作
- [ ] 本机有 Docker buildx（lanehub 要构建 amd64）、`sshpass`、`rsync`
- [ ] 选**低峰时段**：网关每次启动都会跑 `recover()`，在途请求会被标成 `uncertain/process_restarted`（`src/database.mjs:32`）

---

## 1 代码冻结与提交

### 1.1 网关（ipzsk-api-gateway）

**负责人/权限**：做 B1–B6 的 agent 停手以后，由所有者（A1）执行。
**冻结条件**：另一个 agent 报告 ffmpeg 和 HeyGen 完成；`git status` 不再变化。

**先跑测试**（本机，只用 `gateway_test`）：
```sh
cd ~/Code/github/icycat/ipzsk-api-gateway
npm test
TEST_DB_HOST=… TEST_DB_PASSWORD=… npm run test:integration   # 只能连 gateway_test
npm run contracts && git diff --exit-code contracts/          # 契约产物是最新的
```
预期：全部通过；`contracts/` 没有差异。

**建议的提交列表**（按依赖顺序排；`schema.sql` / `app.mjs` / `server.mjs` / `package.json` 是跨模块的装配文件，统一放到最后一个提交。**中间提交只是评审单元，不保证能单独启动**；bisect 只以最后一个提交为准。如果要求每个提交都能跑，就合成 1 个提交，把下表当评审指引用）：

| # | 提交信息 | 文件 |
|---|---|---|
| 1 | `build: 镜像内置静态 ffmpeg 9.0.1；网关 mem_limit 512m→768m（缩略图峰值实测）` | `Dockerfile`, `compose.yaml` |
| 2 | `feat(media): B1 R2 预签名 PUT/HEAD/Range/DELETE/Copy、时间片签名、上传与配额、文件头嗅探、ffmpeg 缩略图队列、统一角色` | `src/r2-storage.mjs`, `src/media-probe.mjs`, `src/media-thumbs.mjs`, `src/uploads.mjs`, `src/roles.mjs`, `src/customer-auth.mjs`, `src/validation.mjs`, `test/uploads.test.mjs`, `test/media.test.mjs`, `test/media-thumbs.test.mjs`, `test/fixtures/{pixel.png,pixel.webp,small.jpg,faststart.mp4,tail-moov.mp4}` |
| 3 | `feat(studio): B2+B3 网页型号目录（lanehub 派生）、批量报价、生成记录/会话/队列/模板/主体/收藏、画布与文件夹接口` | `src/studio.mjs`, `src/library.mjs`, `src/media-references.mjs`, `src/lanehub-catalog.mjs`, `src/lanehub.mjs`, `src/lanehub-charges.mjs`, `src/gateway.mjs`, `src/database.mjs`, `src/media-task-sync.mjs`, `test/studio.test.mjs`, `test/studio-integration.test.mjs` |
| 4 | `feat(cases): B4 案例库导入、公开案例接口、生成结果归档到新 key（含视频/海报/字幕）、archived_images 回填脚本` | `src/cases.mjs`, `src/image-archive.mjs`, `src/image-results.mjs`, `scripts/import-cases.mjs`, `scripts/backfill-archived-images.mjs`, `test/cases.test.mjs`, `test/canvas-cases-integration.test.mjs`, `test/fixtures/cases.manifest.json` |
| 5 | `feat(admin): B5 /api/admin/* 第一批与 grant-role 脚本` | `src/admin-studio.mjs`, `scripts/grant-role.mjs`, `test/admin-integration.test.mjs` |
| 6 | `feat(avatar): 数字人（HeyGen via lanehub）契约映射、音频素材` | `src/avatar-contract.mjs`, `test/avatar.test.mjs`, `test/avatar-integration.test.mjs` |
| 7 | `feat(contracts): B6 契约导出与契约测试` | `src/contracts-schema.mjs`, `scripts/export-contracts.mjs`, `contracts/`, `test/contracts.test.mjs` |
| 8 | `feat(db): schema v18–v23 并装配路由、定时任务与测试脚本` | `src/schema.sql`, `src/app.mjs`, `src/server.mjs`, `package.json` |

（B-2 修复可以另开一个提交：`fix(ops): deploy-prod.sh 同步 scripts 目录本身，不再把内容撒到根目录`。）
**验证**：`git status` 为空；在最后一个提交上 `npm test` 通过；记下 `git rev-parse --short HEAD` = **GW_COMMIT**。
**回滚**：推送前可以 `git reset --soft`；推送后不要改写历史。

### 1.2 lanehub（HeyGen）

**负责人/权限**：所有者（A1）。
```sh
cd ~/Code/github/icycat/lanehub
go test ./providers/heygen/... ./pricing/... ./controller/... ./relay/task/... ./router/...
git add controller/catalog.go controller/quote.go controller/quote_heygen_test.go \
  docs/downstream-api-contract.md docs/ipzsk-integration.md docs/heygen-onboarding.md \
  pricing/catalog.go pricing/params.go pricing/pricing_test.go providers/canonical/canonical.go \
  providers/heygen/ relay/task/normalize.go relay/task/normalize_test.go router/relay-router.go router/relay-router_test.go
git commit -m "feat(heygen): Avatar III 型号与 4.83/0.99 价目、avatars/voices 选择器、按成片时长估算与结算、目录 mode/inputs、错误码中文化"
```
预期：测试通过；`git status` 为空（共 26 个路径）。**验证**：`git show --stat HEAD` 列出 26 个文件。**回滚**：推送前 `git reset --soft HEAD~1`。

### 1.3 网站 dev → main

**负责人/权限**：所有者（A1、A10）。现状：本地 `dev` 比 `main` 多 33 个提交，比 `origin/main` 多 30 个；`origin/dev` 有 3 个本地没有的旧提交（B-5）。**`origin/main` 上没有 `package.json`，生产当前是静态文件**，第一次合并会让 Vercel 第一次执行 `npm run build`（`tsc -b && vite build`）。

步骤：
1. 修 B-1（`isMock` 只在 DEV 生效），提交。
2. 网关提交完成后重新同步契约：`npm run contracts:sync && npm run contracts:check`。`endpoints.json` 的 `_source.commit` 必须等于 **GW_COMMIT**，**不能带 `-dirty`**（现在是 `dde33e4-dirty`）。提交。
3. 本机：`npm ci && npm run typecheck && npm test && npm run build`。预期全部通过，`dist/pages/*.html` 共 5 个。
4. 处理 `origin/dev`：`git log dev..origin/dev` 确认那 3 个提交已经被 `304b146` 取代（它们删掉的 `api/images/generations.js`、`api/tasks.js` 在 dev 上仍然存在，并且旧版 `/image` 还在用），然后二选一：
   - 推到新分支 `git push origin dev:release/studio`，不碰 `origin/dev`（推荐）；或者
   - 所有者确认后执行 `git merge -s ours origin/dev`，再普通推送。
5. 先看 **Vercel Preview**（推分支会自动构建）：在 Preview URL 上跑冒烟：
   `BASE_URL=<preview-url> API_URL=https://api.ipzsk.com node scripts/smoke/prod-smoke.cjs`（这是对生产 API 的只读请求，需要 A9 里的「只读冒烟」授权）。
6. 开 PR `release/studio → main`，合并 **必须在 §4 网关发布之后**。原因：合并后 `/studio`、`/admin` 就会在生产上线（隐藏入口），旧网关没有这些接口，页面会报错。

**预期**：Vercel Production 构建成功；`/`、`/account`、`/developer`、`/workspace`、`/workstation` 仍是旧页面（切换在 §7）。
**验证**：`curl -sI https://www.ipzsk.com/studio` 返回 200 且有 CSP 头；旧页面正常。
**回滚**：Vercel Dashboard → Deployments → 上一个生产部署 → **Instant Rollback**；然后 `git revert -m 1 <merge>` 推到 main。

---

## 2 基础设施准备

### 2.1 服务器内存余量

**负责人/权限**：执行人，A2。主机 2C / 1.9G。
```sh
secretctl secret run ipzsk-prod-server --map password=SSHPASS -- sh -c 'sshpass -e ssh ubuntu@43.135.34.238'
cd /home/ubuntu/api-gateway
nproc; free -m; swapon --show; df -h /
sudo docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.CPUPerc}}'
sudo docker inspect -f '{{.Name}} mem_limit={{.HostConfig.Memory}}' $(sudo docker ps -q)
grep -n 'mem_limit\|^  [a-z]*:$' compose.yaml
diff <(git -C ~/Code/github/icycat/ipzsk-api-gateway show HEAD:compose.yaml) compose.yaml   # 在本机执行，先 scp 服务器的 compose.yaml 下来：看漂移
```
**预期**：gateway 512m（旧）、db 384m、caddy 128m、lanehub（服务器上的值，仓库里没有）。
**判断标准**：`实际 RSS 合计（docker stats）+ 389MB（ffmpeg 最坏峰值）+ 200MB 系统余量 ≤ 1900MB`。算下来不够，就先不开缩略图（不挂 R2 不可行，因为上传依赖 R2），可以在网关仓库把 `MAX_PIXELS_SIDE` 降到 4096（实测峰值 135MB）后再发布，或者给主机加 1G swap。**limit 合计（768+384+128+lanehub）超过物理内存本身不是问题，limit 不是预留；要看的是实际使用。**

**改 mem_limit**（B-3）：
```sh
sudo cp compose.yaml backups/compose.yaml.$(date -u +%Y%m%dT%H%M%SZ)
sudo sed -i '/^  gateway:/,/^  [a-z]*:$/ s/mem_limit: 512m/mem_limit: 768m/' compose.yaml
sudo docker compose config | grep -A0 -n 'mem_limit'
```
**预期**：gateway 这一段显示 `mem_limit: "805306368"`（768m）。生效在 §4 的 `up -d` 重建容器之后。
**验证**：§4 之后 `sudo docker inspect -f '{{.HostConfig.Memory}}' ipzsk-gateway-gateway-1` = `805306368`。
**回滚**：`sudo cp backups/compose.yaml.<stamp> compose.yaml && sudo docker compose up -d gateway`。

### 2.2 镜像体积与 ffmpeg

**负责人/权限**：执行人，本机即可，不需要授权。
```sh
cd ~/Code/github/icycat/ipzsk-api-gateway
docker buildx build --platform linux/amd64 -t ipzsk-gateway:sizecheck --load .
docker image ls ipzsk-gateway:sizecheck
docker run --rm --platform linux/amd64 --entrypoint ffmpeg ipzsk-gateway:sizecheck -hide_banner -protocols | grep -w https
docker run --rm --platform linux/amd64 --entrypoint ffmpeg ipzsk-gateway:sizecheck -hide_banner -encoders | grep libwebp
```
**预期**：镜像比旧版大约多 **+107MB 压缩 / +210MB 解压**（Dockerfile 注释写的）；`https` 协议存在（缩略图要直接读 R2 签名 URL）；`libwebp` 存在（否则会降级成 jpg）。
**服务器磁盘**：`df -h /` 剩余 ≥ 2GB（构建时新旧层会同时存在）；构建后可以 `sudo docker image prune -f`。
**回滚**：不涉及。

### 2.3 R2 bucket CORS

**负责人/权限**：所有者，A3。先查 bucket 名（不输出密钥）：
```sh
sudo docker compose exec -T gateway printenv R2_CONFIG_FILE
sudo docker compose exec -T gateway node -e 'console.log(JSON.parse(require("fs").readFileSync(process.env.R2_CONFIG_FILE,"utf8")).bucket)'
```
预签名 PUT 的 SignedHeaders = `content-length;content-type;cache-control;host`（`src/r2-storage.mjs presignPut`）；浏览器会发 `Content-Type`、`Cache-Control`（`uploads.mjs` 返回的 `headers`），`Content-Length` 由浏览器自己带上。

**Dashboard 版**（R2 → bucket → Settings → CORS Policy → Edit，原样粘贴）：
```json
[
  {
    "AllowedOrigins": ["https://www.ipzsk.com"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["content-type", "content-length", "cache-control"],
    "ExposeHeaders": ["ETag", "Content-Length", "Content-Type"],
    "MaxAgeSeconds": 3600
  }
]
```
**wrangler 版**（`cors.json`）：
```json
{ "rules": [ { "allowed": { "origins": ["https://www.ipzsk.com"], "methods": ["PUT", "GET", "HEAD"], "headers": ["content-type", "content-length", "cache-control"] },
               "exposeHeaders": ["ETag", "Content-Length", "Content-Type"], "maxAgeSeconds": 3600 } ] }
```
```sh
secretctl secret run cloudflare/r2-edit-ipzsk --map token=CLOUDFLARE_API_TOKEN -- \
  sh -c 'CLOUDFLARE_ACCOUNT_ID=4625b08a63fe2d8151c0df01b6d98490 npx wrangler r2 bucket cors set <bucket> --file cors.json && npx wrangler r2 bucket cors list <bucket>'
```
**预期**：`list` 回显上面那条规则。
**验证**（只读预检，不写对象）：
```sh
curl -si -X OPTIONS "https://4625b08a63fe2d8151c0df01b6d98490.r2.cloudflarestorage.com/<bucket>/probe" \
  -H 'Origin: https://www.ipzsk.com' -H 'Access-Control-Request-Method: PUT' -H 'Access-Control-Request-Headers: content-type,cache-control' | grep -i 'access-control'
```
预期出现 `access-control-allow-origin: https://www.ipzsk.com`，allow-methods 里有 PUT。把 Origin 换成其他域名，预期不返回 allow-origin。
**回滚**：`wrangler r2 bucket cors delete <bucket>`，或者在 Dashboard 恢复原策略（改之前先把原策略截图 / `cors list` 的输出保存下来）。

### 2.4 环境变量与密钥

**结论：不需要新增必填变量。** 扫描范围是 `src/` 和 `scripts/*.mjs` 里所有 `process.env.X` / `env.X`，并和 HEAD（`dde33e4`）对比：

| 变量 | 用途 | 状态 |
|---|---|---|
| `PUBLIC_ORIGIN` `PGHOST` `PGPORT` `PGPASSWORD_FILE` `DATABASE_URL` `ADMIN_PASSWORD_FILE` `UPSTREAM_SECRET_DIR` `INITIAL_MODELS` `PORT` | 基础 | 已有 |
| `LANEHUB_BASE_URL` `LANEHUB_ADMIN_TOKEN(_FILE)` `LANEHUB_ACCOUNT_ID` `LANEHUB_USD_CNY` `LANEHUB_QUOTA_PER_UNIT` `LANEHUB_SIGNUP_CNY` | lanehub 模式 | 已有（只在服务器 compose 里） |
| `R2_CONFIG_FILE` | R2。**不配就关掉上传、缩略图、案例接口**（返回 503 `media_storage_unavailable`） | 已有（只在服务器 compose 里），§2.3 先确认有值 |
| `DESKTOP_DEFAULT_MODEL` `SKILL_INVOCATION_WINDOW_MINUTES` | 桌面端、插件 | 已有 |
| `LOCAL_STACK_MODEL` `SMOKE_MODEL` `TEST_DB_*` | 本地脚本、测试 | 与生产无关 |
| **`HEYGEN_UPLOAD_ASSETS`** | **新增，可选**。`=1` 时让 lanehub 走 upload_assets（lanehub 还没实现，PROVISIONAL）。默认关闭 | 生产**不要设置**；只有当 HeyGen 拉预签名 URL 报 `download_failed` 时才评估 |

HeyGen 的密钥放在 lanehub 渠道里，不进网关。
**验证**：`sudo docker compose exec -T gateway sh -c 'for v in R2_CONFIG_FILE LANEHUB_BASE_URL LANEHUB_ACCOUNT_ID LANEHUB_USD_CNY; do printf "%s=%s\n" $v "$(printenv $v | cut -c1-40)"; done'`，四个都要有值（这几个都不是密钥）。

### 2.5 lanehub：发布、HeyGen 渠道、价目

**负责人/权限**：所有者，A4。顺序：**lanehub 先上，网关后上**（网关启动时要拉 `/api/catalog`，见 `deploy-prod.sh` 头注释）。

1. **备份 lanehub（SQLite）**：
   ```sh
   sudo docker compose exec -T lanehub sh -c 'ls -la /data 2>/dev/null; printenv SQLITE_PATH'   # 先确认库文件路径
   sudo docker compose stop lanehub && sudo cp -a <宿主机上的 lanehub 数据目录> backups/lanehub-$(date -u +%Y%m%dT%H%M%SZ) && sudo docker compose start lanehub
   ```
   预期备份目录里有 `.db` 文件。停 lanehub 的这段时间，网关的生成请求会失败，**选低峰**，整个过程 < 30 秒。
2. **构建与发布**（本机构建，服务器构建会 OOM，见 LANEHUB-DEPLOY §1）：
   ```sh
   cd ~/Code/github/icycat/lanehub
   docker buildx build --platform linux/amd64 -t lanehub:prod --load .
   docker save lanehub:prod | gzip | ssh ubuntu@43.135.34.238 'gunzip | sudo docker load'
   ssh … 'cd /home/ubuntu/api-gateway && sudo docker compose up -d lanehub && sudo docker compose ps lanehub'
   ```
   预期 `Up`；`curl -s http://127.0.0.1:3001/api/status` 返回 success。
3. **建 HeyGen 渠道**（SSH 隧道 `ssh -L 3001:127.0.0.1:3001 $SRV`，浏览器打开 http://127.0.0.1:3001 → 渠道 → 新建）：
   类型 **67（HeyGen）**；密钥 = HeyGen API token（vault 缺 `ipzsk/heygen-api`）；Base URL 留空；分组 `official`；**型号白名单只填 `heygen-avatar,heygen-avatar-iii`**；黑名单留空。**只建一条**（选择器固定用 id 最小的那条）。
   ⚠️ 用后台页面保存，不要用 `PUT /api/channel/` 部分字段更新（会把缺的字段写成零值）。
4. **价目行**（设置 → 价目目录，库里的值优先于代码）：
   - `channel_type=67, model=heygen-avatar, size=default`：**4.00 → 4.83**，USD，`per_minute_output`
   - `heygen-avatar-iii`：**0.99**（启动时如果没有这一行会自动播种；确认存在即可）
   - 后台改不了时，用 SQL 兜底（先停 lanehub，改库的**副本**，再换回去；镜像里不一定有 sqlite3，在宿主机上执行）：
     ```sql
     SELECT id, provider_type, model_id, size_name, after_discount, price_currency, billing_unit FROM provider_price_catalog WHERE provider_type=67;
     UPDATE provider_price_catalog SET after_discount=4.83, synced_at=strftime('%s','now') WHERE provider_type=67 AND model_id='heygen-avatar' AND size_name='default' AND after_discount=4.00;
     INSERT INTO provider_price_catalog(provider_type,model_id,size_name,after_discount,original_price,price_currency,billing_unit,raw_json,synced_at)
       SELECT 67,'heygen-avatar-iii','default',0.99,0,'USD','per_minute_output','{"source":"help.heygen.com 2026-09-17 Avatar III"}',strftime('%s','now')
       WHERE NOT EXISTS (SELECT 1 FROM provider_price_catalog WHERE provider_type=67 AND model_id='heygen-avatar-iii' AND size_name='default');
     ```
   - **不录** `heygen-image`、`heygen-video-translate`、`heygen-video-agent`。
5. **验证**：
   ```sh
   sudo docker compose exec -T gateway node -e 'fetch("http://lanehub:3000/api/catalog").then(r=>r.json()).then(d=>console.log(d.data.models.filter(m=>/heygen/.test(m.id)).map(m=>[m.id,m.mode,JSON.stringify(m.billing)])))'
   ```
   预期只出现 `heygen-avatar`（mode avatar）和 `heygen-avatar-iii`，billing 单位是 `per_minute_output`。
6. **lanehub 模式确认**（网关库）：
   ```sh
   sudo docker compose exec -T db psql -U gateway -d gateway -tAc "SELECT key,value FROM app_settings WHERE key='lanehub_mode'; SELECT enabled FROM billing_policy WHERE id=1;"
   ```
   预期 `lanehub_mode|on`、`f`（预扣关闭）。**不是这个结果就停下**，按 LANEHUB-DEPLOY 处理，不要继续往下做。

**回滚**：`sudo docker compose stop lanehub`，把备份目录拷回去，`sudo docker tag <旧镜像 id> lanehub:prod && sudo docker compose up -d lanehub`（发布前先 `sudo docker image ls lanehub` 记下旧镜像 id）；价目改回 4.00；渠道设成禁用。

---

## 3 数据库迁移

迁移没有单独的命令：网关启动时 `db.migrate()` 会整体执行 `src/schema.sql`（幂等）。所以**真正迁移发生在 §4 的 `up -d`**。本节做的是备份、恢复演练和预演。

### 3.1 备份

**负责人/权限**：执行人，A5。
```sh
cd /home/ubuntu/api-gateway
sudo bash ops/backup.sh
ls -la backups | tail -5
```
**预期**：`Database backup created: backups/gateway-<UTC>.dump`，旁边有 `.voucher-key`、`.customer-auth-secret`（600）。
**验证**：脚本内部已经跑过 `pg_restore --list`；再执行 `sudo tar czf backups/src-before-studio-<UTC>.tgz src public ops scripts package.json package-lock.json Dockerfile compose.yaml`。
**回滚**：不涉及（只读）。

### 3.2 恢复演练，同时在真实数据副本上预演 v18–v23

```sh
D=backups/gateway-<UTC>.dump
sudo docker compose exec -T db createdb -U postgres gateway_restore_check
sudo docker compose exec -T db pg_restore -U postgres -d gateway_restore_check --no-owner < $D
sudo docker compose exec -T db psql -U postgres -d gateway_restore_check -tAc "SELECT max(version) FROM schema_version; SELECT count(*) FROM users; SELECT count(*) FROM requests; SELECT count(*) FROM archived_images;"
sudo docker compose exec -T db psql -U gateway -d gateway -tAc "SELECT max(version) FROM schema_version; SELECT count(*) FROM users; SELECT count(*) FROM requests; SELECT count(*) FROM archived_images;"
# 预演：新 schema.sql 在副本上执行两次（本机 scp 过去，或者 §4.2 同步后用 $GW/src/schema.sql）
for i in 1 2; do sudo docker compose exec -T db psql -U postgres -d gateway_restore_check -v ON_ERROR_STOP=1 -q < /tmp/schema-new.sql && echo "run $i ok"; done
sudo docker compose exec -T db psql -U postgres -d gateway_restore_check -tAc "SELECT string_agg(version::text,',' ORDER BY version) FROM schema_version WHERE version>=18"
sudo docker compose exec -T db dropdb -U postgres gateway_restore_check
```
**预期**：副本和生产的计数一致（schema 17）；`run 1 ok`、`run 2 ok`；版本 `18,19,20,21,22,23`。第 2 次执行不报错，就证明幂等。
**回滚**：`dropdb gateway_restore_check`（已经在最后一步）。

### 3.3 要应用的版本

| 版本 | 对象 |
|---|---|
| v18 | 表 `user_roles`；列 `audit_events.actor_user_id` |
| v19 | 表 `media_assets`（含 thumb_* 队列列）、`asset_folders`、`asset_folder_items`；索引 `media_assets_user_recent`、`media_assets_pending`、`media_assets_thumb_due` |
| v20 | 表 `generation_threads`、`generation_records`、`generation_references`、`favorites`、`composer_queues`、`user_templates`、`subjects`、`subject_assets`；索引 `generation_records_{user_recent,thread,active,batch}`、`media_assets_task_result`（唯一）、`user_templates_user`、`subjects_user_name` |
| v21 | 表 `canvas_projects`、`inspiration_cases`、`inspiration_case_references`；索引 `canvas_projects_user_recent`、`inspiration_cases_feed`、`inspiration_cases_all`、`asset_folder_items_asset` |
| v22 | 索引 `generation_records_{recent,model_recent,status_recent}`、`audit_events_actor`、`audit_events_target`；表 `admin_idempotency` |
| v23 | 替换 CHECK：`media_assets_kind_check`（+audio）、`media_assets_content_type_check`（+audio/mpeg、wav）、`subjects_kind_check`（+avatar）；列 `subjects.external_ref` |

所有改动都只增不减。v23 替换 CHECK 时会扫描 `media_assets`，而 v19 之前这张表是空的，所以扫描代价可以忽略。

### 3.4 迁移后的验证 SQL（§4 之后执行）

```sh
sudo docker compose exec -T db psql -U gateway -d gateway -tA <<'SQL'
SELECT 'versions: '||string_agg(version::text,',' ORDER BY version) FROM schema_version WHERE version>=18;
SELECT 'missing tables: '||coalesce(string_agg(t,','),'none') FROM unnest(ARRAY['user_roles','media_assets','asset_folders','asset_folder_items','generation_threads','generation_records','generation_references','favorites','composer_queues','user_templates','subjects','subject_assets','canvas_projects','inspiration_cases','inspiration_case_references','admin_idempotency']) t WHERE to_regclass(t) IS NULL;
SELECT 'audio check: '||(pg_get_constraintdef(oid) LIKE '%audio%') FROM pg_constraint WHERE conname='media_assets_kind_check';
SELECT 'external_ref: '||count(*) FROM information_schema.columns WHERE table_name='subjects' AND column_name='external_ref';
SELECT 'actor col: '||count(*) FROM information_schema.columns WHERE table_name='audit_events' AND column_name='actor_user_id';
SQL
```
**预期**：`versions: 18,19,20,21,22,23`、`missing tables: none`、`audio check: true`、`external_ref: 1`、`actor col: 1`。
**回滚**：schema **只能前进**。回滚代码不回滚 schema，新表留空无害（§16）。只有数据损坏时才从 3.1 的 dump 恢复，而且要单独授权。

---

## 4 网关发布

### 4.1 发布前

- [ ] §1.1 完成，HEAD = GW_COMMIT，工作区干净
- [ ] §2.5 lanehub 已发布，`lanehub_mode=on`
- [ ] §3.1 备份完成、§3.2 预演通过
- [ ] §2.1 服务器 compose 已改成 768m
- [ ] 在途任务数量低：`sudo docker compose exec -T db psql -U gateway -d gateway -tAc "SELECT count(*) FROM requests WHERE status IN ('queued','running')"`（希望是 0）

### 4.2 执行

**负责人/权限**：所有者，A6。
```sh
cd ~/Code/github/icycat/ipzsk-api-gateway
# B-2 绕过：先把 scripts 目录本身同步过去（deploy-prod.sh 会把内容撒到根目录）
secretctl secret run ipzsk-prod-server --map password=SSHPASS -- sh -c \
  'sshpass -e rsync -a --exclude "._*" scripts/ ubuntu@43.135.34.238:/home/ubuntu/api-gateway/scripts/'
secretctl secret run ipzsk-prod-server --map password=SSHPASS --map username=SSH_USER -- scripts/ops/deploy-prod.sh
```
**脚本流程**：建立 SSH 主连接 → 把服务器 `src/` 拉回来，和 `src/.deployed-commit` 对应的提交做 diff（**漂移检测**；不一致就退出，要合并后再来，或者确认后 `FORCE=1`；服务器上从来没有 `.deployed-commit` 时也会要求 `FORCE=1`）→ 写入 `.deployed-commit` 并 rsync `src/` → rsync scripts 内容、package*.json、Dockerfile → `docker compose build gateway` → `up -d gateway` → 等待 healthy（最多 90 秒）→ 检查 `catalog_refresh_failed` → 输出 lanehub 目录的型号数。
**预期输出**：`… gateway … (healthy)`、`无失败日志`、`catalog models: N`（N > 0，包含 heygen 两条）。
⚠️ 如果漂移检测报出服务器上有 git 以外的改动：**停下**，把服务器副本（脚本会打印 `$TMP/src`）合回 git，**不要**直接 FORCE。

### 4.3 健康检查与日志

```sh
curl -fsS https://api.ipzsk.com/healthz                       # {"status":"ok"}
sudo docker compose ps gateway                                # healthy
sudo docker inspect -f '{{.HostConfig.Memory}}' $(sudo docker compose ps -q gateway)   # 805306368
cat src/.deployed-commit                                      # = GW_COMMIT
sudo docker compose exec -T gateway sh -c 'ffmpeg -version | head -1; ls scripts/grant-role.mjs scripts/import-cases.mjs scripts/backfill-archived-images.mjs'
sudo docker compose logs gateway --since 10m 2>&1 | grep -E 'gateway_listening|image_archive_disabled|image_archive_(sync_)?failed|thumbnail_(failed|loop_failed)|lanehub_catalog_refresh_failed|catalog_unavailable|media_cleanup_failed|request_failed|lanehub_charge_sync_failed'
curl -s -o /dev/null -w '%{http_code}\n' https://api.ipzsk.com/api/me/media/models   # 401
curl -s https://api.ipzsk.com/api/public/cases | head -c 200                           # {"items":[],…}（导入之前是空的）
```
**要盯的日志**：

| 日志 | 含义 | 处置 |
|---|---|---|
| `gateway_listening` | 启动完成 | 应该出现 1 次 |
| `image_archive_disabled` | 没有 R2 配置 | **不应该出现**；出现就回滚或补 `R2_CONFIG_FILE` |
| `image_archive_failed` / `image_archive_sync_failed` | 归档失败（含视频、海报） | 偶发可以接受；持续出现就查 R2 凭据和网络 |
| `thumbnail_failed`（带 asset_id、attempt、stderr） | 单个缩略图失败，会退避重试 | 同一资产 5 次后变成 `failed`；大面积出现就看 stderr（https 协议、OOM `exit_SIGKILL`） |
| `thumbnail_loop_failed` | 队列循环本身出错 | 查数据库 |
| `lanehub_catalog_refresh_failed` | 目录拉取失败（保留旧目录） | 启动时出现就会导致 `catalog_unavailable` 503，查 lanehub |
| `lanehub_charge_sync_failed` | 对账失败 | 查 lanehub |
| `request_failed` | 500 | 带 request_id 排查 |

另外执行 §3.4 的验证 SQL。

### 4.4 回滚（只回滚代码）

**负责人/权限**：所有者，A6。
```sh
cd ~/Code/github/icycat/ipzsk-api-gateway
git worktree add /tmp/gw-prev dde33e4          # 上次部署的提交（当前服务器 .deployed-commit 的值，发布前记下来）
cd /tmp/gw-prev && FORCE=1 secretctl secret run ipzsk-prod-server --map password=SSHPASS --map username=SSH_USER -- scripts/ops/deploy-prod.sh
```
或者更快的办法：发布前 `sudo docker tag ipzsk-gateway:local ipzsk-gateway:pre-studio`，回滚时 `sudo tar xzf backups/src-before-studio-<UTC>.tgz && sudo docker tag ipzsk-gateway:pre-studio ipzsk-gateway:local && sudo docker compose up -d --no-build gateway`。
**schema 不回滚**：旧代码不读新表，不受影响。`mem_limit` 可以保留 768m。
**验证**：healthz 返回 200；`/api/me/media/models` 返回 404（旧代码没有这个路由）。网站 `/studio` 会不可用，所以**网站也要回滚到合并前**（§1.3 回滚）。

---

## 5 数据初始化

容器内运行脚本的通用前缀（脚本要求显式 `DATABASE_URL`；口令做 URL 编码，全程不打印）：
```sh
gwrun() { sudo docker compose exec -T gateway sh -c 'export DATABASE_URL="postgres://gateway:$(node -p "encodeURIComponent(require(\"fs\").readFileSync(process.env.PGPASSWORD_FILE,\"utf8\").trim())")@db:5432/gateway"; exec "$@"' sh "$@"; }
```

### 5.1 授予第一个 admin

**负责人/权限**：所有者，A7。
**前提**：(1) §4 完成（v18 已存在）；(2) 管理员已经在 https://www.ipzsk.com/account 用邮箱**注册并登录过一次**（`users` 表里有这一行；邮件验证码依赖 SES，如果仍未开通，要确认现有账号可以密码登录）；(3) 设计上管理员密码 ≥ 16 位（§9.1）；(4) 容器里有 `scripts/grant-role.mjs`（B-2）。
```sh
gwrun node scripts/grant-role.mjs owner@example.com admin
```
**预期**：`granted admin`。`user_not_found` 表示还没注册；`email_ambiguous` 表示有重复邮箱，要人工查。
**验证**：
```sh
sudo docker compose exec -T db psql -U gateway -d gateway -tAc "SELECT u.email,r.role,r.granted_at FROM user_roles r JOIN users u ON u.id=r.user_id"
```
然后浏览器登录，访问 https://www.ipzsk.com/admin 能进入；导航出现「管理中台」。
**回滚**：`gwrun node scripts/grant-role.mjs owner@example.com admin --revoke` → `revoked admin`。

### 5.2 导入案例

**负责人/权限**：所有者，A8。清单 = 网站仓库 `src/studio/inspiration/data/cases.manifest.json`（**561 条，其中 42 条带 template**）。图片来源：521 张在 `gpt-image2.canghe.ai`，5 张在 `raw.githubusercontent.com`，35 张是站内 `/image-studio/assets/style-*`（通过 `--site-origin` 从 www 拉取，**所以 §9 删除 `image-studio/` 必须在导入之后**）。服务器在新加坡，访问 GitHub 应该没问题。
容器是 read_only，`/tmp` 只有 16MB，清单走 stdin 传进去：
```sh
# 本机
scp ~/Code/github/icycat/ipzsk/src/studio/inspiration/data/cases.manifest.json ubuntu@43.135.34.238:/home/ubuntu/api-gateway/backups/cases.manifest.json
# 服务器
gwrun sh -c 'node scripts/import-cases.mjs /dev/stdin --site-origin https://www.ipzsk.com --dry-run' < backups/cases.manifest.json > backups/import-dry.log
grep -c '^create' backups/import-dry.log; tail -1 backups/import-dry.log
gwrun sh -c 'node scripts/import-cases.mjs /dev/stdin --site-origin https://www.ipzsk.com' < backups/cases.manifest.json | tee backups/import-run.log | tail -3
```
**预期**：dry-run 输出 `create` 561 行，最后是 `{"created":0,"updated":0,"unchanged":0,"image_uploaded":0,"failed":0}`（dry-run 不计数）。正式运行最后是 `{"created":561,"updated":0,"unchanged":0,"image_uploaded":561,"failed":0}`（sha 相同的封面会复用，所以 `image_uploaded` 可能略小于 561）。
**失败处理**：`failed>0` 时看 `failed\t<id>\t<原因>`。脚本幂等，直接重跑即可，已完成的会计为 `unchanged`。
**验证**：
```sh
sudo docker compose exec -T db psql -U gateway -d gateway -tAc "SELECT status,count(*) FROM inspiration_cases GROUP BY 1; SELECT count(*) FROM inspiration_cases WHERE template IS NOT NULL; SELECT thumb_state,count(*) FROM media_assets WHERE source='case' GROUP BY 1;"
curl -s 'https://api.ipzsk.com/api/public/case-categories' | head -c 300
```
预期 `published|561`、`42`、`queued|~561`（会逐步变成 done）。
**回滚**：在管理中台批量隐藏（`POST /api/admin/cases/bulk-status` → hidden），或者 SQL `UPDATE inspiration_cases SET status='hidden'`。R2 对象保留，不影响其他数据。

### 5.3 回填旧归档（archived_images → media_assets）

**负责人/权限**：所有者，A8。会**复制** R2 对象到 `u/{user}/{asset}/orig.*`，旧对象保留；可以断点续跑。
```sh
sudo docker compose exec -T db psql -U gateway -d gateway -tAc "SELECT count(*) FROM archived_images"      # 记为 N
gwrun node scripts/backfill-archived-images.mjs --dry-run | tail -3
gwrun node scripts/backfill-archived-images.mjs --limit 50
gwrun node scripts/backfill-archived-images.mjs
```
**预期**：dry-run 输出 `copy\t<旧 key>\t<新 key>` 若干行，最后 `{"copied":0,"failed":0,"planned":N}`；`--limit 50` 输出 `{"copied":50,"failed":0,…}`；全量输出 `copied = N-50`、`failed:0`。
**验证**：
```sh
sudo docker compose exec -T db psql -U gateway -d gateway -tAc "SELECT count(*) FROM media_assets WHERE source='generation' AND task_id IN (SELECT task_id FROM archived_images)"
```
结果应该 = N。随便登录一个有历史记录的**测试账号**，素材页能看到旧图（生产用户数据不要人工翻看）。
`--limit 50` 这一批跑完后，先看 `thumbnail_failed` 日志和 `docker stats` 再跑全量。
**回滚**：新行可以按 `source='generation' AND created_at > <开始时间>` 标记成 deleted；R2 新 key 可以留着，由清理任务处理。旧对象一直没动。

### 5.4 缩略图队列 ETA 与临时提速

- 队列节奏：`server.mjs` 每 5 秒领取 1 个任务（串行；进行中的会跳过这一拍）。**ETA ≥ 任务数 × 5s**：案例 561 个 ≈ **47 分钟**；加上回填 N 个 ≈ `(561+N)×5s`。单张 4K 如果超过 5 秒，实际还会更长。
- 进度：
  ```sh
  sudo docker compose exec -T db psql -U gateway -d gateway -tAc "SELECT thumb_state,count(*) FROM media_assets GROUP BY 1 ORDER BY 1"
  ```
- 临时提速（可选，**只在低峰做**，边跑边 `docker stats` 看内存）：在同一个容器里再开一个循环进程。`FOR UPDATE SKIP LOCKED` 保证不会重复领取。内存上两个 ffmpeg 同时跑，最坏 2×389MB，768m 下有 OOM 风险；案例图片多数小于 4K，一般约 135MB×2：
  ```sh
  gwrun node --input-type=module -e '
    import { databaseFromEnv } from "./src/database.mjs"; import { loadR2Storage } from "./src/r2-storage.mjs"; import { runThumbJobs } from "./src/media-thumbs.mjs";
    const db = await databaseFromEnv(), r2 = await loadR2Storage(process.env.R2_CONFIG_FILE); let n = 0, id;
    const log = { warn: (o, m) => console.error(m, o.asset_id, o.error) };
    while ((id = await runThumbJobs({ db, r2, log })) && n < 400) n++;
    console.log("processed", n); await db.close();'
  ```
  预期最后输出 `processed <n>`；Ctrl-C 可以随时停。被打断的任务靠 5 分钟租约回收，计 1 次尝试。
- 回滚：停掉进程即可。

---

## 6 真实环境验证矩阵

**负责人/权限**：所有者 + 执行人。带 💰 的会产生真实扣费（A9），用**专用验收账号**（验收后停用，参照 DEPLOYMENT.md 惯例），不用真实用户。

| # | 项 | 做法 | 通过标准 |
|---|---|---|---|
| V1 | R2 拒绝大小/类型不符的预签名 PUT | 验收账号登录后在浏览器控制台：`POST /api/me/uploads {kind:'image',content_type:'image/png',bytes:100}` 拿到 `put_url`，分别 PUT (a) 101 字节 (b) `Content-Type: image/jpeg` (c) 正确的 100 字节 PNG | (a)(b) R2 返回 403 `SignatureDoesNotMatch`；(c) 200；随后 `complete` 返回 ready。另外 PUT 一个伪装成 png 的 jpg → `complete` 返回 422 `upload_type_mismatch` |
| V2 | R2 Copy 可用 | §5.3 `--limit 50` 结果 `failed:0`，并且新 key 的签名 URL 能打开 | 50/50 |
| V3 | lanehub 能拉到 R2 签名 URL（参考图）💰 | `/studio` 上传一张参考图，用最便宜的图片型号生成 1 张 | 任务 succeeded，结果体现了参考图；lanehub 日志里没有拉取失败 |
| V4 | 报价 == 实扣（图片）💰 | V3 那单：`POST /api/me/media/quote` 的 points 与 `generation_records.charged_points` 对比 | 相等（8 位小数） |
| V5 | 报价 == 实扣（视频）💰 | 最短时长视频 1 条 | 相等；归档里有 mp4 和 poster |
| V6 | HeyGen 估算与结算 💰 | 按 lanehub `heygen-onboarding.md` §3：`GET /v1/heygen/avatars`、`/voices?language=Chinese` → quote（`amount_kind=estimate`、`estimated_seconds=60`）→ 提交 10 字脚本 → 轮询 | 用户日志里有「按真实成片时长结算：估算 60.0 秒 → 实际 N 秒（退回 …）」；HeyGen 后台扣费和 `charge_cny` 换算一致；再用 `heygen-avatar-iii` 验一单 |
| V7 | HeyGen 列表接口 | 网关侧对应的形象/音色列表接口（契约里的 avatar 目录块）登录后调用 | 非空；私有形象与渠道账号一致 |
| V8 | ffmpeg 缩略图（amd64 生产机） | §5.2 之后看 `thumb_state` | `done` 占绝大多数；`failed`=0 或者可以解释；随机抽一个 `urls.w480` 打开是 webp；V5 的视频有 `poster` |
| V9 | CORS 预检（www） | `prod-smoke.cjs` 的 `cors_preflight *` 项；另外手动 `curl -X OPTIONS -H 'Origin: https://www.ipzsk.com' -H 'Access-Control-Request-Method: PATCH' https://api.ipzsk.com/api/admin/cases/x` | 204，`ACAO=https://www.ipzsk.com`，`ACAC=true`，Methods 包含 `PUT, PATCH, DELETE`，Headers 包含 `Idempotency-Key`；外域返回 403 |
| V10 | 管理员 12 小时会话 | 管理员登录后 12 小时以上再访问 `/admin`（或者在测试库把 `auth_session.created_at` 改早；**生产上不改**） | `GET /api/admin/me` → 401 `admin_session_expired`，前端提示重新登录；`/api/me/*` 仍然可用 |
| V11 | 时间片 URL 稳定 | `prod-smoke.cjs` 的 `signed_url_time_slice_stable`；DevTools 刷新灵感页 | 同一时间片内 URL 相同；图片显示 `(disk cache)` |
| V12 | 契约与部署一致 | `cat $GW/src/.deployed-commit` 对比网站 `src/shared/contracts/generated/endpoints.json` 的 `_source.commit`；本机 `npm run contracts:check` | commit 相同、不带 `-dirty`；check 报 0 漂移；冒烟里的所有 API 路径都不是 404 |
| V13 | mock 在生产无效 | `prod-smoke.cjs` 的 `mock_active` | 不失败（先修 B-1） |
| V14 | 旧桌面端、插件不受影响 | 桌面端登录 bootstrap；`/v1/chat/completions` 一条 | 正常 |

执行冒烟（这是对生产的只读请求，要在 A9 授权后执行）：
```sh
cd ~/Code/github/icycat/ipzsk
node scripts/smoke/prod-smoke.cjs > /tmp/smoke.json; echo "exit=$?"; jq '.failures,.warnings' /tmp/smoke.json
```

---

## 7 网站切换

**负责人/权限**：所有者，A11。前提：§4–§6 通过、B-1 已修。

### 7.1 开关

1. Vercel → Project → Settings → Environment Variables：**Production** 加 `VITE_CASES_SOURCE=api`（这个变量在构建时生效，要重新部署）。Preview 先加，先验证。
   - 验证：`/studio` 灵感页总数不再显示 561（API 模式不返回 total），分类计数来自 `/api/public/case-categories`；DevTools 能看到 `api.ipzsk.com/api/public/cases` 请求。
   - 回滚：删掉这个变量并 Redeploy（回到静态清单）。
2. mock：`isMock` 必须只在 DEV 生效（B-1）。验证：生产上 `prod-smoke.cjs` 不报 `mock_active`；另外用 `grep -o "get(\"mock\")" dist/assets/*.js` 检查生产构建里有没有这个判断（修复后 Vite 会把 `import.meta.env.DEV` 常量折叠掉，这段代码应该消失或者变成死代码）。

### 7.2 vercel.json 切换（patch）

文件：`docs/cutover/vercel-cutover.patch`（正向），`docs/cutover/vercel-rollback.patch`（反向）。内容：
- rewrites：`/` → `/dist/pages/home.html`；`/account`、`/developer`、`/workspace`、`/workstation` → `/dist/pages/*.html`；删除 `/image`、`/video` rewrites。
- redirects（307，非永久）：`/image`、`/image.html` → `/studio?kind=image`；`/video`、`/video.html` → `/studio?kind=video`；`/index.html`、`/account.html`、`/developer.html`、`/workspace.html`、`/workstation.html` → 对应的干净路径。
- CSP：`/account`、`/developer`、`/account.html`、`/workspace(.*)` 改成和 `/studio`、`/next/*` 相同的策略（`style-src 'self' 'unsafe-inline'`，R2 的 img/media/connect）。新增 `/dist/pages/(.*)` 头（no-store + 同样的 CSP）。理由：Radix（Dialog 的 react-remove-scroll 等）会注入 `<style>` 和内联样式，旧的 `style-src 'self'` 会拦下来；`/next/*` 预览已经在这套策略下跑过。只加 `style-src-attr 'unsafe-inline'` 不够，因为拦不住的是 `<style>` 元素（style-src-elem）。
- `.vercelignore` 加 `/index.html`：**Vercel 的文件系统优先于 rewrites**，根目录的旧 `index.html` 还在，`/` 就永远不会走 rewrite。
- `/next/*` 预览先保留，方便对照。

**本地验证已经做过**（见最终报告）：`git apply --check` 通过；应用后 JSON 能解析；反向 patch 恢复后字节一致；在本地 vercel.json 模拟器 + 生产构建上跑冒烟，页面全部 200、CSP 违规为 0。

执行：
```sh
cd ~/Code/github/icycat/ipzsk
git checkout -b cutover/pages main
git apply --check docs/cutover/vercel-cutover.patch && git apply docs/cutover/vercel-cutover.patch
node -e 'JSON.parse(require("fs").readFileSync("vercel.json","utf8"))' && git commit -am "feat(site): 首页/账户/开发者/内容工作台/下载页切到新构建；/image、/video 跳转工作台"
git push origin cutover/pages      # 先看 Preview
BASE_URL=<preview-url> node scripts/smoke/prod-smoke.cjs
```

### 7.3 导航合并

新页面统一用 `src/studio/SiteHeader.tsx`：`首页 · 下载`、`创作工作台`、`内容工作台`，外加有角色时显示的「管理中台」。旧 `site-nav.js` 里的「生图」「生视频」随切换消失，入口改为 `/studio?kind=`。切换后检查：所有新页面顶栏一致；`/workspace` 里「去生图」打开的是 `/studio`（`src/pages/workspace/views/Images.tsx`）。

### 7.4 分阶段顺序

| 阶段 | 内容 | 观察时长 | 回滚 |
|---|---|---|---|
| S0 | §1.3 合 main（`/studio`、`/admin` 作为隐藏入口上线），`VITE_CASES_SOURCE` 仍是静态 | 24h | Instant Rollback |
| S1 | 生产开启 `VITE_CASES_SOURCE=api` 并 Redeploy | 24h | 删变量，Redeploy |
| S2 | 合 `cutover/pages`（patch） | 48h | 见下 |
| S3 | 旧代码保留两周（§16）→ §9 清理 | — | — |

**S2 回滚**（2 分钟内）：Vercel Instant Rollback 到 S1 的部署；然后 `git apply docs/cutover/vercel-rollback.patch && git commit -am "revert: 页面切换回旧版" && push`（或者 `git revert <cutover commit>`）。验证：`curl -s https://www.ipzsk.com/ | grep -o '<title>[^<]*'` = `IPZSK · 桌面客户端下载`；`curl -sI https://www.ipzsk.com/image` = 200。

**S2 验证**：
```sh
for p in / /account /developer /workspace /workstation; do printf '%s ' $p; curl -s https://www.ipzsk.com$p | grep -o '/dist/assets/[^"]*\.js' | head -1; done
curl -sI https://www.ipzsk.com/image | grep -i '^location'    # /studio?kind=image
curl -sI https://www.ipzsk.com/video | grep -i '^location'    # /studio?kind=video
curl -sI https://ipzsk.com/ | grep -i '^location'             # https://www.ipzsk.com/
node scripts/smoke/prod-smoke.cjs
```
再用浏览器手动走一遍：登录 → 账户页打开充值弹窗（Radix Dialog，确认 DevTools 没有 CSP 报错）→ 开发者中心 → 下载页。

---

## 8 上线后观察（§16）

**前 24 小时清单**（负责人：执行人；时间点 +1h / +4h / +24h）：
- [ ] `sudo docker compose ps`：全部 healthy；`docker stats`：gateway 峰值 < 700MB，主机 `free -m` available > 200MB，没有 OOM（`sudo dmesg -T | grep -i oom`）
- [ ] 错误日志计数：
  ```sh
  sudo docker compose logs gateway --since 1h 2>&1 | grep -oE 'thumbnail_failed|thumbnail_loop_failed|image_archive_failed|lanehub_catalog_refresh_failed|lanehub_charge_sync_failed|request_failed|media_cleanup_failed' | sort | uniq -c
  ```
- [ ] 上传成功率与耗时：
  ```sql
  SELECT status,count(*) FROM media_assets WHERE source='upload' AND created_at>now()-interval '24 hours' GROUP BY 1;   -- failed/pending 占比
  ```
- [ ] 缩略图：`SELECT thumb_state,count(*) FROM media_assets GROUP BY 1;`，`failed` 的 `thumb_error` 按前缀分布
- [ ] quote 与实扣差异（每日）：`SELECT model,count(*),sum(charged_points) FROM generation_records WHERE created_at>now()-interval '24 hours' AND status='succeeded' GROUP BY 1;` 对照 lanehub 日志的报价，HeyGen 看结算日志「退回 / 补扣」
- [ ] 生成失败按错误码：`SELECT failure_code,count(*) FROM generation_records WHERE created_at>now()-interval '24 hours' AND status='failed' GROUP BY 1 ORDER BY 2 DESC;`（重点看 `process_restarted`、`video_result_missing`、`download_failed`）
- [ ] 签名 URL 过期问题：浏览器端 R2 403 目前没有服务端指标，从用户反馈和 `prod-smoke` 的 `public_cases_signed_urls` 看（跨时间片边界时重跑一次）
- [ ] 限流：日志 / 响应里 `rate_limited`、`too_many_active` 的出现情况
- [ ] 在途卡住的记录：`SELECT count(*) FROM generation_records WHERE status IN ('queued','running') AND updated_at<now()-interval '30 minutes';` = 0
- [ ] 待清理：`SELECT count(*) FROM media_assets WHERE status='pending' AND created_at<now()-interval '24 hours';` 应该被清理循环消化
- [ ] Vercel：Functions 日志没有异常；Analytics 404 没有突增（旧链接）
- [ ] HeyGen 余额（lanehub 后台「查余额」）；lanehub 渠道没有被自动禁用
- [ ] 备份：次日 03:15 的 systemd 备份文件已生成（`ls -la backups | tail -3`）

---

## 9 遗留清理

**负责人/权限**：所有者，A12。**条件**：S2 稳定满 **14 天**（§16「旧页面代码保留两周」），并且 Vercel 日志里对应路径 / 函数 14 天没有访问。另开 PR，逐项 `git rm`。

**S2 + 14 天后可以删除**（旧页面，调用关系已核对）：
- `index.html`（同时把 `.vercelignore` 里的 `/index.html` 删掉）、`home-downloads.js`、`home-downloads.css`、`home-account.js`
- `account.html`、`account.js`、`account.css`、`auth-ui.js`、`captcha-ui.js`、`recharge.js`、`recharge.css`、`points-wallet.js`
- `developer.html`、`developer.js`、`developer.css`、`api.js`
- `workspace.html`、`workspace.js`、`workspace.css`
- `workstation.html`、`workstation.js`、`workstation.css`
- `image.html`、`video.html`、`video.css`
- `site-nav.js`、`site-nav.css`
- `image-library.js`、`image-library.css`、`image-library-i18n.css`（仓库里没有引用）
- `lib/gateway.js`、`workstation-release.json`（没有引用）
- `dev-server.mjs`（已被 Vite 代理取代；同时删 `vite.config.ts` 注释里对它的引用）
- `tests/captcha-ui.test.mjs`、`tests/points-wallet.test.mjs`、`tests/recharge.test.mjs`（测的是上面删掉的文件）
- vercel.json：`/account.html` 的 headers 条目；`/next/*` 的 rewrite 和 headers（到时候预览已经没有意义）

**另外满足条件后再删**：
- Vercel 函数 `api/image-prompt.js`、`api/image-result.js`、`api/tasks.js`、`api/images/generations.js`、`api/prompts/translate.js`、`api/v1/chat/`、`api/videos/generations.js`、`api/videos/tasks.js` 以及 `test/chat-completions.test.js`、`test/video-api.test.js`：它们只服务于旧 `/image`、`/video`（`image-studio/assets/*.js`）。条件：Vercel Functions 日志 14 天调用为 0。**保留** `api/desktop-release.js` 和 `tests/desktop-release.test.cjs`（新首页和下载页在用）。
- `image-studio/` 整个目录：条件是 (1) §5.2 导入完成（35 张站内原图已经进 R2）；(2) 生产 `VITE_CASES_SOURCE=api` 稳定 14 天。同时删掉静态清单回退：`scripts/build-cases-manifest.mjs`（读 `image-studio/assets/catalog.json`）、`src/studio/inspiration/data/cases.manifest.json` 以及 `inspiration/api.ts` 里的 manifest 分支。注意 `THIRD_PARTY_NOTICES` 和 dsh-imagegen NOTICE（§14）。
- `.vercelignore` 里 `image-studio/*` 那几行随目录一起删。

**不删**：`media-demo.html`（开发用演示页）、`studio.html`、`admin.html`、`pages/`、`assets/`、`IPZSK_logo_exact.svg`、`docs/`。

**验证**：`npm run build && npm test && npm run contracts:check` 通过；Preview 上跑 `prod-smoke.cjs` 通过；`grep -rn "site-nav\|/api.js\|recharge.js" --exclude-dir=node_modules .` 没有结果。
**回滚**：`git revert <清理提交>`。
