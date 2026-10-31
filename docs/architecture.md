# 架构设计（适配自调研报告 §2）

## 三层架构

```
控制面 Control Plane（无状态）: Web SPA / API（项目·环境·用例·计划·RBAC·审计）/ 调度器
数据面: PostgreSQL（业务真相源） / Redis（队列·锁·心跳） / S3-MinIO（截图·video·trace·HAR） / PG 聚合表（可用率，V1 再议时序库）
执行面 Execution Plane（重资源，独立扩缩）: Worker 节点 ×N（浏览器池 + DSL 解释器 + 代码轨 runner），可部署到异地/内网
告警: 判定后 -> 告警服务（去重/抑制/升级） -> 飞书/企微/钉钉/Email/Webhook -> 状态页（公开脱敏视图）
```

关键原则：
- 执行面与控制面解耦：Worker 只认领 job、心跳上报容量（总/空闲槽位、浏览器版本）、回传结构化事件。
- 多租户：tenant_id 贯穿所有表 + API 强制过滤 + S3 按 tenant/project/execution 前缀 + 队列 job 带租户配额。MVP 只预埋字段，不做计费/自助注册。
- 浏览器池：BrowserContext 隔离为默认粒度，context-per-execution 用完即弃；进程定额回收（默认 20 context / 200 次执行）；容器 --shm-size=2g。

## 八步核心数据流

1. 建用例：编辑器/Git 同步 -> case + case_version（执行永远绑版本）
2. 调度：plan(cron/时区/地域集/连续失败阈值/维护窗口) 到期 -> 以 (plan_id, scheduled_at) 唯一键幂等建 execution(queued)；监控类错过不补跑
3. 分发：入队 job{executionId, region} -> 对应 Worker 认领；排队超时 = infra_failed，不算被测失败
4. 执行：Worker 拉解密变量（仅内存）-> 建 Context（注入 storageState）-> 逐步执行 -> 每步回传 step_result
5. 收产物：Worker 直传 S3（预签名）-> 落 artifact 表（key/类型/大小/expires_at）
6. 判定：测试语义任一断言失败=fail；监控语义先单节点判定，再 quorum 汇总（3 节点 ≥2 失败才 down），状态机 up->suspect->down->recovered
7. 告警：只在状态迁移时触发 -> 去重 -> 抑制（维护窗口/依赖）-> 通道分发 -> 未确认按策略升级；恢复发 recovery 并关 incident
8. 展示：仪表盘读聚合表（可用率按分钟桶、MTTR/MTTA、flaky 榜）；状态页是同一数据的脱敏公开视图

## 双轨统一（2026-10-31 决策后新增）

底层只有一个 Playwright 内核、一个统一模型（@uip/shared 的 UnifiedExecution/UnifiedStepResult）：
- DSL 轨：apps/worker/src/dsl-runner.ts 解释 DB 中的步骤 JSON
- 代码轨：apps/worker/src/code-runner.ts spawn `playwright test --reporter=json`，reporter-parser.ts 转统一模型
报表、告警、产物、flaky 口径（先败后过=flaky）两轨完全一致。
