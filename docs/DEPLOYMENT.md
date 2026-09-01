# ipzsk 图片生成网站部署方案

## 1．部署目标

上线后完成下面这条流程：

1. 用户打开 `https://ipzsk.com`。
2. 用户注册并登录。
3. 用户点击“充值”进入 AllValue 商店购买 ¥10 充值商品。
4. AllValue 在支付完成后发放兑换码。
5. 用户返回 ipzsk，输入兑换码。
6. 账户余额增加 ¥10，即 `1000` 分。
7. 用户每生成一张图片，扣除 `25` 分，即 ¥0.25。
8. 生成失败时，系统自动退回 `25` 分。
9. 用户可以查看余额、充值记录、消费记录和图片生成记录。
10. 管理员可以生成兑换码、撤销兑换码、调整余额和查看账目。

---

## 2．整体架构

```text
中国用户
   │
   ▼
ipzsk.com
   │
   ▼
腾讯云新加坡 Lighthouse
   │
   ├── Caddy
   │     ├── 提供前端页面
   │     ├── 自动申请 HTTPS 证书
   │     └── 转发 API 请求
   │
   ├── ipzskd
   │     ├── 用户注册和登录
   │     ├── 兑换码处理
   │     ├── 钱包和账单
   │     ├── 图片生成任务
   │     └── PocketBase 数据库
   │
   └── APIMart API
         └── 实际生成图片

AllValue 商店
   │
   ├── 用户支付 ¥10
   └── 发放 1 个 ¥10 兑换码
```

前端、后端和数据库部署在同一台腾讯云新加坡服务器。

APIMart 密钥只保存在后端。浏览器不接触密钥。

---

## 3．服务器配置

购买腾讯云 Lighthouse：

| 项目   | 配置               |
| ---- | ---------------- |
| 地域   | Singapore        |
| 系统   | Ubuntu 24.04 LTS |
| CPU  | 2 vCPU           |
| 内存   | 4GB              |
| 系统盘  | 60GB SSD         |
| 公网带宽 | 30Mbps           |
| 月流量  | 1536GB           |
| 公网地址 | 独立 IPv4          |
| 数量   | 1 台              |

腾讯云当前文档列出的新加坡 Linux Starter 套餐是 2 核、4GB、60GB、30Mbps、1536GB 月流量，标价为每月 $6。购买价格和续费价格以控制台显示为准。[腾讯云 Lighthouse 套餐价格](https://www-sg.tencentcloud.com/ind/document/product/1103/47794)

第一阶段不购买额外的云数据库、对象存储、负载均衡器和 CDN。

---

## 4．域名和 DNS

使用下面三个地址：

| 地址                      | 用途       |
| ----------------------- | -------- |
| `https://ipzsk.com`     | 用户网站     |
| `https://www.ipzsk.com` | 自动跳转到主域名 |
| `https://api.ipzsk.com` | 后端 API   |

DNS 配置：

| 类型    | 主机记录  | 记录值         | TTL |
| ----- | ----- | ----------- | --- |
| A     | `@`   | `SERVER_IP` | 300 |
| CNAME | `www` | `ipzsk.com` | 300 |
| A     | `api` | `SERVER_IP` | 300 |

上线稳定后，将 TTL 调整为 `600` 或 `3600`。

服务器位于新加坡，不属于中国大陆服务器。中国大陆 ICP 备案要求针对解析到中国大陆服务器的网站。[腾讯云 ICP 备案说明](https://www-sg.tencentcloud.com/document/product/1145/46435)

---

## 5．代码目录

将当前单个约 31MB 的 `index.html` 拆分为下面的结构：

```text
ipzsk/
├── frontend/
│   ├── index.html
│   └── assets/
│       ├── css/
│       │   └── app.css
│       ├── js/
│       │   ├── app.js
│       │   ├── auth.js
│       │   ├── wallet.js
│       │   ├── generation.js
│       │   └── api.js
│       ├── data/
│       │   └── styles.json
│       └── images/
│           ├── logo/
│           └── styles/
│
├── backend/
│   ├── go.mod
│   ├── go.sum
│   ├── main.go
│   ├── migrations/
│   └── internal/
│       ├── auth/
│       ├── admin/
│       ├── wallet/
│       ├── redeem/
│       ├── generation/
│       ├── provider/
│       ├── security/
│       └── reconciliation/
│
├── deploy/
│   ├── Caddyfile
│   ├── ipzsk.service
│   ├── deploy.sh
│   ├── backup.sh
│   └── restore.sh
│
├── docs/
│   ├── DEPLOYMENT.md
│   ├── OPERATIONS.md
│   └── RESTORE.md
│
├── .env.example
├── .gitignore
└── README.md
```

前端处理要求：

- HTML、CSS 和 JavaScript 不再内嵌大图片。
- 图片转换为 WebP。
- 普通样式预览图控制在 `50KB－150KB`。
- 首屏资源控制在 `2MB` 以内。
- 非首屏图片使用懒加载。
- 静态文件名加入内容 hash。
- 不在前端代码中保存 APIMart API Key。
- 删除用户在浏览器填写 API Key 的入口。

---

## 6．服务器初始化

### 6.1 登录服务器

```bash
ssh ubuntu@SERVER_IP
```

### 6.2 更新系统

```bash
sudo apt update
sudo apt full-upgrade -y
sudo timedatectl set-timezone UTC
```

### 6.3 创建部署账户

```bash
sudo adduser --disabled-password --gecos "" deploy
sudo usermod -aG sudo deploy

sudo install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
echo "ENGINEER_SSH_PUBLIC_KEY" | sudo tee /home/deploy/.ssh/authorized_keys
sudo chown deploy:deploy /home/deploy/.ssh/authorized_keys
sudo chmod 600 /home/deploy/.ssh/authorized_keys
```

在另一个终端确认可以登录：

```bash
ssh deploy@SERVER_IP
```

确认成功后，写入 SSH 配置：

```bash
sudo tee /etc/ssh/sshd_config.d/99-ipzsk.conf >/dev/null <<'EOF'
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
AllowUsers deploy
EOF

sudo sshd -t
sudo systemctl restart ssh
```

### 6.4 配置防火墙

腾讯云控制台防火墙：

| 端口   | 来源               | 用途         |
| ---- | ---------------- | ---------- |
| 22   | `ENGINEER_IP/32` | SSH        |
| 80   | `0.0.0.0/0`      | HTTP 和证书签发 |
| 443  | `0.0.0.0/0`      | HTTPS      |
| 8090 | 不开放              | 后端内部端口     |

服务器防火墙：

```bash
sudo apt install -y ufw fail2ban unattended-upgrades

sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from ENGINEER_IP to any port 22 proto tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

PocketBase 的 `8090` 端口只监听 `127.0.0.1`。

### 6.5 创建交换空间

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### 6.6 创建运行目录

```bash
sudo useradd --system --home /var/lib/ipzsk --shell /usr/sbin/nologin ipzsk

sudo mkdir -p /srv/ipzsk/releases
sudo mkdir -p /srv/ipzsk/shared
sudo mkdir -p /var/lib/ipzsk/pb_data
sudo mkdir -p /var/lib/ipzsk/uploads
sudo mkdir -p /var/backups/ipzsk
sudo mkdir -p /etc/ipzsk
sudo mkdir -p /var/log/ipzsk

sudo chown -R ipzsk:ipzsk /var/lib/ipzsk
sudo chown -R ipzsk:ipzsk /var/backups/ipzsk
sudo chown -R deploy:deploy /srv/ipzsk
sudo chmod 750 /etc/ipzsk
```

---

## 7．安装 Caddy

使用 Caddy 官方 Ubuntu 软件源：

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl gpg

curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg

curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list

sudo chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg
sudo chmod o+r /etc/apt/sources.list.d/caddy-stable.list

sudo apt update
sudo apt install -y caddy
```

安装方式来自 [Caddy 官方安装文档](https://caddyserver.com/docs/install)。

---

## 8．Caddy 配置

写入 `/etc/caddy/Caddyfile`：

```caddyfile
{
	email ADMIN_EMAIL
	admin 127.0.0.1:2019
}

www.ipzsk.com {
	redir https://ipzsk.com{uri} permanent
}

ipzsk.com {
	root * /srv/ipzsk/current/frontend

	encode zstd gzip

	@static path /assets/*
	header @static Cache-Control "public, max-age=31536000, immutable"

	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options "nosniff"
		X-Frame-Options "DENY"
		Referrer-Policy "no-referrer"
		Permissions-Policy "camera=(), microphone=(), geolocation=()"
		Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob: https:; connect-src 'self' https://api.ipzsk.com; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
	}

	try_files {path} /index.html
	file_server

	log {
		output file /var/log/caddy/ipzsk-access.log {
			roll_size 20MiB
			roll_keep 14
		}
		format json
	}
}

api.ipzsk.com {
	encode zstd gzip

	@admin path /_/*
	respond @admin 404

	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options "nosniff"
		X-Frame-Options "DENY"
		Referrer-Policy "no-referrer"
		Cache-Control "no-store"
	}

	reverse_proxy 127.0.0.1:8090 {
		health_uri /healthz
		health_interval 30s
		health_timeout 5s
	}

	log {
		output file /var/log/caddy/ipzsk-api-access.log {
			roll_size 20MiB
			roll_keep 14
		}
		format json
	}
}
```

检查并启动：

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
sudo systemctl enable caddy
sudo systemctl status caddy
```

Caddy 会自动申请和续期 HTTPS 证书。静态文件和反向代理的配置分别使用 Caddy 的 [file\_server](https://caddyserver.com/docs/caddyfile/directives/file_server) 和 [reverse\_proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)。

---

## 9．后端运行方式

后端使用 Go 编写，将 PocketBase 嵌入自定义程序。固定 PocketBase 版本，不使用自动浮动版本。

PocketBase 当前 Go 文档版本为 `v0.40.1`，支持作为 Go Framework 嵌入应用。[PocketBase Go Framework](https://pocketbase.io/docs/go-overview/)

后端监听：

```text
127.0.0.1:8090
```

运行文件：

```text
/srv/ipzsk/current/backend/ipzskd
```

数据目录：

```text
/var/lib/ipzsk/pb_data
```

---

## 10．环境变量

创建 `/etc/ipzsk/ipzsk.env`：

```env
APP_ENV=production
APP_URL=https://ipzsk.com
API_URL=https://api.ipzsk.com
HTTP_ADDR=127.0.0.1:8090

PB_DATA_DIR=/var/lib/ipzsk/pb_data
PB_ENCRYPTION_KEY=GENERATED_32_BYTE_SECRET

SESSION_SIGNING_KEY=GENERATED_32_BYTE_SECRET
CSRF_SIGNING_KEY=GENERATED_32_BYTE_SECRET
REDEEM_CODE_PEPPER=GENERATED_32_BYTE_SECRET
REDEEM_CODE_ENCRYPT_KEY=GENERATED_32_BYTE_SECRET

APIMART_BASE_URL=https://api.apimart.ai/v1
APIMART_API_KEY=APIMART_SECRET
APIMART_MODEL=gpt-image-2

IMAGE_PRICE_FEN=25
RECHARGE_10_VALUE_FEN=1000

ALLOWED_ORIGINS=https://ipzsk.com,https://www.ipzsk.com
MAX_UPLOAD_BYTES=3145728
MAX_CONCURRENT_GENERATIONS_PER_USER=2
```

生成密钥：

```bash
openssl rand -base64 48
```

设置权限：

```bash
sudo chown root:ipzsk /etc/ipzsk/ipzsk.env
sudo chmod 640 /etc/ipzsk/ipzsk.env
```

`.gitignore` 必须包含：

```gitignore
.env
.env.*
!.env.example
pb_data/
backups/
*.sqlite
*.db
```

---

## 11．systemd 服务

写入 `/etc/systemd/system/ipzsk.service`：

```ini
[Unit]
Description=ipzsk application
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ipzsk
Group=ipzsk
WorkingDirectory=/srv/ipzsk/current/backend
EnvironmentFile=/etc/ipzsk/ipzsk.env

ExecStart=/srv/ipzsk/current/backend/ipzskd serve \
  --http=127.0.0.1:8090 \
  --dir=/var/lib/ipzsk/pb_data

Restart=always
RestartSec=5
TimeoutStartSec=30
TimeoutStopSec=30

NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=/var/lib/ipzsk /var/log/ipzsk /var/backups/ipzsk
LockPersonality=true
RestrictSUIDSGID=true
RestrictRealtime=true
MemoryDenyWriteExecute=true

LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
```

启动服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable ipzsk
sudo systemctl start ipzsk
sudo systemctl status ipzsk
```

查看日志：

```bash
sudo journalctl -u ipzsk -f
```

---

## 12．数据库设计

所有金额都使用整数“分”保存。

```text
¥10.00 = 1000 fen
¥0.25 = 25 fen
```

不使用浮点数保存金额。

### 12.1 `users`

PocketBase Auth Collection。

字段：

| 字段             | 类型       | 说明               |
| -------------- | -------- | ---------------- |
| `email`        | email    | 登录邮箱             |
| `password`     | password | 密码 hash          |
| `display_name` | text     | 显示名称             |
| `status`       | select   | active、suspended |
| `created`      | datetime | 创建时间             |
| `updated`      | datetime | 更新时间             |

密码至少 `10` 位。

### 12.2 `wallets`

| 字段            | 类型       | 说明   |
| ------------- | -------- | ---- |
| `user_id`     | relation | 用户   |
| `balance_fen` | integer  | 当前余额 |
| `version`     | integer  | 并发控制 |
| `updated`     | datetime | 更新时间 |

约束：

```text
UNIQUE(user_id)
```

### 12.3 `wallet_ledger`

这张表保存每一笔余额变化，不允许修改历史记录。

| 字段                   | 类型       |
| -------------------- | -------- |
| `user_id`            | relation |
| `type`               | select   |
| `delta_fen`          | integer  |
| `balance_before_fen` | integer  |
| `balance_after_fen`  | integer  |
| `reference_type`     | text     |
| `reference_id`       | text     |
| `idempotency_key`    | text     |
| `description`        | text     |
| `created`            | datetime |

`type`：

```text
redemption
generation_charge
generation_refund
admin_adjustment
order_refund
```

约束：

```text
UNIQUE(idempotency_key)
INDEX(user_id, created)
INDEX(reference_type, reference_id)
```

### 12.4 `redemption_products`

| 字段          | 示例               |
| ----------- | ---------------- |
| `sku`       | `PUNK-CREDIT-10` |
| `title`     | `¥10 图片额度`       |
| `value_fen` | `1000`           |
| `active`    | `true`           |

### 12.5 `redemption_codes`

| 字段                  | 说明            |
| ------------------- | ------------- |
| `code_hash`         | 兑换码 HMAC hash |
| `code_ciphertext`   | 加密后的原始兑换码     |
| `sku`               | 商品 SKU        |
| `value_fen`         | 充值金额          |
| `status`            | 状态            |
| `allvalue_order_no` | AllValue 订单号  |
| `issued_email`      | 收货邮箱          |
| `issued_at`         | 发放时间          |
| `redeemed_user_id`  | 兑换用户          |
| `redeemed_at`       | 兑换时间          |
| `expires_at`        | 过期时间          |
| `created`           | 创建时间          |

状态：

```text
created
issued
redeemed
revoked
expired
```

约束：

```text
UNIQUE(code_hash)
UNIQUE(allvalue_order_no) WHERE allvalue_order_no IS NOT NULL
```

### 12.6 `generation_jobs`

| 字段                  | 说明            |
| ------------------- | ------------- |
| `user_id`           | 用户            |
| `idempotency_key`   | 防止重复提交        |
| `cost_fen`          | 固定为 25        |
| `status`            | 任务状态          |
| `provider_task_id`  | APIMart 任务 ID |
| `style_id`          | 风格            |
| `ratio`             | 图片比例          |
| `prompt_hash`       | 提示词 hash      |
| `result_url`        | 成品地址          |
| `error_code`        | 错误代码          |
| `charged_ledger_id` | 扣款记录          |
| `refund_ledger_id`  | 退款记录          |
| `created`           | 创建时间          |
| `completed_at`      | 完成时间          |

状态：

```text
created
charged
submitted
processing
completed
failed
refunded
provider_unknown
```

约束：

```text
UNIQUE(user_id, idempotency_key)
UNIQUE(provider_task_id) WHERE provider_task_id IS NOT NULL
INDEX(user_id, created)
INDEX(status, created)
```

### 12.7 `admin_audit`

记录管理员操作：

```text
管理员
操作类型
操作对象
修改前内容
修改后内容
IP
时间
```

### 12.8 `reconciliation_runs`

记录每天的余额和账单核对结果。

---

## 13．账户系统

前端提供：

- 注册。
- 登录。
- 退出登录。
- 修改密码。
- 查看账户信息。
- 查看余额。
- 查看账单。
- 查看图片生成记录。

登录成功后，由后端设置 Cookie：

```text
HttpOnly
Secure
SameSite=Lax
Path=/
```

所有修改数据的请求必须带 CSRF Token。

浏览器不得把登录令牌写入 `localStorage`。

管理员后台不开放到公网。管理员通过 SSH 隧道访问：

```bash
ssh -L 8090:127.0.0.1:8090 deploy@SERVER_IP
```

然后打开：

```text
http://127.0.0.1:8090/_/
```

PocketBase 自定义路由和认证中间件可以直接挂在 Go 应用中。[PocketBase 路由文档](https://pocketbase.io/docs/go-routing/)

---

## 14．用户 API

### 14.1 注册

```http
POST /v1/auth/register
Content-Type: application/json
```

```json
{
  "email": "USER_EMAIL",
  "password": "USER_PASSWORD"
}
```

### 14.2 登录

```http
POST /v1/auth/login
Content-Type: application/json
```

```json
{
  "email": "USER_EMAIL",
  "password": "USER_PASSWORD"
}
```

### 14.3 退出

```http
POST /v1/auth/logout
X-CSRF-Token: CSRF_TOKEN
```

### 14.4 当前账户

```http
GET /v1/me
```

返回：

```json
{
  "id": "USER_ID",
  "email": "USER_EMAIL",
  "balance_fen": 1000,
  "balance_text": "¥10.00"
}
```

### 14.5 查询余额

```http
GET /v1/me/balance
```

### 14.6 查询账单

```http
GET /v1/me/ledger?cursor=CURSOR&limit=20
```

### 14.7 兑换充值码

```http
POST /v1/redeem
Content-Type: application/json
X-CSRF-Token: CSRF_TOKEN
```

```json
{
  "code": "PUNK10-XXXX-XXXX-XXXX"
}
```

成功返回：

```json
{
  "credited_fen": 1000,
  "balance_fen": 1000,
  "balance_text": "¥10.00"
}
```

### 14.8 创建图片

```http
POST /v1/generations
Idempotency-Key: RANDOM_UUID
X-CSRF-Token: CSRF_TOKEN
Content-Type: multipart/form-data
```

字段：

```text
style_id
prompt
subtitle
platform
ratio
mood
reference_image
```

成功返回：

```json
{
  "job_id": "JOB_ID",
  "status": "submitted",
  "cost_fen": 25,
  "balance_fen": 975
}
```

### 14.9 查询任务

```http
GET /v1/generations/JOB_ID
```

### 14.10 查询历史

```http
GET /v1/generations?cursor=CURSOR&limit=20
```

---

## 15．统一错误格式

```json
{
  "error": {
    "code": "INSUFFICIENT_BALANCE",
    "message": "余额不足，请先充值。",
    "request_id": "REQUEST_ID"
  }
}
```

主要状态码：

| 状态码 | 使用场景         |
| --- | ------------ |
| 400 | 请求格式错误       |
| 401 | 未登录          |
| 402 | 余额不足         |
| 403 | 账户被停用        |
| 409 | 兑换码已使用或请求重复  |
| 413 | 图片超过大小限制     |
| 422 | 参数不符合要求      |
| 429 | 请求频率过高       |
| 502 | APIMart 返回错误 |
| 503 | 服务暂时不可用      |

---

## 16．兑换码逻辑

### 16.1 兑换码格式

```text
PUNK10-XXXX-XXXX-XXXX
```

要求：

- 使用密码学安全随机数生成。
- 不使用连续数字。
- 去掉容易混淆的字符，例如 `0`、`O`、`1`、`I`。
- 每个兑换码至少包含 `80 bit` 随机熵。
- 数据库主要保存 HMAC hash。
- 原始兑换码加密后保存，用于 AllValue 库存导出。

### 16.2 兑换事务

```text
1．去掉空格并转换为大写。
2．计算 HMAC hash。
3．开始数据库事务。
4．查询兑换码。
5．检查状态是否为 created 或 issued。
6．检查是否过期。
7．把状态改为 redeemed。
8．读取用户钱包。
9．钱包增加 1000 分。
10．写入 wallet_ledger。
11．提交事务。
12．返回新余额。
```

如果任何一步失败，整个事务回滚。

同一个兑换码只能兑换一次。

同一个请求重复提交时，根据幂等键返回第一次结果，不重复充值。

PocketBase 事务内部必须继续使用事务对象，避免事务外写入。[PocketBase Records 和事务](https://pocketbase.io/docs/go-records/)

---

## 17．扣款和生成逻辑

### 17.1 创建任务

```text
1．检查用户登录状态。
2．验证 CSRF Token。
3．验证 Idempotency-Key。
4．验证文字和图片参数。
5．开始数据库事务。
6．检查用户余额是否至少为 25 分。
7．创建 generation_job。
8．钱包扣除 25 分。
9．写入 generation_charge 账单。
10．提交事务。
11．调用 APIMart。
12．保存 APIMart task ID。
13．开始查询生成状态。
```

### 17.2 任务成功

```text
APIMart 返回成功
→ 保存 result_url
→ 状态改为 completed
→ 不再修改余额
```

### 17.3 明确失败

```text
APIMart 明确返回失败
→ 开始退款事务
→ 钱包增加 25 分
→ 写入 generation_refund
→ 状态改为 refunded
```

退款幂等键：

```text
generation-refund:JOB_ID
```

即使退款逻辑被执行多次，也只能产生一笔退款。

### 17.4 结果未知

网络断开或者 APIMart 超时，但不能确认任务是否失败时：

```text
状态改为 provider_unknown
不重复提交
不立即退款
进入对账任务
```

后台根据 `provider_task_id` 查询实际状态：

- 确认成功：改为 `completed`。
- 确认失败：退回 `25` 分。
- 仍然未知：继续保留，管理员处理。

---

## 18．并发控制

下面这些操作必须放在同一个数据库事务内：

- 查询余额。
- 扣除余额。
- 写入账单。
- 创建任务。

余额字段使用整数。

每次变动后验证：

```text
wallet.balance_fen
=
该用户所有 wallet_ledger.delta_fen 的总和
```

定时对账发现不一致时：

- 不自动修改历史账单。
- 标记账户。
- 阻止新的生成请求。
- 通知管理员核查。
- 管理员通过 `admin_adjustment` 写入修正记录。

---

## 19．AllValue 商品配置

创建一个充值商品：

| 字段     | 内容               |
| ------ | ---------------- |
| 商品名    | ipzsk 图片额度 ¥10   |
| SKU    | `PUNK-CREDIT-10` |
| 售价     | ¥10              |
| 对应余额   | 1000 分           |
| 可生成数量  | 40 张             |
| 交付内容   | 1 个兑换码           |
| 支付完成页面 | 显示兑换码和兑换入口       |
| 邮件     | 同时发送兑换码          |

商品说明：

```text
购买后获得 ipzsk ¥10 图片生成额度。
每生成一张图片扣除 ¥0.25。
本商品通过兑换码充值。
请登录 ipzsk.com 后，在“余额—兑换充值码”中使用。
```

### 19.1 初始兑换码库存

首次生成 `500` 个兑换码。

```text
总面值：¥5000
单码面值：¥10
兑换码数量：500
```

生成后导出 CSV：

```csv
code,sku,value_fen,status
PUNK10-XXXX-XXXX-XXXX,PUNK-CREDIT-10,1000,created
```

导入 AllValue 的数字商品库存。

只有支付完成的订单可以获得兑换码。

### 19.2 退款处理

AllValue 订单退款后：

1. 查找订单号对应的兑换码。
2. 尚未兑换：状态改为 `revoked`。
3. 已经兑换：写入一笔 `order_refund` 负数账单。
4. 如果余额变成负数，用户仍可登录和查看记录。
5. 余额不足 `25` 分时，停止生成图片。

---

## 20．前端用户界面

### 20.1 顶部账户区

未登录：

```text
登录
注册
```

已登录：

```text
余额：¥10.00
充值
账户
退出
```

### 20.2 充值窗口

显示：

```text
当前余额：¥10.00

［购买 ¥10 额度］
［兑换充值码］

¥10 可生成 40 张图片。
每张图片 ¥0.25。
```

“购买 ¥10 额度”按钮打开 AllValue 商品页面。

兑换框：

```text
兑换码：PUNK10-____-____-____

［确认兑换］
```

### 20.3 生成按钮

```text
生成图片　¥0.25
```

提交前显示：

```text
本次将扣除 ¥0.25。
生成失败后会自动退回余额。
```

余额不足时：

```text
余额不足，请先充值。

［购买 ¥10 额度］
［兑换充值码］
```

### 20.4 账单页面

显示：

| 时间         | 类型   |      金额 |     余额 |
| ---------- | ---- | ------: | -----: |
| 2026-09-01 | 兑换充值 | +¥10.00 | ¥10.00 |
| 2026-09-01 | 图片生成 |  -¥0.25 |  ¥9.75 |
| 2026-09-01 | 生成退款 |  +¥0.25 | ¥10.00 |

### 20.5 图片生成状态

状态显示：

```text
正在提交
正在生成
生成完成
生成失败，余额已退回
结果仍在确认
```

前端轮询：

```text
前 30 秒：每 2 秒查询一次
30 秒后：每 5 秒查询一次
最长等待：180 秒
```

页面刷新后，根据服务器上的任务记录继续查询。

### 20.6 上传图片

浏览器上传前处理：

- 长边压缩到 `1600px`。
- 转成 WebP 或 JPEG。
- 文件控制在 `1MB` 左右。
- 去掉 EXIF。
- 服务端最大接收 `3MB`。
- 只允许 JPEG、PNG 和 WebP。

---

## 21．APIMart 接入

APIMart 调用只能从后端发出。

请求过程：

```text
前端
→ api.ipzsk.com
→ ipzskd
→ APIMart
```

限制：

- API Key 不返回给浏览器。
- 日志不记录 API Key。
- 日志不记录完整提示词。
- 数据库只保存 `prompt_hash`。
- 上传的参考图片保存在临时目录。
- 任务提交完成后 `15` 分钟内删除临时文件。
- 单个用户最多同时运行 `2` 个任务。
- 同一个 `Idempotency-Key` 不得重复调用 APIMart。

超时设置：

| 阶段     |    时间 |
| ------ | ----: |
| 建立连接   |  10 秒 |
| 提交任务   |  30 秒 |
| 单次状态查询 |  15 秒 |
| 前端最长等待 | 180 秒 |

图片生成成功后，将 APIMart 返回的结果地址保存到任务记录。

---

## 22．安全限制

### 22.1 请求频率

| 请求   | 限制                 |
| ---- | ------------------ |
| 注册   | 每个 IP 每小时 5 次      |
| 登录   | 每个 IP 每 15 分钟 10 次 |
| 兑换   | 每个用户和 IP 每小时 10 次  |
| 生成   | 每个用户每分钟 5 次        |
| 同时生成 | 每个用户最多 2 个         |
| 上传   | 每个文件最大 3MB         |

### 22.2 浏览器安全

- CORS 只允许 `https://ipzsk.com` 和 `https://www.ipzsk.com`。
- 使用 HTTPS。
- 登录 Cookie 设置 HttpOnly、Secure 和 SameSite。
- 所有修改操作检查 CSRF Token。
- 所有用户文本在展示时转义。
- 禁止前端执行用户输入的 HTML。
- 禁止把秘密信息写入 URL。
- API 响应使用 `Cache-Control: no-store`。

### 22.3 管理权限

- 管理后台不开放公网。
- SSH 端口只允许工程师固定 IP。
- 管理员操作写入 `admin_audit`。
- 手工调整余额必须填写原因。
- 余额调整只能新增账单，不能直接修改旧账单。
- 兑换码导出文件不得进入 Git。
- 环境变量文件权限为 `640`。
- 数据库目录仅 `ipzsk` 用户可写。

---

## 23．构建和发布

### 23.1 本地构建

```bash
cd backend
go test ./...
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build \
  -trimpath \
  -ldflags="-s -w" \
  -o dist/ipzskd ./main.go
```

前端构建输出：

```text
frontend/dist/
```

发布包：

```text
release/
├── backend/
│   └── ipzskd
└── frontend/
    ├── index.html
    └── assets/
```

### 23.2 上传发布包

```bash
RELEASE_ID=$(date -u +%Y%m%d%H%M%S)

ssh deploy@SERVER_IP "mkdir -p /srv/ipzsk/releases/$RELEASE_ID"

scp -r release/* \
  deploy@SERVER_IP:/srv/ipzsk/releases/$RELEASE_ID/
```

### 23.3 服务器发布

```bash
ssh deploy@SERVER_IP
```

```bash
RELEASE_ID=RELEASE_ID

sudo -u ipzsk /srv/ipzsk/releases/$RELEASE_ID/backend/ipzskd \
  migrate \
  --dir=/var/lib/ipzsk/pb_data

sudo ln -sfn /srv/ipzsk/releases/$RELEASE_ID /srv/ipzsk/current
sudo chown -h deploy:deploy /srv/ipzsk/current

sudo systemctl restart ipzsk
sudo systemctl reload caddy
```

检查：

```bash
curl -fsS http://127.0.0.1:8090/healthz
curl -fsS https://api.ipzsk.com/healthz
curl -I https://ipzsk.com
```

### 23.4 回滚

保留最近 `5` 个发布版本。

```bash
sudo ln -sfn /srv/ipzsk/releases/PREVIOUS_RELEASE /srv/ipzsk/current
sudo systemctl restart ipzsk
sudo systemctl reload caddy
```

如果数据库迁移不可逆，发布前先创建数据库备份和腾讯云快照。

---

## 24．健康检查

### 24.1 `/healthz`

只检查：

- 进程正在运行。
- HTTP 服务可以响应。

返回：

```json
{
  "status": "ok"
}
```

### 24.2 `/readyz`

检查：

- 数据库可读写。
- 数据目录权限正常。
- APIMart 配置存在。
- 钱包对账没有阻断错误。

返回：

```json
{
  "status": "ready",
  "database": "ok",
  "provider_config": "ok",
  "reconciliation": "ok"
}
```

健康检查不得调用一次真实图片生成。

---

## 25．日志

日志中记录：

- `request_id`。
- 用户 ID。
- API 路径。
- 状态码。
- 响应时间。
- 图片任务 ID。
- APIMart task ID。
- 错误代码。
- 扣款账单 ID。
- 退款账单 ID。

日志中不记录：

- 密码。
- 登录 Cookie。
- CSRF Token。
- APIMart API Key。
- 完整兑换码。
- 完整提示词。
- 上传图片内容。

日志保存：

```text
Caddy：14 天
应用日志：30 天
管理员审计：长期保存
钱包账单：长期保存
```

---

## 26．备份

### 26.1 每日数据库备份

每天 UTC `03:30` 执行。

创建 `/usr/local/sbin/ipzsk-backup`：

```bash
#!/usr/bin/env bash
set -euo pipefail

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="/var/backups/ipzsk/$STAMP"

mkdir -p "$DEST"

systemctl stop ipzsk

tar -C /var/lib/ipzsk \
  -czf "$DEST/pb_data.tar.gz" \
  pb_data

systemctl start ipzsk

sha256sum "$DEST/pb_data.tar.gz" \
  > "$DEST/SHA256SUMS"

find /var/backups/ipzsk \
  -mindepth 1 \
  -maxdepth 1 \
  -type d \
  -mtime +30 \
  -exec rm -rf {} \;
```

权限：

```bash
sudo chmod 750 /usr/local/sbin/ipzsk-backup
```

systemd timer：

```ini
[Unit]
Description=Daily ipzsk backup

[Timer]
OnCalendar=*-*-* 03:30:00 UTC
Persistent=true

[Install]
WantedBy=timers.target
```

执行前需要确认当前没有生成任务，或者使用 SQLite 在线备份机制，避免在任务处理中停止服务。

### 26.2 腾讯云快照

建立两个轮换快照：

```text
snapshot-pre-deploy
snapshot-weekly
```

用途：

- 每次数据库结构迁移前更新 `snapshot-pre-deploy`。
- 每周更新 `snapshot-weekly`。

腾讯云 Lighthouse 的免费快照配额按实例数量计算，每台实例对应 2 个免费快照配额，单地域上限为 10 个。[腾讯云 Lighthouse 配额](https://www-sg.tencentcloud.com/ind/document/product/1103/41265)

### 26.3 异地备份

每周将数据库备份下载到工程师电脑，并使用 `age` 加密：

```bash
scp deploy@SERVER_IP:/var/backups/ipzsk/BACKUP/pb_data.tar.gz .
age -r AGE_PUBLIC_KEY -o pb_data.tar.gz.age pb_data.tar.gz
```

保留：

```text
每日备份：7 份
每周备份：4 份
每月备份：3 份
```

### 26.4 恢复目标

```text
RPO：24 小时
RTO：2 小时
```

每月进行一次恢复测试。

---

## 27．恢复流程

```bash
sudo systemctl stop ipzsk

sudo mv /var/lib/ipzsk/pb_data \
  /var/lib/ipzsk/pb_data.before-restore

sudo mkdir -p /var/lib/ipzsk
sudo tar -C /var/lib/ipzsk \
  -xzf /var/backups/ipzsk/BACKUP_ID/pb_data.tar.gz

sudo chown -R ipzsk:ipzsk /var/lib/ipzsk/pb_data

sudo systemctl start ipzsk

curl -fsS http://127.0.0.1:8090/healthz
curl -fsS http://127.0.0.1:8090/readyz
```

恢复后核对：

- 用户数量。
- 钱包总余额。
- 账单总额。
- 兑换码状态。
- 最近生成任务。
- 管理员审计记录。

---

## 28．监控和告警

腾讯云基础监控：

| 指标      | 告警条件           |
| ------- | -------------- |
| CPU     | 连续 15 分钟超过 80% |
| 内存      | 超过 85%         |
| 磁盘      | 超过 75%         |
| 月流量     | 使用超过 70%       |
| 服务状态    | 连续 3 次健康检查失败   |
| API 5xx | 5 分钟内超过 5%     |
| 图片失败率   | 30 分钟内超过 10%   |
| 钱包对账    | 出现任何差异         |
| 兑换失败    | 10 分钟内超过 10 次  |

每天运行一次对账：

```text
wallet.balance_fen
与
SUM(wallet_ledger.delta_fen)
进行比较
```

同时核对：

- 已扣款但没有任务的记录。
- 失败但没有退款的任务。
- 已退款两次的任务。
- `provider_unknown` 超过 30 分钟的任务。
- 已兑换但没有充值账单的兑换码。
- 退款订单关联的兑换码状态。

---

## 29．上线验收

### 29.1 账户

- 可以注册。
- 可以登录。
- 可以退出。
- 错误密码不会登录。
- 未登录用户不能访问余额和生成 API。
- 停用账户不能继续生成。

### 29.2 AllValue

使用真实 ¥10 订单测试：

1. 用户进入 AllValue。
2. 完成支付。
3. 收到兑换码。
4. 回到 ipzsk。
5. 成功兑换。
6. 余额显示 ¥10.00。
7. 同一兑换码再次兑换时失败。
8. 订单退款后，兑换码状态可以处理。

这项测试通过前，不进入公开上线状态。

### 29.3 扣款

- 余额 ¥10.00 时生成一次，变为 ¥9.75。
- 余额 ¥0.25 时可以生成一次。
- 余额 ¥0.24 时不能生成。
- 连续点击生成按钮不会重复扣款。
- 刷新页面不会再次扣款。
- 同一个幂等键不会创建两个任务。

### 29.4 退款

- APIMart 明确失败后退回 ¥0.25。
- 同一个任务只退款一次。
- 超时但状态未知时，不重复提交。
- 对账确认失败后可以退款。
- 退款记录出现在账单页面。

### 29.5 并发

准备一个 ¥10 账户，同时发送 `20` 个生成请求。

验收结果：

```text
成功扣款次数
=
实际创建的生成任务数
```

余额不能出现丢失更新。

### 29.6 安全

- APIMart API Key 不出现在浏览器源码。
- `8090` 端口不能从公网访问。
- 管理后台不能通过 `api.ipzsk.com/_/` 访问。
- Cookie 带 HttpOnly、Secure、SameSite。
- 未允许的域名不能跨域调用 API。
- 上传非图片文件时被拒绝。
- 超过 `3MB` 的文件被拒绝。
- 完整兑换码不出现在日志。

### 29.7 中国网络

分别使用下面的网络测试：

- 中国移动。
- 中国联通。
- 中国电信。
- 家庭宽带。
- 手机 4G 或 5G。

记录：

- 首页首屏加载时间。
- 登录时间。
- 上传时间。
- 生成请求提交时间。
- 生成结果显示时间。
- HTTPS 是否正常。
- 图片资源是否有失败。

腾讯云说明中国大陆访问境外地域时，可能受跨境网络影响而出现时延和丢包，因此上线验收需要实际测试三家运营商。[腾讯云 Lighthouse 网络说明](https://www-sg.tencentcloud.com/ind/document/product/1103/41266)

### 29.8 备份和回滚

- 每日备份可以生成。
- SHA256 校验通过。
- 备份可以恢复到临时目录。
- 旧版本可以重新指向。
- 应用回滚后可以正常读取数据库。
- 数据库迁移前已经创建快照。

---

## 30．上线顺序

### 第 1 阶段：基础设施

- 购买腾讯云新加坡 Lighthouse。
- 安装 Ubuntu 24.04 LTS。
- 配置 SSH。
- 配置腾讯云防火墙。
- 配置 UFW。
- 设置 DNS。
- 安装 Caddy。
- 验证 HTTPS。

### 第 2 阶段：代码拆分

- 拆分 31MB 的 `index.html`。
- 提取 CSS 和 JavaScript。
- 提取并压缩图片。
- 删除前端 API Key 配置。
- 接入后端 API 客户端。

### 第 3 阶段：账户和钱包

- 建立用户表。
- 建立钱包。
- 建立不可修改的账单表。
- 完成注册、登录和退出。
- 完成余额查询。
- 完成账单查询。

### 第 4 阶段：兑换码

- 建立兑换商品。
- 完成兑换码生成器。
- 完成兑换事务。
- 完成管理员导出。
- 生成首批 500 个兑换码。
- 导入 AllValue。

### 第 5 阶段：图片生成

- 接入 APIMart。
- 完成扣款事务。
- 完成异步任务查询。
- 完成失败退款。
- 完成状态未知对账。
- 完成生成历史。

### 第 6 阶段：部署和运维

- 建立 systemd 服务。
- 建立发布脚本。
- 建立备份脚本。
- 建立恢复流程。
- 建立日志和监控。
- 完成回滚测试。

### 第 7 阶段：真实支付验收

- 完成 1 笔真实 ¥10 支付。
- 收到兑换码。
- 兑换后显示 ¥10。
- 连续生成 2 张图片。
- 确认余额为 ¥9.50。
- 制造 1 次失败并验证退款。
- 测试退款订单。
- 完成中国三家运营商访问测试。

---

## 31．费用

| 项目                | 费用         |
| ----------------- | ---------- |
| 腾讯云新加坡 Lighthouse | 当前标价约 $6／月 |
| Ubuntu            | ¥0         |
| Caddy             | ¥0         |
| PocketBase        | ¥0         |
| SQLite            | ¥0         |
| HTTPS 证书          | ¥0         |
| GitHub            | 使用现有仓库     |
| AllValue          | 按现有商店费率    |
| APIMart           | 按图片实际调用量   |

服务器固定开支以腾讯云购买页面和续费页面为准。

---

## 32．完成状态

整个项目按下面的状态区分：

```text
local_check_passed
本地测试通过，还没有部署。

review_ready
代码和部署文件可以交给工程师检查。

deployed
代码已经部署到新加坡服务器。

live_verified
真实支付、兑换、扣款、退款和中国网络测试全部通过。
```

只有达到 `live_verified`，才算整个充值和扣款流程上线完成。
