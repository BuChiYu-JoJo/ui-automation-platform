import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AlertEvent } from "@uip/notifiers";
import {
  AlertDispatchService, AlertRuleService, ArtifactCleanupService, CaseService, DomainError,
  EnvironmentService, EnvVariableService, ExecutionService, HeartbeatService, InMemoryRepositories,
  InProcessDispatcher, IncidentService, LocalArtifactStorage, MaintenanceService, MonitorStateService,
  PlanService, ProjectService, QuorumJudgeService, SchedulerService, StatsService, StorageStateService,
  WorkerNodeService, createEnvelopeCrypto,
  type ExecutionRecord, type NotifierFactory, type PlanRecord,
} from "../domain";
import type { DslCase } from "@uip/dsl";

const TENANT = "tenant-week3";
const status = (e: unknown) => (e as DomainError).httpStatus;
const dsl: DslCase = { dslVersion: "1", name: "登录用例", steps: [{ id: "s1", type: "goto", url: "/" }] };

function makeWeek3() {
  const repos = new InMemoryRepositories();
  const crypto = createEnvelopeCrypto();
  const projects = new ProjectService(repos);
  const environments = new EnvironmentService(repos, projects);
  const variables = new EnvVariableService(repos, environments, crypto);
  const cases = new CaseService(repos, projects);
  const plans = new PlanService(repos, projects);
  const rules = new AlertRuleService(repos, projects, crypto);
  const sent: AlertEvent[] = [];
  const factory: NotifierFactory = (type) => ({
    channel: type,
    send: async (e: AlertEvent) => { sent.push(e); return { ok: true, status: 200 }; },
  });
  const dispatch = new AlertDispatchService(repos, rules, factory);
  const maintenance = new MaintenanceService(repos, projects);
  const monitors = new MonitorStateService(repos, dispatch, maintenance);
  const judge = new QuorumJudgeService(repos, monitors);
  const incidents = new IncidentService(repos);
  const dispatcher = new InProcessDispatcher();
  const executions = new ExecutionService(repos, cases, environments, variables, dispatcher);
  executions.setCompletionHook(async (t, e) => { await judge.onExecutionCompleted(t, e); });
  const scheduler = new SchedulerService(repos, executions);
  const stats = new StatsService(repos, maintenance);
  const workers = new WorkerNodeService(repos);
  const heartbeats = new HeartbeatService(repos, projects, dispatch);
  const stateRoot = mkdtempSync(join(tmpdir(), "uip-w3-state-"));
  const storageStates = new StorageStateService(repos, environments, crypto, stateRoot);
  const artifactRoot = mkdtempSync(join(tmpdir(), "uip-w3-art-"));
  const storage = new LocalArtifactStorage(artifactRoot);
  const cleanup = new ArtifactCleanupService(repos, storage);
  return {
    repos, crypto, projects, environments, variables, cases, plans, rules, sent,
    maintenance, monitors, judge, incidents, dispatcher, executions, scheduler,
    stats, workers, heartbeats, storageStates, storage, cleanup, stateRoot,
  };
}
type W3 = ReturnType<typeof makeWeek3>;
async function seedPlan(w: W3, opts?: {
  regions?: string[]; threshold?: number; cron?: string; withRule?: boolean;
}) {
  const project = await w.projects.create(TENANT, { name: "Demo", slug: `demo-${randomUUID().slice(0, 8)}`, ownerId: "tester" });
  const env = await w.environments.create(TENANT, project.id, { name: "prod", baseUrl: "https://example.com" });
  const { case: c } = await w.cases.createDslCase(TENANT, project.id, { name: "登录用例", dsl }, "tester");
  const plan = await w.plans.create(TENANT, {
    caseId: c.id, environmentId: env.id, cronExpr: opts?.cron ?? "*/5 * * * *", timezone: "UTC",
    regions: opts?.regions ?? [], failThreshold: opts?.threshold ?? 3, concurrencyPolicy: "skip",
  });
  if (opts?.withRule !== false)
    await w.rules.create(TENANT, {
      scopeType: "plan", scopeId: plan.id,
      channels: [{ type: "feishu", label: "值班群", target: "https://open.feishu.cn/open-apis/bot/v2/hook/FAKE-TOKEN-123" }],
    });
  return { project, env, case: c, plan };
}
function groupExec(plan: PlanRecord, groupId: string, scheduledAt: Date,
  region: string, s: ExecutionRecord["status"], at: Date): ExecutionRecord {
  return {
    id: randomUUID(), tenantId: TENANT, projectId: plan.projectId, planId: plan.id, groupId,
    caseVersionId: "v-any", environmentId: plan.environmentId, region, triggerType: "schedule",
    status: s, attempt: 1, scheduledAt, startedAt: at, finishedAt: at, createdAt: at,
  };
}
const minutesFrom = (base: Date, n: number) => new Date(base.getTime() + n * 60_000);

// ---------- worker nodes ----------
test("worker nodes: register starts online, heartbeat refreshes, >60s without heartbeat is offline", async () => {
  const w = makeWeek3();
  const node = await w.workers.register(TENANT, { name: "w-cn-1", region: "cn-east", totalSlots: 6, browserVersion: "131.0" });
  assert.equal(node.status, "online");
  assert.equal(node.freeSlots, 6);
  const beat = await w.workers.heartbeat(TENANT, node.id, { usedSlots: 2 });
  assert.equal(beat.freeSlots, 4);
  assert.equal(beat.status, "online");
  const later = await w.workers.list(TENANT, new Date(Date.now() + 61_000));
  assert.equal(later[0].status, "offline");
  const beat2 = await w.workers.heartbeat(TENANT, node.id, { usedSlots: 0 });
  assert.equal(beat2.status, "online");
  await assert.rejects(() => w.workers.heartbeat(TENANT, "no-such-node", { usedSlots: 0 }),
    (e: unknown) => status(e) === 404);
});

// ---------- scheduler multi-region ----------
test("scheduler: multi-region plan creates one execution per region with shared groupId, re-tick idempotent", async () => {
  const w = makeWeek3();
  const { plan } = await seedPlan(w, { regions: ["cn-east", "cn-north", "oversea"] });
  const now = minutesFrom(plan.createdAt, 6);
  const r1 = await w.scheduler.tick(TENANT, now);
  assert.equal(r1.created.length, 3);
  assert.deepEqual(r1.created.map(e => e.region).sort(), ["cn-east", "cn-north", "oversea"]);
  const groupIds = new Set(r1.created.map(e => e.groupId));
  assert.equal(groupIds.size, 1);
  assert.ok(r1.created.every(e => e.scheduledAt?.getTime() === r1.created[0].scheduledAt?.getTime()));
  const r2 = await w.scheduler.tick(TENANT, now);
  assert.equal(r2.created.length, 0);
  assert.equal((await w.repos.executions.listByPlan(TENANT, plan.id)).length, 3);
});

// ---------- quorum ----------
test("quorum: 2/3 down votes -> down verdict feeds state machine once, incident carries region votes", async () => {
  const w = makeWeek3();
  const { plan } = await seedPlan(w, { regions: ["cn-east", "cn-north", "oversea"], threshold: 1 });
  const t0 = new Date();
  const gid = `${plan.id}@${t0.toISOString()}`;
  const feed = async (region: string, s: ExecutionRecord["status"]) => {
    const e = groupExec(plan, gid, t0, region, s, t0);
    await w.repos.executions.insertExecution(e);
    return w.judge.onExecutionCompleted(TENANT, e);
  };
  assert.equal(await feed("cn-east", "failed"), null); // 组员未到齐不判
  assert.equal(await feed("cn-north", "failed"), null);
  const verdict = await feed("oversea", "passed");
  assert.equal(verdict?.verdict, "down");
  assert.equal(verdict?.degraded, false);
  assert.deepEqual(verdict?.votes, { "cn-east": "failed", "cn-north": "failed", oversea: "passed" });
  const st = await w.monitors.getByPlan(TENANT, plan.id);
  assert.equal(st?.status, "down");
  assert.equal(st?.consecutiveFailures, 1); // 一个组 = 一步，不是 2 条 failed 计两次
  assert.equal(w.sent.length, 1);
  assert.equal(w.sent[0].kind, "opened");
  assert.ok(w.sent[0].quorumDetail?.includes("2/3"));
  const incidents = await w.repos.incidents.listByProject(TENANT, plan.projectId);
  assert.equal(incidents.length, 1);
  assert.deepEqual((incidents[0].regionVotes as { votes: unknown }).votes,
    { "cn-east": "failed", "cn-north": "failed", oversea: "passed" });
  // 幂等：重复 judge 同一组不重复喂状态机、不重复告警
  const again = await w.judge.judgeGroup(TENANT, gid);
  assert.equal(again?.verdict, "down");
  assert.equal((await w.monitors.getByPlan(TENANT, plan.id))?.consecutiveFailures, 1);
  assert.equal(w.sent.length, 1);
});

test("quorum: 1/3 down votes is not down (up verdict, no incident)", async () => {
  const w = makeWeek3();
  const { plan } = await seedPlan(w, { regions: ["a", "b", "c"], threshold: 1 });
  const t0 = new Date();
  const gid = `${plan.id}@${t0.toISOString()}`;
  let verdict: Awaited<ReturnType<W3["judge"]["onExecutionCompleted"]>> = null;
  for (const [region, s] of [["a", "failed"], ["b", "passed"], ["c", "passed"]] as const) {
    const e = groupExec(plan, gid, t0, region, s, t0);
    await w.repos.executions.insertExecution(e);
    verdict = await w.judge.onExecutionCompleted(TENANT, e);
  }
  assert.equal(verdict?.verdict, "up");
  const st = await w.monitors.getByPlan(TENANT, plan.id);
  assert.equal(st?.status, "up");
  assert.equal(st?.consecutiveFailures, 0);
  assert.equal((await w.repos.incidents.listByProject(TENANT, plan.projectId)).length, 0);
  assert.equal(w.sent.length, 0);
});

test("quorum: all-infra group yields infra verdict and never feeds business failure", async () => {
  const w = makeWeek3();
  const { plan } = await seedPlan(w, { regions: ["a", "b", "c"], threshold: 1 });
  const t0 = new Date();
  const gid = `${plan.id}@${t0.toISOString()}`;
  let verdict: Awaited<ReturnType<W3["judge"]["onExecutionCompleted"]>> = null;
  for (const region of ["a", "b", "c"]) {
    const e = groupExec(plan, gid, t0, region, "infra_failed", t0);
    await w.repos.executions.insertExecution(e);
    verdict = await w.judge.onExecutionCompleted(TENANT, e);
  }
  assert.equal(verdict?.verdict, "infra");
  const st = await w.monitors.getByPlan(TENANT, plan.id);
  assert.equal(st?.status, "up");
  assert.equal(st?.infraCount, 1); // 整组算一次 infra，不是 3 次
  assert.equal(st?.consecutiveFailures, 0);
  assert.equal(w.sent.length, 0);
});

test("quorum: single surviving voter decides but verdict is flagged degraded", async () => {
  const w = makeWeek3();
  const { plan } = await seedPlan(w, { regions: ["a", "b", "c"], threshold: 1 });
  const t0 = new Date();
  const gid = `${plan.id}@${t0.toISOString()}`;
  let verdict: Awaited<ReturnType<W3["judge"]["onExecutionCompleted"]>> = null;
  for (const [region, s] of [["a", "failed"], ["b", "infra_failed"], ["c", "infra_failed"]] as const) {
    const e = groupExec(plan, gid, t0, region, s, t0);
    await w.repos.executions.insertExecution(e);
    verdict = await w.judge.onExecutionCompleted(TENANT, e);
  }
  assert.equal(verdict?.verdict, "down");
  assert.equal(verdict?.degraded, true);
  assert.equal(verdict?.downVotes, 1);
  assert.equal(verdict?.upVotes, 0);
  assert.equal((await w.monitors.getByPlan(TENANT, plan.id))?.status, "down");
});

test("quorum: each group verdict is exactly one state-machine step toward down", async () => {
  const w = makeWeek3();
  const { plan } = await seedPlan(w, { regions: ["a", "b"], threshold: 2 });
  const feedGroup = async (slotMin: number, s: ExecutionRecord["status"]) => {
    const t = minutesFrom(new Date(), slotMin);
    const gid = `${plan.id}@${t.toISOString()}`;
    for (const region of ["a", "b"]) {
      const e = groupExec(plan, gid, t, region, s, t);
      await w.repos.executions.insertExecution(e);
      await w.judge.onExecutionCompleted(TENANT, e);
    }
  };
  await feedGroup(0, "failed"); // 组判定 down #1：2 地域都失败才算 down（P=2 规则）
  let st = await w.monitors.getByPlan(TENANT, plan.id);
  assert.equal(st?.status, "suspect");
  assert.equal(st?.consecutiveFailures, 1); // 不是 2：组只算一步
  assert.equal(w.sent.length, 0);
  await feedGroup(5, "failed"); // 组判定 down #2 -> 达阈值
  st = await w.monitors.getByPlan(TENANT, plan.id);
  assert.equal(st?.status, "down");
  assert.equal(st?.consecutiveFailures, 2);
  assert.equal(w.sent.length, 1);
});

// ---------- maintenance windows ----------
test("maintenance: active window suppresses incident+alert but records transition; next failure after window opens incident", async () => {
  const w = makeWeek3();
  const { plan } = await seedPlan(w, { threshold: 1 });
  const t0 = new Date();
  await w.maintenance.create(TENANT, {
    scopeType: "plan", scopeId: plan.id,
    startsAt: minutesFrom(t0, -10).toISOString(), endsAt: minutesFrom(t0, 30).toISOString(),
    reason: "发布窗口",
  });
  const feed = (s: ExecutionRecord["status"], at: Date) => {
    const e: ExecutionRecord = {
      id: randomUUID(), tenantId: TENANT, projectId: plan.projectId, planId: plan.id,
      caseVersionId: "v", environmentId: plan.environmentId, triggerType: "schedule",
      status: s, attempt: 1, finishedAt: at, createdAt: at,
    };
    return w.monitors.onExecutionCompleted(TENANT, e);
  };
  // 窗口内失败达阈值：状态迁移照常记录（打抑制标），但不开 incident、不发告警
  let st = await feed("failed", t0);
  assert.equal(st?.status, "down");
  assert.equal(st?.history.at(-1)?.suppressedByMaintenance, true);
  assert.equal(st?.openIncidentId, undefined);
  assert.equal((await w.repos.incidents.listByProject(TENANT, plan.projectId)).length, 0);
  assert.equal(w.sent.length, 0);
  // 窗口内继续失败：仍然不开单
  st = await feed("failed", minutesFrom(t0, 10));
  assert.equal((await w.repos.incidents.listByProject(TENANT, plan.projectId)).length, 0);
  // 窗口结束后的下一次失败判定：补开 incident 并发 opened（不在窗口结束瞬间 retro-fire）
  st = await feed("failed", minutesFrom(t0, 40));
  assert.ok(st?.openIncidentId);
  assert.equal((await w.repos.incidents.listByProject(TENANT, plan.projectId)).length, 1);
  assert.equal(w.sent.length, 1);
  assert.equal(w.sent[0].kind, "opened");
});

test("maintenance: recovery inside a window resolves the incident silently (no recovered notification)", async () => {
  const w = makeWeek3();
  const { plan } = await seedPlan(w, { threshold: 1 });
  const t0 = new Date();
  const feed = (s: ExecutionRecord["status"], at: Date) => {
    const e: ExecutionRecord = {
      id: randomUUID(), tenantId: TENANT, projectId: plan.projectId, planId: plan.id,
      caseVersionId: "v", environmentId: plan.environmentId, triggerType: "schedule",
      status: s, attempt: 1, finishedAt: at, createdAt: at,
    };
    return w.monitors.onExecutionCompleted(TENANT, e);
  };
  let st = await feed("failed", t0); // 窗口外：down + incident + opened
  assert.equal(st?.status, "down");
  assert.equal(w.sent.length, 1);
  const incidentId = st?.openIncidentId as string;
  await w.maintenance.create(TENANT, {
    scopeType: "plan", scopeId: plan.id,
    startsAt: minutesFrom(t0, 5).toISOString(), endsAt: minutesFrom(t0, 60).toISOString(),
    reason: "观察期",
  });
  st = await feed("passed", minutesFrom(t0, 10));
  assert.equal(st?.status, "down"); // 第 1 次成功仍 down
  st = await feed("passed", minutesFrom(t0, 15));
  assert.equal(st?.status, "up"); // 恢复迁移照常记录
  const incident = await w.incidents.get(TENANT, incidentId);
  assert.equal(incident.status, "resolved"); // incident 照常关单（数据真实）
  assert.equal(w.sent.length, 1); // 但窗口内不发 recovered 通知
});

test("maintenance: recurring cron window matches inside its duration only", async () => {
  const w = makeWeek3();
  const { plan } = await seedPlan(w);
  await w.maintenance.create(TENANT, {
    scopeType: "plan", scopeId: plan.id,
    cronExpr: "0 2 * * *", durationMinutes: 120, timezone: "UTC", reason: "夜间批处理",
  });
  const inside = await w.maintenance.isInMaintenance(TENANT, { planId: plan.id }, new Date("2026-11-02T02:30:00Z"));
  assert.ok(inside);
  const after = await w.maintenance.isInMaintenance(TENANT, { planId: plan.id }, new Date("2026-11-02T04:30:00Z"));
  assert.equal(after, null);
  const before = await w.maintenance.isInMaintenance(TENANT, { planId: plan.id }, new Date("2026-11-02T01:00:00Z"));
  assert.equal(before, null);
  // 项目级窗口对旗下 plan 同样命中
  await w.maintenance.create(TENANT, {
    scopeType: "project", scopeId: plan.projectId,
    startsAt: "2026-11-03T00:00:00Z", endsAt: "2026-11-03T06:00:00Z", reason: "机房维护",
  });
  const projHit = await w.maintenance.isInMaintenance(TENANT,
    { planId: plan.id, projectId: plan.projectId }, new Date("2026-11-03T03:00:00Z"));
  assert.ok(projHit);
});

test("stats overview: monitor in maintenance shows displayStatus=maintenance, unless already down", async () => {
  const w = makeWeek3();
  const a = await seedPlan(w, { threshold: 3 });
  const b = await seedPlan(w, { threshold: 1 });
  const now = new Date();
  for (const p of [a.plan, b.plan])
    await w.maintenance.create(TENANT, {
      scopeType: "plan", scopeId: p.id,
      startsAt: minutesFrom(now, -30).toISOString(), endsAt: minutesFrom(now, 30).toISOString(),
      reason: "维护中",
    });
  // b 先在窗口外打到 down（把状态直接置 down 模拟窗口前已故障：窗口不能洗白已有故障）
  await w.repos.monitors.insert({
    id: randomUUID(), tenantId: TENANT, projectId: b.project.id, planId: b.plan.id, status: "down",
    consecutiveFailures: 3, consecutiveSuccesses: 0, flakyCount: 0, infraCount: 0,
    history: [], createdAt: now, updatedAt: now,
  });
  const ov = await w.stats.overview(TENANT, a.project.id, now);
  assert.equal(ov.monitors[0].displayStatus, "maintenance");
  assert.equal(ov.monitors[0].inMaintenance, true);
  assert.equal(ov.monitors[0].status, "up"); // 原始状态不被展示口径改写
  const ovB = await w.stats.overview(TENANT, b.project.id, now);
  assert.equal(ovB.monitors[0].displayStatus, "down");
  assert.equal(ovB.monitors[0].inMaintenance, true);
  assert.equal(ovB.maintenanceCount, 1);
});

// ---------- heartbeat ----------
test("heartbeat: create shows token once, ping/timeout/recovery cycle with deduped alerts", async () => {
  const w = makeWeek3();
  const project = await w.projects.create(TENANT, { name: "HB", slug: "hb-proj", ownerId: "tester" });
  await w.rules.create(TENANT, {
    scopeType: "project", scopeId: project.id,
    channels: [{ type: "wecom", target: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=FAKEKEY" }],
  });
  const { heartbeat, token } = await w.heartbeats.create(TENANT, project.id,
    { name: "nightly-job", expectIntervalSec: 60 });
  assert.ok(token.startsWith("uhb_"));
  assert.ok(!("token" in heartbeat) && !("tokenHash" in heartbeat)); // DTO 永不回 token/哈希
  assert.equal(heartbeat.status, "pending");
  const raw = (await w.repos.heartbeats.listByProject(TENANT, project.id))[0];
  assert.ok(!JSON.stringify(raw).includes(token)); // 落库只有哈希
  await assert.rejects(() => w.heartbeats.ping("uhb_wrong-token"), (e: unknown) => status(e) === 404);

  const t0 = new Date();
  const p1 = await w.heartbeats.ping(token, t0);
  assert.deepEqual(p1, { ok: true, recovered: false });
  // 宽限内（60*1.5=90s）：不判 down
  assert.equal((await w.heartbeats.scanHeartbeats(TENANT, new Date(t0.getTime() + 80_000))).length, 0);
  // 超过宽限：判 down，开 incident（sourceType=heartbeat），告警 kind=heartbeat_down 只发一次
  const down = await w.heartbeats.scanHeartbeats(TENANT, new Date(t0.getTime() + 100_000));
  assert.equal(down.length, 1);
  assert.equal(down[0].status, "down");
  const incidents = await w.repos.incidents.listByProject(TENANT, project.id);
  assert.equal(incidents.length, 1);
  assert.equal(incidents[0].sourceType, "heartbeat");
  assert.equal(incidents[0].sourceId, heartbeat.id);
  let logs = await w.repos.notifications.listByIncident(TENANT, incidents[0].id);
  assert.deepEqual(logs.map(l => l.kind), ["heartbeat_down"]);
  // 重复扫描不重复开单/告警
  assert.equal((await w.heartbeats.scanHeartbeats(TENANT, new Date(t0.getTime() + 200_000))).length, 0);
  assert.equal((await w.repos.incidents.listByProject(TENANT, project.id)).length, 1);
  // 恢复打点：关 incident + heartbeat_recovered 通知
  const p2 = await w.heartbeats.ping(token, new Date(t0.getTime() + 210_000));
  assert.deepEqual(p2, { ok: true, recovered: true });
  const resolved = await w.incidents.get(TENANT, incidents[0].id);
  assert.equal(resolved.status, "resolved");
  assert.equal(typeof resolved.durationMs, "number");
  logs = await w.repos.notifications.listByIncident(TENANT, incidents[0].id);
  assert.deepEqual(logs.map(l => l.kind).sort(), ["heartbeat_down", "heartbeat_recovered"]);
  const after = (await w.heartbeats.list(TENANT, project.id))[0];
  assert.equal(after.status, "up");
});

// ---------- artifact retention + cleanup ----------
test("artifacts: retention assigned by outcome (passed 7d / failed 30d), incident extends to 90d, cleanup honors expiry + dry-run", async () => {
  const w = makeWeek3();
  const { project, env, case: c, plan } = await seedPlan(w, { threshold: 1 });
  // 1) completeExecution 按结论落保留期
  const okExec = await w.executions.dryRun(TENANT, c.id, { environmentId: env.id });
  const before = Date.now();
  await w.executions.completeExecution(TENANT, okExec.id, {
    executionId: okExec.id, track: "dsl", caseName: "登录用例", status: "passed", durationMs: 10,
    steps: [], artifacts: [{ kind: "screenshot", s3Key: "k/passed.png" }],
  });
  const okDetail = await w.executions.getDetail(TENANT, okExec.id);
  const okDays = (okDetail.artifacts[0].expiresAt.getTime() - before) / 86_400_000;
  assert.ok(okDays > 6.9 && okDays < 7.1, `passed 保留应约 7 天, 实际 ${okDays}`);
  // 2) 失败执行触发 down 开 incident 后，其产物被顺延到 90 天并打 incidentLinked
  const failExec = await w.repos.executions.insertExecution({
    id: randomUUID(), tenantId: TENANT, projectId: project.id, planId: plan.id,
    caseVersionId: "v", environmentId: env.id, triggerType: "schedule", status: "failed",
    attempt: 1, finishedAt: new Date(), createdAt: new Date(),
  });
  await w.repos.executions.insertArtifact({
    id: randomUUID(), tenantId: TENANT, executionId: failExec.id, kind: "trace",
    s3Key: "k/fail.zip", sizeBytes: 10, expiresAt: new Date(Date.now() + 30 * 86_400_000),
  });
  await w.monitors.onExecutionCompleted(TENANT, failExec);
  const failArts = await w.repos.executions.listArtifacts(TENANT, failExec.id);
  assert.equal(failArts[0].incidentLinked, true);
  const failDays = (failArts[0].expiresAt.getTime() - Date.now()) / 86_400_000;
  assert.ok(failDays > 89 && failDays <= 90.1, `incident 关联保留应约 90 天, 实际 ${failDays}`);

  // 3) 清理：过期删、未过期留、incident 未到期留、dry-run 不删
  const now = new Date();
  const mk = async (key: string, expiresAt: Date, incidentLinked = false) => {
    await w.storage.put(key, "x");
    return w.repos.executions.insertArtifact({
      id: randomUUID(), tenantId: TENANT, executionId: okExec.id, kind: "log",
      s3Key: key, sizeBytes: 1, expiresAt, incidentLinked,
    });
  };
  const expiredPassed = await mk("t/p/expired.log", new Date(now.getTime() - 86_400_000));
  const fresh = await mk("t/p/fresh.log", new Date(now.getTime() + 5 * 86_400_000));
  const incidentFresh = await mk("t/p/incident.log", new Date(now.getTime() + 80 * 86_400_000), true);
  const incidentExpired = await mk("t/p/incident-old.log", new Date(now.getTime() - 86_400_000), true);
  const dry = await w.cleanup.cleanupExpiredArtifacts(TENANT, now, { dryRun: true });
  assert.equal(dry.deleted, 0);
  assert.ok(dry.expired >= 2 && dry.keys.includes("t/p/expired.log") && dry.keys.includes("t/p/incident-old.log"));
  assert.equal(await w.storage.exists("t/p/expired.log"), true); // dry-run 没真删
  const real = await w.cleanup.cleanupExpiredArtifacts(TENANT, now);
  assert.ok(real.deleted >= 2);
  assert.equal(await w.storage.exists("t/p/expired.log"), false);
  assert.equal(await w.storage.exists("t/p/incident-old.log"), false);
  assert.equal(await w.storage.exists("t/p/fresh.log"), true);
  assert.equal(await w.storage.exists("t/p/incident.log"), true); // incident 90 天未到期
  const all = await w.repos.executions.listAllArtifacts(TENANT);
  assert.ok(all.find(a => a.id === expiredPassed.id)?.deletedAt);
  assert.ok(all.find(a => a.id === incidentExpired.id)?.deletedAt);
  assert.equal(all.find(a => a.id === fresh.id)?.deletedAt, undefined);
  assert.equal(all.find(a => a.id === incidentFresh.id)?.deletedAt, undefined);
});

// ---------- storageState preset ----------
test("storageState preset: encrypted at rest, TTL freshness (fresh -> expired), missing role, decrypt round-trip", async () => {
  const w = makeWeek3();
  const project = await w.projects.create(TENANT, { name: "SS", slug: "ss-proj", ownerId: "tester" });
  const env = await w.environments.create(TENANT, project.id, { name: "prod", baseUrl: "https://example.com" });
  const state = {
    cookies: [{ name: "sid", value: "session-value-12345", domain: "example.com", path: "/" }],
    origins: [{ origin: "https://example.com", localStorage: [{ name: "k", value: "v" }] }],
  };
  const saved = await w.storageStates.save(TENANT, env.id, { role: "admin", state, ttlSec: 3600 });
  assert.equal(saved.ttlSec, 3600);
  // 落盘是密文：文件原文不含会话值
  const fileText = readFileSync(join(w.stateRoot, `${saved.key}.enc`), "utf8");
  assert.ok(!fileText.includes("session-value-12345"));
  // TTL 内 fresh
  const fresh = await w.storageStates.ensureStorageState(TENANT, env.id, "admin",
    new Date(saved.savedAt.getTime() + 100_000));
  assert.equal(fresh.status, "fresh");
  assert.equal(fresh.needsLogin, false);
  // 超 TTL -> expired + needsLogin
  const expired = await w.storageStates.ensureStorageState(TENANT, env.id, "admin",
    new Date(saved.savedAt.getTime() + 3601_000));
  assert.equal(expired.status, "expired");
  assert.equal(expired.needsLogin, true);
  // 未保存的角色 -> missing
  const missing = await w.storageStates.ensureStorageState(TENANT, env.id, "ghost");
  assert.equal(missing.status, "missing");
  assert.equal(missing.needsLogin, true);
  // 解密往返（内部路径）
  const loaded = await w.storageStates.loadStateJson(TENANT, env.id, "admin");
  assert.deepEqual(loaded, state);
});
