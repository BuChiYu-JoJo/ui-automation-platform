# 本机验收清单（ACCEPTANCE）—— 在 jojo 的机器上执行

> 背景：开发 VM 上有三个环境阻塞（Prisma 引擎下载被网络阻断、无可用浏览器、无 Docker），
> MVP 的代码与测试已在内存仓库 + 进程内分发下全绿（见 PROGRESS），但「真实 DB / 真实浏览器 /
> 真全栈」必须在一台正常机器上验一次。本清单就是那一次验收的完整步骤，
> 一键版是 `scripts/smoke-local.sh`（自动跑第 1–3 节的大部分命令并汇总 PASS/FAIL）。
>
> 验收完成后，把每节的实际结果（通过/失败 + 关键输出）回填 `docs/PROGRESS.md` 的 Week 4 章节。

## 0. 前置条件

| 项 | 要求 | 检查命令 |
|---|---|---|
| Node | >= 20（开发环境为 v24.22.1；仓库未设 engines，按此对齐最稳） | `node -v` |
| pnpm | 9.15.0（根 package.json 的 packageManager 字段） | `corepack enable && corepack prepare pnpm@9.15.0 --activate`，然后 `pnpm -v` |
| 网络 | 能访问 npm registry、`binaries.prisma.sh`、`cdn.playwright.dev` | 见第 1 节，装不上就是网络问题 |
| Docker（仅第 3 节需要） | Docker Desktop / docker engine + compose v2 | `docker compose version` |
| 磁盘 | 建议预留 5 GB（Chromium + 镜像 + 产物） | — |

## 0.1 环境变量（cp .env.example .env 后逐项改）

先生成主密钥（后面所有密钥变量、告警通道、storageState 都靠它加密）：

```bash
openssl rand -base64 32   # 输出填到 MASTER_KEY_B64
```

| 变量 | 一句话说明 |
|---|---|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | compose 里 Postgres 的账号/密码/库名；密码必须改掉占位值 |
| `DATABASE_URL` | API 连 Postgres 的连接串；compose 部署时 compose 文件会按上面三项自动拼，本机直连时改成 localhost 版本 |
| `REDIS_URL` | Redis 地址（BullMQ 队列/调度）；compose 内自动指向 redis 服务 |
| `S3_ENDPOINT` / `S3_REGION` / `S3_BUCKET` | 产物对象存储（MinIO）的地址/区域/桶名 |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | MinIO 访问凭据；与下面 MINIO_ROOT_* 保持一致即可（本地） |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | MinIO 容器 root 账号；密码必须改掉占位值 |
| `API_PORT` / `WEB_PORT` | API（默认 3000）与 Web 管理台（默认 5173）的宿主机端口，被占用就改这里 |
| `JWT_SECRET` | 登录 JWT 签名密钥（当前鉴权仍是骨架 header 模式，上线前必须改成随机值并接真鉴权） |
| `MASTER_KEY_B64` | 信封加密主密钥，32 字节 base64（上方命令生成）；**丢失 = 所有已加密的密钥变量/通道/storageState 不可解密，务必离线备份** |
| `WORKER_CONCURRENCY` | Worker 同时执行的浏览器任务数（先按机器内存定，4C8G 建议 4） |
| `WORKER_MAX_CONTEXTS_PER_BROWSER` / `WORKER_MAX_EXECUTIONS_PER_BROWSER` | 浏览器进程的 context 上限与回收阈值（防 Chromium 长跑内存膨胀） |
| `ALLOW_EVAL_JS` | DSL 的 eval_js 动作开关；保持 `false`，除非某个用例明确需要且你接受风险 |
| `UIP_REPOSITORY`（运行时，非 .env.example 必填） | `prisma` = 用真 DB；不设 = 内存仓库（重启丢数据，只供演示） |
| `UIP_DISPATCH`（运行时） | `bullmq` = 经 Redis 分发给 Worker；不设 = API 进程内分发（单机演示） |
| `UIP_SCHEDULER_ENABLED` / `UIP_TENANT_IDS`（运行时） | 调度定时器开关与它服务的租户列表；多实例部署时只开一个实例的调度，防重复建单 |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`（可选） | 已有系统 Chrome/Chromium 时指过去，免下载 Playwright 自带浏览器 |

## 1. 代码级验收（对应 smoke-local.sh 第 1–7 步）

```bash
pnpm install                     # 完整安装（含 postinstall：Prisma 引擎、Playwright 驱动）
pnpm --filter @uip/api exec prisma validate
pnpm --filter @uip/api exec prisma generate
pnpm -r run build
pnpm -r run test
pnpm --filter @uip/worker exec playwright install chromium
pnpm demo:e2e
```

期望输出（逐项对）：

- `prisma validate`：输出 `The schema at prisma/schema.prisma is valid 🚀`（大意如此，无报错行）。
- `pnpm -r run test`：全绿。Week 4 基线：api 36 + worker 9 + dsl 3 + shared 2 = **50 条**。
- `pnpm demo:e2e`：**退出码 0**，且打印的最终 execution `status=passed`
  （本地登录站的 DSL 登录旅程真跑 + step_results 回写 + 截图落在 artifacts/ 下）。
  退出码 2 = 浏览器仍不可用（先解决第 6 步的浏览器安装）；退出码 1 = 真失败，看打印的步骤结果。

首次 migrate（validate 通过后、接真 DB 前补这一步——Week 2/3 的 schema 欠账都在这里结清）：

```bash
pnpm --filter @uip/api exec prisma migrate dev --name mvp-baseline
UIP_REPOSITORY=prisma pnpm --filter @uip/api start   # 切真 DB 起 API
```

然后把 Week 1–3 的 HTTP 冒烟主链路重跑一遍（建项目 → 环境 → 变量 → 用例 → 计划 →
run-now/dry-run → executions → stats/overview → stats/flaky → public/status），
内存模式下这些都验过，真 DB 下应得到同样结果。公开状态页记得用第 2 节建好的项目 slug 访问。

## 2. 冒烟主链路（内存或真 DB 都可，先跑通再上 compose）

```bash
# 起 API（另开一个终端，仓库根目录）
pnpm --filter @uip/api start     # 监听 API_PORT（默认 3000），全局前缀 /api
curl localhost:3000/api/stats/ping

# 建项目（slug 决定公开状态页地址 /status/<slug>）
curl -X POST localhost:3000/api/projects -H 'content-type: application/json' \
  -d '{"name":"我的第一个项目","slug":"my-first","ownerId":"jojo"}'
# 建环境（baseUrl 换成你自己的站点）
curl -X POST localhost:3000/api/projects/<projectId>/environments -H 'content-type: application/json' \
  -d '{"name":"prod","baseUrl":"https://example.com"}'
# 建用例：直接用 dogfood 模板（见 e2e-fixtures/dogfood/README.md 先改 testid/文案）
curl -X POST localhost:3000/api/projects/<projectId>/cases -H 'content-type: application/json' \
  -d "{\"name\":\"Dogfood 1：首页可用性\",\"dsl\":$(cat e2e-fixtures/dogfood/01-homepage-availability.json)}"
# 建计划（5 分钟、阈值 3）与告警规则见 dogfood README 的推荐设置表
# 验公开状态页与 flaky 榜
curl localhost:3000/api/public/status/my-first
curl 'localhost:3000/api/stats/flaky?projectId=<projectId>&days=7'
```

## 3. 真 webhook 测试发送（飞书/企微各选一个群）

1. 在飞书/企微群里加自定义机器人，拿到 webhook 地址（这就是密钥，只粘到下一步、不要外传）。
2. 建告警规则（通道 target 会被平台信封加密落库、接口回显只有掩码）：
   ```bash
   curl -X POST localhost:3000/api/alert-rules -H 'content-type: application/json' -d '{
     "scopeType":"project","scopeId":"<projectId>",
     "channels":[{"type":"feishu","label":"值班群","target":"https://open.feishu.cn/open-apis/bot/v2/hook/<你的token>"}]}'
   ```
3. 测试发送：
   ```bash
   curl -X POST localhost:3000/api/alert-rules/<ruleId>/test-send
   ```
   期望：群里收到「UIP 平台测试消息」，接口返回的每条 log `status=sent` 且 target 是掩码形态。

## 4. Compose 全栈拉起

```bash
cp .env.example .env             # 按 0.1 逐项改（尤其 POSTGRES_PASSWORD、MINIO_ROOT_PASSWORD、MASTER_KEY_B64、JWT_SECRET）
docker compose -f deploy/docker-compose.yml up -d
docker compose -f deploy/docker-compose.yml ps   # postgres/redis/minio 应为 healthy
```

健康检查（逐个 curl，都应 200）：

| 服务 | 地址 | 期望 |
|---|---|---|
| API | `curl localhost:3000/api/stats/ping` | `{"module":"stats","status":"ok"}` |
| API 公开状态页 | `curl localhost:3000/api/public/status/<你的项目slug>` | JSON 载荷（结构见 PROGRESS Week 4） |
| Web 管理台 | 浏览器打开 `http://localhost:5173` | 能打开 Dashboard 并选到项目 |
| Web 公开状态页 | 浏览器打开 `http://localhost:5173/status/<slug>` | 无侧边栏的公开页、横幅/监控行/可用率正常 |
| MinIO 健康 | `curl localhost:9000/minio/health/live` | 200（控制台在 :9001） |
| Postgres | `docker compose -f deploy/docker-compose.yml exec postgres pg_isready` | accepting connections |

全栈模式下的运行时开关（在 .env 或 compose environment 里补）：
`UIP_REPOSITORY=prisma`、`UIP_DISPATCH=bullmq`、API 侧 `UIP_SCHEDULER_ENABLED=true`（只给一个实例开）。
产物落 MinIO 的验收标准：跑一条会失败的用例 → MinIO 的 `uip-artifacts` 桶里应出现该 execution 的截图/trace
（注：S3 存储在 Week 3 时仍是接口 stub，若此处未落桶，按 PROGRESS 的登记项处理——先确认 API 日志里
产物登记的 s3Key，再决定是否把「S3 实现替换 stub」提为 V1 第一项，不要误判为验收失败）。

停栈与数据：`docker compose -f deploy/docker-compose.yml down`（保留数据卷）；
数据卷 `pgdata` / `miniodata` 是唯一数据所在，备份 = 备份这两个卷 + `.env` 里的 `MASTER_KEY_B64`。

## 5. Dogfooding（一周观察）

按 `e2e-fixtures/dogfood/README.md` 把 3 条模板改成你的真实旅程并启用计划，
观察一周、逐条填 `e2e-fixtures/dogfood/observation-log.md`，把小结回填 PROGRESS Week 4 章节。

## 6. 故障排查表

| 现象 | 对应已知阻塞/原因 | 处理 |
|---|---|---|
| `pnpm install` 或 prisma validate 在下载引擎时 `ECONNRESET / Error: aborted` | 阻塞 #1：出网被断（开发 VM 上就是这个状态） | 换网络/开代理后重跑；确认能打开 `binaries.prisma.sh`；不要用 `--ignore-scripts` 绕（validate 必挂） |
| demo:e2e 退出码 2 / `Executable doesn't exist at ~/.cache/ms-playwright/...` | 阻塞 #2：Playwright 浏览器未装好 | `pnpm --filter @uip/worker exec playwright install chromium`；Linux 还缺系统库时加 `--with-deps`（需 sudo）；或设 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 指向系统 Chrome |
| `docker: command not found` / compose 起不来 | 阻塞 #3：本机无 Docker | 装 Docker Desktop（Mac/Win）或 docker engine（Linux）后从第 4 节重来；无 Docker 时第 1–3 节的内存模式验收不受影响 |
| 端口占用（3000/5173/5432/6379/9000 起不来） | 本地已有进程占了同名端口 | 改 `.env` 的 `API_PORT`/`WEB_PORT`，或改 compose 里 postgres/redis/minio 的宿主机映射端口，并同步 `DATABASE_URL`/`REDIS_URL`/`S3_ENDPOINT` |
| Worker 容器频繁 OOM / Chromium 启动即崩（`Failed to launch`, /dev/shm 相关报错） | Chromium 的 /dev/shm 太小是经典坑 | compose 里 worker 已设 `shm_size: "2gb"`——若你改过 compose 先恢复它；宿主机内存不足时调低 `WORKER_CONCURRENCY` |
| Linux 上 Chromium 报缺 `libnss3` 等共享库 | Playwright 浏览器缺系统依赖 | `pnpm --filter @uip/worker exec playwright install --with-deps chromium` |
| API 启动报 MASTER_KEY_B64 相关错误 / 解密失败 | 主密钥缺失、不是 32 字节 base64、或换了新密钥读旧数据 | 用 `openssl rand -base64 32` 生成并固定下来；**中途换密钥 = 旧密文全部解不开**，只能重录密钥变量/通道/storageState |
| 调度不开单或重复建单 | `UIP_SCHEDULER_ENABLED` 没开 / 多实例都开了 | 单机确认开关为 true；多实例只保留一个开着（调度本身有幂等游标兜底，重复 tick 不会重复建单，但别依赖兜底） |
| 公开状态页 404 | slug 拼错或项目被软删 | 用建项目时返回的 slug；状态页只认未删除项目 |
| 公开状态页 429 | 超过进程内限流（60 次/分钟/IP） | 正常刷新不会触发；压测/爬虫场景请在网关层做正式限流（代码里有 TODO 标注） |
