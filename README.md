# UI 自动化测试 + 合成监控平台（通用版）

多项目通用的 UI 自动化测试与合成监控平台骨架。设计依据：`docs/architecture.md`（三层架构 + 八步数据流）、
调研报告 `~/workspace/research_notes/ui-automation-monitoring-platform-20261031-0641/report.md`。
2026-10-31 决策：**TS 全栈、DSL 轨 + 代码轨双轨一起上**（见 `docs/decisions.md`、`docs/roadmap-v2.md`）。

## 结构

```
apps/api      NestJS 控制面（模块 stub + 完整 Prisma schema + BullMQ 入队 stub）
apps/worker   执行面：浏览器池 / DSL 解释器 / 代码轨 runner（JSON reporter -> 统一模型）
apps/web      Vue 3 管理台（路由 + 占位视图 + API client stub）
packages/dsl      DSL 类型 + zod 校验 + JSON Schema【真实可用，有单测】
packages/shared   双轨统一模型 / 脱敏 / 信封加密(AES-GCM) / S3 key 规范【真实可用，有单测】
packages/notifiers 告警通道：飞书/企微【可工作】，钉钉/Email stub，通用 Webhook
deploy/       docker-compose（pg16/redis7/minio/api/worker/web）+ Dockerfile×3
docs/         architecture / dsl-spec / roadmap-v2 / decisions / PROGRESS（里程碑验收与阻塞记录）/ ACCEPTANCE（本机验收清单）
scripts/      demo-e2e.mjs（Week 1 端到端验收演示，pnpm demo:e2e）
e2e-fixtures/ DSL 示例用例 + 代码轨示例 spec（example.com）+ local-site 本地演示站点（登录页/欢迎页）
```

## 本地运行

```bash
cp .env.example .env          # 改掉里面的本地占位密码/密钥
pnpm install
pnpm --filter @uip/dsl build && pnpm --filter @uip/shared build && pnpm --filter @uip/notifiers build
pnpm --filter @uip/worker build
pnpm -r run test              # dsl 校验 / 脱敏 / reporter 解析 单测
# 起基础设施（需要 Docker）：
docker compose -f deploy/docker-compose.yml up -d postgres redis minio
pnpm --filter @uip/api exec prisma generate   # 生成 Prisma Client 后再跑 api
pnpm --filter @uip/web dev    # 管理台 http://localhost:5173

# Week 1 端到端演示（无需 Docker/DB：内存仓库 + 本地站点 + 真实 Chromium）：
pnpm demo:e2e   # 退出码 0=通过 / 2=浏览器不可用（基础设施阻塞，如实报告） / 1=失败；详见 docs/PROGRESS.md
```

## 部署与验收（Week 4）

- **一键本机验收**：`bash scripts/smoke-local.sh` —— 逐步跑 install → prisma validate/generate →
  构建 → 测试 → 装 Chromium → demo:e2e → compose 校验，每步 PASS/FAIL 不中断，失败带排查提示。
- **人工清单版**：[`docs/ACCEPTANCE.md`](docs/ACCEPTANCE.md) —— 前置版本、每个环境变量一句话说明、
  期望输出、compose 全栈拉起与健康检查、真 webhook 测试发送、dogfooding 一周观察、故障排查表。
- **拿平台监控自己的站点**：`e2e-fixtures/dogfood/` 三条现成 DSL 旅程模板 + 改法说明 + 观察日志模板。
- 文档索引：架构 `docs/architecture.md`、DSL 规范 `docs/dsl-spec.md`、路线图 `docs/roadmap-v2.md`、
  决策记录 `docs/decisions.md`、进度与已知阻塞 `docs/PROGRESS.md`。

## 什么能跑 / 什么是 stub

| 部分 | 状态 |
|---|---|
| packages/dsl 校验、packages/shared 脱敏/加密/S3 key | ✅ 真实实现 + 单测 |
| worker DSL 解释器（18 个动作） | ✅ 真实实现（对 Playwright API）；run_case 明确报错（V1），eval_js 默认关闭 |
| worker 代码轨 reporter 解析 | ✅ 真实实现 + 样例 fixture 单测；code-runner 为 spawn 薄封装 |
| worker 浏览器池（槽位/回收） | ✅ 真实实现，未做压测校准 |
| packages/notifiers 飞书/企微 | ✅ 真实 HTTP POST（需自备 webhook 地址）；钉钉/Email 为 stub |
| apps/api domain 服务层（项目/环境/变量/用例/执行/计划/状态机/告警/incident/节点/quorum/维护窗口/心跳/产物清理/登录预设/flaky 榜/公开状态页） | ✅ Week 1–4 逐周真实实现（见 docs/PROGRESS.md）：仓库抽象（内存实现可用 / Prisma 实现待引擎下载后验证），密钥加密落库、可插拔分发、全仓单测 50 条 |
| apps/api auth 模块 | ⚠️ 仍是骨架（租户/操作者暂走 header，上线前必须接真鉴权，见 ACCEPTANCE） |
| apps/web | ✅ Dashboard/Executions 接真实 API（含 flaky 榜与轨道徽章）；公开状态页 `/status/:slug` 已落地；其余视图为可用占位 |
| 产物直传 S3、Git 同步、结果回写 API 的独立服务化 | ❌ S3 仍为接口 stub（本地 FS 实现可用）；Git 同步与 CI 门禁属 V1 |

## 红线（骨架阶段约定）

不含任何真实凭证；示例只用 example.com。产物只走 S3 key 规范、失败才留 + 生命周期清理（清理任务待实现）。
