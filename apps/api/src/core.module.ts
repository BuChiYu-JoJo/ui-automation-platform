import { Global, Module } from "@nestjs/common";
import { join } from "node:path";
import {
  AlertDispatchService, AlertRuleService, ArtifactCleanupService, CaseService, EnvironmentService,
  EnvVariableService, ExecutionService, HeartbeatService, InMemoryRepositories, InProcessDispatcher,
  IncidentService, LocalArtifactStorage, MaintenanceService, MonitorStateService,
  PlanService, PrismaRepositories, ProjectService, PublicStatusService, QuorumJudgeService, S3ArtifactStorageStub,
  SchedulerService, StatsService, StorageStateService, WorkerNodeService,
  createEnvelopeCrypto,
  type ArtifactStorage, type ExecutionDispatcher, type PrismaLikeClient, type Repositories,
} from "./domain";
import { ExecutionQueueService } from "./queue/execution-queue.service";

export const REPOSITORIES = "UIP_REPOSITORIES";
export const PROJECT_SERVICE = "UIP_PROJECT_SERVICE";
export const ENVIRONMENT_SERVICE = "UIP_ENVIRONMENT_SERVICE";
export const VARIABLE_SERVICE = "UIP_VARIABLE_SERVICE";
export const CASE_SERVICE = "UIP_CASE_SERVICE";
export const EXECUTION_SERVICE = "UIP_EXECUTION_SERVICE";
export const EXECUTION_DISPATCHER = "UIP_EXECUTION_DISPATCHER";
export const PLAN_SERVICE = "UIP_PLAN_SERVICE";
export const ALERT_RULE_SERVICE = "UIP_ALERT_RULE_SERVICE";
export const ALERT_DISPATCH_SERVICE = "UIP_ALERT_DISPATCH_SERVICE";
export const INCIDENT_SERVICE = "UIP_INCIDENT_SERVICE";
export const MONITOR_SERVICE = "UIP_MONITOR_SERVICE";
export const SCHEDULER_SERVICE = "UIP_SCHEDULER_SERVICE";
export const STATS_SERVICE = "UIP_STATS_SERVICE";
export const WORKER_NODE_SERVICE = "UIP_WORKER_NODE_SERVICE";
export const MAINTENANCE_SERVICE = "UIP_MAINTENANCE_SERVICE";
export const QUORUM_SERVICE = "UIP_QUORUM_SERVICE";
export const HEARTBEAT_SERVICE = "UIP_HEARTBEAT_SERVICE";
export const ARTIFACT_STORAGE = "UIP_ARTIFACT_STORAGE";
export const CLEANUP_SERVICE = "UIP_CLEANUP_SERVICE";
export const STORAGE_STATE_SERVICE = "UIP_STORAGE_STATE_SERVICE";
export const PUBLIC_STATUS_SERVICE = "UIP_PUBLIC_STATUS_SERVICE";

/** 仓库选择：UIP_REPOSITORY=prisma 才尝试 Prisma（需要 engines 已下载、client 已 generate）；
 *  构造失败自动回退内存实现并告警——Prisma 被网络阻断时不阻塞里程碑（见 docs/PROGRESS.md）。 */
export function createRepositories(): Repositories {
  if (process.env.UIP_REPOSITORY === "prisma") {
    try {
      // 动态 require：未 generate 时 @prisma/client 会抛错，在此捕获回退
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { PrismaClient } = require("@prisma/client") as { PrismaClient: new () => PrismaLikeClient };
      return new PrismaRepositories(new PrismaClient());
    } catch (err) {
      console.warn(`[uip] Prisma unavailable, falling back to in-memory repositories: ${
        err instanceof Error ? err.message : String(err)}`);
    }
  }
  return new InMemoryRepositories();
}
/** 分发选择：UIP_DISPATCH=bullmq 时走 ExecutionQueueService（需 Redis）；否则进程内分发。 */
export function createDomainProviders() {
  return [
    { provide: REPOSITORIES, useFactory: () => createRepositories() },
    { provide: PROJECT_SERVICE, useFactory: (r: Repositories) => new ProjectService(r), inject: [REPOSITORIES] },
    { provide: ENVIRONMENT_SERVICE, useFactory: (r: Repositories, p: ProjectService) => new EnvironmentService(r, p), inject: [REPOSITORIES, PROJECT_SERVICE] },
    { provide: VARIABLE_SERVICE, useFactory: (r: Repositories, e: EnvironmentService) => new EnvVariableService(r, e, createEnvelopeCrypto()), inject: [REPOSITORIES, ENVIRONMENT_SERVICE] },
    { provide: CASE_SERVICE, useFactory: (r: Repositories, p: ProjectService) => new CaseService(r, p), inject: [REPOSITORIES, PROJECT_SERVICE] },
    {
      provide: EXECUTION_DISPATCHER,
      useFactory: (queue: ExecutionQueueService): ExecutionDispatcher =>
        process.env.UIP_DISPATCH === "bullmq" ? queue : new InProcessDispatcher(),
      inject: [ExecutionQueueService],
    },
    {
      provide: EXECUTION_SERVICE,
      useFactory: (r: Repositories, c: CaseService, e: EnvironmentService, v: EnvVariableService, d: ExecutionDispatcher) =>
        new ExecutionService(r, c, e, v, d),
      inject: [REPOSITORIES, CASE_SERVICE, ENVIRONMENT_SERVICE, VARIABLE_SERVICE, EXECUTION_DISPATCHER],
    },
    // ---- Week 2 ----
    { provide: PLAN_SERVICE, useFactory: (r: Repositories, p: ProjectService) => new PlanService(r, p), inject: [REPOSITORIES, PROJECT_SERVICE] },
    {
      provide: ALERT_RULE_SERVICE,
      useFactory: (r: Repositories, p: ProjectService) => new AlertRuleService(r, p, createEnvelopeCrypto()),
      inject: [REPOSITORIES, PROJECT_SERVICE],
    },
    {
      provide: ALERT_DISPATCH_SERVICE,
      useFactory: (r: Repositories, rules: AlertRuleService) => new AlertDispatchService(r, rules),
      inject: [REPOSITORIES, ALERT_RULE_SERVICE],
    },
    { provide: INCIDENT_SERVICE, useFactory: (r: Repositories) => new IncidentService(r), inject: [REPOSITORIES] },
    // ---- Week 3 ----
    {
      provide: MAINTENANCE_SERVICE,
      useFactory: (r: Repositories, p: ProjectService) => new MaintenanceService(r, p),
      inject: [REPOSITORIES, PROJECT_SERVICE],
    },
    {
      provide: MONITOR_SERVICE,
      useFactory: (r: Repositories, a: AlertDispatchService, m: MaintenanceService) =>
        new MonitorStateService(r, a, m),
      inject: [REPOSITORIES, ALERT_DISPATCH_SERVICE, MAINTENANCE_SERVICE],
    },
    {
      provide: QUORUM_SERVICE,
      useFactory: (r: Repositories, mon: MonitorStateService) => new QuorumJudgeService(r, mon),
      inject: [REPOSITORIES, MONITOR_SERVICE],
    },
    { provide: WORKER_NODE_SERVICE, useFactory: (r: Repositories) => new WorkerNodeService(r), inject: [REPOSITORIES] },
    {
      provide: HEARTBEAT_SERVICE,
      useFactory: (r: Repositories, p: ProjectService, a: AlertDispatchService) =>
        new HeartbeatService(r, p, a),
      inject: [REPOSITORIES, PROJECT_SERVICE, ALERT_DISPATCH_SERVICE],
    },
    {
      // 产物存储：默认本地 FS（artifacts 根目录，与 worker 落盘形态一致）；
      // UIP_ARTIFACT_STORAGE=s3 时用 stub 实现（删除会显式报错，不假装删成功，待 MinIO 解阻塞后换真实现）
      provide: ARTIFACT_STORAGE,
      useFactory: (): ArtifactStorage => process.env.UIP_ARTIFACT_STORAGE === "s3"
        ? new S3ArtifactStorageStub()
        : new LocalArtifactStorage(process.env.UIP_ARTIFACTS_DIR ?? join(process.cwd(), "artifacts")),
    },
    {
      provide: CLEANUP_SERVICE,
      useFactory: (r: Repositories, s: ArtifactStorage) => new ArtifactCleanupService(r, s),
      inject: [REPOSITORIES, ARTIFACT_STORAGE],
    },
    {
      provide: STORAGE_STATE_SERVICE,
      useFactory: (r: Repositories, e: EnvironmentService) =>
        new StorageStateService(r, e, createEnvelopeCrypto()),
      inject: [REPOSITORIES, ENVIRONMENT_SERVICE],
    },
    {
      provide: SCHEDULER_SERVICE,
      useFactory: (r: Repositories, e: ExecutionService) => new SchedulerService(r, e),
      inject: [REPOSITORIES, EXECUTION_SERVICE],
    },
    {
      provide: STATS_SERVICE,
      useFactory: (r: Repositories, m: MaintenanceService) => new StatsService(r, m),
      inject: [REPOSITORIES, MAINTENANCE_SERVICE],
    },
    {
      // Week 4 公开状态页：只依赖仓库 + StatsService 的展示状态口径，自身无任何写路径
      provide: PUBLIC_STATUS_SERVICE,
      useFactory: (r: Repositories, s: StatsService, m: MaintenanceService) => new PublicStatusService(r, s, m),
      inject: [REPOSITORIES, STATS_SERVICE, MAINTENANCE_SERVICE],
    },
    {
      // 组装期接线：带 planId 的 execution 落终态 -> quorum judge（单地域内部直转 Week 2 状态机，
      // 多地域先按组判定再喂状态机一步）。避免 ExecutionService<->Judge 循环依赖。
      provide: "UIP_HOOK_WIRING",
      useFactory: (exec: ExecutionService, judge: QuorumJudgeService) => {
        exec.setCompletionHook(async (tenantId, execution) => {
          await judge.onExecutionCompleted(tenantId, execution);
        });
        return true;
      },
      inject: [EXECUTION_SERVICE, QUORUM_SERVICE],
    },
  ];
}
@Global()
@Module({
  providers: [ExecutionQueueService, ...createDomainProviders()],
  exports: [ExecutionQueueService, REPOSITORIES, PROJECT_SERVICE, ENVIRONMENT_SERVICE, VARIABLE_SERVICE, CASE_SERVICE, EXECUTION_SERVICE, EXECUTION_DISPATCHER, PLAN_SERVICE, ALERT_RULE_SERVICE, ALERT_DISPATCH_SERVICE, INCIDENT_SERVICE, MONITOR_SERVICE, SCHEDULER_SERVICE, STATS_SERVICE, WORKER_NODE_SERVICE, MAINTENANCE_SERVICE, QUORUM_SERVICE, HEARTBEAT_SERVICE, ARTIFACT_STORAGE, CLEANUP_SERVICE, STORAGE_STATE_SERVICE, PUBLIC_STATUS_SERVICE],
})
export class CoreModule {}
