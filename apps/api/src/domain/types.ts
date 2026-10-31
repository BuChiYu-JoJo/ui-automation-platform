import type { DslCase } from "@uip/dsl";
import type { ExecutionStatus, StepStatus } from "@uip/shared";

/** 持久化记录类型（与 prisma/schema.prisma 一一对应，框架无关）。DTO 在 services 层另行组装，记录类型不直接出 API。 */
export interface ProjectRecord {
  id: string; tenantId: string; name: string; slug: string;
  description?: string; ownerId: string; status: "active" | "deleted";
  createdAt: Date; updatedAt: Date;
}
export interface EnvironmentRecord {
  id: string; tenantId: string; projectId: string; name: string; baseUrl: string;
  browserConfig?: Record<string, unknown>; isDefault: boolean;
  /** Week 3：storageState 登录预设（按角色）：state 本体是加密文件（artifacts 根目录下），
   *  这里只存引用 + 保存时间 + TTL。storageState 等同凭证，按密钥同级保护（见 week3-services）。 */
  storageStatePresets?: Record<string, StorageStatePresetInfo>;
  createdAt: Date; updatedAt: Date;
}
export interface StorageStatePresetInfo {
  /** artifacts 根目录下的相对 key（shared.storageStateKey 规范） */
  key: string;
  savedAt: Date;
  /** TTL 秒；缺省用 StorageStateService 的默认值（7 天） */
  ttlSec?: number;
}
export interface EnvVariableRecord {
  id: string; tenantId: string; environmentId: string; key: string;
  /** 非密钥：明文存 valuePlain。密钥：valuePlain 恒 null，只存 valueCipher（信封加密）。 */
  valuePlain: string | null; valueCipher: string | null;
  isSecret: boolean; kind: string; // variable | storage_state | totp_seed
  createdAt: Date; updatedAt: Date;
}
export interface CaseRecord {
  id: string; tenantId: string; projectId: string; name: string;
  type: "dsl" | "code"; sourceRef?: string; tags: string[]; ownerId?: string;
  status: string; createdAt: Date; updatedAt: Date;
}
export interface CaseVersionRecord {
  id: string; tenantId: string; caseId: string; versionNo: number;
  dslJson?: DslCase; codeSnapshotRef?: string; createdBy: string;
  changeNote?: string; createdAt: Date;
}
export interface StepResultRecord {
  id: string; tenantId: string; executionId: string; stepNo: number;
  stepType: string; name: string; status: StepStatus; durationMs: number;
  errorMessage?: string; locatorHealed: boolean; screenshotArtifactId?: string;
}
export interface ArtifactRecord {
  id: string; tenantId: string; executionId: string; stepResultId?: string;
  kind: "screenshot" | "video" | "trace" | "har" | "log";
  s3Key: string; sizeBytes: number; expiresAt: Date;
  /** Week 3：与 incident 关联的产物保留 90 天（开 incident 时由状态机回写标记 + 顺延 expiresAt） */
  incidentLinked?: boolean;
  /** Week 3：过期清理软删标记；清理任务删存储对象后落此字段，记录本身保留供审计 */
  deletedAt?: Date;
}
export interface ExecutionRecord {
  id: string; tenantId: string; projectId: string; planId?: string;
  /** Week 3：多地域同刻执行的组标识（planId + scheduledAt 派生），quorum 按组判定 */
  groupId?: string;
  caseVersionId: string; environmentId: string; region?: string; workerId?: string;
  triggerType: string; status: ExecutionStatus; attempt: number; isRetryOf?: string;
  scheduledAt?: Date; startedAt?: Date; finishedAt?: Date; durationMs?: number;
  snapshotJson?: Record<string, unknown>; // 脱敏后的变量快照（密钥值替换为 ***）
  createdAt: Date;
}
export interface AuditLogRecord {
  id: string; tenantId: string; actor: string; action: string; resource: string;
  summary?: Record<string, unknown>; ip?: string; createdAt: Date;
}
// ---------------- Week 2: Plan / Monitor / Alert / Incident ----------------
export type ConcurrencyPolicy = "skip" | "queue" | "parallel";
export interface PlanRecord {
  id: string; tenantId: string; projectId: string; caseId: string; environmentId: string;
  cronExpr: string; timezone: string; regions: string[]; enabled: boolean;
  concurrencyPolicy: ConcurrencyPolicy; failThreshold: number;
  /** 调度游标：已处理到的最近一个触发点（幂等 + 漏跑只补最新点都靠它） */
  lastScheduledAt?: Date;
  /** concurrencyPolicy=skip 时被跳过的触发次数（累计） */
  skippedCount: number;
  createdAt: Date; updatedAt: Date;
}
export type MonitorStatus = "up" | "suspect" | "down";
export interface MonitorTransition {
  from: MonitorStatus; to: MonitorStatus; at: Date; executionId: string; reason: string;
  /** Week 3：多地域时 refId 是 groupId（executionId 字段复用为「触发来源 id」） */
  groupId?: string;
  /** Week 3：迁移发生在维护窗口内——照常记录，但不告警、不开 incident（见 decisions Week 3 条） */
  suppressedByMaintenance?: boolean;
}
export interface MonitorStateRecord {
  id: string; tenantId: string; projectId: string; planId: string;
  status: MonitorStatus;
  consecutiveFailures: number; consecutiveSuccesses: number;
  /** 先败后过（flaky）累计：算成功但单独计数，用于 flaky 治理（Week 4 展示） */
  flakyCount: number;
  /** infra_failed 累计：监控自身基础设施问题，绝不计入业务失败（见 decisions 2026-10-31 Week 2 条） */
  infraCount: number;
  openIncidentId?: string;
  lastExecutionId?: string; lastTransitionAt?: Date;
  /** 迁移历史内嵌存储（审计用；量级小，不单开表） */
  history: MonitorTransition[];
  createdAt: Date; updatedAt: Date;
}
export type AlertChannelType = "feishu" | "wecom" | "webhook";
export interface AlertChannelRecord {
  type: AlertChannelType; label?: string;
  /** webhook URL 内含 token，一律按密钥处理：只存信封密文，DTO 只回掩码 */
  targetCipher: string;
}
export interface AlertRuleRecord {
  id: string; tenantId: string; projectId: string;
  scopeType: "plan" | "project"; scopeId: string;
  channels: AlertChannelRecord[]; dedupWindowSec: number; enabled: boolean;
  createdAt: Date; updatedAt: Date;
}
export interface IncidentRecord {
  id: string; tenantId: string; projectId: string; planId: string;
  /** Week 3：来源类型。plan 型 planId=真实 plan；heartbeat 型 planId 复填 heartbeat id
   *  （schema plan_id 非空的历史包袱），以 sourceType/sourceId 为准区分，切勿按 planId 误查 plan。 */
  sourceType: "plan" | "heartbeat";
  sourceId: string;
  status: "triggered" | "acknowledged" | "resolved";
  startedAt: Date; ackAt?: Date; ackBy?: string; resolvedAt?: Date;
  /** 持续时长（resolved 后落定，毫秒） */
  durationMs?: number;
  /** 升级时间点（ack 超时）：MVP 只落字段不挂定时器，升级链 V1 做 */
  escalateAt: Date;
  regionVotes?: Record<string, unknown>;
  summary?: string; createdAt: Date; updatedAt: Date;
}
// ---------------- Week 3: Worker 节点 / 维护窗口 / Heartbeat / Quorum 组判定 ----------------
export interface WorkerNodeRecord {
  id: string; tenantId: string; name: string; region: string;
  totalSlots: number; usedSlots: number;
  browserVersion?: string;
  /** 在线判定不落库：list 时以 now - lastHeartbeatAt <= 60s 派生 online/offline */
  lastHeartbeatAt?: Date;
  registeredAt: Date; createdAt: Date; updatedAt: Date;
}
export interface MaintenanceWindowRecord {
  id: string; tenantId: string; projectId: string;
  scopeType: "project" | "plan"; scopeId: string;
  /** 一次性窗口：startsAt/endsAt 齐全；周期窗口：cronExpr + durationMinutes（按 timezone 求值） */
  startsAt?: Date; endsAt?: Date;
  cronExpr?: string; durationMinutes?: number; timezone: string;
  reason: string; createdBy: string;
  createdAt: Date; updatedAt: Date;
}
export interface HeartbeatRecord {
  id: string; tenantId: string; projectId: string; name: string;
  /** token 只存 sha256 哈希；明文只在创建响应中出现一次（API key 模式），之后永不回显 */
  tokenHash: string;
  /** 展示用前缀（token 前 10 字符），不含可用凭证信息 */
  tokenPrefix: string;
  expectIntervalSec: number;
  /** 可选：指定告警规则；缺省时按项目级规则分发 */
  alertRuleId?: string;
  status: "pending" | "up" | "down";
  lastSeenAt?: Date;
  openIncidentId?: string;
  createdAt: Date; updatedAt: Date;
}
export type GroupVerdictKind = "up" | "down" | "infra";
export interface GroupVerdictRecord {
  /** groupId 即主键：同一组只判定一次（judge 幂等靠它） */
  groupId: string; tenantId: string; projectId: string; planId: string;
  scheduledAt?: Date;
  verdict: GroupVerdictKind;
  /** 实际投票节点数 < 计划地域数（infra 弃权导致）时为 true：结论可信度降级，展示/告警文案需标注 */
  degraded: boolean;
  /** region -> 该地域 execution 的终态（passed/flaky/failed/timeout/infra_failed/cancelled） */
  votes: Record<string, string>;
  downVotes: number; upVotes: number; plannedRegions: number;
  judgedAt: Date;
}
export interface NotificationLogRecord {
  id: string; tenantId: string; incidentId?: string;
  /** heartbeat_down / heartbeat_recovered 是 heartbeat 监控的 opened/recovered（日志口径分开记，
   *  实际发送的 AlertEvent.kind 仍映射为 opened/recovered 渲染，见 AlertDispatchService） */
  kind: "opened" | "recovered" | "test" | "heartbeat_down" | "heartbeat_recovered";
  channel: string; target: string; // target 恒为掩码形态
  status: "sent" | "failed"; response?: string; sentAt: Date;
}
