import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve as resolvePath, sep } from "node:path";
import { storageStateKey, type EnvelopeCrypto } from "@uip/shared";
import { lastCronFire } from "./cron";
import { badRequest, notFound } from "./errors";
import type { Repositories } from "./repositories";
import type { AlertDispatchService, MaintenanceChecker, MonitorStateService } from "./week2-services";
import type { EnvironmentService, ProjectService } from "./services";
import type {
  ExecutionRecord, GroupVerdictRecord, HeartbeatRecord,
  MaintenanceWindowRecord, PlanRecord, WorkerNodeRecord,
} from "./types";
import {
  createHeartbeatDto, createMaintenanceWindowDto, parseOr400, registerWorkerDto,
  saveStorageStateDto, updateMaintenanceWindowDto, workerHeartbeatDto,
} from "./validation";

/** Worker 节点离线阈值：超过 60s 没有心跳即视为 offline（心跳建议 15-20s 一次，留 3 个周期容错）。 */
export const WORKER_OFFLINE_AFTER_MS = 60_000;
// ---------------- Worker 节点 ----------------
export interface WorkerNodeDto extends WorkerNodeRecord {
  status: "online" | "offline";
  freeSlots: number;
}
export class WorkerNodeService {
  constructor(private repos: Repositories) {}
  /** 注册即视为一次心跳（lastHeartbeatAt=now，注册完立刻 online，避免注册与首跳之间的假离线）。 */
  async register(tenantId: string, raw: unknown): Promise<WorkerNodeDto> {
    const dto = parseOr400(registerWorkerDto, raw, "registerWorker");
    const now = new Date();
    const rec = await this.repos.workers.insert({
      id: randomUUID(), tenantId, name: dto.name, region: dto.region,
      totalSlots: dto.totalSlots, usedSlots: 0, browserVersion: dto.browserVersion,
      lastHeartbeatAt: now, registeredAt: now, createdAt: now, updatedAt: now,
    });
    return this.toDto(rec, now);
  }
  async heartbeat(tenantId: string, id: string, raw: unknown): Promise<WorkerNodeDto> {
    const dto = parseOr400(workerHeartbeatDto, raw, "workerHeartbeat");
    const node = await this.get(tenantId, id);
    const now = new Date();
    const saved = await this.repos.workers.save({
      ...node,
      ...(dto.usedSlots !== undefined ? { usedSlots: dto.usedSlots } : {}),
      ...(dto.totalSlots !== undefined ? { totalSlots: dto.totalSlots } : {}),
      ...(dto.browserVersion !== undefined ? { browserVersion: dto.browserVersion } : {}),
      lastHeartbeatAt: now, updatedAt: now,
    });
    return this.toDto(saved, now);
  }
  async get(tenantId: string, id: string): Promise<WorkerNodeRecord> {
    const n = await this.repos.workers.findById(tenantId, id);
    if (!n) throw notFound(`worker node ${id} not found`);
    return n;
  }
  async list(tenantId: string, now: Date = new Date()): Promise<WorkerNodeDto[]> {
    return (await this.repos.workers.list(tenantId)).map(n => this.toDto(n, now));
  }
  private toDto(n: WorkerNodeRecord, now: Date): WorkerNodeDto {
    const online = !!n.lastHeartbeatAt
      && now.getTime() - n.lastHeartbeatAt.getTime() <= WORKER_OFFLINE_AFTER_MS;
    return { ...n, status: online ? "online" : "offline", freeSlots: Math.max(0, n.totalSlots - n.usedSlots) };
  }
}

// ---------------- 维护窗口 ----------------
/** 维护窗口语义（Week 3 口径）：
 *  - 作用域 plan 或 project（plan 级优先于项目级命中，但 isInMaintenance 只回答「是否在窗口内」）。
 *  - 一次性：startsAt <= at < endsAt。周期：最近一个 cron 触发点 fire 满足 fire <= at < fire + durationMinutes（按窗口时区求值）。
 *  - 窗口内：执行照常跑照常记录；状态机迁移照常记 history（打 suppressed 标），但不开 incident、不发告警；
 *    窗口内 downtime 不计 SLA——本期落地方式是 stats 展示层标注 + 状态机不产生 incident（incident 是 downtime 的数据源）。
 *  - 窗口前已 down 的 incident 不受影响（不关单、窗口内恢复只关单不发通知，见 MonitorStateService）。 */
export class MaintenanceService implements MaintenanceChecker {
  constructor(
    private repos: Repositories,
    private projects: ProjectService,
  ) {}
  async create(tenantId: string, raw: unknown, actor = "demo-user"): Promise<MaintenanceWindowRecord> {
    const dto = parseOr400(createMaintenanceWindowDto, raw, "createMaintenanceWindow");
    let projectId: string;
    if (dto.scopeType === "plan") {
      const plan = await this.repos.plans.findById(tenantId, dto.scopeId);
      if (!plan) throw notFound(`plan ${dto.scopeId} not found`);
      projectId = plan.projectId;
    } else {
      await this.projects.get(tenantId, dto.scopeId);
      projectId = dto.scopeId;
    }
    const now = new Date();
    return this.repos.maintenance.insert({
      id: randomUUID(), tenantId, projectId, scopeType: dto.scopeType, scopeId: dto.scopeId,
      startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
      endsAt: dto.endsAt ? new Date(dto.endsAt) : undefined,
      cronExpr: dto.cronExpr, durationMinutes: dto.durationMinutes, timezone: dto.timezone,
      reason: dto.reason, createdBy: actor, createdAt: now, updatedAt: now,
    });
  }
  async get(tenantId: string, id: string): Promise<MaintenanceWindowRecord> {
    const w = await this.repos.maintenance.findById(tenantId, id);
    if (!w) throw notFound(`maintenance window ${id} not found`);
    return w;
  }
  async listByProject(tenantId: string, projectId: string) {
    await this.projects.get(tenantId, projectId);
    return this.repos.maintenance.listByProject(tenantId, projectId);
  }
  async update(tenantId: string, id: string, raw: unknown): Promise<MaintenanceWindowRecord> {
    const dto = parseOr400(updateMaintenanceWindowDto, raw, "updateMaintenanceWindow");
    const w = await this.get(tenantId, id);
    const merged = {
      ...w, ...dto,
      startsAt: dto.startsAt ? new Date(dto.startsAt) : w.startsAt,
      endsAt: dto.endsAt ? new Date(dto.endsAt) : w.endsAt,
      updatedAt: new Date(),
    };
    // 合并后仍须满足窗口形态：一次性须起止齐全且止 > 起；周期须有 cron + duration
    if (merged.cronExpr) {
      if (!merged.durationMinutes) throw badRequest("周期窗口必须提供 durationMinutes");
    } else {
      if (!merged.startsAt || !merged.endsAt) throw badRequest("一次性窗口必须同时提供 startsAt 与 endsAt");
      if (merged.endsAt <= merged.startsAt) throw badRequest("endsAt 必须晚于 startsAt");
    }
    return this.repos.maintenance.save(merged);
  }
  async remove(tenantId: string, id: string) {
    await this.get(tenantId, id);
    await this.repos.maintenance.delete(tenantId, id);
    return { deleted: true, id };
  }
  /** 单个窗口在 at 时刻是否激活（纯函数形态，便于测试与复用）。 */
  isWindowActive(w: MaintenanceWindowRecord, at: Date): boolean {
    if (w.startsAt && w.endsAt) return w.startsAt <= at && at < w.endsAt;
    if (w.cronExpr && w.durationMinutes) {
      const fire = lastCronFire(w.cronExpr, w.timezone, at);
      if (!fire) return false;
      return at.getTime() < fire.getTime() + w.durationMinutes * 60_000;
    }
    return false;
  }
  /** 某 plan（或其所属 project）在 at 是否处于任一维护窗口：plan 级与项目级任一命中即算。 */
  async isInMaintenance(tenantId: string,
    scope: { planId?: string; projectId?: string }, at: Date): Promise<MaintenanceWindowRecord | null> {
    const candidates: MaintenanceWindowRecord[] = [];
    if (scope.planId)
      candidates.push(...await this.repos.maintenance.listByScope(tenantId, "plan", scope.planId));
    if (scope.projectId)
      candidates.push(...await this.repos.maintenance.listByScope(tenantId, "project", scope.projectId));
    return candidates.find(w => this.isWindowActive(w, at)) ?? null;
  }
  /** 该 plan 当前/未来窗口的下一次开始时间（展示用，可选）：周期窗口用 nextCronFire 语义扫一遍即可——
   *  这里只提供「当前是否在窗口」的判定，下一次开始时间留给前端按 cron 自行展示（MVP 不做）。 */
  async activeWindowForPlan(tenantId: string, plan: PlanRecord, at: Date) {
    return this.isInMaintenance(tenantId, { planId: plan.id, projectId: plan.projectId }, at);
  }
}

// ---------------- Quorum 组判定 ----------------
/** 组 id 约定：`${planId}@${scheduledAt ISO}`（调度器建单时生成，execution.groupId 与 snapshot.groupId 同值）。 */
export function deriveGroupId(planId: string, scheduledAt?: Date): string | null {
  return scheduledAt ? `${planId}@${scheduledAt.toISOString()}` : null;
}
const TERMINAL: ExecutionRecord["status"][] =
  ["passed", "failed", "flaky", "infra_failed", "timeout", "cancelled"];
/** Quorum 判定规则（写死防扯皮，与 decisions.md Week 3 条一致）：
 *  投票：passed/flaky = 赞成（up 票）；failed/timeout = 反对（down 票）；infra_failed/cancelled = 弃权（不投票）。
 *  设计划地域数 P、有效投票 V=up+down、down 票 D：
 *   - V = 0（全弃权）        -> verdict=infra：不喂状态机业务判定（只给状态机加 infra 计数）。
 *   - D >= 2                 -> down（覆盖 P=3 时「≥2 地域失败才 down」、P=2 时「两地域都失败」）。
 *   - V = 1 且 D = 1         -> down，但 degraded=true（P>=2 时只剩一个有效投票，按它判但降级标注）。
 *   - 其余（D<=1 且 V>=2）   -> up（含 P=2 一票 down 一票 up 的平票：证据不足不报 down）。
 *  degraded = V < P。单地域计划（P<=1）不走 quorum，Week 2 单条路径不变。 */
export class QuorumJudgeService {
  constructor(
    private repos: Repositories,
    private monitors: MonitorStateService,
  ) {}
  /** execution 落终态后由完成钩子调用：组员没到齐（含待分发/运行中）先不判；到齐了调 judgeGroup。 */
  async onExecutionCompleted(tenantId: string, execution: ExecutionRecord)
    : Promise<GroupVerdictRecord | null> {
    if (!execution.planId) return null;
    const plan = await this.repos.plans.findById(tenantId, execution.planId);
    if (!plan) return null;
    if (plan.regions.length <= 1) {
      // 单地域：沿用 Week 2 单条路径（onExecutionCompleted 内部自理 infra/成功/失败）
      await this.monitors.onExecutionCompleted(tenantId, execution);
      return null;
    }
    const groupId = execution.groupId ?? deriveGroupId(plan.id, execution.scheduledAt);
    if (!groupId) { // 多地域但无从归组（异常路径）：按单条处理，宁可判一次也不能丢结果
      await this.monitors.onExecutionCompleted(tenantId, execution);
      return null;
    }
    const members = await this.groupMembers(tenantId, plan.id, groupId);
    // 必须等齐计划地域数的成员才判：组员是逐个到达的，只看「已插入的成员」会把半组误判成全组
    if (members.length < plan.regions.length) return null;
    if (!members.every(m => TERMINAL.includes(m.status))) return null;
    return this.judgeGroup(tenantId, groupId);
  }
  async groupMembers(tenantId: string, planId: string, groupId: string): Promise<ExecutionRecord[]> {
    const all = await this.repos.executions.listByPlan(tenantId, planId);
    return all.filter(e => (e.groupId ?? deriveGroupId(planId, e.scheduledAt)) === groupId);
  }
  /** 对一组做判定（幂等：已判过的组直接返回旧结论，绝不重复喂状态机）。
   *  默认要求全员到齐；allowPartial=true 时按已终态成员先判（judge 超时兜底的显式入口，调用方自担降级）。 */
  async judgeGroup(tenantId: string, groupId: string, opts?: { allowPartial?: boolean })
    : Promise<GroupVerdictRecord | null> {
    const existing = await this.repos.groups.findByGroupId(tenantId, groupId);
    if (existing) return existing;
    // groupId 形如 `${planId}@${scheduledAt}`；planId 本身是 uuid 不含 @，取第一个 @ 前为 planId
    const planId = groupId.split("@")[0];
    const plan = await this.repos.plans.findById(tenantId, planId);
    if (!plan) return null;
    const members = await this.groupMembers(tenantId, plan.id, groupId);
    if (!members.length) return null;
    const terminal = members.filter(m => TERMINAL.includes(m.status));
    if (!opts?.allowPartial
      && (terminal.length < members.length || members.length < plan.regions.length)) return null;
    const votes: Record<string, string> = {};
    let upVotes = 0, downVotes = 0;
    for (const m of terminal) {
      votes[m.region ?? "default"] = m.status;
      if (m.status === "passed" || m.status === "flaky") upVotes += 1;
      else if (m.status === "failed" || m.status === "timeout") downVotes += 1;
      // infra_failed / cancelled：弃权，只出现在 votes 明细里，不计票
    }
    const plannedRegions = plan.regions.length;
    const voters = upVotes + downVotes;
    let verdict: GroupVerdictRecord["verdict"];
    if (voters === 0) verdict = "infra";
    else if (downVotes >= 2 || (voters === 1 && downVotes === 1)) verdict = "down";
    else verdict = "up";
    const rec: GroupVerdictRecord = {
      groupId, tenantId, projectId: plan.projectId, planId: plan.id,
      scheduledAt: terminal[0]?.scheduledAt ?? members[0].scheduledAt,
      verdict, degraded: voters < plannedRegions, votes, downVotes, upVotes,
      plannedRegions, judgedAt: new Date(),
    };
    const saved = await this.repos.groups.insert(rec);
    await this.monitors.onGroupVerdict(tenantId, plan, saved); // 一个组判定只喂状态机一步
    return saved;
  }
}

// ---------------- Heartbeat ----------------
/** 超时宽限倍数：lastSeen 超过 expectIntervalSec * 1.5 才判 down（给打点方留网络抖动余量，见 decisions）。 */
export const HEARTBEAT_GRACE_MULTIPLIER = 1.5;
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export interface HeartbeatDto {
  id: string; projectId: string; name: string; expectIntervalSec: number;
  tokenPrefix: string; status: HeartbeatRecord["status"]; lastSeenAt?: Date;
  alertRuleId?: string; updatedAt: Date;
}
const toHeartbeatDto = (r: HeartbeatRecord): HeartbeatDto => ({
  id: r.id, projectId: r.projectId, name: r.name, expectIntervalSec: r.expectIntervalSec,
  tokenPrefix: r.tokenPrefix, status: r.status, lastSeenAt: r.lastSeenAt,
  alertRuleId: r.alertRuleId, updatedAt: r.updatedAt,
});
export class HeartbeatService {
  constructor(
    private repos: Repositories,
    private projects: ProjectService,
    private alerts: AlertDispatchService,
  ) {}
  /** 创建：生成 token（`uhb_` + 随机），明文只在本响应出现一次（token 字段），落库只有哈希。 */
  async create(tenantId: string, projectId: string, raw: unknown)
    : Promise<{ heartbeat: HeartbeatDto; token: string }> {
    const dto = parseOr400(createHeartbeatDto, raw, "createHeartbeat");
    await this.projects.get(tenantId, projectId);
    if (dto.alertRuleId) {
      const rule = await this.repos.alertRules.findById(tenantId, dto.alertRuleId);
      if (!rule || rule.projectId !== projectId) throw badRequest("alertRuleId 不存在或不属于该项目");
    }
    const token = `uhb_${randomBytes(24).toString("base64url")}`;
    const now = new Date();
    const rec = await this.repos.heartbeats.insert({
      id: randomUUID(), tenantId, projectId, name: dto.name,
      tokenHash: hashToken(token), tokenPrefix: token.slice(0, 10),
      expectIntervalSec: dto.expectIntervalSec, alertRuleId: dto.alertRuleId,
      status: "pending", createdAt: now, updatedAt: now,
    });
    return { heartbeat: toHeartbeatDto(rec), token };
  }
  async list(tenantId: string, projectId: string): Promise<HeartbeatDto[]> {
    await this.projects.get(tenantId, projectId);
    return (await this.repos.heartbeats.listByProject(tenantId, projectId)).map(toHeartbeatDto);
  }
  async remove(tenantId: string, projectId: string, id: string) {
    const hb = await this.repos.heartbeats.findById(tenantId, id);
    if (!hb || hb.projectId !== projectId) throw notFound(`heartbeat ${id} not found`);
    await this.repos.heartbeats.delete(tenantId, id);
    return { deleted: true, id };
  }
  /** 打点：token 即凭证（URL 里的 token 本身就是被监控方与平台的共享秘密），
   *  所以这个端点不要求租户 header——租户由 token 反查。这也是它必须只存哈希的原因：
   *  DB 泄漏不能直接换来可用的打点凭证。未知 token 一律 404，不区分「不存在/已删除」防枚举。 */
  async ping(token: string, at: Date = new Date()): Promise<{ ok: true; recovered: boolean }> {
    const hb = await this.repos.heartbeats.findByTokenHash(hashToken(token));
    if (!hb) throw notFound("heartbeat token not recognized");
    let recovered = false;
    const wasDown = hb.status === "down";
    hb.lastSeenAt = at;
    hb.status = "up";
    if (wasDown) {
      recovered = true;
      const incident = hb.openIncidentId
        ? await this.repos.incidents.findById(hb.tenantId, hb.openIncidentId) : null;
      hb.openIncidentId = undefined;
      await this.repos.heartbeats.save({ ...hb, updatedAt: new Date() });
      if (incident && incident.status !== "resolved") {
        const resolved = await this.repos.incidents.save({
          ...incident, status: "resolved", resolvedAt: at,
          durationMs: at.getTime() - incident.startedAt.getTime(), updatedAt: new Date(),
        });
        await this.alerts.dispatchHeartbeat(hb.tenantId, hb, resolved, "heartbeat_recovered", {
          monitorName: `heartbeat:${hb.name}`,
          summary: `心跳已恢复（间隔 ${hb.expectIntervalSec}s），故障持续 ${Math.round((resolved.durationMs ?? 0) / 1000)}s`,
        });
      }
      return { ok: true, recovered };
    }
    await this.repos.heartbeats.save({ ...hb, updatedAt: new Date() });
    return { ok: true, recovered };
  }
  /** 超时扫描（可测核心，无定时器）：基线 = lastSeenAt（从未打点则用 createdAt——新建后一个宽限周期内不误报）。
   *  返回本次新判 down 的 heartbeat 列表；已 down 的不重复开单/告警（去重与 Week 2 同口径）。 */
  async scanHeartbeats(tenantId: string, now: Date = new Date()): Promise<HeartbeatRecord[]> {
    const newlyDown: HeartbeatRecord[] = [];
    for (const hb of await this.repos.heartbeats.listByTenant(tenantId)) {
      if (hb.status === "down") continue;
      const baseline = hb.lastSeenAt ?? hb.createdAt;
      const deadline = baseline.getTime() + hb.expectIntervalSec * 1000 * HEARTBEAT_GRACE_MULTIPLIER;
      if (now.getTime() <= deadline) continue;
      const incident = await this.repos.incidents.insert({
        id: randomUUID(), tenantId, projectId: hb.projectId, planId: hb.id,
        sourceType: "heartbeat", sourceId: hb.id,
        status: "triggered", startedAt: now,
        escalateAt: new Date(now.getTime() + 15 * 60_000),
        regionVotes: { heartbeat: hb.name, expectIntervalSec: hb.expectIntervalSec, lastSeenAt: hb.lastSeenAt ?? null },
        summary: `心跳超时：超过 ${Math.round(hb.expectIntervalSec * HEARTBEAT_GRACE_MULTIPLIER)}s 未打点（期望间隔 ${hb.expectIntervalSec}s）`,
        createdAt: new Date(), updatedAt: new Date(),
      });
      const saved = await this.repos.heartbeats.save({
        ...hb, status: "down", openIncidentId: incident.id, updatedAt: new Date(),
      });
      newlyDown.push(saved);
      await this.alerts.dispatchHeartbeat(tenantId, saved, incident, "heartbeat_down", {
        monitorName: `heartbeat:${hb.name}`,
        summary: `心跳超时未打点：最后打点 ${hb.lastSeenAt?.toISOString() ?? "从未打点"}，期望间隔 ${hb.expectIntervalSec}s（宽限 x${HEARTBEAT_GRACE_MULTIPLIER}）`,
      });
    }
    return newlyDown;
  }
}

// ---------------- 产物存储与过期清理 ----------------
/** 存储抽象：清理任务只认这个接口。本地 FS 实现供 dev/测试（也是 artifacts 根目录的真实落盘形态）；
 *  S3 实现先留 stub：MinIO 实启依赖 Docker 阻塞解除，接口先定死，上线时换实现不动清理逻辑。 */
export interface ArtifactStorage {
  readonly kind: string;
  delete(key: string): Promise<void>;
  exists?(key: string): Promise<boolean>;
}
export class LocalArtifactStorage implements ArtifactStorage {
  readonly kind = "local-fs";
  constructor(private rootDir: string) {}
  private pathFor(key: string): string {
    const p = resolvePath(join(this.rootDir, key));
    const root = resolvePath(this.rootDir);
    if (p !== root && !p.startsWith(root + sep)) throw new Error(`artifact key escapes root: ${key}`);
    return p;
  }
  async delete(key: string): Promise<void> { await rm(this.pathFor(key), { force: true }); }
  async exists(key: string): Promise<boolean> {
    try { await stat(this.pathFor(key)); return true; } catch { return false; }
  }
  /** 测试/演示辅助：按 key 写文件（模拟 worker 已把产物落在 artifacts 根目录） */
  async put(key: string, content: string | Buffer): Promise<void> {
    const p = this.pathFor(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, content);
  }
}
export class S3ArtifactStorageStub implements ArtifactStorage {
  readonly kind = "s3-stub";
  async delete(_key: string): Promise<void> {
    // TODO(s3): 接 @aws-sdk/client-s3 DeleteObject 到 MinIO/OSS；当前抛错让清理任务记 error 且不软删记录，防「以为删了其实没删」
    throw new Error("S3 artifact storage not wired yet (MinIO blocked by missing Docker); refusing to fake-delete");
  }
}
export interface CleanupResult {
  scanned: number; expired: number; deleted: number; dryRun: boolean;
  keys: string[]; errors: { artifactId: string; error: string }[];
}
export class ArtifactCleanupService {
  constructor(
    private repos: Repositories,
    private storage: ArtifactStorage,
  ) {}
  /** 扫 expiresAt <= now 且未软删的产物：dryRun 只报清单不删；实删先删存储对象、成功后才给记录打 deletedAt，
   *  存储失败记 error 且保留记录，下轮重试——绝不出现「记录删了对象还在」或反之的假干净。 */
  async cleanupExpiredArtifacts(tenantId: string, now: Date = new Date(),
    opts?: { dryRun?: boolean }): Promise<CleanupResult> {
    const dryRun = opts?.dryRun ?? false;
    const all = await this.repos.executions.listAllArtifacts(tenantId);
    const expired = all.filter(a => !a.deletedAt && a.expiresAt <= now);
    const result: CleanupResult = {
      scanned: all.length, expired: expired.length, deleted: 0, dryRun,
      keys: expired.map(a => a.s3Key), errors: [],
    };
    if (dryRun) return result;
    for (const a of expired) {
      try {
        await this.storage.delete(a.s3Key);
        await this.repos.executions.saveArtifact({ ...a, deletedAt: now });
        result.deleted += 1;
      } catch (err) {
        result.errors.push({ artifactId: a.id, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return result;
  }
}

// ---------------- storageState 登录预设 ----------------
/** 默认 TTL：7 天。storageState 本质是会话凭证：太短要频繁重登，太长等于长期凭证，7 天是监控场景的折中（可按环境覆盖）。 */
export const STORAGE_STATE_DEFAULT_TTL_SEC = 7 * 24 * 3600;
export type StorageStateStatus =
  | { status: "fresh"; needsLogin: false; key: string; savedAt: Date; ageSec: number }
  | { status: "missing" | "expired"; needsLogin: true; key?: string; savedAt?: Date };
/** 登录预设服务（API 侧）：state 内容信封加密后写 artifacts 根目录（key 走 shared.storageStateKey），
 *  环境记录只存引用/时间/TTL。⚠️ 安全口径：storageState == 登录凭证，与密码同级保护——
 *  加密落盘、不进 DTO、不进日志、不进执行快照；worker 侧解密只在内存/临时文件（见 worker login-preset）。 */
export class StorageStateService {
  constructor(
    private repos: Repositories,
    private environments: EnvironmentService,
    private crypto: EnvelopeCrypto,
    private artifactsRoot: string =
      process.env.UIP_ARTIFACTS_DIR ?? join(process.cwd(), "artifacts"),
  ) {}
  private fileFor(key: string): string {
    const p = resolvePath(join(this.artifactsRoot, key));
    const root = resolvePath(this.artifactsRoot);
    if (!p.startsWith(root + sep)) throw new Error(`storage state key escapes root: ${key}`);
    return `${p}.enc`;
  }
  async save(tenantId: string, environmentId: string, raw: unknown): Promise<{
    role: string; key: string; savedAt: Date; ttlSec: number;
  }> {
    const dto = parseOr400(saveStorageStateDto, raw, "saveStorageState");
    const env = await this.environments.get(tenantId, environmentId);
    const stateText = typeof dto.state === "string" ? dto.state : JSON.stringify(dto.state);
    try { JSON.parse(stateText); } catch { throw badRequest("state 不是合法 JSON（应为 Playwright storageState）"); }
    const key = storageStateKey(tenantId, env.projectId, environmentId, dto.role);
    const file = this.fileFor(key);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, this.crypto.encrypt(stateText), { mode: 0o600 });
    const savedAt = new Date();
    const ttlSec = dto.ttlSec ?? STORAGE_STATE_DEFAULT_TTL_SEC;
    const presets = { ...(env.storageStatePresets ?? {}), [dto.role]: { key, savedAt, ttlSec } };
    // EnvironmentRepository 没有「部分更新」语义，走 save 全量回写（先重读避免覆盖并发修改的其它字段）
    const fresh = await this.environments.get(tenantId, environmentId);
    await this.repos.environments.save({ ...fresh, storageStatePresets: presets, updatedAt: new Date() });
    return { role: dto.role, key, savedAt, ttlSec };
  }
  /** 复用判定：预设存在 + 文件在 + 未超 TTL -> fresh（worker 可直接注入）；否则 needsLogin=true 等登录用例刷新。 */
  async ensureStorageState(tenantId: string, environmentId: string, role: string,
    now: Date = new Date()): Promise<StorageStateStatus> {
    const env = await this.environments.get(tenantId, environmentId);
    const preset = env.storageStatePresets?.[role];
    if (!preset) return { status: "missing", needsLogin: true };
    const savedAt = new Date(preset.savedAt); // Prisma Json 回读时 Date 会变 ISO 字符串，这里统一归一
    const ttlSec = preset.ttlSec ?? STORAGE_STATE_DEFAULT_TTL_SEC;
    const ageSec = Math.floor((now.getTime() - savedAt.getTime()) / 1000);
    const exists = await stat(this.fileFor(preset.key)).then(() => true).catch(() => false);
    if (!exists) return { status: "missing", needsLogin: true, key: preset.key, savedAt };
    if (ageSec > ttlSec) return { status: "expired", needsLogin: true, key: preset.key, savedAt };
    return { status: "fresh", needsLogin: false, key: preset.key, savedAt, ageSec };
  }
  /** 内部使用：解密读回 state JSON（只供 worker 拉取路径/测试，永不进 API DTO）。 */
  async loadStateJson(tenantId: string, environmentId: string, role: string): Promise<unknown> {
    const env = await this.environments.get(tenantId, environmentId);
    const preset = env.storageStatePresets?.[role];
    if (!preset) throw notFound(`environment ${environmentId} 没有角色 ${role} 的 storageState 预设`);
    const cipher = await readFile(this.fileFor(preset.key), "utf8");
    return JSON.parse(this.crypto.decrypt(cipher));
  }
}
