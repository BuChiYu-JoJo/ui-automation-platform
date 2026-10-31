import { randomUUID } from "node:crypto";
import { validateDslCase, type DslCase } from "@uip/dsl";
import { redactObject, type EnvelopeCrypto, type UnifiedExecution } from "@uip/shared";
import { badRequest, conflict, notFound } from "./errors";
import type { Repositories } from "./repositories";
import type {
  ArtifactRecord, CaseRecord, CaseVersionRecord, EnvVariableRecord,
  EnvironmentRecord, ExecutionRecord, ProjectRecord, StepResultRecord,
} from "./types";
import {
  createCaseVersionDto, createCodeCaseDto, createDslCaseDto, createEnvironmentDto, createProjectDto,
  dryRunDto, parseOr400, updateEnvironmentDto, updateProjectDto, upsertVariableDto,
} from "./validation";

/** 密钥变量的 API 掩码：响应中既不出现明文也不出现密文，只有这个占位符 + isSecret 标记。 */
export const SECRET_MASK = "********";
export interface EnvVariableDto {
  id: string; environmentId: string; key: string; isSecret: boolean; kind: string;
  /** 非密钥返回真实值；密钥恒为 SECRET_MASK */
  value: string | null; masked: boolean; updatedAt: Date;
}
const toVariableDto = (r: EnvVariableRecord): EnvVariableDto => ({
  id: r.id, environmentId: r.environmentId, key: r.key, isSecret: r.isSecret, kind: r.kind,
  value: r.isSecret ? SECRET_MASK : r.valuePlain, masked: r.isSecret, updatedAt: r.updatedAt,
});

// ---------------- Projects ----------------
export class ProjectService {
  constructor(private repos: Repositories) {}
  async create(tenantId: string, raw: unknown): Promise<ProjectRecord> {
    const dto = parseOr400(createProjectDto, raw, "createProject");
    if (await this.repos.projects.findBySlug(tenantId, dto.slug))
      throw conflict(`slug "${dto.slug}" 在当前租户下已存在`);
    const now = new Date();
    return this.repos.projects.insert({
      id: randomUUID(), tenantId, name: dto.name, slug: dto.slug,
      description: dto.description, ownerId: dto.ownerId, status: "active", createdAt: now, updatedAt: now,
    });
  }
  async list(tenantId: string) { return this.repos.projects.list(tenantId); }
  async get(tenantId: string, id: string): Promise<ProjectRecord> {
    const p = await this.repos.projects.findById(tenantId, id);
    if (!p || p.status === "deleted") throw notFound(`project ${id} not found`);
    return p;
  }
  async update(tenantId: string, id: string, raw: unknown): Promise<ProjectRecord> {
    const dto = parseOr400(updateProjectDto, raw, "updateProject");
    const p = await this.get(tenantId, id);
    return this.repos.projects.save({ ...p, ...dto, updatedAt: new Date() });
  }
  /** 软删除：status=deleted，列表/详情默认不可见，slug 随即可复用 */
  async softDelete(tenantId: string, id: string): Promise<ProjectRecord> {
    const p = await this.get(tenantId, id);
    return this.repos.projects.save({ ...p, status: "deleted", updatedAt: new Date() });
  }
}

// ---------------- Environments ----------------
export class EnvironmentService {
  constructor(private repos: Repositories, private projects: ProjectService) {}
  async create(tenantId: string, projectId: string, raw: unknown): Promise<EnvironmentRecord> {
    const dto = parseOr400(createEnvironmentDto, raw, "createEnvironment");
    await this.projects.get(tenantId, projectId); // 项目不存在/跨租户 -> 404
    const existing = await this.repos.environments.listByProject(tenantId, projectId);
    const now = new Date();
    const rec = await this.repos.environments.insert({
      id: randomUUID(), tenantId, projectId, name: dto.name, baseUrl: dto.baseUrl.replace(/\/$/, ""),
      browserConfig: dto.browserConfig,
      isDefault: dto.isDefault ?? existing.length === 0, // 首个环境自动成为默认
      createdAt: now, updatedAt: now,
    });
    if (rec.isDefault) await this.repos.environments.clearDefaultExcept(tenantId, projectId, rec.id);
    return rec;
  }
  async list(tenantId: string, projectId: string) {
    await this.projects.get(tenantId, projectId);
    return this.repos.environments.listByProject(tenantId, projectId);
  }
  async get(tenantId: string, id: string): Promise<EnvironmentRecord> {
    const e = await this.repos.environments.findById(tenantId, id);
    if (!e) throw notFound(`environment ${id} not found`);
    return e;
  }
  async update(tenantId: string, id: string, raw: unknown): Promise<EnvironmentRecord> {
    const dto = parseOr400(updateEnvironmentDto, raw, "updateEnvironment");
    const e = await this.get(tenantId, id);
    const saved = await this.repos.environments.save({
      ...e, ...dto, baseUrl: dto.baseUrl ? dto.baseUrl.replace(/\/$/, "") : e.baseUrl, updatedAt: new Date(),
    });
    if (saved.isDefault) await this.repos.environments.clearDefaultExcept(tenantId, saved.projectId, saved.id);
    return this.repos.environments.findById(tenantId, id) as Promise<EnvironmentRecord>;
  }
  async remove(tenantId: string, id: string) {
    await this.get(tenantId, id);
    await this.repos.environments.delete(tenantId, id);
    return { deleted: true, id };
  }
}

// ---------------- Env variables（密钥只进不出） ----------------
export class EnvVariableService {
  constructor(
    private repos: Repositories,
    private environments: EnvironmentService,
    private crypto: EnvelopeCrypto,
  ) {}
  /** 创建或按 key 更新（upsert）：密钥在落库前信封加密，密文不出 DTO；写审计桩（只记 key，不记值）。 */
  async upsert(tenantId: string, environmentId: string, raw: unknown, actor = "demo-user")
    : Promise<EnvVariableDto> {
    const dto = parseOr400(upsertVariableDto, raw, "upsertVariable");
    await this.environments.get(tenantId, environmentId);
    const existing = await this.repos.variables.findByKey(tenantId, environmentId, dto.key);
    const now = new Date();
    const fields = dto.isSecret
      ? { valueCipher: this.crypto.encrypt(dto.value), valuePlain: null }
      : { valuePlain: dto.value, valueCipher: null };
    let rec: EnvVariableRecord;
    if (existing) {
      rec = await this.repos.variables.save({
        ...existing, ...fields, isSecret: dto.isSecret, kind: dto.kind, updatedAt: now,
      });
    } else {
      rec = await this.repos.variables.insert({
        id: randomUUID(), tenantId, environmentId, key: dto.key,
        ...fields, isSecret: dto.isSecret, kind: dto.kind, createdAt: now, updatedAt: now,
      });
    }
    if (dto.isSecret) { // 审计桩：密钥创建/更新必须留痕，summary 绝不含值
      await this.repos.audit.append({
        id: randomUUID(), tenantId, actor,
        action: existing ? "env_variable.secret.update" : "env_variable.secret.create",
        resource: `env_variable:${rec.id}`,
        summary: { key: dto.key, environmentId, isSecret: true },
        createdAt: now,
      });
    }
    return toVariableDto(rec);
  }
  async list(tenantId: string, environmentId: string): Promise<EnvVariableDto[]> {
    await this.environments.get(tenantId, environmentId);
    return (await this.repos.variables.listByEnvironment(tenantId, environmentId)).map(toVariableDto);
  }
  async remove(tenantId: string, environmentId: string, variableId: string) {
    const rec = await this.repos.variables.findById(tenantId, variableId);
    if (!rec || rec.environmentId !== environmentId) throw notFound(`variable ${variableId} not found`);
    await this.repos.variables.delete(tenantId, variableId);
    return { deleted: true, id: variableId };
  }
  /** 仅限执行路径内部使用：解密密钥变量组装运行变量表。绝不经过 API DTO。 */
  async resolveForExecution(tenantId: string, environmentId: string): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const r of await this.repos.variables.listByEnvironment(tenantId, environmentId)) {
      if (r.kind !== "variable") continue;
      out[r.key] = r.isSecret ? this.crypto.decrypt(r.valueCipher ?? "") : (r.valuePlain ?? "");
    }
    return out;
  }
  /** 密钥变量的 key 集合：快照落库前按 key 掩码（不依赖键名猜测，见 dryRun）。 */
  async secretKeys(tenantId: string, environmentId: string): Promise<string[]> {
    return (await this.repos.variables.listByEnvironment(tenantId, environmentId))
      .filter(r => r.isSecret).map(r => r.key);
  }
  /** 测试/内部核对用：取出落库的原始记录（含 cipher，不含明文），永不进 API 响应。 */
  async rawRecord(tenantId: string, environmentId: string, key: string) {
    return this.repos.variables.findByKey(tenantId, environmentId, key);
  }
}

// ---------------- Cases（最小：DSL 建用例即建 v1，原子） ----------------
export interface CaseWithLatest { case: CaseRecord; latestVersion: CaseVersionRecord | null }
export class CaseService {
  constructor(private repos: Repositories, private projects: ProjectService) {}
  async createDslCase(tenantId: string, projectId: string, raw: unknown, actor = "demo-user")
    : Promise<CaseWithLatest> {
    const dto = parseOr400(createDslCaseDto, raw, "createDslCase");
    await this.projects.get(tenantId, projectId);
    if (dto.dsl.name !== dto.name)
      throw badRequest(`用例名与 dsl.name 不一致: "${dto.name}" vs "${dto.dsl.name}"`);
    const now = new Date();
    const caseRec: CaseRecord = {
      id: randomUUID(), tenantId, projectId, name: dto.name, type: "dsl",
      tags: dto.tags, ownerId: dto.ownerId, status: "active", createdAt: now, updatedAt: now,
    };
    const version: CaseVersionRecord = {
      id: randomUUID(), tenantId, caseId: caseRec.id, versionNo: 1,
      dslJson: dto.dsl as unknown as DslCase, createdBy: actor, changeNote: dto.changeNote, createdAt: now,
    };
    // 原子性：内存实现同一 tick 连续写两表；Prisma 路径启用后改用 $transaction 包裹（见 domain/prisma.ts 说明）
    await this.repos.cases.insertCase(caseRec);
    await this.repos.cases.insertVersion(version);
    return { case: caseRec, latestVersion: version };
  }
  /** 代码轨建用例（Week 2 最小闭环）：type=code + sourceRef 指向 UIP_CODE_CASES_DIR 下的 spec 文件夹；
   *  v1 版本以 codeSnapshotRef 记录 sourceRef（后续 Git 同步时换成 commit）。 */
  async createCodeCase(tenantId: string, projectId: string, raw: unknown, actor = "demo-user")
    : Promise<CaseWithLatest> {
    const dto = parseOr400(createCodeCaseDto, raw, "createCodeCase");
    await this.projects.get(tenantId, projectId);
    const now = new Date();
    const caseRec: CaseRecord = {
      id: randomUUID(), tenantId, projectId, name: dto.name, type: "code",
      sourceRef: dto.sourceRef, tags: dto.tags, ownerId: dto.ownerId,
      status: "active", createdAt: now, updatedAt: now,
    };
    const version: CaseVersionRecord = {
      id: randomUUID(), tenantId, caseId: caseRec.id, versionNo: 1,
      codeSnapshotRef: dto.sourceRef, createdBy: actor, createdAt: now,
    };
    await this.repos.cases.insertCase(caseRec);
    await this.repos.cases.insertVersion(version);
    return { case: caseRec, latestVersion: version };
  }
  async get(tenantId: string, caseId: string): Promise<CaseWithLatest> {
    const c = await this.repos.cases.findCaseById(tenantId, caseId);
    if (!c) throw notFound(`case ${caseId} not found`);
    return { case: c, latestVersion: await this.repos.cases.latestVersion(tenantId, caseId) };
  }
  async list(tenantId: string, projectId: string) {
    await this.projects.get(tenantId, projectId);
    const out: CaseWithLatest[] = [];
    for (const c of await this.repos.cases.listCases(tenantId, projectId))
      out.push({ case: c, latestVersion: await this.repos.cases.latestVersion(tenantId, c.id) });
    return out;
  }
  async addVersion(tenantId: string, caseId: string, raw: unknown, actor = "demo-user")
    : Promise<CaseVersionRecord> {
    const dto = parseOr400(createCaseVersionDto, raw, "createCaseVersion");
    const { case: c } = await this.get(tenantId, caseId);
    if (c.type !== "dsl") throw badRequest("只有 DSL 轨用例可以追加 DSL 版本");
    const v = validateDslCase(dto.dsl);
    if (!v.ok) throw badRequest(`DSL 校验失败: ${v.errors.join("; ")}`);
    const versions = await this.repos.cases.listVersions(tenantId, caseId);
    const nextNo = (versions.length ? Math.max(...versions.map(x => x.versionNo)) : 0) + 1;
    const rec: CaseVersionRecord = {
      id: randomUUID(), tenantId, caseId, versionNo: nextNo, dslJson: dto.dsl as unknown as DslCase,
      createdBy: actor, changeNote: dto.changeNote, createdAt: new Date(),
    };
    return this.repos.cases.insertVersion(rec);
  }
}

// ---------------- Executions（最小：dry-run + 结果回写） ----------------
export interface ExecutionDispatchPayload {
  executionId: string; tenantId: string; projectId: string;
  caseId: string; caseVersionId: string; environmentId: string;
  track: "dsl" | "code"; baseUrl: string; dslCase?: DslCase;
  /** 代码轨：spec 文件夹（相对 UIP_CODE_CASES_DIR），worker 的 code-runner 据此定位 */
  sourceRef?: string;
  variables: Record<string, string>; // 已解密，仅在进程/队列内传递，不落库不进日志
}
/** 可插拔分发：Redis 可用时 BullMQ（api 层 ExecutionQueueService 适配），否则进程内（测试/演示）。 */
export interface ExecutionDispatcher {
  readonly mode: string;
  dispatch(payload: ExecutionDispatchPayload): Promise<void>;
}
/** 进程内分发：注册 handler 后同步执行（演示/测试路径）；未注册 handler 时只记录待派发。 */
export class InProcessDispatcher implements ExecutionDispatcher {
  readonly mode = "in-process";
  private handler?: (payload: ExecutionDispatchPayload) => Promise<UnifiedExecution>;
  readonly dispatched: ExecutionDispatchPayload[] = [];
  onExecute(handler: (payload: ExecutionDispatchPayload) => Promise<UnifiedExecution>) {
    this.handler = handler;
  }
  constructor(private onResult?: (result: UnifiedExecution, payload: ExecutionDispatchPayload) => Promise<void>) {}
  async dispatch(payload: ExecutionDispatchPayload): Promise<void> {
    this.dispatched.push(payload);
    if (this.handler) {
      const result = await this.handler(payload);
      await this.onResult?.(result, payload);
    }
  }
}
/** 产物保留期（天）：通过/其他 7、失败/超时 30、incident 关联 90（顺延在状态机开单时回写）。
 *  这是调研口径的落地（成功产物只留结构化结果 + 少量截图，失败产物要够排障与复盘）。 */
export function artifactRetentionDays(status: ExecutionRecord["status"], incidentLinked = false): number {
  if (incidentLinked) return 90;
  return status === "failed" || status === "timeout" ? 30 : 7;
}
export interface ExecutionDetail {
  execution: ExecutionRecord; stepResults: StepResultRecord[]; artifacts: ArtifactRecord[];
}
export class ExecutionService {
  constructor(
    private repos: Repositories,
    private cases: CaseService,
    private environments: EnvironmentService,
    private variables: EnvVariableService,
    private dispatcher: ExecutionDispatcher,
  ) {}
  /** 执行完成钩子（Week 2）：带 planId 的 execution 落终态后回调（监控状态机接入点）。
   *  手动 dry-run 无 planId，钩子不触发。由 core.module 在组装时注入，避免服务循环依赖。 */
  private completionHook?: (tenantId: string, execution: ExecutionRecord) => Promise<void>;
  setCompletionHook(hook: (tenantId: string, execution: ExecutionRecord) => Promise<void>) {
    this.completionHook = hook;
  }
  private async notifyHook(tenantId: string, execution: ExecutionRecord) {
    if (execution.planId && this.completionHook) {
      try { await this.completionHook(tenantId, execution); }
      catch (err) { // 状态机/告警失败不能反噬执行主流程，记录后吞掉
        console.error(`[uip] completion hook failed for execution ${execution.id}: ${
          err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  /** dry-run：以最新版本建 execution(queued) -> 快照脱敏落库 -> 分发（BullMQ 或进程内） */
  async dryRun(tenantId: string, caseId: string, raw: unknown): Promise<ExecutionRecord> {
    const dto = parseOr400(dryRunDto, raw, "dryRun");
    return this.createAndDispatch(tenantId, caseId, { environmentId: dto.environmentId, triggerType: dto.triggerType });
  }
  /** 建单 + 分发的统一入口（dryRun / 调度器 / 队列释放共用）。
   *  Week 3：调度器多地域时按地域逐条调用（opts.region + opts.groupId），一条地域一条 execution；
   *  opts.regions 保留 Week 2 语义（只写快照，不单独建单），供单地域/手动路径使用。 */
  async createAndDispatch(tenantId: string, caseId: string, opts: {
    environmentId: string; triggerType: string;
    planId?: string; scheduledAt?: Date; regions?: string[];
    region?: string; groupId?: string;
    /** queue 策略下先建单不分发，快照打 pendingDispatch 标记，等 tick 释放 */
    deferDispatch?: boolean;
  }): Promise<ExecutionRecord> {
    const { case: c, latestVersion } = await this.cases.get(tenantId, caseId);
    if (!latestVersion) throw badRequest(`case ${caseId} 没有任何版本`);
    const env = await this.environments.get(tenantId, opts.environmentId);
    if (env.projectId !== c.projectId) throw badRequest("environment 不属于该用例所在项目");
    const resolved = await this.variables.resolveForExecution(tenantId, env.id);
    const merged = { ...(latestVersion.dslJson?.variables ?? {}), ...resolved };
    for (const k of await this.variables.secretKeys(tenantId, env.id))
      if (k in merged) merged[k] = "***"; // 快照只存掩码，真实值仅随分发 payload 在内存/队列中传递
    const snapshot: Record<string, unknown> = redactObject(merged) as Record<string, unknown>;
    if (opts.regions?.length) snapshot.regions = opts.regions;
    if (opts.groupId) snapshot.groupId = opts.groupId;
    if (opts.deferDispatch) snapshot.pendingDispatch = true;
    const execution = await this.repos.executions.insertExecution({
      id: randomUUID(), tenantId, projectId: c.projectId, caseVersionId: latestVersion.id,
      environmentId: env.id, triggerType: opts.triggerType, status: "queued", attempt: 1,
      planId: opts.planId, scheduledAt: opts.scheduledAt,
      region: opts.region ?? (opts.regions?.length === 1 ? opts.regions[0] : undefined),
      groupId: opts.groupId,
      snapshotJson: snapshot, createdAt: new Date(),
    });
    if (opts.deferDispatch) return execution;
    return this.dispatchExisting(execution);
  }
  /** 对一条已建单（queued）的 execution 组装 payload 并分发；queue 策略释放与首次分发共用。 */
  async dispatchExisting(execution: ExecutionRecord): Promise<ExecutionRecord> {
    const version = await this.repos.cases.findVersionById(execution.tenantId, execution.caseVersionId);
    if (!version) throw badRequest(`caseVersion ${execution.caseVersionId} not found`);
    const { case: c } = await this.cases.get(execution.tenantId, version.caseId);
    const env = await this.environments.get(execution.tenantId, execution.environmentId);
    const resolved = await this.variables.resolveForExecution(execution.tenantId, env.id);
    // 清除 pendingDispatch 标记（已释放）
    const snapshot = { ...(execution.snapshotJson ?? {}) };
    delete snapshot.pendingDispatch;
    const current = (await this.repos.executions.findExecutionById(execution.tenantId, execution.id)) ?? execution;
    await this.repos.executions.saveExecution({ ...current, snapshotJson: snapshot });
    try {
      await this.dispatcher.dispatch({
        executionId: execution.id, tenantId: execution.tenantId, projectId: execution.projectId,
        caseId: c.id, caseVersionId: version.id, environmentId: env.id, track: c.type,
        baseUrl: env.baseUrl, dslCase: version.dslJson,
        sourceRef: version.codeSnapshotRef ?? c.sourceRef, variables: resolved,
      });
    } catch (err) { // 分发失败 = 基础设施失败，不算被测失败
      const failed = await this.finishWithStatus(
        (await this.repos.executions.findExecutionById(execution.tenantId, execution.id)) ?? execution,
        "infra_failed", err instanceof Error ? err.message : String(err));
      await this.notifyHook(execution.tenantId, failed);
      return failed;
    }
    return (await this.repos.executions.findExecutionById(execution.tenantId, execution.id)) ?? execution;
  }
  /** Worker 结果回写：统一模型 -> execution 状态 + step_results + artifacts（同一入口，双轨共用） */
  async completeExecution(tenantId: string, executionId: string, result: UnifiedExecution,
    artifactFiles: { kind: ArtifactRecord["kind"]; s3Key: string; sizeBytes: number; stepNo?: number }[] = [])
    : Promise<ExecutionRecord> {
    const execution = await this.mustGet(tenantId, executionId);
    const now = new Date();
    const stepRecs: StepResultRecord[] = result.steps.map(s => ({
      id: randomUUID(), tenantId, executionId, stepNo: s.stepNo, stepType: s.stepType,
      name: s.name, status: s.status, durationMs: s.durationMs,
      errorMessage: s.errorMessage, locatorHealed: s.locatorHealed ?? false,
    }));
    await this.repos.executions.insertStepResults(stepRecs);
    // Week 3 产物保留期在登记时按执行结论定死：通过 7 天 / 失败 30 天；
    // 与 incident 关联的失败产物由状态机开单时再顺延到 90 天（见 week3 清理与状态机）。
    const expiresAt = new Date(now.getTime() + artifactRetentionDays(result.status) * 24 * 3600_000);
    for (const a of result.artifacts)
      await this.repos.executions.insertArtifact({
        id: randomUUID(), tenantId, executionId, kind: a.kind, s3Key: a.s3Key,
        sizeBytes: 0, expiresAt,
      });
    for (const f of artifactFiles)
      await this.repos.executions.insertArtifact({
        id: randomUUID(), tenantId, executionId, kind: f.kind, s3Key: f.s3Key,
        sizeBytes: f.sizeBytes, expiresAt,
      });
    const saved = await this.repos.executions.saveExecution({
      ...execution, status: result.status, durationMs: result.durationMs,
      startedAt: execution.startedAt ?? new Date(now.getTime() - result.durationMs), finishedAt: now,
    });
    await this.notifyHook(tenantId, saved); // 带 planId 时驱动监控状态机（见 week2-services）
    return saved;
  }
  async markRunning(tenantId: string, executionId: string) {
    const e = await this.mustGet(tenantId, executionId);
    return this.repos.executions.saveExecution({ ...e, status: "running", startedAt: new Date() });
  }
  private async finishWithStatus(e: ExecutionRecord, status: ExecutionRecord["status"], msg: string) {
    // 基础设施失败要留原因（如浏览器二进制缺失），否则排障时只看到 infra_failed 四个字
    return this.repos.executions.saveExecution({
      ...e, status, finishedAt: new Date(),
      snapshotJson: { ...(e.snapshotJson ?? {}), infraError: msg.slice(0, 500) },
    });
  }
  async mustGet(tenantId: string, id: string): Promise<ExecutionRecord> {
    const e = await this.repos.executions.findExecutionById(tenantId, id);
    if (!e) throw notFound(`execution ${id} not found`);
    return e;
  }
  async getDetail(tenantId: string, id: string): Promise<ExecutionDetail> {
    const execution = await this.mustGet(tenantId, id);
    return {
      execution,
      stepResults: await this.repos.executions.listStepResults(tenantId, id),
      artifacts: await this.repos.executions.listArtifacts(tenantId, id),
    };
  }
  async list(tenantId: string, projectId: string) {
    return this.repos.executions.listExecutions(tenantId, projectId);
  }
  /** 双轨统一列表（Week 2）：DSL 与代码轨在同一列表返回，每条带 track + caseName，前端据此打徽章。 */
  async listEnriched(tenantId: string, projectId: string): Promise<EnrichedExecution[]> {
    const execs = await this.repos.executions.listExecutions(tenantId, projectId);
    const out: EnrichedExecution[] = [];
    for (const e of execs) {
      const version = await this.repos.cases.findVersionById(tenantId, e.caseVersionId);
      const c = version ? await this.repos.cases.findCaseById(tenantId, version.caseId) : null;
      out.push({ execution: e, track: c?.type ?? "dsl", caseName: c?.name ?? "(unknown case)" });
    }
    return out.sort((a, b) =>
      b.execution.createdAt.getTime() - a.execution.createdAt.getTime());
  }
}
export interface EnrichedExecution {
  execution: ExecutionRecord; track: "dsl" | "code"; caseName: string;
}
