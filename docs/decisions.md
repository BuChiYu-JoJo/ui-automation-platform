# 决策记录

## 2026-10-31：Week 4 口径（可用率 incident 近似 / 隔离只建议 / 状态页数据最小化）

- 决策人：Muse（按 jojo 委托的主导推进模式，在里程碑边界内定口径，jojo 验收时可推翻）。
- 内容：
  1. **公开状态页 30 天可用率用 incident 时长近似 downtime**：平台没有分钟桶时序数据（专用 TSDB 按 roadmap 是 V2 才评估），精确口径无数据源。近似公式：downtime = 窗口内该 plan 各 incident 的重叠时长 − 与维护窗口重叠的部分；可用率 = (30 天总分钟 − 维护窗口总分钟 − downtime) / (30 天总分钟 − 维护窗口总分钟)，维护分钟按窗口区间并集算。已知偏差（写在 PublicStatusService 文件头）：incident 在连续失败达阈值后才打开，suspect 期与检测延迟不计 downtime（结果偏乐观）；heartbeat 型 incident 不计入 plan 可用率。理由：先给一个**口径公开、可复算**的近似值，好过状态页没有可用率或编造分钟桶；SLA 月报（V1 backlog）落地分钟桶后替换此数据源，公式不变。
  2. **flaky 隔离只给建议、不自动隔离**：Week 4 落地 flaky 榜 + `quarantineSuggested`（率 > 20% 或窗口内最长连续 flaky ≥ 5，两条任中即建议；连串口径是近似——只算窗口内可见的最长串，窗口边界之前的状态未知）。自动隔离（quarantine 工作流：打标、到期、隔离期不告警）按 roadmap 留 V1。理由：自动隔离会改变告警行为，属于「平台替人做决定」，必须先有 dogfooding 一周的真实 flaky 数据支撑阈值，再自动化；且连串口径在窗口边界上是近似值，拿近似值做自动动作风险不对等。展示建议 + 人工决定是 MVP 的正确边界。
  3. **公开状态页数据最小化**：免登录端点只出五类信息——项目展示名、监控展示状态、最近判定时间、30 天可用率、进行中 incident 的监控名/开始时间/已持续秒数。内部 id（planId/caseId/incidentId/tenantId）、环境名与 baseUrl、执行快照与变量、错误详情与 incident.summary、产物引用、告警通道与 webhook 一律不出，并有单测用禁用词清单断言整个 JSON。项目按 slug 全局查（状态页 URL 无租户上下文）是这条口径的配套：只读、脱敏、进程内限流 60 次/分钟/IP（正式限流上线时下沉网关，代码留 TODO）。理由：状态页是对外攻击面，能少给一律少给；可用率/状态这类聚合值足够对外沟通，多给的每一项都是泄漏面。
- 执行结果：Week 4 (A) 部分已按此口径落地，全仓单测 50/50、构建全绿、HTTP 冒烟通过（见 PROGRESS Week 4 章节）；(B) 本机验收五项待 jojo 执行回填。
- 状态：已执行，待 jojo 验收本里程碑（即 MVP 收尾验收）。

## 2026-10-31：Week 3 口径（quorum 规则表 / 维护窗口延迟告警 / heartbeat 宽限 / storageState 保护）

- 决策人：Muse（按 jojo 委托的主导推进模式，在里程碑边界内定口径，jojo 验收时可推翻）。
- 内容：
  1. **Quorum 判定规则表**（`QuorumJudgeService`，组 = 同 plan 同触发点跨地域的一组执行；票型：passed/flaky=赞成票，failed/timeout=反对票，infra_failed/cancelled=弃权不投票；V=有效票数，D=反对票数，P=计划地域数）：
     | 情形 | 判定 |
     |---|---|
     | P=1 | 不走 quorum，单结果直通 Week 2 状态机（行为不变） |
     | V=0（全弃权） | verdict=infra：不喂业务失败，只给状态机记一次 infraCount |
     | D ≥ 2 | down |
     | V=1 且 D=1 | down（单幸存投票者决定，但 degraded=true） |
     | 其余 | up |
     推论：3 地域需 ≥2 反对才 down、1/3 反对不 down；2 地域需 2 票反对（任一地域通过即不算 down，可用性优先）；`degraded = V < P`（有地域弃权/缺席时判定仍生效但打降级标，incident 与告警正文带 quorumDetail）。附带两条实现口径：判定必须**等齐 P 个成员**才触发（组员逐个到达，先到者不得触发半组误判——实现期实测发现的问题，已修正并有注释）；判定结果按 groupId 落库幂等，重复触发不重复喂状态机。一个组判定 = 状态机的一个步（连续 down 判定才推进 suspect→down）。
  2. **维护窗口的延迟告警口径**：窗口内状态迁移照常记录（打 `suppressedByMaintenance=true`）但不开 incident、不发通知——包括窗口内恢复时的关单通知也一并静默（incident 本身照常关单，数据真实、只是不打扰）。被抑制的 down **不在窗口结束瞬间 retro-fire**：窗口结束只恢复正常判定，仍处于 down 且无 open incident 时，由窗口后的**下一次失败判定**补开 incident 并发 opened。理由：窗口结束瞬间补发会把「已自愈的历史故障」也报出来（窗口内恢复的情况就不会补开，天然正确），且告警时间应对应「现在仍在故障」这一事实；代价是极端情况下（窗口后计划被停用）down 状态会留在面板上无 incident，以 stats 的 maintenance/down 展示态兜底可见。窗口前已开的 incident 不被窗口洗白，stats 展示态：窗口中且非 down 显示 `maintenance`，已 down 的仍显示 down。
  3. **Heartbeat 超时宽限 1.5×**：判 down 条件为 `now - lastSeenAt > expectIntervalSec × 1.5`。理由：定时任务的调度抖动、GC、时钟漂移普遍在半个周期内，1.0× 会误报、2× 又让真实宕机发现太慢，1.5× 是同类产品（healthchecks.io grace time 等）的常见折中。配套口径：token 只在创建时明文返回一次、落库只存 sha256 哈希；打点端点 `ANY /api/heartbeat/:token` 以 token 本身为鉴权（调用方是 cron/脚本，无租户会话上下文；token 128bit+ 随机且可按监控单独吊销），这是该端点不要求租户头的明确理由。heartbeat 的 down/恢复复用 plan 监控同一套告警分发与去重（notification kind 区分为 `heartbeat_down`/`heartbeat_recovered`），incident 以 `sourceType/sourceId` 区分来源。
  4. **storageState == 凭证，同级保护**：登录态文件（storageState）按凭证处理——共享信封加密落盘（与密钥变量同一把主密钥体系）、DTO/接口永不回明文、日志不打印内容、预设按「环境 × 角色」隔离。默认 TTL **7 天**（`ensureStorageState` 判 fresh/expired/missing，环境可配）：短于多数站点会话有效期、长于一周内的人工刷新成本；过期不自动跑登录用例刷新（自动刷新 = 平台持有密码，与「普通用例不接触密码」的 Week 1 口径冲突），只标 needsLogin 由人工/受控登录用例刷新，DSL `login_preset` 步骤在缺失/过期时明确报错而不是静默裸跑。
  5. 附带口径：产物保留期 passed/flaky 7 天、failed/timeout 30 天、incident 关联 90 天，在**执行完成时**按结论落 `expiresAt`（不靠清理任务回算），incident 打开时顺延其触发执行/整组产物到 90 天；清理只做「到期删除 + dry-run 预演」，删除经存储接口（本地实现真删、S3 未接通前 stub 显式抛错，禁止假装删除成功）。
- 执行结果：Week 3 已按此口径落地，单测 43/43（新增 22）、构建全绿、HTTP 冒烟通过（见 PROGRESS Week 3 章节）；三大环境阻塞复查未变，Week 3 的 schema 变更同样未经 prisma validate，已如实标注。
- 状态：已执行，待 jojo 验收本里程碑。

## 2026-10-31：Week 2 范围口径（monitor_state 存储 / infra 不计业务失败 / 漏跑不补）

- 决策人：Muse（按 jojo 委托的主导推进模式，在里程碑边界内定口径，jojo 验收时可推翻）。
- 内容：
  1. **monitor_state 独立建表**：监控状态机当前态从「塞进 plan/incident 推导」改为独立表 `monitor_state`（每 plan 一行：状态、连续成功/失败计数、flaky/infra 累计、openIncidentId、迁移 history 内嵌 Json）。理由：状态机是热路径（每次执行完成都要读写），独立表 + 领域仓库接口与 Week 1 仓库抽象一致；history 量级小（只在迁移时追加），内嵌 Json 足够，不单开迁移表。代价：schema 新增表，而 Prisma 引擎仍被网络阻断，新表与 Week 2 的其他 schema 变更（plan 调度游标、incident 的 escalateAt/durationMs、notification_log 的 kind）**均未经 prisma validate**，已在 PROGRESS 如实标注，网络恢复后第一件事补验。
  2. **infra_failed 不计业务失败口径**：execution 落 infra_failed（分发失败、浏览器/Worker 基础设施问题）时，状态机只累加 infraCount，绝不推进 suspect/down、不告警。理由：监控平台自身故障与被测系统故障是两个可用性口径，混在一起会产生「平台挂了却给业务方发 down 告警」的错误归因，也会污染 SLA/成功率（stats 成功率分母同步剔除 infra_failed）。代价：平台自身故障需要独立的 infra 告警通道（infraCount 阈值告警），本期只计数展示，阈值告警留后续。
  3. **漏跑不补跑风暴 policy**：调度器宕机/延迟恢复后，只取窗口内最近一个触发点建单，中间漏掉的触发点直接丢弃。理由：合成监控的历史点补跑没有业务意义（测的是「现在是否可用」），而补跑会在恢复瞬间打出成倍的浏览器流量，既压被测系统也让状态机被过期结果污染。此 policy 与幂等游标（lastScheduledAt）是一套：游标只前进到已处理的最近触发点。
  4. 附带口径：down 后需**连续成功 2 次**才 recovered（单次成功可能只是抖动恢复）；suspect 阶段一次成功即静默回正（未开 incident 前不发任何通知，防告警疲劳）；告警只在状态迁移时发送，升级（escalation）本期只落 `escalateAt` 字段不做动作，升级链 V1。
- 执行结果：Week 2 已按此口径落地，单测 21/21、构建全绿、HTTP 冒烟通过（见 PROGRESS Week 2 章节）；三大环境阻塞（Prisma/浏览器/Docker）复查未变。
- 状态：已执行，待 jojo 验收本里程碑。

## 2026-10-31：jojo 委托 Muse 主导推进；Week 1 收尾范围

- 决策人：项目发起人（jojo）——原话「你直接继续，项目交给你负责」。
- 内容：
  1. 项目由 Muse 负责按里程碑推进实现，jojo 负责评审/验收，不再逐项等 jojo 拍板才动手；里程碑边界仍以 roadmap-v2 为准，超边界事项（部署、对外部署动作、真实凭证接入等）仍需单独确认。
  2. 本里程碑（Week 1 收尾）范围：Prisma 复验（网络阻塞则走仓库抽象不阻塞）、项目/环境/变量真 CRUD（密钥加密落库、只进不出）、用例版本与 dry-run 最小闭环、端到端演示（本地站点 + 真实浏览器执行 + 结果回写）为验收标准。
- 执行结果：服务层与演示脚本已落地、测试 11/11、构建全绿；Prisma 引擎与 Playwright 浏览器二进制均因本机出网下载失败而阻塞，已如实记录在 docs/PROGRESS.md（阻塞 #1/#2），未伪造通过。
- 状态：已执行，待 jojo 验收本里程碑。

## 2026-10-31：TS 全栈 + 双轨一起上

- 决策人：项目发起人（jojo）
- 内容：
  1. 技术栈定 TypeScript 全栈：Vue 3 + NestJS + PostgreSQL + Redis/BullMQ + Playwright Worker + MinIO，docker-compose 起步。
  2. MVP 同时做 DSL 轨与代码轨（推翻调研路线图"代码轨推迟 V1"的排期），双轨共用统一执行模型。
- 理由：
  - TS 与 Playwright 同语言同进程模型，codegen/storageState/trace 生态零翻译层，单人维护成本最低（调研报告 §6）。
  - 团队存量用例两种形态都有：监控旅程适合 DSL（存 DB、可调度下发），回归资产是代码（Git 真相源）；只做一轨都要在 MVP 后补另一套报表/告警，得不偿失。双轨统一模型让提前做代码轨的边际成本主要是 reporter 解析（已验证可测），可控。
- 代价与补偿：为保 2–4 周体量，状态页简化、flaky 自动隔离与 codegen 导入推后 V1（见 roadmap-v2.md）。
- 状态：已执行（本仓库骨架按此落地）。
