import type { Repositories } from "./repositories";
import type {
  ArtifactRecord, AuditLogRecord, CaseRecord, CaseVersionRecord,
  EnvVariableRecord, EnvironmentRecord, ExecutionRecord, ProjectRecord, StepResultRecord,
} from "./types";

/** Prisma 实现：对生成的 PrismaClient 做结构化（duck-type）适配，不静态 import 生成类型，
 *  因此 @prisma/engines 未下载、client 未 generate 时本文件仍可编译；
 *  运行时只有 UIP_REPOSITORY=prisma 且 client 构造成功才会被选用（见 core.module.ts）。
 *  ⚠️ 状态（2026-10-31）：本机 prisma engines 二进制下载被网络 ECONNRESET 阻断，
 *  本实现已写完但未经真实 DB 运行验证，启用前先 `pnpm --filter @uip/api exec prisma validate && prisma generate`。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Delegate = any;
export interface PrismaLikeClient {
  project: Delegate; environment: Delegate; envVariable: Delegate;
  case: Delegate; caseVersion: Delegate; execution: Delegate;
  stepResult: Delegate; artifact: Delegate; auditLog: Delegate;
  plan: Delegate; monitorState: Delegate; alertRule: Delegate;
  incident: Delegate; notificationLog: Delegate;
  // Week 3（表见 schema.prisma；同为未 validate 状态，启用前一并补验）
  workerNode: Delegate; maintenanceWindow: Delegate; heartbeat: Delegate; groupVerdict: Delegate;
  $transaction?: (fn: (tx: PrismaLikeClient) => Promise<unknown>) => Promise<unknown>;
}
const dates = (r: Record<string, unknown>) => ({
  ...r,
  createdAt: r.createdAt instanceof Date ? r.createdAt : new Date(String(r.createdAt ?? Date.now())),
  updatedAt: r.updatedAt instanceof Date ? r.updatedAt : new Date(String(r.updatedAt ?? Date.now())),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as any;

export class PrismaRepositories implements Repositories {
  constructor(private db: PrismaLikeClient) {}
  projects: Repositories["projects"] = {
    insert: async (rec) => dates(await this.db.project.create({ data: rec })),
    findById: async (tenantId, id) => {
      const r = await this.db.project.findFirst({ where: { id, tenantId } }); return r ? dates(r) : null;
    },
    findBySlug: async (tenantId, slug) => {
      const r = await this.db.project.findFirst({ where: { tenantId, slug, status: { not: "deleted" } } });
      return r ? dates(r) : null;
    },
    findBySlugGlobal: async (slug) => {
      const r = await this.db.project.findFirst({ where: { slug, status: { not: "deleted" } } });
      return r ? dates(r) : null;
    },
    list: async (tenantId, opts) => (await this.db.project.findMany({
      where: { tenantId, ...(opts?.includeDeleted ? {} : { status: { not: "deleted" } }) },
    })).map(dates),
    save: async (rec) => dates(await this.db.project.update({ where: { id: rec.id }, data: rec })),
  };
  environments: Repositories["environments"] = {
    insert: async (rec) => dates(await this.db.environment.create({ data: rec })),
    findById: async (tenantId, id) => {
      const r = await this.db.environment.findFirst({ where: { id, tenantId } }); return r ? dates(r) : null;
    },
    listByProject: async (tenantId, projectId) =>
      (await this.db.environment.findMany({ where: { tenantId, projectId } })).map(dates),
    save: async (rec) => dates(await this.db.environment.update({ where: { id: rec.id }, data: rec })),
    delete: async (tenantId, id) => { await this.db.environment.deleteMany({ where: { id, tenantId } }); },
    clearDefaultExcept: async (tenantId, projectId, exceptId) => {
      await this.db.environment.updateMany({
        where: { tenantId, projectId, isDefault: true, id: { not: exceptId } }, data: { isDefault: false },
      });
    },
  };
  variables: Repositories["variables"] = {
    insert: async (rec) => dates(await this.db.envVariable.create({ data: rec })),
    findById: async (tenantId, id) => {
      const r = await this.db.envVariable.findFirst({ where: { id, tenantId } }); return r ? dates(r) : null;
    },
    findByKey: async (tenantId, environmentId, key) => {
      const r = await this.db.envVariable.findFirst({ where: { tenantId, environmentId, key } });
      return r ? dates(r) : null;
    },
    listByEnvironment: async (tenantId, environmentId) =>
      (await this.db.envVariable.findMany({ where: { tenantId, environmentId } })).map(dates),
    save: async (rec) => dates(await this.db.envVariable.update({ where: { id: rec.id }, data: rec })),
    delete: async (tenantId, id) => { await this.db.envVariable.deleteMany({ where: { id, tenantId } }); },
  };
  cases: Repositories["cases"] = {
    insertCase: async (rec) => dates(await this.db.case.create({ data: rec })),
    insertVersion: async (rec) => dates(await this.db.caseVersion.create({ data: rec })),
    findCaseById: async (tenantId, id) => {
      const r = await this.db.case.findFirst({ where: { id, tenantId } }); return r ? dates(r) : null;
    },
    listCases: async (tenantId, projectId) =>
      (await this.db.case.findMany({ where: { tenantId, projectId } })).map(dates),
    listVersions: async (tenantId, caseId) => (await this.db.caseVersion.findMany({
      where: { tenantId, caseId }, orderBy: { versionNo: "asc" },
    })).map(dates),
    latestVersion: async (tenantId, caseId) => {
      const r = await this.db.caseVersion.findFirst({
        where: { tenantId, caseId }, orderBy: { versionNo: "desc" },
      }); return r ? dates(r) : null;
    },
    findVersionById: async (tenantId, versionId) => {
      const r = await this.db.caseVersion.findFirst({ where: { id: versionId, tenantId } });
      return r ? dates(r) : null;
    },
    saveCase: async (rec: CaseRecord) => dates(await this.db.case.update({ where: { id: rec.id }, data: rec })),
  };
  executions: Repositories["executions"] = {
    insertExecution: async (rec) => dates(await this.db.execution.create({ data: rec })),
    findExecutionById: async (tenantId, id) => {
      const r = await this.db.execution.findFirst({ where: { id, tenantId } }); return r ? dates(r) : null;
    },
    listExecutions: async (tenantId, projectId) =>
      (await this.db.execution.findMany({ where: { tenantId, projectId } })).map(dates),
    findByPlanSlot: async (tenantId, planId, scheduledAt, region) => {
      const r = await this.db.execution.findFirst({
        where: { tenantId, planId, scheduledAt, ...(region !== undefined ? { region } : {}) },
      });
      return r ? dates(r) : null;
    },
    listByPlan: async (tenantId, planId) => (await this.db.execution.findMany({
      where: { tenantId, planId }, orderBy: { createdAt: "asc" },
    })).map(dates),
    saveExecution: async (rec: ExecutionRecord) =>
      dates(await this.db.execution.update({ where: { id: rec.id }, data: rec })),
    insertStepResults: async (recs: StepResultRecord[]) => {
      if (recs.length) await this.db.stepResult.createMany({ data: recs });
    },
    listStepResults: async (tenantId, executionId) => (await this.db.stepResult.findMany({
      where: { tenantId, executionId }, orderBy: { stepNo: "asc" },
    })).map(dates),
    insertArtifact: async (rec: ArtifactRecord) => dates(await this.db.artifact.create({
      data: { ...rec, sizeBytes: BigInt(rec.sizeBytes) },
    })),
    listArtifacts: async (tenantId, executionId) => (await this.db.artifact.findMany({
      where: { tenantId, executionId },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    })).map((r: any) => ({ ...dates(r), sizeBytes: Number(r.sizeBytes ?? 0) })),
    saveArtifact: async (rec: ArtifactRecord) => dates(await this.db.artifact.update({
      where: { id: rec.id }, data: { ...rec, sizeBytes: BigInt(rec.sizeBytes) },
    })),
    listAllArtifacts: async (tenantId) => (await this.db.artifact.findMany({
      where: { tenantId },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    })).map((r: any) => ({ ...dates(r), sizeBytes: Number(r.sizeBytes ?? 0) })),
  };
  audit: Repositories["audit"] = {
    append: async (rec: AuditLogRecord) => dates(await this.db.auditLog.create({ data: rec })),
    list: async (tenantId, resource) => (await this.db.auditLog.findMany({
      where: { tenantId, ...(resource ? { resource } : {}) },
    })).map(dates),
  };
  // ---- Week 2（与内存实现同语义；MonitorState 表为 Week 2 新增，见 schema.prisma 注释） ----
  plans: Repositories["plans"] = {
    insert: async (rec) => dates(await this.db.plan.create({ data: rec })),
    findById: async (tenantId, id) => {
      const r = await this.db.plan.findFirst({ where: { id, tenantId } }); return r ? dates(r) : null;
    },
    listByProject: async (tenantId, projectId) =>
      (await this.db.plan.findMany({ where: { tenantId, projectId } })).map(dates),
    listEnabled: async (tenantId) =>
      (await this.db.plan.findMany({ where: { tenantId, enabled: true } })).map(dates),
    save: async (rec) => dates(await this.db.plan.update({ where: { id: rec.id }, data: rec })),
    delete: async (tenantId, id) => { await this.db.plan.deleteMany({ where: { id, tenantId } }); },
  };
  monitors: Repositories["monitors"] = {
    getByPlan: async (tenantId, planId) => {
      const r = await this.db.monitorState.findFirst({ where: { tenantId, planId } });
      return r ? dates(r) : null;
    },
    insert: async (rec) => dates(await this.db.monitorState.create({ data: rec })),
    save: async (rec) => dates(await this.db.monitorState.update({ where: { id: rec.id }, data: rec })),
    listByProject: async (tenantId, projectId) =>
      (await this.db.monitorState.findMany({ where: { tenantId, projectId } })).map(dates),
  };
  alertRules: Repositories["alertRules"] = {
    insert: async (rec) => dates(await this.db.alertRule.create({
      data: { ...rec, channels: rec.channels, condition: {} },
    })),
    findById: async (tenantId, id) => {
      const r = await this.db.alertRule.findFirst({ where: { id, tenantId } }); return r ? dates(r) : null;
    },
    listByScope: async (tenantId, scopeType, scopeId) => (await this.db.alertRule.findMany({
      where: { tenantId, scopeType, scopeId },
    })).map(dates),
    listByProject: async (tenantId, projectId) =>
      (await this.db.alertRule.findMany({ where: { tenantId, projectId } })).map(dates),
    save: async (rec) => dates(await this.db.alertRule.update({
      where: { id: rec.id }, data: { ...rec, channels: rec.channels, condition: {} },
    })),
    delete: async (tenantId, id) => { await this.db.alertRule.deleteMany({ where: { id, tenantId } }); },
  };
  incidents: Repositories["incidents"] = {
    insert: async (rec) => dates(await this.db.incident.create({ data: rec })),
    findById: async (tenantId, id) => {
      const r = await this.db.incident.findFirst({ where: { id, tenantId } }); return r ? dates(r) : null;
    },
    findOpenByPlan: async (tenantId, planId) => {
      const r = await this.db.incident.findFirst({
        where: { tenantId, planId, status: { not: "resolved" } }, orderBy: { startedAt: "desc" },
      }); return r ? dates(r) : null;
    },
    findOpenBySource: async (tenantId, sourceType, sourceId) => {
      const r = await this.db.incident.findFirst({
        where: { tenantId, sourceType, sourceId, status: { not: "resolved" } },
        orderBy: { startedAt: "desc" },
      }); return r ? dates(r) : null;
    },
    listByProject: async (tenantId, projectId) => (await this.db.incident.findMany({
      where: { tenantId, projectId }, orderBy: { startedAt: "desc" },
    })).map(dates),
    save: async (rec) => dates(await this.db.incident.update({ where: { id: rec.id }, data: rec })),
  };
  notifications: Repositories["notifications"] = {
    append: async (rec) => dates(await this.db.notificationLog.create({ data: rec })),
    listByIncident: async (tenantId, incidentId) =>
      (await this.db.notificationLog.findMany({ where: { tenantId, incidentId } })).map(dates),
    hasSent: async (tenantId, incidentId, kind) => {
      const n = await this.db.notificationLog.count({
        where: { tenantId, incidentId, kind, status: "sent" },
      });
      return n > 0;
    },
  };
  // ---- Week 3（与内存实现同语义；新表未经真实 DB 验证，同 Week 2 标注） ----
  workers: Repositories["workers"] = {
    insert: async (rec) => dates(await this.db.workerNode.create({ data: rec })),
    findById: async (tenantId, id) => {
      const r = await this.db.workerNode.findFirst({ where: { id, tenantId } }); return r ? dates(r) : null;
    },
    list: async (tenantId) => (await this.db.workerNode.findMany({
      where: { tenantId }, orderBy: { registeredAt: "asc" },
    })).map(dates),
    save: async (rec) => dates(await this.db.workerNode.update({ where: { id: rec.id }, data: rec })),
  };
  maintenance: Repositories["maintenance"] = {
    insert: async (rec) => dates(await this.db.maintenanceWindow.create({ data: rec })),
    findById: async (tenantId, id) => {
      const r = await this.db.maintenanceWindow.findFirst({ where: { id, tenantId } });
      return r ? dates(r) : null;
    },
    listByProject: async (tenantId, projectId) =>
      (await this.db.maintenanceWindow.findMany({ where: { tenantId, projectId } })).map(dates),
    listByScope: async (tenantId, scopeType, scopeId) => (await this.db.maintenanceWindow.findMany({
      where: { tenantId, scopeType, scopeId },
    })).map(dates),
    save: async (rec) => dates(await this.db.maintenanceWindow.update({ where: { id: rec.id }, data: rec })),
    delete: async (tenantId, id) => { await this.db.maintenanceWindow.deleteMany({ where: { id, tenantId } }); },
  };
  heartbeats: Repositories["heartbeats"] = {
    insert: async (rec) => dates(await this.db.heartbeat.create({ data: rec })),
    findById: async (tenantId, id) => {
      const r = await this.db.heartbeat.findFirst({ where: { id, tenantId } }); return r ? dates(r) : null;
    },
    findByTokenHash: async (tokenHash) => {
      const r = await this.db.heartbeat.findFirst({ where: { tokenHash } }); return r ? dates(r) : null;
    },
    listByProject: async (tenantId, projectId) =>
      (await this.db.heartbeat.findMany({ where: { tenantId, projectId } })).map(dates),
    listByTenant: async (tenantId) =>
      (await this.db.heartbeat.findMany({ where: { tenantId } })).map(dates),
    save: async (rec) => dates(await this.db.heartbeat.update({ where: { id: rec.id }, data: rec })),
    delete: async (tenantId, id) => { await this.db.heartbeat.deleteMany({ where: { id, tenantId } }); },
  };
  groups: Repositories["groups"] = {
    findByGroupId: async (tenantId, groupId) => {
      const r = await this.db.groupVerdict.findFirst({ where: { groupId, tenantId } });
      return r ? dates(r) : null;
    },
    insert: async (rec) => dates(await this.db.groupVerdict.create({ data: rec })),
  };
}
