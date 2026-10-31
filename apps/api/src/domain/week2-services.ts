import { randomUUID } from "node:crypto";
import {
  FeishuNotifier, GenericWebhookNotifier, WeComNotifier,
  type AlertEvent, type Notifier,
} from "@uip/notifiers";
import type { EnvelopeCrypto } from "@uip/shared";
import { lastCronFire } from "./cron";
import { badRequest, conflict, notFound } from "./errors";
import type { Repositories } from "./repositories";
import { artifactRetentionDays, type ExecutionService, type ProjectService } from "./services";
import type {
  AlertChannelRecord, AlertChannelType, AlertRuleRecord, ExecutionRecord, GroupVerdictRecord,
  HeartbeatRecord, IncidentRecord, MaintenanceWindowRecord, MonitorStateRecord,
  NotificationLogRecord, PlanRecord,
} from "./types";
import {
  createAlertRuleDto, createPlanDto, parseOr400, updateAlertRuleDto, updatePlanDto,
} from "./validation";

/** ack 超时（分钟）：incident 建单时 escalateAt = startedAt + 此值。MVP 只落字段，升级动作 V1。 */
export const ACK_TIMEOUT_MIN = 15;

// ---------------- Plans ----------------
export class PlanService {
  constructor(
    private repos: Repositories,
    private projects: ProjectService,
  ) {}
  async create(tenantId: string, raw: unknown): Promise<PlanRecord> {
    const dto = parseOr400(createPlanDto, raw, "createPlan");
    const c = await this.repos.cases.findCaseById(tenantId, dto.caseId);
    if (!c) throw notFound(`case ${dto.caseId} not found`);
    const env = await this.repos.environments.findById(tenantId, dto.environmentId);
    if (!env) throw notFound(`environment ${dto.environmentId} not found`);
    if (env.projectId !== c.projectId)
      throw badRequest("environment 与 case 不属于同一项目");
    await this.projects.get(tenantId, c.projectId);
    const now = new Date();
    return this.repos.plans.insert({
      id: randomUUID(), tenantId, projectId: c.projectId, caseId: dto.caseId,
      environmentId: dto.environmentId, cronExpr: dto.cronExpr, timezone: dto.timezone,
      regions: dto.regions, enabled: dto.enabled, concurrencyPolicy: dto.concurrencyPolicy,
      failThreshold: dto.failThreshold, skippedCount: 0, createdAt: now, updatedAt: now,
    });
  }
  async get(tenantId: string, id: string): Promise<PlanRecord> {
    const p = await this.repos.plans.findById(tenantId, id);
    if (!p) throw notFound(`plan ${id} not found`);
    return p;
  }
  async listByProject(tenantId: string, projectId: string) {
    await this.projects.get(tenantId, projectId);
    return this.repos.plans.listByProject(tenantId, projectId);
  }
  async update(tenantId: string, id: string, raw: unknown): Promise<PlanRecord> {
    const dto = parseOr400(updatePlanDto, raw, "updatePlan");
    const p = await this.get(tenantId, id);
    return this.repos.plans.save({ ...p, ...dto, updatedAt: new Date() });
  }
  async setEnabled(tenantId: string, id: string, enabled: boolean): Promise<PlanRecord> {
    const p = await this.get(tenantId, id);
    return this.repos.plans.save({ ...p, enabled, updatedAt: new Date() });
  }
  async remove(tenantId: string, id: string) {
    await this.get(tenantId, id);
    await this.repos.plans.delete(tenantId, id);
    return { deleted: true, id };
  }
}

// ---------------- Alert rules（通道 target 按密钥处理） ----------------
/** target 掩码：只留 scheme + host，其余（路径里的 token）一律打掉。 */
export function maskTarget(target: string): string {
  try {
    const u = new URL(target);
    return `${u.protocol}//${u.host}/***`;
  } catch { return "***"; }
}
export interface AlertChannelDto {
  type: AlertChannelType; label?: string; targetMasked: string;
}
export interface AlertRuleDto {
  id: string; projectId: string; scopeType: "plan" | "project"; scopeId: string;
  channels: AlertChannelDto[]; dedupWindowSec: number; enabled: boolean; updatedAt: Date;
}
const toRuleDto = (r: AlertRuleRecord, crypto: EnvelopeCrypto): AlertRuleDto => ({
  id: r.id, projectId: r.projectId, scopeType: r.scopeType, scopeId: r.scopeId,
  channels: r.channels.map(ch => ({
    type: ch.type, label: ch.label, targetMasked: maskTarget(crypto.decrypt(ch.targetCipher)),
  })),
  dedupWindowSec: r.dedupWindowSec, enabled: r.enabled, updatedAt: r.updatedAt,
});
export class AlertRuleService {
  constructor(
    private repos: Repositories,
    private projects: ProjectService,
    private crypto: EnvelopeCrypto,
  ) {}
  private encryptChannels(channels: { type: AlertChannelType; label?: string; target: string }[])
    : AlertChannelRecord[] {
    return channels.map(ch => {
      if (ch.type !== "webhook" && !/^https:\/\//.test(ch.target))
        throw badRequest(`${ch.type} 通道 target 必须是 https webhook URL`);
      return { type: ch.type, label: ch.label, targetCipher: this.crypto.encrypt(ch.target) };
    });
  }
  async create(tenantId: string, raw: unknown): Promise<AlertRuleDto> {
    const dto = parseOr400(createAlertRuleDto, raw, "createAlertRule");
    // scope 校验：plan scope 必须指向真实 plan（projectId 随之确定）；project scope 必须指向真实 project
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
    const rec = await this.repos.alertRules.insert({
      id: randomUUID(), tenantId, projectId, scopeType: dto.scopeType, scopeId: dto.scopeId,
      channels: this.encryptChannels(dto.channels), dedupWindowSec: dto.dedupWindowSec,
      enabled: dto.enabled, createdAt: now, updatedAt: now,
    });
    return toRuleDto(rec, this.crypto);
  }
  async get(tenantId: string, id: string): Promise<AlertRuleRecord> {
    const r = await this.repos.alertRules.findById(tenantId, id);
    if (!r) throw notFound(`alert rule ${id} not found`);
    return r;
  }
  async getDto(tenantId: string, id: string) { return toRuleDto(await this.get(tenantId, id), this.crypto); }
  async listByProject(tenantId: string, projectId: string) {
    await this.projects.get(tenantId, projectId);
    return (await this.repos.alertRules.listByProject(tenantId, projectId))
      .map(r => toRuleDto(r, this.crypto));
  }
  async update(tenantId: string, id: string, raw: unknown): Promise<AlertRuleDto> {
    const dto = parseOr400(updateAlertRuleDto, raw, "updateAlertRule");
    const r = await this.get(tenantId, id);
    const saved = await this.repos.alertRules.save({
      ...r,
      ...(dto.channels ? { channels: this.encryptChannels(dto.channels) } : {}),
      ...(dto.dedupWindowSec !== undefined ? { dedupWindowSec: dto.dedupWindowSec } : {}),
      ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
      updatedAt: new Date(),
    });
    return toRuleDto(saved, this.crypto);
  }
  async remove(tenantId: string, id: string) {
    await this.get(tenantId, id);
    await this.repos.alertRules.delete(tenantId, id);
    return { deleted: true, id };
  }
  /** 分发专用：找 plan 的规则；plan 级没有时回退项目级。只返回 enabled 的。 */
  async rulesForPlan(tenantId: string, plan: PlanRecord): Promise<AlertRuleRecord[]> {
    const own = (await this.repos.alertRules.listByScope(tenantId, "plan", plan.id))
      .filter(r => r.enabled);
    if (own.length) return own;
    return (await this.repos.alertRules.listByScope(tenantId, "project", plan.projectId))
      .filter(r => r.enabled);
  }
  /** 分发专用（Week 3 heartbeat）：heartbeat 指定了 alertRuleId 就用它（须 enabled）；
   *  否则回退项目级规则（heartbeat 没有 plan 级规则的概念）。 */
  async rulesForHeartbeat(tenantId: string, hb: HeartbeatRecord): Promise<AlertRuleRecord[]> {
    if (hb.alertRuleId) {
      const r = await this.repos.alertRules.findById(tenantId, hb.alertRuleId);
      return r && r.enabled ? [r] : [];
    }
    return (await this.repos.alertRules.listByScope(tenantId, "project", hb.projectId))
      .filter(r => r.enabled);
  }
  /** 仅供分发路径解密（不进 DTO/日志）。 */
  decryptTarget(ch: AlertChannelRecord): string { return this.crypto.decrypt(ch.targetCipher); }
}

// ---------------- Alert dispatch（只在状态迁移时触发，incident 级去重） ----------------
export type NotifierFactory = (type: AlertChannelType, target: string) => Notifier;
export const defaultNotifierFactory: NotifierFactory = (type, target) =>
  type === "feishu" ? new FeishuNotifier(target)
    : type === "wecom" ? new WeComNotifier(target)
      : new GenericWebhookNotifier(target);
export class AlertDispatchService {
  constructor(
    private repos: Repositories,
    private rules: AlertRuleService,
    private factory: NotifierFactory = defaultNotifierFactory,
  ) {}
  /** 通用分发：logKind 是 notification_log 的口径（去重按它核查），eventKind 是发给通道的
   *  AlertEvent.kind（heartbeat 的 down/recovered 在日志里记 heartbeat_*，渲染仍用 opened/recovered）。 */
  private async dispatch(tenantId: string, ruleList: AlertRuleRecord[], incident: IncidentRecord,
    logKind: NotificationLogRecord["kind"], eventKind: "opened" | "recovered",
    event: Omit<AlertEvent, "kind" | "at">)
    : Promise<NotificationLogRecord[]> {
    // 去重第一道：调用方只在状态迁移时调用本服务；第二道：同一 incident 同一 kind 已有成功发送则整体跳过
    if (await this.repos.notifications.hasSent(tenantId, incident.id, logKind)) return [];
    const logs: NotificationLogRecord[] = [];
    for (const rule of ruleList) {
      for (const ch of rule.channels) {
        const target = this.rules.decryptTarget(ch);
        let log: NotificationLogRecord;
        try {
          const res = await this.factory(ch.type, target)
            .send({ ...event, kind: eventKind, at: new Date().toISOString() });
          log = {
            id: randomUUID(), tenantId, incidentId: incident.id, kind: logKind, channel: ch.type,
            target: maskTarget(target), status: res.ok ? "sent" : "failed",
            response: res.ok ? `ok (http ${res.status ?? "-"})` : (res.error ?? "send failed").slice(0, 300),
            sentAt: new Date(),
          };
        } catch (err) {
          log = {
            id: randomUUID(), tenantId, incidentId: incident.id, kind: logKind, channel: ch.type,
            target: maskTarget(target), status: "failed",
            response: (err instanceof Error ? err.message : String(err)).slice(0, 300),
            sentAt: new Date(),
          };
        }
        logs.push(await this.repos.notifications.append(log));
      }
    }
    return logs;
  }
  async dispatchOpened(tenantId: string, plan: PlanRecord, incident: IncidentRecord,
    ctx: { monitorName: string; environment: string; summary: string; quorumDetail?: string }) {
    return this.dispatch(tenantId, await this.rules.rulesForPlan(tenantId, plan), incident,
      "opened", "opened", {
        monitorName: ctx.monitorName, environment: ctx.environment, summary: ctx.summary,
        quorumDetail: ctx.quorumDetail,
      });
  }
  async dispatchRecovered(tenantId: string, plan: PlanRecord, incident: IncidentRecord,
    ctx: { monitorName: string; environment: string; summary: string; quorumDetail?: string }) {
    return this.dispatch(tenantId, await this.rules.rulesForPlan(tenantId, plan), incident,
      "recovered", "recovered", {
        monitorName: ctx.monitorName, environment: ctx.environment, summary: ctx.summary,
        quorumDetail: ctx.quorumDetail,
      });
  }
  /** 测试发送（Week 4 补齐，ACCEPTANCE 真 webhook 验收用）：对规则的每个通道发一条 kind=test 的
   *  合成事件并落 notification_log（kind=test、无 incidentId、不参与去重）。返回逐通道发送日志。 */
  async testSend(tenantId: string, rule: AlertRuleRecord): Promise<NotificationLogRecord[]> {
    const logs: NotificationLogRecord[] = [];
    for (const ch of rule.channels) {
      const target = this.rules.decryptTarget(ch);
      let log: NotificationLogRecord;
      try {
        const res = await this.factory(ch.type, target).send({
          kind: "test", monitorName: "UIP 平台测试消息", environment: "test-send",
          summary: "这是一条来自 UIP 平台的通道连通性测试消息，收到即说明该告警通道可用。",
          at: new Date().toISOString(),
        });
        log = {
          id: randomUUID(), tenantId, kind: "test", channel: ch.type,
          target: maskTarget(target), status: res.ok ? "sent" : "failed",
          response: res.ok ? `ok (http ${res.status ?? "-"})` : (res.error ?? "send failed").slice(0, 300),
          sentAt: new Date(),
        };
      } catch (err) {
        log = {
          id: randomUUID(), tenantId, kind: "test", channel: ch.type,
          target: maskTarget(target), status: "failed",
          response: (err instanceof Error ? err.message : String(err)).slice(0, 300),
          sentAt: new Date(),
        };
      }
      logs.push(await this.repos.notifications.append(log));
    }
    return logs;
  }
  /** Week 3 heartbeat 分发：规则按 heartbeat 的 alertRuleId / 项目级解析，
   *  日志 kind 用 heartbeat_down / heartbeat_recovered（与 plan 型告警分开统计、各自去重）。 */
  async dispatchHeartbeat(tenantId: string, hb: HeartbeatRecord, incident: IncidentRecord,
    kind: "heartbeat_down" | "heartbeat_recovered",
    ctx: { monitorName: string; summary: string }) {
    return this.dispatch(tenantId, await this.rules.rulesForHeartbeat(tenantId, hb), incident,
      kind, kind === "heartbeat_down" ? "opened" : "recovered", {
        monitorName: ctx.monitorName, environment: "heartbeat", summary: ctx.summary,
      });
  }
}

// ---------------- Incidents ----------------
export class IncidentService {
  constructor(private repos: Repositories) {}
  async get(tenantId: string, id: string): Promise<IncidentRecord> {
    const i = await this.repos.incidents.findById(tenantId, id);
    if (!i) throw notFound(`incident ${id} not found`);
    return i;
  }
  async listByProject(tenantId: string, projectId: string) {
    return this.repos.incidents.listByProject(tenantId, projectId);
  }
  /** ack：triggered -> acknowledged，记 ackBy/ackAt；已 ack 幂等返回；已 resolved 拒绝。 */
  async ack(tenantId: string, id: string, actor: string): Promise<IncidentRecord> {
    const i = await this.get(tenantId, id);
    if (i.status === "resolved") throw conflict(`incident ${id} 已 resolved，不能 ack`);
    if (i.status === "acknowledged") return i;
    return this.repos.incidents.save({
      ...i, status: "acknowledged", ackAt: new Date(), ackBy: actor, updatedAt: new Date(),
    });
  }
}

// ---------------- Monitor 状态机 ----------------
/** 维护窗口查询接口（结构化注入，避免 week2-services 对 week3-services 的循环依赖）。
 *  Week 3 由 MaintenanceService 实现并在组装期注入；未注入时行为与 Week 2 完全一致。 */
export interface MaintenanceChecker {
  isInMaintenance(tenantId: string, scope: { planId?: string; projectId?: string }, at: Date)
    : Promise<MaintenanceWindowRecord | null>;
}
/** 一次「判定输入」：单地域来自一条 execution，多地域来自 quorum 组判定（见 week3 QuorumJudgeService）。
 *  状态机只认这个抽象，不关心输入是单条还是组——组判定 = 一步，绝不按组内 execution 条数重复计数。 */
export interface MonitorOutcome {
  kind: "success" | "failure";
  flaky?: boolean;
  at: Date;
  /** 触发来源 id：单地域 = executionId，多地域 = groupId（迁移历史的 executionId 字段复用为来源 id） */
  refId: string;
  groupId?: string;
  environmentId: string;
  /** 落 incident.regionVotes 的明细（组判定给真实投票，单地域给本地域结果） */
  regionVotes?: Record<string, unknown>;
  quorumDetail?: string;
  /** incident/告警摘要里描述触发来源的一句话 */
  triggerSummary: string;
}
/** 状态机语义（Week 2 口径，写死在这里防扯皮）：
 *  up --失败1次--> suspect --连续失败达 plan.failThreshold--> down（开 incident + opened 告警）
 *  suspect --成功--> up（静默回正，只记 history）；down --连续成功 2 次--> up（关 incident + recovered 告警）
 *  infra_failed：只加 infraCount，绝不动状态——监控自身的基础设施故障不能算被测系统 down。
 *  flaky（先败后过）：算成功，另加 flakyCount。只有状态迁移才发告警事件。
 *  Week 3 追加：维护窗口内迁移照常记录（history 打 suppressedByMaintenance），但不开 incident、不发告警；
 *  窗口内转入 down 且窗口结束后仍未恢复的，由窗口后的下一次失败判定补开 incident（不 retro-fire，见 decisions）。 */
export class MonitorStateService {
  constructor(
    private repos: Repositories,
    private alerts: AlertDispatchService,
    private maintenance?: MaintenanceChecker,
  ) {}
  async getOrCreate(tenantId: string, plan: PlanRecord): Promise<MonitorStateRecord> {
    const existing = await this.repos.monitors.getByPlan(tenantId, plan.id);
    if (existing) return existing;
    const now = new Date();
    return this.repos.monitors.insert({
      id: randomUUID(), tenantId, projectId: plan.projectId, planId: plan.id, status: "up",
      consecutiveFailures: 0, consecutiveSuccesses: 0, flakyCount: 0, infraCount: 0,
      history: [], createdAt: now, updatedAt: now,
    });
  }
  /** 单地域/单条入口（Week 2 行为不变）：手动 dry-run 无 planId 时上层已过滤，这里再兜底。 */
  async onExecutionCompleted(tenantId: string, execution: ExecutionRecord): Promise<MonitorStateRecord | null> {
    if (!execution.planId) return null;
    const plan = await this.repos.plans.findById(tenantId, execution.planId);
    if (!plan) return null;
    const state = await this.getOrCreate(tenantId, plan);
    state.lastExecutionId = execution.id;
    state.updatedAt = new Date();
    if (execution.status === "infra_failed") {
      state.infraCount += 1;
      return this.repos.monitors.save(state);
    }
    const isSuccess = execution.status === "passed" || execution.status === "flaky";
    const isFailure = execution.status === "failed" || execution.status === "timeout";
    if (!isSuccess && !isFailure) return this.repos.monitors.save(state); // queued/running/cancelled 不喂状态机
    return this.applyOutcome(tenantId, plan, state, {
      kind: isFailure ? "failure" : "success",
      flaky: execution.status === "flaky",
      at: execution.finishedAt ?? new Date(),
      refId: execution.id,
      environmentId: execution.environmentId,
      regionVotes: {
        regions: plan.regions,
        votes: { [execution.region ?? "default"]: execution.status },
      },
      triggerSummary: `最近执行 ${execution.id} 状态 ${execution.status}`,
    });
  }
  /** 多地域入口（Week 3）：quorum 组判定结果喂入。一个组判定只走一步 applyOutcome。 */
  async onGroupVerdict(tenantId: string, plan: PlanRecord, verdict: GroupVerdictRecord)
    : Promise<MonitorStateRecord> {
    const state = await this.getOrCreate(tenantId, plan);
    state.lastExecutionId = verdict.groupId; // 组路径下此字段记最近判定组（来源 id 口径见 MonitorOutcome）
    state.updatedAt = new Date();
    if (verdict.verdict === "infra") {
      // 全员弃权（全 infra_failed/cancelled）：是探针/平台侧问题，不是被测系统 down——同 infra 口径只计数
      state.infraCount += 1;
      return this.repos.monitors.save(state);
    }
    const failedRegions = Object.entries(verdict.votes)
      .filter(([, s]) => s === "failed" || s === "timeout").map(([r]) => r);
    const quorumDetail =
      `${verdict.downVotes}/${verdict.plannedRegions} 地域失败${failedRegions.length ? `: ${failedRegions.join(",")}` : ""}` +
      (verdict.degraded ? `（降级判定：仅 ${verdict.upVotes + verdict.downVotes}/${verdict.plannedRegions} 地域有效投票）` : "");
    return this.applyOutcome(tenantId, plan, state, {
      kind: verdict.verdict === "down" ? "failure" : "success",
      at: verdict.judgedAt,
      refId: verdict.groupId,
      groupId: verdict.groupId,
      environmentId: plan.environmentId,
      regionVotes: {
        groupId: verdict.groupId, regions: plan.regions, votes: verdict.votes,
        downVotes: verdict.downVotes, upVotes: verdict.upVotes, degraded: verdict.degraded,
      },
      quorumDetail,
      triggerSummary: `组判定 ${verdict.groupId} = ${verdict.verdict}（${quorumDetail}）`,
    });
  }
  /** 判定核心：单条与组判定共用。维护抑制在此统一处理，两个入口行为一致。 */
  private async applyOutcome(tenantId: string, plan: PlanRecord, state: MonitorStateRecord,
    o: MonitorOutcome): Promise<MonitorStateRecord> {
    const win = this.maintenance
      ? await this.maintenance.isInMaintenance(tenantId, { planId: plan.id, projectId: plan.projectId }, o.at)
      : null;
    const suppressed = !!win;
    const transition = (to: MonitorStateRecord["status"], reason: string) => {
      state.history.push({
        from: state.status, to, at: o.at, executionId: o.refId, reason,
        ...(o.groupId ? { groupId: o.groupId } : {}),
        ...(suppressed ? { suppressedByMaintenance: true } : {}),
      });
      state.status = to; state.lastTransitionAt = o.at;
    };
    /** 开单 + opened 告警 + 触发执行产物顺延 90 天（incident 关联保留口径）。调用方保证非抑制态。 */
    const openAndAlert = async (): Promise<MonitorStateRecord> => {
      const incident = await this.openIncident(tenantId, plan, o);
      state.openIncidentId = incident.id;
      const saved = await this.repos.monitors.save(state);
      await this.extendIncidentArtifacts(tenantId, o.refId, incident.startedAt);
      await this.alerts.dispatchOpened(tenantId, plan, incident, {
        monitorName: await this.monitorName(tenantId, plan),
        environment: await this.envName(tenantId, o.environmentId),
        summary: `连续失败 ${state.consecutiveFailures} 次（阈值 ${plan.failThreshold}），${o.triggerSummary}`,
        quorumDetail: o.quorumDetail,
      });
      return saved;
    };

    if (o.kind === "failure") {
      state.consecutiveFailures += 1; state.consecutiveSuccesses = 0;
      if (state.status === "up") transition("suspect", `consecutive_failures=${state.consecutiveFailures}`);
      if (state.status !== "down" && state.consecutiveFailures >= plan.failThreshold) {
        transition("down", `threshold_reached=${plan.failThreshold}`);
        if (suppressed) return this.repos.monitors.save(state); // 窗口内只记录不开单，窗口后补开见下
        return openAndAlert();
      }
      // 已 down 且没有 open incident：只可能是「窗口内转 down 被抑制」留下的状态。
      // 窗口结束后的下一次失败判定在此补开 incident——不在窗口结束时刻 retro-fire（见 decisions Week 3 条）。
      if (state.status === "down" && !state.openIncidentId && !suppressed) return openAndAlert();
      return this.repos.monitors.save(state);
    }
    // success
    if (o.flaky) state.flakyCount += 1;
    state.consecutiveSuccesses += 1;
    if (state.status === "suspect") {
      state.consecutiveFailures = 0;
      transition("up", "suspect_cleared_by_success");
    } else if (state.status === "down") {
      if (state.consecutiveSuccesses >= 2) {
        transition("up", "recovered_after_2_successes");
        state.consecutiveFailures = 0;
        const incident = state.openIncidentId
          ? await this.repos.incidents.findById(tenantId, state.openIncidentId) : null;
        state.openIncidentId = undefined;
        const saved = await this.repos.monitors.save(state);
        if (incident && incident.status !== "resolved") {
          const resolved = await this.repos.incidents.save({
            ...incident, status: "resolved", resolvedAt: o.at,
            durationMs: o.at.getTime() - incident.startedAt.getTime(), updatedAt: new Date(),
          });
          // 窗口内恢复：incident 照常关单（数据真实），但不发 recovered 通知（窗口内不打扰的口径一致）
          if (!suppressed) {
            await this.alerts.dispatchRecovered(tenantId, plan, resolved, {
              monitorName: await this.monitorName(tenantId, plan),
              environment: await this.envName(tenantId, o.environmentId),
              summary: `已恢复：连续成功 ${state.consecutiveSuccesses} 次，故障持续 ${Math.round((resolved.durationMs ?? 0) / 1000)}s`,
              quorumDetail: o.quorumDetail,
            });
          }
        }
        return saved;
      }
      // down 中第 1 次成功：不迁移、不告警，等第 2 次确认恢复
    } else {
      state.consecutiveFailures = 0;
    }
    return this.repos.monitors.save(state);
  }
  /** incident 关联产物保留 90 天：开单时把触发来源（单条 execution 或组内各 execution）的产物顺延。
   *  refId 是组时按 groupId 找组内执行逐条顺延；是单条时直接顺延该条。 */
  private async extendIncidentArtifacts(tenantId: string, refId: string, incidentStartedAt: Date) {
    const expiresAt = new Date(incidentStartedAt.getTime() + artifactRetentionDays("failed", true) * 24 * 3600_000);
    const direct = await this.repos.executions.listArtifacts(tenantId, refId);
    const targets = [...direct];
    if (!direct.length) { // 组判定：refId 是 groupId，到所属 plan 的执行里找同组产物
      const all = await this.repos.executions.listAllArtifacts(tenantId);
      const execIds = new Set<string>();
      for (const a of all) if (!a.incidentLinked) execIds.add(a.executionId);
      for (const eid of execIds) {
        const e = await this.repos.executions.findExecutionById(tenantId, eid);
        if (e?.groupId === refId)
          targets.push(...(await this.repos.executions.listArtifacts(tenantId, eid)));
      }
    }
    for (const a of targets)
      if (!a.incidentLinked)
        await this.repos.executions.saveArtifact({ ...a, incidentLinked: true, expiresAt });
  }
  private async openIncident(tenantId: string, plan: PlanRecord, o: MonitorOutcome): Promise<IncidentRecord> {
    const existing = await this.repos.incidents.findOpenBySource(tenantId, "plan", plan.id)
      ?? await this.repos.incidents.findOpenByPlan(tenantId, plan.id);
    if (existing) return existing; // 保险：已有未关闭 incident 时不重复开单
    return this.repos.incidents.insert({
      id: randomUUID(), tenantId, projectId: plan.projectId, planId: plan.id,
      sourceType: "plan", sourceId: plan.id,
      status: "triggered", startedAt: o.at,
      escalateAt: new Date(o.at.getTime() + ACK_TIMEOUT_MIN * 60_000),
      regionVotes: o.regionVotes ?? { regions: plan.regions, votes: {} },
      summary: `${o.triggerSummary} 触发 down（阈值 ${plan.failThreshold}）`,
      createdAt: new Date(), updatedAt: new Date(),
    });
  }
  private async monitorName(tenantId: string, plan: PlanRecord): Promise<string> {
    const c = await this.repos.cases.findCaseById(tenantId, plan.caseId);
    return c?.name ?? `plan:${plan.id}`;
  }
  private async envName(tenantId: string, environmentId: string): Promise<string> {
    const e = await this.repos.environments.findById(tenantId, environmentId);
    return e?.name ?? environmentId;
  }
  async getByPlan(tenantId: string, planId: string) {
    return this.repos.monitors.getByPlan(tenantId, planId);
  }
  async listByProject(tenantId: string, projectId: string) {
    return this.repos.monitors.listByProject(tenantId, projectId);
  }
}

// ---------------- Scheduler（可测核心：tick(now)，无真实定时器） ----------------
export interface TickResult {
  created: ExecutionRecord[];
  released: ExecutionRecord[];
  skipped: { planId: string; scheduledAt: Date; reason: string }[];
  errors: { planId: string; error: string }[];
}
/** 调度口径：
 *  - 幂等：游标 plan.lastScheduledAt + (planId, scheduledAt, region) 唯一键双保险，同一分钟重复 tick 只建一单。
 *  - 漏跑不补风暴：只取窗口内「最近一个」触发点建单，中间漏掉的点直接丢弃（监控补跑历史点没有意义）。
 *  - 并发策略：上一单还 queued/running 时 skip=跳过并计数 / queue=建单打 pendingDispatch 标记等 tick 释放 / parallel=照常建单分发。
 *  - Week 3 多地域：plan.regions 有多个地域时，一个触发点按地域建一组 execution（共享 groupId），
 *    queue 释放也按组释放（同组要么一起等、要么一起发，否则 quorum 永远凑不齐）。regions 为空 = 单地域单条。 */
export class SchedulerService {
  constructor(
    private repos: Repositories,
    private executions: ExecutionService,
  ) {}
  async tick(tenantId: string, now: Date = new Date()): Promise<TickResult> {
    const result: TickResult = { created: [], released: [], skipped: [], errors: [] };
    for (const plan of await this.repos.plans.listEnabled(tenantId)) {
      try { await this.tickPlan(tenantId, plan, now, result); }
      catch (err) {
        result.errors.push({ planId: plan.id, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return result;
  }
  private async tickPlan(tenantId: string, plan: PlanRecord, now: Date, result: TickResult) {
    // 1) queue 策略释放：有待分发单且当前无活跃单时，放行最老的一组（同 groupId 的全部待分发单）
    let byPlan = await this.repos.executions.listByPlan(tenantId, plan.id);
    const pending = byPlan.filter(e => e.status === "queued" && e.snapshotJson?.pendingDispatch === true)
      .sort((a, b) => (a.scheduledAt?.getTime() ?? 0) - (b.scheduledAt?.getTime() ?? 0));
    const isActive = (e: ExecutionRecord) =>
      e.status === "running" || (e.status === "queued" && e.snapshotJson?.pendingDispatch !== true);
    if (pending.length && !byPlan.some(isActive)) {
      const oldestGroup = pending[0].groupId ?? pending[0].id;
      for (const p of pending.filter(e => (e.groupId ?? e.id) === oldestGroup))
        result.released.push(await this.executions.dispatchExisting(p));
      byPlan = await this.repos.executions.listByPlan(tenantId, plan.id);
    }
    // 2) 算最近触发点（游标之后、now 之前，只取最新一个 —— 漏跑不补）
    const cursor = plan.lastScheduledAt ?? plan.createdAt;
    const latest = lastCronFire(plan.cronExpr, plan.timezone, now, cursor);
    if (!latest) return;
    const regions: (string | undefined)[] = plan.regions.length ? plan.regions : [undefined];
    const groupId = `${plan.id}@${latest.toISOString()}`;
    const missing: (string | undefined)[] = [];
    for (const region of regions) {
      const existing = await this.repos.executions.findByPlanSlot(tenantId, plan.id, latest, region);
      if (!existing) missing.push(region);
    }
    if (!missing.length) { // 幂等安全网：该槽位各地域都已建单，只推进游标
      await this.repos.plans.save({ ...plan, lastScheduledAt: latest, updatedAt: new Date() });
      return;
    }
    const busy = byPlan.some(e => e.status === "running" || e.status === "queued");
    if (busy && plan.concurrencyPolicy === "skip") {
      await this.repos.plans.save({
        ...plan, lastScheduledAt: latest, skippedCount: plan.skippedCount + 1, updatedAt: new Date(),
      });
      result.skipped.push({ planId: plan.id, scheduledAt: latest, reason: "previous_execution_active" });
      return;
    }
    const defer = plan.concurrencyPolicy === "queue" && busy;
    for (const region of missing) {
      const created = await this.executions.createAndDispatch(tenantId, plan.caseId, {
        environmentId: plan.environmentId, triggerType: "schedule",
        planId: plan.id, scheduledAt: latest, regions: plan.regions,
        region, groupId, deferDispatch: defer,
      });
      result.created.push(created);
    }
    await this.repos.plans.save({ ...plan, lastScheduledAt: latest, updatedAt: new Date() });
  }
}

// ---------------- Stats / Dashboard ----------------
export interface MonitorStatusView {
  planId: string; caseId: string; caseName: string; status: MonitorStateRecord["status"];
  /** Week 3 展示口径：窗口激活且状态不是 down 时展示 "maintenance"（原始 status 不动，判定仍以 status 为准）；
   *  已 down 的监控在窗口内仍展示 down——故障先于窗口存在，不能被窗口「洗白」。 */
  displayStatus: MonitorStateRecord["status"] | "maintenance";
  inMaintenance: boolean;
  consecutiveFailures: number; flakyCount: number; infraCount: number; lastTransitionAt?: Date;
}
export interface OverviewStats {
  projectId: string;
  /** 今日口径：createdAt 落在服务端本地时区今日内的 execution */
  todayTotal: number;
  /** 成功率口径：分母 = 今日终态执行中的 passed/flaky/failed/timeout（不含 queued/running/cancelled）；
   *  分子 = passed + flaky（flaky 算通过但另有 flakyCount 治理）。infra_failed 剔除是因为它代表监控自身故障、
   *  计入会把平台自身可用性和被测系统可用性混在一起。分母为 0 时 successRate = null。 */
  todayFinished: number;
  successRate: number | null;
  downCount: number;
  /** Week 3：当前处于维护窗口的监控数；窗口期 downtime 不计 SLA 的口径说明见 docs/decisions.md Week 3 条 */
  maintenanceCount: number;
  monitors: MonitorStatusView[];
  recentFailures: {
    executionId: string; caseName: string; planId?: string; track: "dsl" | "code";
    status: string; finishedAt?: Date; durationMs?: number;
  }[];
}
// ---------------- Week 4: Flaky 榜 ----------------
export interface FlakyCaseStat {
  caseId: string; caseName: string;
  /** 该用例所属计划（手动/dry-run 执行没有 planId，此时缺省）；同一用例多计划时按 (case, plan) 分行 */
  planId?: string;
  /** 窗口内终态执行数 = passed + flaky + failed + timeout（infra_failed 与未终态一律剔除，口径同成功率） */
  totalTerminal: number;
  passed: number; flaky: number; failed: number; timeout: number;
  /** flakyRate = flaky / totalTerminal */
  flakyRate: number;
  lastFlakyAt?: Date;
  /** 窗口内最长「连续 flaky」串长度（按终态执行时间序，中间出现 passed/failed/timeout 即断裂）。
   *  近似口径：真实连续性应跨窗口边界看（窗口第一条之前的状态未知），这里只算窗口内可见的最长串并如实标注。 */
  maxConsecutiveFlaky: number;
  /** 隔离建议（仅建议、不自动隔离，自动隔离是 V1）：flakyRate > 20% 或 窗口内最长连续 flaky >= 5 */
  quarantineSuggested: boolean;
  quarantineReason?: string;
}
export interface FlakyStats {
  projectId: string;
  windowDays: number;
  generatedAt: Date;
  items: FlakyCaseStat[];
}
/** 隔离建议阈值（调研口径）：7 天 flaky 率 > 20% 或连续 flaky >= 5 次。 */
export const FLAKY_QUARANTINE_RATE = 0.2;
export const FLAKY_QUARANTINE_STREAK = 5;

export class StatsService {
  constructor(
    private repos: Repositories,
    /** Week 3 可选注入：维护窗口判定（未注入时 displayStatus 恒等于 status，Week 2 行为不变） */
    private maintenance?: MaintenanceChecker,
  ) {}
  async overview(tenantId: string, projectId: string, now: Date = new Date()): Promise<OverviewStats> {
    const execs = await this.repos.executions.listExecutions(tenantId, projectId);
    const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
    const today = execs.filter(e => e.createdAt >= startOfDay);
    const finishedStatuses = ["passed", "flaky", "failed", "timeout"];
    const finished = today.filter(e => finishedStatuses.includes(e.status));
    const passed = finished.filter(e => e.status === "passed" || e.status === "flaky").length;
    const plans = await this.repos.plans.listByProject(tenantId, projectId);
    const states = await this.repos.monitors.listByProject(tenantId, projectId);
    const stateByPlan = new Map(states.map(s => [s.planId, s]));
    const monitors: MonitorStatusView[] = [];
    for (const p of plans) {
      const c = await this.repos.cases.findCaseById(tenantId, p.caseId);
      const s = stateByPlan.get(p.id);
      const rawStatus = s?.status ?? "up";
      const win = this.maintenance
        ? await this.maintenance.isInMaintenance(tenantId, { planId: p.id, projectId }, now)
        : null;
      monitors.push({
        planId: p.id, caseId: p.caseId, caseName: c?.name ?? "(unknown case)",
        status: rawStatus,
        displayStatus: win && rawStatus !== "down" ? "maintenance" : rawStatus,
        inMaintenance: !!win,
        consecutiveFailures: s?.consecutiveFailures ?? 0,
        flakyCount: s?.flakyCount ?? 0, infraCount: s?.infraCount ?? 0,
        lastTransitionAt: s?.lastTransitionAt,
      });
    }
    const recentFailures: OverviewStats["recentFailures"] = [];
    const failed = execs.filter(e => e.status === "failed")
      .sort((a, b) => (b.finishedAt?.getTime() ?? b.createdAt.getTime()) -
        (a.finishedAt?.getTime() ?? a.createdAt.getTime())).slice(0, 10);
    for (const e of failed) {
      const version = await this.repos.cases.findVersionById(tenantId, e.caseVersionId);
      const c = version ? await this.repos.cases.findCaseById(tenantId, version.caseId) : null;
      recentFailures.push({
        executionId: e.id, caseName: c?.name ?? "(unknown case)", planId: e.planId,
        track: c?.type ?? "dsl", status: e.status, finishedAt: e.finishedAt, durationMs: e.durationMs,
      });
    }
    return {
      projectId, todayTotal: today.length, todayFinished: finished.length,
      successRate: finished.length ? passed / finished.length : null,
      downCount: monitors.filter(m => m.status === "down").length,
      maintenanceCount: monitors.filter(m => m.inMaintenance).length,
      monitors, recentFailures,
    };
  }

  /** Flaky 榜（Week 4）：窗口 = [now - days 天, now]，按 execution 的 finishedAt（缺省 createdAt）归窗。
   *  只统计有终态执行的 (case, plan) 组合——只有 infra/未终态执行的用例不入榜（分母为 0 时 flakyRate 无定义）。
   *  排序：有 flaky 的在前，按 flakyRate 降序、flaky 数降序；无 flaky 的按终态数降序垫底。 */
  async flaky(tenantId: string, projectId: string, days = 7, now: Date = new Date()): Promise<FlakyStats> {
    if (!Number.isInteger(days) || days < 1 || days > 30)
      throw badRequest(`days 必须是 1-30 的整数，收到 ${days}`);
    const windowStart = new Date(now.getTime() - days * 24 * 3600_000);
    const terminal = ["passed", "flaky", "failed", "timeout"];
    const execs = (await this.repos.executions.listExecutions(tenantId, projectId))
      .filter(e => terminal.includes(e.status))
      .filter(e => (e.finishedAt ?? e.createdAt) >= windowStart && (e.finishedAt ?? e.createdAt) <= now)
      .sort((a, b) => (a.finishedAt ?? a.createdAt).getTime() - (b.finishedAt ?? b.createdAt).getTime());
    interface Acc {
      caseId: string; caseName: string; planId?: string;
      passed: number; flaky: number; failed: number; timeout: number;
      lastFlakyAt?: Date; streak: number; maxStreak: number;
    }
    const groups = new Map<string, Acc>();
    const versionCache = new Map<string, string | null>(); // caseVersionId -> caseId
    for (const e of execs) {
      let caseId = versionCache.get(e.caseVersionId);
      if (caseId === undefined) {
        const v = await this.repos.cases.findVersionById(tenantId, e.caseVersionId);
        caseId = v?.caseId ?? null;
        versionCache.set(e.caseVersionId, caseId);
      }
      if (!caseId) continue; // 版本已被删的执行无法归属用例，跳过（如实：不猜）
      const key = `${caseId}|${e.planId ?? ""}`;
      let acc = groups.get(key);
      if (!acc) {
        const c = await this.repos.cases.findCaseById(tenantId, caseId);
        acc = {
          caseId, caseName: c?.name ?? "(unknown case)", planId: e.planId,
          passed: 0, flaky: 0, failed: 0, timeout: 0, streak: 0, maxStreak: 0,
        };
        groups.set(key, acc);
      }
      if (e.status === "passed") { acc.passed += 1; acc.streak = 0; }
      else if (e.status === "flaky") {
        acc.flaky += 1; acc.streak += 1; acc.maxStreak = Math.max(acc.maxStreak, acc.streak);
        const at = e.finishedAt ?? e.createdAt;
        if (!acc.lastFlakyAt || at > acc.lastFlakyAt) acc.lastFlakyAt = at;
      }
      else if (e.status === "failed") { acc.failed += 1; acc.streak = 0; }
      else { acc.timeout += 1; acc.streak = 0; }
    }
    const items: FlakyCaseStat[] = [...groups.values()].map(acc => {
      const totalTerminal = acc.passed + acc.flaky + acc.failed + acc.timeout;
      const flakyRate = totalTerminal ? acc.flaky / totalTerminal : 0;
      const byRate = flakyRate > FLAKY_QUARANTINE_RATE;
      const byStreak = acc.maxStreak >= FLAKY_QUARANTINE_STREAK;
      return {
        caseId: acc.caseId, caseName: acc.caseName, planId: acc.planId,
        totalTerminal, passed: acc.passed, flaky: acc.flaky, failed: acc.failed, timeout: acc.timeout,
        flakyRate, lastFlakyAt: acc.lastFlakyAt, maxConsecutiveFlaky: acc.maxStreak,
        quarantineSuggested: byRate || byStreak,
        quarantineReason: byRate && byStreak
          ? `flaky 率 ${(flakyRate * 100).toFixed(1)}% > 20% 且连续 flaky ${acc.maxStreak} 次 >= 5`
          : byRate ? `flaky 率 ${(flakyRate * 100).toFixed(1)}% > 20%`
            : byStreak ? `连续 flaky ${acc.maxStreak} 次 >= 5`
              : undefined,
      };
    });
    items.sort((a, b) =>
      Number(b.flaky > 0) - Number(a.flaky > 0)
      || b.flakyRate - a.flakyRate
      || b.flaky - a.flaky
      || b.totalTerminal - a.totalTerminal);
    return { projectId, windowDays: days, generatedAt: now, items };
  }
}
