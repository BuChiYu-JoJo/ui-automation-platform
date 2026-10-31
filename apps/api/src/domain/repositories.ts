import type {
  AlertRuleRecord, ArtifactRecord, AuditLogRecord, CaseRecord, CaseVersionRecord,
  EnvVariableRecord, EnvironmentRecord, ExecutionRecord, GroupVerdictRecord, HeartbeatRecord,
  IncidentRecord, MaintenanceWindowRecord, MonitorStateRecord,
  NotificationLogRecord, PlanRecord, ProjectRecord, StepResultRecord, WorkerNodeRecord,
} from "./types";

/** 仓库抽象：服务层只依赖这些接口，不直接依赖 Prisma。
 *  实现：(a) PrismaRepositories（prisma.ts，引擎就绪后启用） (b) InMemoryRepositories（in-memory.ts，测试/演示/引擎阻塞时兜底）。
 *  所有查询都必须带 tenantId 过滤（多租户预埋），这是接口契约的一部分。 */
export interface ProjectRepository {
  insert(rec: ProjectRecord): Promise<ProjectRecord>;
  findById(tenantId: string, id: string): Promise<ProjectRecord | null>;
  findBySlug(tenantId: string, slug: string): Promise<ProjectRecord | null>;
  /** Week 4：公开状态页专用——状态页 URL 只有 slug、没有租户上下文，按 slug 全局查（slug 跨租户撞名时取第一个未删除项，
   *  状态页只暴露脱敏聚合数据，见 PublicStatusService 的数据最小化口径）。 */
  findBySlugGlobal(slug: string): Promise<ProjectRecord | null>;
  list(tenantId: string, opts?: { includeDeleted?: boolean }): Promise<ProjectRecord[]>;
  save(rec: ProjectRecord): Promise<ProjectRecord>;
}
export interface EnvironmentRepository {
  insert(rec: EnvironmentRecord): Promise<EnvironmentRecord>;
  findById(tenantId: string, id: string): Promise<EnvironmentRecord | null>;
  listByProject(tenantId: string, projectId: string): Promise<EnvironmentRecord[]>;
  save(rec: EnvironmentRecord): Promise<EnvironmentRecord>;
  delete(tenantId: string, id: string): Promise<void>;
  /** 把同项目其他环境 isDefault 置 false（单默认规则由 repo 原子地配合 service 执行） */
  clearDefaultExcept(tenantId: string, projectId: string, exceptId: string): Promise<void>;
}
export interface EnvVariableRepository {
  insert(rec: EnvVariableRecord): Promise<EnvVariableRecord>;
  findById(tenantId: string, id: string): Promise<EnvVariableRecord | null>;
  findByKey(tenantId: string, environmentId: string, key: string): Promise<EnvVariableRecord | null>;
  listByEnvironment(tenantId: string, environmentId: string): Promise<EnvVariableRecord[]>;
  save(rec: EnvVariableRecord): Promise<EnvVariableRecord>;
  delete(tenantId: string, id: string): Promise<void>;
}
export interface CaseRepository {
  insertCase(rec: CaseRecord): Promise<CaseRecord>;
  insertVersion(rec: CaseVersionRecord): Promise<CaseVersionRecord>;
  findCaseById(tenantId: string, id: string): Promise<CaseRecord | null>;
  listCases(tenantId: string, projectId: string): Promise<CaseRecord[]>;
  listVersions(tenantId: string, caseId: string): Promise<CaseVersionRecord[]>;
  latestVersion(tenantId: string, caseId: string): Promise<CaseVersionRecord | null>;
  findVersionById(tenantId: string, versionId: string): Promise<CaseVersionRecord | null>;
  saveCase(rec: CaseRecord): Promise<CaseRecord>;
}
export interface ExecutionRepository {
  insertExecution(rec: ExecutionRecord): Promise<ExecutionRecord>;
  findExecutionById(tenantId: string, id: string): Promise<ExecutionRecord | null>;
  listExecutions(tenantId: string, projectId: string): Promise<ExecutionRecord[]>;
  /** 调度幂等：Week 3 起按 (planId, scheduledAt, region) 唯一定位一条 execution；
   *  不传 region 时匹配任意地域（Week 2 兼容）。与 schema @@unique([planId, scheduledAt, region]) 对齐 */
  findByPlanSlot(tenantId: string, planId: string, scheduledAt: Date, region?: string): Promise<ExecutionRecord | null>;
  listByPlan(tenantId: string, planId: string): Promise<ExecutionRecord[]>;
  saveExecution(rec: ExecutionRecord): Promise<ExecutionRecord>;
  insertStepResults(recs: StepResultRecord[]): Promise<void>;
  listStepResults(tenantId: string, executionId: string): Promise<StepResultRecord[]>;
  insertArtifact(rec: ArtifactRecord): Promise<ArtifactRecord>;
  listArtifacts(tenantId: string, executionId: string): Promise<ArtifactRecord[]>;
  /** Week 3：产物回写（incident 关联顺延保留期）与清理任务的全量扫描 */
  saveArtifact(rec: ArtifactRecord): Promise<ArtifactRecord>;
  listAllArtifacts(tenantId: string): Promise<ArtifactRecord[]>;
}
export interface AuditLogRepository {
  append(rec: AuditLogRecord): Promise<AuditLogRecord>;
  list(tenantId: string, resource?: string): Promise<AuditLogRecord[]>;
}
export interface PlanRepository {
  insert(rec: PlanRecord): Promise<PlanRecord>;
  findById(tenantId: string, id: string): Promise<PlanRecord | null>;
  listByProject(tenantId: string, projectId: string): Promise<PlanRecord[]>;
  listEnabled(tenantId: string): Promise<PlanRecord[]>;
  save(rec: PlanRecord): Promise<PlanRecord>;
  delete(tenantId: string, id: string): Promise<void>;
}
export interface MonitorStateRepository {
  getByPlan(tenantId: string, planId: string): Promise<MonitorStateRecord | null>;
  insert(rec: MonitorStateRecord): Promise<MonitorStateRecord>;
  save(rec: MonitorStateRecord): Promise<MonitorStateRecord>;
  listByProject(tenantId: string, projectId: string): Promise<MonitorStateRecord[]>;
}
export interface AlertRuleRepository {
  insert(rec: AlertRuleRecord): Promise<AlertRuleRecord>;
  findById(tenantId: string, id: string): Promise<AlertRuleRecord | null>;
  listByScope(tenantId: string, scopeType: "plan" | "project", scopeId: string): Promise<AlertRuleRecord[]>;
  listByProject(tenantId: string, projectId: string): Promise<AlertRuleRecord[]>;
  save(rec: AlertRuleRecord): Promise<AlertRuleRecord>;
  delete(tenantId: string, id: string): Promise<void>;
}
export interface IncidentRepository {
  insert(rec: IncidentRecord): Promise<IncidentRecord>;
  findById(tenantId: string, id: string): Promise<IncidentRecord | null>;
  findOpenByPlan(tenantId: string, planId: string): Promise<IncidentRecord | null>;
  /** Week 3：按来源查未关闭 incident（plan / heartbeat 共用，防重复开单） */
  findOpenBySource(tenantId: string, sourceType: "plan" | "heartbeat", sourceId: string): Promise<IncidentRecord | null>;
  listByProject(tenantId: string, projectId: string): Promise<IncidentRecord[]>;
  save(rec: IncidentRecord): Promise<IncidentRecord>;
}
export interface WorkerNodeRepository {
  insert(rec: WorkerNodeRecord): Promise<WorkerNodeRecord>;
  findById(tenantId: string, id: string): Promise<WorkerNodeRecord | null>;
  list(tenantId: string): Promise<WorkerNodeRecord[]>;
  save(rec: WorkerNodeRecord): Promise<WorkerNodeRecord>;
}
export interface MaintenanceWindowRepository {
  insert(rec: MaintenanceWindowRecord): Promise<MaintenanceWindowRecord>;
  findById(tenantId: string, id: string): Promise<MaintenanceWindowRecord | null>;
  listByProject(tenantId: string, projectId: string): Promise<MaintenanceWindowRecord[]>;
  listByScope(tenantId: string, scopeType: "project" | "plan", scopeId: string): Promise<MaintenanceWindowRecord[]>;
  save(rec: MaintenanceWindowRecord): Promise<MaintenanceWindowRecord>;
  delete(tenantId: string, id: string): Promise<void>;
}
export interface HeartbeatRepository {
  insert(rec: HeartbeatRecord): Promise<HeartbeatRecord>;
  findById(tenantId: string, id: string): Promise<HeartbeatRecord | null>;
  /** ping 端点专用：token 只以哈希形态查询，明文 token 不落库不进日志 */
  findByTokenHash(tokenHash: string): Promise<HeartbeatRecord | null>;
  listByProject(tenantId: string, projectId: string): Promise<HeartbeatRecord[]>;
  listByTenant(tenantId: string): Promise<HeartbeatRecord[]>;
  save(rec: HeartbeatRecord): Promise<HeartbeatRecord>;
  delete(tenantId: string, id: string): Promise<void>;
}
export interface GroupVerdictRepository {
  findByGroupId(tenantId: string, groupId: string): Promise<GroupVerdictRecord | null>;
  insert(rec: GroupVerdictRecord): Promise<GroupVerdictRecord>;
}
export interface NotificationLogRepository {
  append(rec: NotificationLogRecord): Promise<NotificationLogRecord>;
  listByIncident(tenantId: string, incidentId: string): Promise<NotificationLogRecord[]>;
  /** 去重核查：该 incident 是否已有某 kind 的成功发送 */
  hasSent(tenantId: string, incidentId: string, kind: NotificationLogRecord["kind"]): Promise<boolean>;
}
export interface Repositories {
  projects: ProjectRepository;
  environments: EnvironmentRepository;
  variables: EnvVariableRepository;
  cases: CaseRepository;
  executions: ExecutionRepository;
  audit: AuditLogRepository;
  plans: PlanRepository;
  monitors: MonitorStateRepository;
  alertRules: AlertRuleRepository;
  incidents: IncidentRepository;
  notifications: NotificationLogRepository;
  workers: WorkerNodeRepository;
  maintenance: MaintenanceWindowRepository;
  heartbeats: HeartbeatRepository;
  groups: GroupVerdictRepository;
}
