import { conflict } from "./errors";
import type {
  AlertRuleRepository, AuditLogRepository, CaseRepository, EnvVariableRepository, EnvironmentRepository,
  ExecutionRepository, GroupVerdictRepository, HeartbeatRepository, IncidentRepository,
  MaintenanceWindowRepository, MonitorStateRepository, NotificationLogRepository,
  PlanRepository, ProjectRepository, Repositories, WorkerNodeRepository,
} from "./repositories";
import type {
  AlertRuleRecord, ArtifactRecord, AuditLogRecord, CaseRecord, CaseVersionRecord,
  EnvVariableRecord, EnvironmentRecord, ExecutionRecord, GroupVerdictRecord, HeartbeatRecord,
  IncidentRecord, MaintenanceWindowRecord, MonitorStateRecord,
  NotificationLogRecord, PlanRecord, ProjectRecord, StepResultRecord, WorkerNodeRecord,
} from "./types";

/** 内存实现：测试、演示脚本、Prisma 引擎不可用时兜底。语义与 Prisma 实现保持一致（tenant 过滤、返回拷贝防外部改引用）。 */
const clone = <T>(v: T): T => structuredClone(v);

class InMemoryProjects implements ProjectRepository {
  constructor(private store: Map<string, ProjectRecord>) {}
  async insert(rec: ProjectRecord) { this.store.set(rec.id, clone(rec)); return clone(rec); }
  async findById(tenantId: string, id: string) {
    const r = this.store.get(id); return r && r.tenantId === tenantId ? clone(r) : null;
  }
  async findBySlug(tenantId: string, slug: string) {
    for (const r of this.store.values())
      if (r.tenantId === tenantId && r.slug === slug && r.status !== "deleted") return clone(r);
    return null;
  }
  async findBySlugGlobal(slug: string) {
    for (const r of this.store.values())
      if (r.slug === slug && r.status !== "deleted") return clone(r);
    return null;
  }
  async list(tenantId: string, opts?: { includeDeleted?: boolean }) {
    return [...this.store.values()]
      .filter(r => r.tenantId === tenantId && (opts?.includeDeleted || r.status !== "deleted"))
      .map(clone);
  }
  async save(rec: ProjectRecord) { this.store.set(rec.id, clone(rec)); return clone(rec); }
}
class InMemoryEnvironments implements EnvironmentRepository {
  constructor(private store: Map<string, EnvironmentRecord>) {}
  async insert(rec: EnvironmentRecord) { this.store.set(rec.id, clone(rec)); return clone(rec); }
  async findById(tenantId: string, id: string) {
    const r = this.store.get(id); return r && r.tenantId === tenantId ? clone(r) : null;
  }
  async listByProject(tenantId: string, projectId: string) {
    return [...this.store.values()].filter(r => r.tenantId === tenantId && r.projectId === projectId).map(clone);
  }
  async save(rec: EnvironmentRecord) { this.store.set(rec.id, clone(rec)); return clone(rec); }
  async delete(tenantId: string, id: string) {
    const r = this.store.get(id); if (r && r.tenantId === tenantId) this.store.delete(id);
  }
  async clearDefaultExcept(tenantId: string, projectId: string, exceptId: string) {
    for (const r of this.store.values())
      if (r.tenantId === tenantId && r.projectId === projectId && r.id !== exceptId && r.isDefault) {
        r.isDefault = false; r.updatedAt = new Date();
      }
  }
}
class InMemoryVariables implements EnvVariableRepository {
  constructor(private store: Map<string, EnvVariableRecord>) {}
  async insert(rec: EnvVariableRecord) { this.store.set(rec.id, clone(rec)); return clone(rec); }
  async findById(tenantId: string, id: string) {
    const r = this.store.get(id); return r && r.tenantId === tenantId ? clone(r) : null;
  }
  async findByKey(tenantId: string, environmentId: string, key: string) {
    for (const r of this.store.values())
      if (r.tenantId === tenantId && r.environmentId === environmentId && r.key === key) return clone(r);
    return null;
  }
  async listByEnvironment(tenantId: string, environmentId: string) {
    return [...this.store.values()].filter(r => r.tenantId === tenantId && r.environmentId === environmentId).map(clone);
  }
  async save(rec: EnvVariableRecord) { this.store.set(rec.id, clone(rec)); return clone(rec); }
  async delete(tenantId: string, id: string) {
    const r = this.store.get(id); if (r && r.tenantId === tenantId) this.store.delete(id);
  }
}
class InMemoryCases implements CaseRepository {
  constructor(private caseStore: Map<string, CaseRecord>, private verStore: Map<string, CaseVersionRecord>) {}
  async insertCase(rec: CaseRecord) { this.caseStore.set(rec.id, clone(rec)); return clone(rec); }
  async insertVersion(rec: CaseVersionRecord) { this.verStore.set(rec.id, clone(rec)); return clone(rec); }
  async findCaseById(tenantId: string, id: string) {
    const r = this.caseStore.get(id); return r && r.tenantId === tenantId ? clone(r) : null;
  }
  async listCases(tenantId: string, projectId: string) {
    return [...this.caseStore.values()].filter(r => r.tenantId === tenantId && r.projectId === projectId).map(clone);
  }
  async listVersions(tenantId: string, caseId: string) {
    return [...this.verStore.values()].filter(r => r.tenantId === tenantId && r.caseId === caseId)
      .sort((a, b) => a.versionNo - b.versionNo).map(clone);
  }
  async latestVersion(tenantId: string, caseId: string) {
    const vs = await this.listVersions(tenantId, caseId); return vs.length ? vs[vs.length - 1] : null;
  }
  async findVersionById(tenantId: string, versionId: string) {
    const r = this.verStore.get(versionId); return r && r.tenantId === tenantId ? clone(r) : null;
  }
  async saveCase(rec: CaseRecord) { this.caseStore.set(rec.id, clone(rec)); return clone(rec); }
}
class InMemoryExecutions implements ExecutionRepository {
  constructor(
    private execStore: Map<string, ExecutionRecord>,
    private stepStore: Map<string, StepResultRecord>,
    private artStore: Map<string, ArtifactRecord>,
  ) {}
  async insertExecution(rec: ExecutionRecord) {
    // (planId, scheduledAt, region) 幂等守卫（Week 3 多地域）：与 Prisma schema 的 @@unique 对齐，重复建单直接冲突
    if (rec.planId && rec.scheduledAt) {
      const dup = await this.findByPlanSlot(rec.tenantId, rec.planId, rec.scheduledAt, rec.region);
      if (dup) throw conflict(`execution already exists for plan ${rec.planId} at ${rec.scheduledAt.toISOString()} region=${rec.region ?? "-"}`);
    }
    this.execStore.set(rec.id, clone(rec)); return clone(rec);
  }
  async findExecutionById(tenantId: string, id: string) {
    const r = this.execStore.get(id); return r && r.tenantId === tenantId ? clone(r) : null;
  }
  async listExecutions(tenantId: string, projectId: string) {
    return [...this.execStore.values()].filter(r => r.tenantId === tenantId && r.projectId === projectId).map(clone);
  }
  async findByPlanSlot(tenantId: string, planId: string, scheduledAt: Date, region?: string) {
    for (const r of this.execStore.values())
      if (r.tenantId === tenantId && r.planId === planId && r.scheduledAt?.getTime() === scheduledAt.getTime()
        && (region === undefined || r.region === region))
        return clone(r);
    return null;
  }
  async listByPlan(tenantId: string, planId: string) {
    return [...this.execStore.values()].filter(r => r.tenantId === tenantId && r.planId === planId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map(clone);
  }
  async saveExecution(rec: ExecutionRecord) { this.execStore.set(rec.id, clone(rec)); return clone(rec); }
  async insertStepResults(recs: StepResultRecord[]) { for (const r of recs) this.stepStore.set(r.id, clone(r)); }
  async listStepResults(tenantId: string, executionId: string) {
    return [...this.stepStore.values()].filter(r => r.tenantId === tenantId && r.executionId === executionId)
      .sort((a, b) => a.stepNo - b.stepNo).map(clone);
  }
  async insertArtifact(rec: ArtifactRecord) { this.artStore.set(rec.id, clone(rec)); return clone(rec); }
  async listArtifacts(tenantId: string, executionId: string) {
    return [...this.artStore.values()].filter(r => r.tenantId === tenantId && r.executionId === executionId).map(clone);
  }
  async saveArtifact(rec: ArtifactRecord) { this.artStore.set(rec.id, clone(rec)); return clone(rec); }
  async listAllArtifacts(tenantId: string) {
    return [...this.artStore.values()].filter(r => r.tenantId === tenantId).map(clone);
  }
}
class InMemoryAudit implements AuditLogRepository {
  constructor(private store: Map<string, AuditLogRecord>) {}
  async append(rec: AuditLogRecord) { this.store.set(rec.id, clone(rec)); return clone(rec); }
  async list(tenantId: string, resource?: string) {
    return [...this.store.values()]
      .filter(r => r.tenantId === tenantId && (!resource || r.resource === resource)).map(clone);
  }
}
class InMemoryPlans implements PlanRepository {
  constructor(private store: Map<string, PlanRecord>) {}
  async insert(rec: PlanRecord) { this.store.set(rec.id, clone(rec)); return clone(rec); }
  async findById(tenantId: string, id: string) {
    const r = this.store.get(id); return r && r.tenantId === tenantId ? clone(r) : null;
  }
  async listByProject(tenantId: string, projectId: string) {
    return [...this.store.values()].filter(r => r.tenantId === tenantId && r.projectId === projectId).map(clone);
  }
  async listEnabled(tenantId: string) {
    return [...this.store.values()].filter(r => r.tenantId === tenantId && r.enabled).map(clone);
  }
  async save(rec: PlanRecord) { this.store.set(rec.id, clone(rec)); return clone(rec); }
  async delete(tenantId: string, id: string) {
    const r = this.store.get(id); if (r && r.tenantId === tenantId) this.store.delete(id);
  }
}
class InMemoryMonitors implements MonitorStateRepository {
  constructor(private store: Map<string, MonitorStateRecord>) {}
  async getByPlan(tenantId: string, planId: string) {
    for (const r of this.store.values())
      if (r.tenantId === tenantId && r.planId === planId) return clone(r);
    return null;
  }
  async insert(rec: MonitorStateRecord) { this.store.set(rec.id, clone(rec)); return clone(rec); }
  async save(rec: MonitorStateRecord) { this.store.set(rec.id, clone(rec)); return clone(rec); }
  async listByProject(tenantId: string, projectId: string) {
    return [...this.store.values()].filter(r => r.tenantId === tenantId && r.projectId === projectId).map(clone);
  }
}
class InMemoryAlertRules implements AlertRuleRepository {
  constructor(private store: Map<string, AlertRuleRecord>) {}
  async insert(rec: AlertRuleRecord) { this.store.set(rec.id, clone(rec)); return clone(rec); }
  async findById(tenantId: string, id: string) {
    const r = this.store.get(id); return r && r.tenantId === tenantId ? clone(r) : null;
  }
  async listByScope(tenantId: string, scopeType: "plan" | "project", scopeId: string) {
    return [...this.store.values()]
      .filter(r => r.tenantId === tenantId && r.scopeType === scopeType && r.scopeId === scopeId).map(clone);
  }
  async listByProject(tenantId: string, projectId: string) {
    return [...this.store.values()].filter(r => r.tenantId === tenantId && r.projectId === projectId).map(clone);
  }
  async save(rec: AlertRuleRecord) { this.store.set(rec.id, clone(rec)); return clone(rec); }
  async delete(tenantId: string, id: string) {
    const r = this.store.get(id); if (r && r.tenantId === tenantId) this.store.delete(id);
  }
}
class InMemoryIncidents implements IncidentRepository {
  constructor(private store: Map<string, IncidentRecord>) {}
  async insert(rec: IncidentRecord) { this.store.set(rec.id, clone(rec)); return clone(rec); }
  async findById(tenantId: string, id: string) {
    const r = this.store.get(id); return r && r.tenantId === tenantId ? clone(r) : null;
  }
  async findOpenByPlan(tenantId: string, planId: string) {
    for (const r of this.store.values())
      if (r.tenantId === tenantId && r.planId === planId && r.status !== "resolved") return clone(r);
    return null;
  }
  async findOpenBySource(tenantId: string, sourceType: "plan" | "heartbeat", sourceId: string) {
    for (const r of this.store.values())
      if (r.tenantId === tenantId && r.sourceType === sourceType && r.sourceId === sourceId
        && r.status !== "resolved") return clone(r);
    return null;
  }
  async listByProject(tenantId: string, projectId: string) {
    return [...this.store.values()].filter(r => r.tenantId === tenantId && r.projectId === projectId)
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime()).map(clone);
  }
  async save(rec: IncidentRecord) { this.store.set(rec.id, clone(rec)); return clone(rec); }
}
class InMemoryNotifications implements NotificationLogRepository {
  constructor(private store: Map<string, NotificationLogRecord>) {}
  async append(rec: NotificationLogRecord) { this.store.set(rec.id, clone(rec)); return clone(rec); }
  async listByIncident(tenantId: string, incidentId: string) {
    return [...this.store.values()].filter(r => r.tenantId === tenantId && r.incidentId === incidentId).map(clone);
  }
  async hasSent(tenantId: string, incidentId: string, kind: NotificationLogRecord["kind"]) {
    return [...this.store.values()].some(r =>
      r.tenantId === tenantId && r.incidentId === incidentId && r.kind === kind && r.status === "sent");
  }
}
class InMemoryWorkers implements WorkerNodeRepository {
  constructor(private store: Map<string, WorkerNodeRecord>) {}
  async insert(rec: WorkerNodeRecord) { this.store.set(rec.id, clone(rec)); return clone(rec); }
  async findById(tenantId: string, id: string) {
    const r = this.store.get(id); return r && r.tenantId === tenantId ? clone(r) : null;
  }
  async list(tenantId: string) {
    return [...this.store.values()].filter(r => r.tenantId === tenantId)
      .sort((a, b) => a.registeredAt.getTime() - b.registeredAt.getTime()).map(clone);
  }
  async save(rec: WorkerNodeRecord) { this.store.set(rec.id, clone(rec)); return clone(rec); }
}
class InMemoryMaintenance implements MaintenanceWindowRepository {
  constructor(private store: Map<string, MaintenanceWindowRecord>) {}
  async insert(rec: MaintenanceWindowRecord) { this.store.set(rec.id, clone(rec)); return clone(rec); }
  async findById(tenantId: string, id: string) {
    const r = this.store.get(id); return r && r.tenantId === tenantId ? clone(r) : null;
  }
  async listByProject(tenantId: string, projectId: string) {
    return [...this.store.values()].filter(r => r.tenantId === tenantId && r.projectId === projectId).map(clone);
  }
  async listByScope(tenantId: string, scopeType: "project" | "plan", scopeId: string) {
    return [...this.store.values()]
      .filter(r => r.tenantId === tenantId && r.scopeType === scopeType && r.scopeId === scopeId).map(clone);
  }
  async save(rec: MaintenanceWindowRecord) { this.store.set(rec.id, clone(rec)); return clone(rec); }
  async delete(tenantId: string, id: string) {
    const r = this.store.get(id); if (r && r.tenantId === tenantId) this.store.delete(id);
  }
}
class InMemoryHeartbeats implements HeartbeatRepository {
  constructor(private store: Map<string, HeartbeatRecord>) {}
  async insert(rec: HeartbeatRecord) { this.store.set(rec.id, clone(rec)); return clone(rec); }
  async findById(tenantId: string, id: string) {
    const r = this.store.get(id); return r && r.tenantId === tenantId ? clone(r) : null;
  }
  async findByTokenHash(tokenHash: string) {
    for (const r of this.store.values()) if (r.tokenHash === tokenHash) return clone(r);
    return null;
  }
  async listByProject(tenantId: string, projectId: string) {
    return [...this.store.values()].filter(r => r.tenantId === tenantId && r.projectId === projectId).map(clone);
  }
  async listByTenant(tenantId: string) {
    return [...this.store.values()].filter(r => r.tenantId === tenantId).map(clone);
  }
  async save(rec: HeartbeatRecord) { this.store.set(rec.id, clone(rec)); return clone(rec); }
  async delete(tenantId: string, id: string) {
    const r = this.store.get(id); if (r && r.tenantId === tenantId) this.store.delete(id);
  }
}
class InMemoryGroups implements GroupVerdictRepository {
  constructor(private store: Map<string, GroupVerdictRecord>) {}
  async findByGroupId(tenantId: string, groupId: string) {
    const r = this.store.get(groupId); return r && r.tenantId === tenantId ? clone(r) : null;
  }
  async insert(rec: GroupVerdictRecord) { this.store.set(rec.groupId, clone(rec)); return clone(rec); }
}
export class InMemoryRepositories implements Repositories {
  projects: Repositories["projects"]; environments: Repositories["environments"];
  variables: Repositories["variables"]; cases: Repositories["cases"];
  executions: Repositories["executions"]; audit: Repositories["audit"];
  plans: Repositories["plans"]; monitors: Repositories["monitors"];
  alertRules: Repositories["alertRules"]; incidents: Repositories["incidents"];
  notifications: Repositories["notifications"];
  workers: Repositories["workers"]; maintenance: Repositories["maintenance"];
  heartbeats: Repositories["heartbeats"]; groups: Repositories["groups"];
  constructor() {
    this.projects = new InMemoryProjects(new Map());
    this.environments = new InMemoryEnvironments(new Map());
    this.variables = new InMemoryVariables(new Map());
    this.cases = new InMemoryCases(new Map(), new Map());
    this.executions = new InMemoryExecutions(new Map(), new Map(), new Map());
    this.audit = new InMemoryAudit(new Map());
    this.plans = new InMemoryPlans(new Map());
    this.monitors = new InMemoryMonitors(new Map());
    this.alertRules = new InMemoryAlertRules(new Map());
    this.incidents = new InMemoryIncidents(new Map());
    this.notifications = new InMemoryNotifications(new Map());
    this.workers = new InMemoryWorkers(new Map());
    this.maintenance = new InMemoryMaintenance(new Map());
    this.heartbeats = new InMemoryHeartbeats(new Map());
    this.groups = new InMemoryGroups(new Map());
  }
}
