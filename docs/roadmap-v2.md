# 修订路线图 v2（双轨 MVP，2026-10-31 修订）

原调研路线图把代码轨推迟到 V1；用户拍板双轨一起上，本版据此重排，并等量砍掉其他内容保住 2–4 周体量。

## MVP（2–4 周，单人口径）— Definition of Done：真实监控 3–5 条生产旅程可靠告警 + 一组 Git 代码用例可调度执行

- 第 1 周：compose 骨架（PG/Redis/MinIO/API/Worker）-> 项目/环境/变量（密钥加密）-> DSL v1 解释器 -> 手动执行 -> step_result + 失败截图/trace 落 S3 -> 执行详情页。（= 本仓库骨架已覆盖的结构）
- 第 2 周：BullMQ cron 计划 + 连续失败阈值/状态机 -> 飞书或企微告警 + 恢复通知 -> **代码轨最小闭环（从 V1 提前）：spec 文件夹约定（e2e-fixtures/code 结构）+ Git 同步约定（先手动/脚本同步目录，不做 Web 端 Git 管理）+ JSON reporter 解析转统一模型** -> 简单仪表盘
- 第 3 周：第二 Worker 节点 + quorum -> 维护窗口 -> heartbeat 端点 -> 产物过期清理 -> storageState 登录预设 -> 代码轨与 DSL 轨在同一执行列表/报表里对照验证
- 第 4 周（缓冲）：flaky 标记展示（仅标记，不做自动隔离）-> 状态页（简化版，只读单页）-> 用本平台监控本平台 + 3 个真实旅程跑满一周看误报率

## 从 V1 提前到 MVP

- 代码轨：Git spec 同步（文件夹约定版）、playwright JSON reporter 解析、双轨统一报表

## 为双轨让路、推后到 V1 的

- 状态页：MVP 只做简化只读版（原计划的完整状态页/订阅放 V1）
- flaky 自动隔离区（quarantine 工作流）：MVP 只标记展示，自动隔离 + 到期升级仍 V1
- codegen 录制导入 DSL 草稿：推 V1
- 告警升级/聚合：MVP 只做去重 + 恢复通知，升级链 V1
- Allure 导出、SLA 月报、Worker 管理页：V1 不变

## 仍明确不做（Do-Not-Build-Yet）

拖拽流程设计器 / 真多租户计费与自助注册 / K8s 与自动扩缩 / Selenium·Cypress 第二引擎 / 真机 /
视觉回归 / 运行时自愈定位 / AI 生成用例 / 专用时序 DB / 电话告警与值班排班 / CI 门禁（代码轨 MVP 只调度执行，不做合并门禁）

## V1 / V2

V1：flaky 自动隔离区、代码轨 CI 门禁与 Git Web 管理、录制导入、告警全通道+升级、SLA 月报、RBAC 项目级细化。
V2：多地域探针产品化、K8s Worker 池、云网格 adapter、时序层升级、长流程事件编排评估。
