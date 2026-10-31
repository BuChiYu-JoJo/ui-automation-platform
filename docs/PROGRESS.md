# 进度与里程碑验收（PROGRESS）

## 当前里程碑：Week 4 —— MVP 收尾（2026-10-31 完成本机可做部分）

负责范围：Week 4 分两半——(A) 本机可全做：flaky 榜、公开状态页打磨、dogfooding 套件、
告警 test-send 补齐；(B) 只能在 jojo 机器上验的：写成精确清单（docs/ACCEPTANCE.md +
scripts/smoke-local.sh），**本节明确区分：(A) 是已完成且有测试证据的，(B) 一项都没有在本机验过**。

### (A) 已完成（本机，带证据）

| 项 | 状态 | 证据 |
|---|---|---|
| Flaky 榜 API | ✅ | domain `StatsService.flaky` + `GET /stats/flaky?projectId=&days=`（days 整数 1–30、缺省 7，非法 400）：按 (case, plan) 分行统计窗口内终态执行，flakyRate = flaky / (passed+flaky+failed+timeout)，**infra_failed 与 queued/running/cancelled 一律剔除**，窗口外执行不计；含 lastFlakyAt、窗口内最长连续 flaky 串；排序 = 有 flaky 在前、率降序、数降序；单测覆盖率数学/窗口过滤/排序/按计划分行 |
| 隔离建议（仅建议） | ✅ | 规则：flakyRate > 20% **或** 最长连续 flaky ≥ 5 → `quarantineSuggested=true` + 中文 reason；**只展示不自动隔离**（自动隔离 V1，口径见 decisions Week 4 条）；单测覆盖率触发、连串触发（率恰 0.2 不触发率规则）、双阈值下不触发 |
| Flaky 榜 Web | ✅ | Dashboard 新增 Flaky 榜区块（7/14/30 天窗口切换、用例/终态数/flaky 数/率/最长连串/最近 flaky/建议徽标）；顺带把监控状态徽标切到 Week 3 的 displayStatus（含 maintenance 样式） |
| 公开状态页 API | ✅ | domain `PublicStatusService` + `GET /api/public/status/:slug`（免登录）：只出项目展示名、每监控展示状态（复用 displayStatus 口径）、最近判定时间、30 天可用率、进行中 incident 的「监控名+开始时间+已持续秒数」；进程内 per-IP 限流 60 次/分钟（网关层限流留 TODO）；未知 slug 404。**数据最小化有单测断言**：载荷 JSON 不含 baseUrl/snapshot/webhook/artifact/error/environment/tenant/summary/s3Key/token/内部 id 等 15 个禁用词，incident 键集合精确等于三件套 |
| 30 天可用率口径 | ✅（近似，已写清） | 无分钟桶时序数据，用 **incident 时长近似 downtime**：窗口内 incident 重叠时长 − 与维护窗口重叠部分，分母 = 30 天总分钟 − 维护窗口总分钟（并集）；偏差来源（阈值检测延迟不计、suspect 期算 up、heartbeat incident 不入 plan 可用率）写在 PublicStatusService 文件头 + decisions；单测验证：resolved 60′ + 进行中 120′ → 99.58；维护重叠 60′ → 99.86；无 incident → 100 |
| 公开状态页 Web | ✅ | 路由 `/status/:slug`（meta.public，App.vue 对公开页不套管理台侧边栏）：总体横幅（全部正常/部分故障/重大故障 = 全部监控 down）、状态点 + 可用率 + 最近判定、进行中事件列表；管理台 `/statuspage` 无 slug 时给 slug 输入跳转；移动端靠 max-width + 表格自然收缩 |
| 告警 test-send | ✅ | domain `AlertDispatchService.testSend` + `POST /alert-rules/:id/test-send`：逐通道发 kind=test 合成事件、落 notification_log（kind=test、target 掩码）；单测用 fake 通道验证双通道发送 + 日志无明文 token。为 ACCEPTANCE 的真 webhook 验收补齐（此前只有类型预留、无实现） |
| Dogfooding 套件 | ✅ | `e2e-fixtures/dogfood/`：3 条 DSL 模板（01 首页可用性 / 02 login_preset 登录态受保护页 / 03 搜索列表流程）+ README（每条改什么 testid/文案、要建什么变量与监控专用账号、storageState 预设怎么存、统一推荐设置：5 分钟 / failThreshold 3 / skip / 飞书或企微其一 / 维护窗口）+ observation-log.md（一周观察表：日期/告警/真假/六类原因 + 漏报记录 + 小结回填位）；3 个模板均经 @uip/dsl 校验器验为 VALID |
| 本机验收脚本 | ✅ | `scripts/smoke-local.sh`（已 chmod +x、bash -n 通过）：8 步逐步 PASS/FAIL 不中断（install → prisma validate → generate → build → test → playwright install chromium → demo:e2e → compose config，无 Docker 时第 8 步记 SKIP 不算失败），每步 FAIL 打印与本文件阻塞清单对应的提示，退出码 = 失败步数 |
| 验收/部署文档 | ✅ | `docs/ACCEPTANCE.md`：前置版本（Node ≥20 / pnpm 9.15.0）、`.env.example` 每个变量一句话、逐命令期望输出（demo:e2e 退出码 0 + status=passed、validate 成功文案、测试基线 50 条）、首次 migrate 与切 `UIP_REPOSITORY=prisma` 步骤、冒烟主链路 curl、真 webhook test-send、compose 拉起 + 健康检查表、故障排查表（三阻塞 + 端口/shm/Chromium 系统库/主密钥/调度开关/状态页 404/429）；README 已加「部署与验收」节并链到 ACCEPTANCE/dogfood/docs 索引 |

### 测试与构建（Week 4 后全量）

| 范围 | 结果 |
|---|---|
| 全仓单测 | ✅ **50/50**：dsl 3 + shared 2 + worker 9 + api 36（Week 4 新增 7：flaky 数学与窗口 ×1、隔离建议阈值与分行 ×1、days 校验 ×1、test-send ×1、公开状态页可用率 ×2、维护展示+partial+404 ×1） |
| 全仓构建 | ✅ 六包全绿（dsl/shared/notifiers/worker/api/web） |
| HTTP 冒烟 | ✅ 内存模式实起 API：建项目/环境/用例（dogfood 模板 01）/计划 → `GET /stats/flaky?days=7` 返回 `{windowDays:7, items:[]}` 结构正确、`days=99` 返回 400 → `GET /public/status/smoke-w4` 返回最小化载荷（overall=operational、监控 up、uptime30dPct=100、无多余字段）、未知 slug 404 |

### 已知阻塞（Known Blockers，Week 4 复查后 unchanged，各只查了一次）

1. **Prisma 引擎二进制下载被网络阻断**：Week 4 复查 `prisma validate` 仍失败在引擎下载（`ECONNRESET / Error: aborted` 同族错误）。Week 2–4 全部 schema 变更仍未经 validate、Prisma 仓库实现未经真实 DB 验证。
2. **本机无可用浏览器**：`~/.cache/ms-playwright` 仍为空。demo:e2e 的真实浏览器段、代码轨真实运行、login_preset 真实注入仍未在本机跑过。
3. **本机无 Docker**：`docker: command not found` 未变。compose 全栈、BullMQ 真分发、MinIO 实存均未验；S3 产物存储仍为接口 stub（本地 FS 实现可用、stub 删除显式报错不假删）。

### (B) 待 jojo 本机验收（未做，不要当已完成）

按 `docs/ACCEPTANCE.md` / `scripts/smoke-local.sh` 执行并回填结果：

1. `pnpm install` 完整安装 + `prisma validate` + `prisma generate` + 首次 `prisma migrate dev`，切 `UIP_REPOSITORY=prisma` 后重跑第 2 节冒烟主链路（解阻塞 #1）。
2. `playwright install chromium` 后 `pnpm demo:e2e` 拿到退出码 0 + `status=passed`（解阻塞 #2）。
3. `docker compose up -d` 全栈拉起 + 健康检查表逐项 curl + Web 双页面打开确认（解阻塞 #3）；产物落 MinIO 一项按 ACCEPTANCE 第 4 节的注记判定（S3 仍是 stub，不要误判为验收失败，是否提为 V1 第一项由验收结论定）。
4. 真飞书/企微 webhook：建规则 → `POST /alert-rules/:id/test-send` → 群里收到测试消息（第 3 节）。
5. Dogfooding：3 条模板改成真实旅程（候选：Dataify 控制台登录、营销页关键路径、一个内部工具），按推荐设置跑满一周，逐条填 observation-log，误报率/漏报小结回填本节。

### MVP 交付总结（对 Definition of Done 的诚实对照）

原 DoD：**真实监控 3–5 条生产旅程并可靠告警 + 一组 Git 代码用例可调度执行**。

- **代码完成且已测试的部分**：双轨统一执行模型（DSL 解释器 + 代码轨 reporter 解析）、项目/环境/密钥变量（加密、只进不出）、计划调度（幂等/漏跑/并发策略/多地域组）、quorum 判定、监控状态机（infra 不计业务失败）、告警闭环（去重/恢复/incident/ack/test-send）、维护窗口、heartbeat、产物保留清理、storageState 预设、flaky 榜、公开状态页、仪表盘——全部在内存仓库 + 进程内分发下有单测/HTTP 冒烟证据（50 条单测）。
- **尚未验证的部分（全是环境而非功能缺口）**：真实 DB 持久化（Prisma 实现写完未验）、真实浏览器执行（解释器/runner 写完未在本机跑过）、真全栈（compose/BullMQ/MinIO 未实启）、真实旅程一周误报率（dogfooding 未开始）。
- 结论：**MVP 的功能面已收尾，交付状态 = 「待 jojo 本机验收」**；上面 (B) 五项跑完且 dogfooding 误报数据达标，才算 DoD 完整达成。

### V1 Backlog（收尾状态，后续立项从这里取）

来自 roadmap-v2 与各周顺延项登记，按建议优先级：

1. 代码轨 CI 门禁（合并/发布拦截）+ Git 同步的 Web 管理（MVP 只有文件夹约定 + 手动同步）。
2. flaky 自动隔离区（quarantine 工作流：自动打标、到期提醒、隔离期不告警不计门禁）——Week 4 只做了榜 + 建议。
3. 告警升级链（escalateAt 已落字段，缺定时升级动作）+ 抑制/聚合完善（上游 down 抑制下游、同主机合并）。
4. codegen 录制导入 DSL 草稿（录制 → 可编辑草稿，定位质量按官方推荐口径）。
5. SLA 月报（分钟桶口径落地后替换公开状态页的 incident 近似口径）+ MTTD/MTTA/MTTR 报表。
6. Worker 槽位准入控制（Week 3 只记录/展示 capacity，未做调度准入）+ 节点管理页完善。
7. quorum 部分判定定时扫描（`allowPartial` 入口已留，缺 judge 超时扫描任务）。
8. Git 同步（用例仓库自动拉取/版本对齐）与 Allure 格式导出、RBAC 项目级细化 + 真鉴权（替换 header 骨架）。
9. S3/MinIO 产物实存（替换 stub）——是否提前到 V1 第一项，看 (B)-3 的验收结论。

## 上一里程碑：Week 3（2026-10-31 完成）

负责范围：Worker 节点模型 + 多地域调度与 quorum 判定 / 维护窗口 / Heartbeat 转真 / 产物保留与过期清理 / storageState 登录预设（含 DSL `login_preset` 步骤）/ 双轨对照。全部在内存仓库 + 进程内分发 + fake 通知器下可测（本机三大阻塞未解，见下）。

### Week 3 清单

| 项 | 状态 | 证据 |
|---|---|---|
| Worker 节点模型 + 注册/心跳/列表 | ✅ | domain `WorkerNodeService`（`apps/api/src/domain/week3-services.ts`）：在线 = `lastHeartbeatAt` 在 60s 内（派生不落库）；`POST /workers/register`、`POST /workers/:id/heartbeat`（更新槽位/版本/最后心跳）、`GET /workers`，workers stub 模块已替换；单测覆盖在线→离线（>60s）→心跳恢复在线、未知节点 404 |
| 多地域调度 | ✅ | `SchedulerService.tick` 按 `plan.regions` 逐地域建单，`groupId = planId@scheduledAt` 全组共享，幂等键扩为 `(planId, scheduledAt, region)`（仓库 insert 守卫 + schema `@@unique` 同步）；queue 策略释放时整组放行；单测：3 地域 3 单同组 + 重复 tick 幂等 |
| Quorum 判定层 | ✅ | domain `QuorumJudgeService`：执行完成钩子改走 judge（单地域计划直通 Week 2 状态机，行为不变）；**必须等齐计划地域数的成员才判**（组员逐个到达，先到者不触发半组误判，实现期实测发现并修正）；判定幂等落新表 `group_verdict`；规则表见 decisions.md Week 3 条；单测：2/3 down、1/3 不 down、全 infra 不喂业务失败（只记一次 infraCount）、单幸存投票 degraded 照常判定、每组只喂状态机一步（阈值 2 需两组 down）、重复 judge 不重复喂 |
| 状态机消费组判定 | ✅ | `MonitorStateService` 抽出共用迁移核心 `applyOutcome`，`onGroupVerdict` 与单执行路径共用；一个组判定 = 一个状态机步；incident 的 `regionVotes` 落真实明细（votes/downVotes/upVotes/degraded）+ `quorumDetail` 人话描述进告警正文 |
| 维护窗口 | ✅ | domain `MaintenanceService`（一次性 startsAt/endsAt + 周期 cronExpr+durationMinutes，均按窗口时区评估）+ CRUD 接线；窗口内：执行照常记录、状态迁移照常但打 `suppressedByMaintenance=true`、**不开 incident、不发任何通知**（含窗口内恢复的关单通知）；窗口前已开的 incident 保留不洗白；被抑制的 down 在窗口结束后的**下一次判定**补开 incident（不 retro-fire，口径见 decisions）；stats 概览给窗口中的监控单独展示态 `displayStatus=maintenance`（已 down 的不被洗白）；单测 3 个（抑制+补开、窗口内静默恢复、周期窗口匹配+项目级命中） |
| Heartbeat 转真 | ✅ | domain `HeartbeatService`：建监控回 token **仅一次**（落库只存 sha256 哈希 + 前缀，DTO 永不回哈希）；`ANY /api/heartbeat/:token` 打点（token 本身即鉴权、无需租户头，理由见 decisions），坏 token 404；`scanHeartbeats(now)` 以 **1.5× 宽限**判 down → 开 incident（`sourceType=heartbeat`）+ `heartbeat_down` 告警，恢复打点自动关单 + `heartbeat_recovered`，去重同 Week 2（一单一 opened）；定时器适配器在 `UIP_SCHEDULER_ENABLED` 下顺带扫描；单测全周期（宽限内不判/超限判 down/重复扫描不重复开单/恢复关单）+ HTTP 冒烟（打点 200、坏 token 404） |
| 产物保留与过期清理 | ✅ | 保留期在执行完成时按结论落 `expiresAt`（passed/flaky 7 天、failed/timeout 30 天），incident 打开时把触发执行/整组的产物顺延到 **90 天**并打 `incidentLinked`；domain `ArtifactCleanupService.cleanupExpiredArtifacts(now, {dryRun})` 经存储接口删除（`LocalArtifactStorage` 真删本地文件、S3 实现为接口 stub 且删除显式抛错、绝不假删）；删存储成功才软删记录（`deletedAt`）；`POST /admin/artifacts/cleanup?dryRun=` 手动触发 + 定时器每日一次（`UIP_CLEANUP_ENABLED=true`）；单测覆盖保留赋值/顺延/dry-run 不删/四种到期组合 |
| storageState 登录预设 | ✅ | 环境级预设按角色存（元数据在 `Environment.storageStatePresets`，state 文件经**共享信封加密**落 artifacts 根目录、S3 风格 key）；domain `StorageStateService.ensureStorageState` 按 TTL（默认 7 天）判 fresh/expired/missing（expired/missing → needsLogin）；worker 侧：新模块 `login-preset.ts`（`LoginPresetResolver` + 文件/内存两种 source + `applyStorageState` 做 addCookies 与 localStorage 注入）、DSL 新增 **`login_preset` 步骤**（value=预设名，缺省取用例级 `loginPreset`，缺失/过期时步骤明确报错提示刷新），job 带 `storageStatePath` 时浏览器池建 context 直接注入的 Week 1 钩子已接线；单测 7 个（逻辑级，fake source/context/page，已标注非真实浏览器） |
| 双轨对照验证 | ✅（形状/解析级） | 同一「登录旅程」DSL fixture vs 代码轨 reporter JSON fixture → 统一模型逐项对照：执行级字段键集合一致、步骤键集合/序号/状态一致、名称按代码轨「套件 > spec」口径取 spec 部分对照；worker 单测 `dual-track-shape`；**仍非真实浏览器双跑**（阻塞 #2 未解，如实标注） |
| 测试 | ✅ 43/43 | 原有 21 + 新增 22（api week3 14：worker 节点、多地域调度、quorum ×5、维护窗口 ×3、stats 维护展示、heartbeat 全周期、产物保留+清理、storageState TTL；worker 8：预设解析 ×4、注入逻辑 ×1、`login_preset` 步骤 ×2、双轨对照 ×1）。`pnpm -r run test` 全绿 |
| 构建 | ✅ 全绿 | @uip/dsl、@uip/shared、@uip/notifiers、@uip/worker、@uip/api、@uip/web 均 build 通过 |
| HTTP 冒烟 | ✅ | 内存模式起 api 实测：workers register（online/freeSlots 正确）/heartbeat（槽位更新）/list、心跳监控创建（回 token 一次、DTO 只有 tokenPrefix）+ 打点 200 `{ok:true}` + 坏 token 404、维护窗口建+按项目列、cleanup dryRun 返回 `{scanned, expired, deleted:0, dryRun:true}` |

### 已知阻塞（Known Blockers，Week 3 复查后 unchanged）

1. **Prisma 引擎二进制下载被网络阻断**：Week 3 开工复查 `prisma validate` 仍在下载引擎时 `Error: aborted / ECONNRESET`。Week 3 的 schema 变更（新增 `worker_node`/`group_verdict` 两表；`execution.groupId` + 三元唯一键；`artifact.incidentLinked/deletedAt`；`incident.sourceType/sourceId`；heartbeat 表 token 改哈希列；`environment.storageStatePresets`；`maintenance_window` 补 projectId/durationMinutes/timezone 等字段）已同步进 schema.prisma，但**全部未经 prisma validate 官方校验**、Prisma 仓库实现（含 Week 3 四组新仓库）未经真实 DB 验证。补验命令同 Week 1。
2. **本机无可用浏览器**：Week 3 复查 `~/.cache/ms-playwright` 仍为空/不存在，未变。影响同前：DSL `login_preset` 与双轨对照只能做 fake/解析级逻辑测试，未声称真实浏览器运行。
3. **本机无 Docker**：Week 3 复查 `docker: command not found` 未变。compose 未实启、BullMQ 真实分发、MinIO/S3 产物实存均未验；产物存储接口已就位（本地实现真删、S3 stub），待阻塞解除后接真。

### 其他如实标注（Week 3）

- quorum 的「部分判定」（judge 超时后按已到成员先判）留了 `judgeGroup(groupId, { allowPartial: true })` 入口，本期未接定时扫描：当前语义是组永远等齐——worker 侧执行各有 timeout、终态最终会到齐，不会无限挂起；定时部分判定排 Week 4 顺延项。
- heartbeat incident 与 plan incident 共用 incident 表：以 `sourceType/sourceId` 为权威区分来源；`planId` 列对 heartbeat 单暂填 heartbeat id 以兼容 schema 非空约束（启用 Prisma 前需复核该列约束）。
- storageState 文件当前走本地 artifacts 根目录（与 LocalArtifactStorage 同根）；S3/MinIO 实存待 Docker 阻塞解除后接同一存储接口。**安全口径：storageState == 凭证，同级保护**（信封加密落盘、DTO 不回明文、日志不打印），已写入 decisions。
- worker 节点的 capacity（totalSlots/usedSlots）本期只记录与展示，调度分发尚未按槽位做准入控制（BullMQ 队列本身限流）；槽位准入排 Week 4 评估。

## 上一里程碑：Week 2（2026-10-31 完成）

负责范围：Plan 模块真实现 + 调度器（tick 核心）/ 监控状态机 / 告警闭环（规则+分发+incident）/ 代码轨最小闭环 / 仪表盘接真 API。全部在内存仓库 + 进程内分发下可测。

### Week 2 清单

| 项 | 状态 | 证据 |
|---|---|---|
| Plan CRUD + enable/disable（cron/时区/阈值/并发策略校验） | ✅ | domain `PlanService`（`apps/api/src/domain/week2-services.ts`）；cron 自研严格 5 段解析器 `domain/cron.ts`（cron-parser 只是 BullMQ 传递依赖、非 api 直接依赖，未直接 import）；时区用 DateTimeFormat 构造校验（实测 Node 24 的 `supportedValuesOf` 不含 "UTC"，已避坑）；Nest HTTP 冒烟：建 plan 200、坏 cron 400 |
| 调度器核心 `tick(now)`（框架无关） | ✅ | domain `SchedulerService`：游标 `plan.lastScheduledAt` + `(planId, scheduledAt)` 唯一键双保险幂等；漏跑只取最近触发点、不补风暴；skip/queue/parallel 三策略（queue = 建单打 `pendingDispatch` 标记、后续 tick 在无活跃单时释放最老一单）；单测覆盖幂等/漏跑/skip/queue 四个场景 |
| 定时器适配器 | ✅ | `apps/api/src/plans/scheduler.timer.ts`：setInterval 30s 调 tick，`UIP_SCHEDULER_ENABLED=true` 才启用（默认关，防多实例重复调度），租户取 `UIP_TENANT_IDS`；生产路径仍推荐 BullMQ Job Scheduler 调同一个 tick 核心 |
| 监控状态机（up→suspect→down→recovered） | ✅ | domain `MonitorStateService` + 新表 `monitor_state`（schema 已加，待 validate）；口径：连续失败达 `failThreshold` 才 down、down 后连续成功 2 次才 recovered、suspect 成功即静默回正；**infra_failed 只加 infraCount 不动状态**；flaky 算成功另加 flakyCount；迁移历史内嵌落库；单测覆盖全路径 |
| 告警规则 CRUD（通道 target 按密钥处理） | ✅ | domain `AlertRuleService`：feishu/wecom/webhook 通道，target 落库前信封加密、DTO 只回 `scheme+host/***` 掩码；HTTP 冒烟验证掩码；单测验证落库密文不含 token |
| 告警分发 + 去重 + incident 闭环 | ✅ | domain `AlertDispatchService`（接 @uip/notifiers 真实实现，测试用 fake factory 捕获）：仅状态迁移触发；同 incident 同 kind 已有成功发送则跳过（状态机单次触发 + notification_log 核查双保险）；down 开 incident（`escalateAt = startedAt + 15min`，MVP 只落字段）、recovered 自动关单落 `durationMs`；`POST /incidents/:id/ack` 已实现并单测 |
| 代码轨最小闭环 | ✅（解析器级别） | `POST /projects/:id/cases/code` 建 code 用例（sourceRef 文件夹约定、禁 `..` 穿越）→ dry-run 经同一 ExecutionService 分发（payload 带 track=code + sourceRef）→ 结果回写同一统一模型；`GET /executions?projectId=` 双轨同一列表带 track/caseName；**本机无浏览器，分发段以与 reporter-parser 同形状的统一结果做解析器级别模拟测试，未声称真实浏览器运行** |
| 仪表盘 + 执行列表（Web） | ✅ | `GET /stats/overview`（domain `StatsService`）+ Dashboard.vue 接真实 API（今日执行/成功率/down 数/监控状态表/最近失败）；Executions.vue 接统一列表并加轨道徽章列（DSL/代码）；口径：**成功率分母 = 今日终态（passed/flaky/failed/timeout），剔除 infra_failed 与 queued/running/cancelled，flaky 计成功**；单测覆盖口径 |
| 测试 | ✅ 21/21 | 原有 11（dsl 3、shared 2、worker reporter 1、api domain 5）+ 新增 10（api week2：cron 校验、cron 时区触发点、tick 幂等、漏跑不补、skip 策略、queue 策略、状态机全路径+告警只发一次+ack+自动关单、infra 不计业务失败+flaky、overview 口径、代码轨统一列表）。`pnpm -r run test` |
| 构建 | ✅ 全绿 | @uip/dsl、@uip/shared、@uip/notifiers、@uip/worker、@uip/api、@uip/web 均 build 通过；api 新增直接依赖 @uip/notifiers（workspace 链接） |
| HTTP 冒烟 | ✅ | 本地起 api（内存仓库）：projects/environments/cases/plans/alert-rules/run-now/executions/stats/overview/disable 全链路实测返回正确；run-now 在计划刚建、未到触发点时不建单（游标语义正确） |

### 已知阻塞（Known Blockers，Week 2 复查后 unchanged）

1. **Prisma 引擎二进制下载被网络阻断**：Week 2 复查 `prisma validate` 仍在下载引擎时 `Error: aborted / ECONNRESET`。Week 2 新增的 `monitor_state` 表与 plan/incident/notification 的新字段已同步进 schema.prisma，但**schema 变更未经 prisma validate 官方校验**、Prisma 仓库实现（含 Week 2 五组新仓库）未经真实 DB 验证。补验命令同 Week 1。
2. **本机无可用浏览器**：Week 2 复查 `~/.cache/ms-playwright` 仍为空，其余两路（系统定制 Chromium、其他浏览器）未再重复验证（Week 1 已逐一实测）。影响同前：demo:e2e 浏览器段、代码轨真实浏览器运行无法在本机完成；代码轨本周以解析器级别模拟测试覆盖并如实标注。
3. **本机无 Docker**：Week 2 复查 `docker: command not found` 未变。compose 未实启、BullMQ 真实分发未验，继续以进程内分发 + 内存仓库覆盖同一服务层语义。

### 其他如实标注（Week 2）

- Nest 各模块中 plans/alerts/incidents 已接线真实服务，新增 stats 模块；剩余 stub：auth/workers/status/heartbeat（Week 3 起 heartbeat 要转真实现）。
- `AlertRule` 的 Prisma 实现中 condition 字段暂写 `{}` 占位（领域层 Week 2 不用 condition，规则语义由 scope+状态机承担）；启用 Prisma 时需一并核对。
- MonitorState 的 history 在 Prisma 模型为 Json 内嵌，与领域层数组结构对应，启用时注意 Date 序列化为 ISO 字符串。
- 调度器租户范围：tick 按租户调用；timer 适配器从 `UIP_TENANT_IDS` 取租户列表，多租户枚举接口属后续里程碑。

## 下一里程碑：Week 4（硬化与交付）

目标：把平台从「本机内存可测」推进到「在 jojo 的机器/网络环境可真实验收 + 可对内试用」。本机三大阻塞（Prisma 引擎下载、浏览器、Docker）不在本 VM 内硬解，改为给出可直接执行的验收清单。

1. **本地环境验收清单（jojo 机器执行，结果回填本文件）**：
   - `pnpm demo:e2e`：真实浏览器跑通 DSL 登录旅程并回写统一结果（解阻塞 #2 的验收）；
   - `prisma validate` + `prisma generate` + 首次 migrate：补 Week 2/3 全部 schema 欠账（monitor_state、worker_node、group_verdict 及各表新字段），切 `UIP_REPOSITORY=prisma` 后把 Week 1–3 的 HTTP 冒烟全链路重跑一遍（解阻塞 #1 的验收）；
   - `docker compose up`：PG/Redis/MinIO 实启后，BullMQ 真分发跑一条计划单、产物落 MinIO（S3 存储实现替换 stub）各验一次（解阻塞 #3 的验收）。
2. **flaky 榜**：基于 step_result/execution 历史出 flaky 用例排行（flaky 次数、flaky 率、最近一次 flaky 时间），Dashboard 增加排行区块；flaky 自动隔离仍属 V1 本期不做。
3. **公共状态页打磨**：状态页展示各 plan 当前状态（含 Week 3 的 maintenance 展示态与心跳监控状态）、近 24h 可用率；只读公开路由的口径（不带租户敏感信息）写清并落地。
4. **README 部署指南**：从零部署全步骤（env 清单、主密钥 `MASTER_KEY_B64` 生成、compose 起停、数据卷与备份提示）、常见故障排查（Prisma 引擎下载失败、Playwright 浏览器安装、端口占用、调度器多实例开关）。
5. **Dogfooding**：拿平台监控 3 条真实旅程（候选：Dataify 控制台登录、营销页关键路径、一个内部工具），连续观察一周，误报/漏报逐条记录回填本文件，作为 V1 立项（flaky 隔离、告警升级链、槽位准入）的数据依据。
6. **顺延项登记**（本期评估、不默认全做）：quorum 部分判定的定时扫描（`allowPartial` 入口已留）、worker 槽位准入控制、infraCount 阈值的独立 infra 告警、heartbeat incident 的 planId 列约束复核。

---

## 上一里程碑：Week 1 收尾（2026-10-31 完成）

负责人模型：Muse 按里程碑实现，jojo 验收（见 decisions.md 2026-10-31 第二条）。

### Week 1 清单

| 项 | 状态 | 证据 |
|---|---|---|
| compose 骨架（PG/Redis/MinIO/API/Worker） | ✅ 骨架完成（文件层） | `deploy/docker-compose.yml`（上一里程碑）；本机无 docker 命令，未实启，如实标注 |
| Prisma schema 复验（validate/generate） | ⛔ 阻塞（网络） | 见下方阻塞 #1：两次重试均在 @prisma/engines postinstall / validate 下载引擎时 `ECONNRESET`；已按预案走仓库抽象，未阻塞里程碑 |
| 仓库抽象（接口 + 双实现） | ✅ | `apps/api/src/domain/repositories.ts`；内存实现全量可用；Prisma 实现 `domain/prisma.ts` 已写完、未经真实 DB 验证；`core.module.ts` 按 `UIP_REPOSITORY` 选择、Prisma 不可用自动回退内存并告警 |
| 项目 CRUD（软删/slug 租户内唯一/tenant 过滤） | ✅ | domain `ProjectService` + Nest 路由；实测 HTTP：建/列 200、重 slug 409、非法 slug 400 |
| 环境 CRUD（baseUrl 校验/单默认规则） | ✅ | domain `EnvironmentService` + 单测覆盖单默认规则与 400 |
| 环境变量 CRUD（密钥信封加密落库、API 永不回明文/密文、审计桩） | ✅ | domain `EnvVariableService`（@uip/shared AES-GCM）；单测 round-trip 覆盖；DTO 恒为 `********` 掩码 |
| DSL 用例最小闭环（建用例原子建 v1、取最新版、追加版本递增） | ✅ | domain `CaseService` + 单测覆盖 v1→v2→v3 与坏 DSL 400 |
| 执行最小闭环（dry-run 建 queued execution 绑版本、可插拔分发、详情含 step_results/artifacts） | ✅ | domain `ExecutionService`；分发接口 `ExecutionDispatcher`：BullMQ 适配（`UIP_DISPATCH=bullmq`，需 Redis）/ 进程内实现（测试与演示用）；快照落库前按密钥 key 掩码 + redactObject 双重脱敏 |
| DTO 校验（zod，400 带字段信息） | ✅ | `domain/validation.ts` + `DomainExceptionFilter`（Nest 全局过滤器） |
| 端到端演示脚本 | ✅ 已落地；⚠️ 本机运行结果 = 基础设施阻塞（如实报告，非通过） | `pnpm demo:e2e`（`scripts/demo-e2e.mjs` + `e2e-fixtures/local-site/` 本地登录站 + `e2e-fixtures/dsl/login-local.example.json`）。本机实跑：服务层全流程通过（项目/环境/密钥变量/用例/dry-run），execution 落 `infra_failed` 且记录了原因，退出码 2。阻塞原因见 #2。在装有 Playwright Chromium 的环境同一命令应以 `status=passed` + 退出码 0 通过（脚本内含断言与逐步打印） |
| 测试 | ✅ 11/11 | 原有 6（dsl 校验 3、shared 脱敏 2、worker reporter 解析 1）+ 新增 5（api domain：密钥 round-trip、slug 唯一 409、单默认环境、用例版本递增、dry-run 快照脱敏与分发）。`pnpm -r run test` |
| 构建 | ✅ 全绿 | @uip/dsl、@uip/shared、@uip/notifiers、@uip/worker、@uip/api、@uip/web 均 build 通过 |

### 已知阻塞（Known Blockers）

1. **Prisma 引擎二进制下载被网络阻断**（自上一里程碑延续）：`pnpm install`（不加 --ignore-scripts）第 1 次为 Already-up-to-date 未触发下载；`pnpm install --force` 触发 @prisma/engines postinstall 后在下载时 `ECONNRESET / attemptNumber: 1` 失败；`prisma validate` 同样在下载引擎时 `ECONNRESET`。已在两次尝试后停止重试（符合预案）。影响：schema 未经 `prisma validate` 官方校验、Prisma 仓库实现未经真实 DB 验证、api 默认跑内存仓库。网络恢复后补验：`pnpm install && pnpm --filter @uip/api exec prisma validate && pnpm --filter @uip/api exec prisma generate`，再设 `UIP_REPOSITORY=prisma` 启用。
2. **本机无可用浏览器**：三路皆断——(a) Playwright 自带 Chromium 下载失败：full 包从 `https://cdn.playwright.dev/builds/cft/156.0.8078.4/linux64/chrome-linux64.zip` 下载时 TLSSocket 超时（270s）；`--only-shell` 亦报 `Download failure, code=1`，`~/.cache/ms-playwright` 为空。(b) 系统 Chromium（/opt/meta-chromium）是 Hatch 定制构建，启动要求 browser-daemon 提供的 WebGL policy（报错 `Hatch WebGL domain policy is required for browser startup`），不能独立被 Playwright 驱动。(c) 机器上无其他 chrome/chromium/firefox。影响：demo:e2e 的浏览器执行段与代码轨真跑在本机无法完成；DSL 解释器/worker 代码已构建通过且逻辑由 reporter 解析单测等覆盖，但未在本机真跑过浏览器。已给 BrowserPool 增加 `executablePath` / `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 支持，任意一路恢复即可直接复跑 `pnpm demo:e2e` 验收。
3. **本机无 Docker**：`docker: command not found`，compose 未实启（仅文件层就绪）。影响：PG/Redis/MinIO 实启、BullMQ 真实分发未验，当前以进程内分发 + 内存仓库覆盖同一服务层语义。

### 其他如实标注

- Nest 各模块中 projects/environments/cases/executions 已接线真实服务；其余模块（plans/alerts/incidents/workers/status/heartbeat/auth）仍为骨架 stub，属 Week 2+ 范围。
- 租户/操作者目前取自 header（x-tenant-id/x-actor），真实鉴权接入前禁止对外暴露（见 domain/tenant.ts TODO）。
- Prisma 实现中 case+version 的原子性需在启用时用 $transaction 包裹（代码内已标注）。

## Week 1 当时规划的下一里程碑：Week 2（精确范围，已由上方 Week 2 章节执行完毕）

目标（沿 roadmap-v2）：**BullMQ cron 计划 + 连续失败阈值/状态机 + 飞书/企微告警**，加代码轨最小闭环（roadmap-v2 已排入第 2 周）。

1. Plan 模块真实现：plan CRUD（cron 表达式校验、时区、failThreshold、concurrencyPolicy）、到期扫描/Job Scheduler 建 execution 的幂等逻辑（(planId, scheduledAt) 唯一键已在 schema 中）。
2. 判定状态机：单次结果 -> monitor 状态 up→suspect→down（连续失败达阈值）→recovered，状态迁移落库；仅状态迁移触发告警事件。
3. 告警：alert_rule 真实现 + 飞书/企微通道接 @uip/notifiers（已具备真实 POST）做 opened/recovered 通知 + 去重窗口；通知流水落 notification_log；incident 建/关单最小闭环。
4. 代码轨最小闭环：spec 文件夹约定 + code-runner 经队列分发真跑（需浏览器环境，先解阻塞 #2 或在有浏览器的环境验）+ 与 DSL 轨同列表展示。
5. 简单仪表盘：web 首页接真实 API（今日执行数/成功率/最近失败/各 monitor 状态）。
6. 若网络恢复：先补 Prisma validate/generate 与 BullMQ/Redis 实启验证（解阻塞 #1/#3）再做 1–3 的持久化验收。
