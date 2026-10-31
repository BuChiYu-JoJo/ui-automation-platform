import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AlertEvent } from "@uip/notifiers";
import {
  AlertDispatchService, AlertRuleService, CaseService, DomainError, EnvironmentService,
  ExecutionService, InMemoryRepositories, InProcessDispatcher, MaintenanceService, PlanService,
  ProjectService, PublicStatusService, StatsService, EnvVariableService, createEnvelopeCrypto,
  type ExecutionRecord, type IncidentRecord, type MonitorStateRecord, type NotifierFactory,
} from "../domain";
import type { DslCase } from "@uip/dsl";

const TENANT = "tenant-week4";
const NOW = new Date("2026-10-31T12:00:00Z");
const status = (e: unknown) => (e as DomainError).httpStatus;
const dsl: DslCase = { dslVersion: "1", name: "占位用例", steps: [{ id: "s1", type: "goto", url: "/" }] };
const minutesFrom = (base: Date, n: number) => new Date(base.getTime() + n * 60_000);

function makeWeek4() {
  const repos = new InMemoryRepositories();
  const crypto = createEnvelopeCrypto();
  const projects = new ProjectService(repos);
  const environments = new EnvironmentService(repos, projects);
  const variables = new EnvVariableService(repos, environments, crypto);
  const cases = new CaseService(repos, projects);
  const plans = new PlanService(repos, projects);
  const maintenance = new MaintenanceService(repos, projects);
  const stats = new StatsService(repos, maintenance);
  const pub = new PublicStatusService(repos, stats, maintenance);
  const executions = new ExecutionService(repos, cases, environments, variables, new InProcessDispatcher());
  const rules = new AlertRuleService(repos, projects, crypto);
  const sent: AlertEvent[] = [];
  const factory: NotifierFactory = (type) => ({
    channel: type,
    send: async (e: AlertEvent) => { sent.push(e); return { ok: true, status: 200 }; },
  });
  const dispatch = new AlertDispatchService(repos, rules, factory);
  return { repos, projects, environments, cases, plans, maintenance, stats, pub, executions, rules, dispatch, sent };
}
type W4 = ReturnType<typeof makeWeek4>;

async function seedProject(w: W4, slug: string, name = "项目") {
  const project = await w.projects.create(TENANT, { name, slug, ownerId: "tester" });
  const env = await w.environments.create(TENANT, project.id, { name: "prod", baseUrl: "https://example.com" });
  return { project, env };
}
async function seedCase(w: W4, projectId: string, name: string) {
  // CaseService 校验用例名与 dsl.name 一致，这里按名生成各自的 DSL
  const named: DslCase = { ...dsl, name };
  const { case: c } = await w.cases.createDslCase(TENANT, projectId, { name, dsl: named }, "tester");
  const ver = await w.repos.cases.latestVersion(TENANT, c.id);
  assert.ok(ver);
  return { case: c, versionId: ver.id };
}
async function insertExec(w: W4, args: {
  projectId: string; versionId: string; envId: string; s: ExecutionRecord["status"];
  at: Date; planId?: string;
}) {
  return w.repos.executions.insertExecution({
    id: randomUUID(), tenantId: TENANT, projectId: args.projectId, planId: args.planId,
    caseVersionId: args.versionId, environmentId: args.envId,
    triggerType: args.planId ? "schedule" : "manual", status: args.s,
    attempt: 1, startedAt: args.at, finishedAt: args.at, createdAt: args.at,
  });
}
async function insertMonitor(w: W4, projectId: string, planId: string, s: MonitorStateRecord["status"]) {
  return w.repos.monitors.insert({
    id: randomUUID(), tenantId: TENANT, projectId, planId, status: s,
    consecutiveFailures: s === "down" ? 3 : 0, consecutiveSuccesses: 0,
    flakyCount: 0, infraCount: 0, history: [], createdAt: NOW, updatedAt: NOW,
  });
}
async function insertIncident(w: W4, args: {
  projectId: string; planId: string; startedAt: Date; resolvedAt?: Date;
}): Promise<IncidentRecord> {
  return w.repos.incidents.insert({
    id: randomUUID(), tenantId: TENANT, projectId: args.projectId, planId: args.planId,
    sourceType: "plan", sourceId: args.planId,
    status: args.resolvedAt ? "resolved" : "triggered",
    startedAt: args.startedAt, resolvedAt: args.resolvedAt,
    durationMs: args.resolvedAt ? args.resolvedAt.getTime() - args.startedAt.getTime() : undefined,
    escalateAt: new Date(args.startedAt.getTime() + 15 * 60_000),
    regionVotes: { votes: { default: "failed" } },
    summary: "内部细节：不应出现在公开状态页",
    createdAt: args.startedAt, updatedAt: args.resolvedAt ?? args.startedAt,
  });
}
async function seedPlan(w: W4, projectId: string, envId: string, caseId: string) {
  return w.plans.create(TENANT, {
    caseId, environmentId: envId, cronExpr: "*/5 * * * *", timezone: "UTC",
    regions: [], failThreshold: 3, concurrencyPolicy: "skip",
  });
}

// ---------- flaky leaderboard ----------
test("flaky leaderboard: rate math excludes infra_failed/non-terminal and out-of-window runs; sorting + suggestion flags", async () => {
  const w = makeWeek4();
  const { project, env } = await seedProject(w, "flaky-proj");
  const a = await seedCase(w, project.id, "高频 flaky");
  const b = await seedCase(w, project.id, "稳定用例");
  const c = await seedCase(w, project.id, "连串 flaky");
  const d = await seedCase(w, project.id, "全过用例");
  const t = (min: number) => minutesFrom(NOW, -60 * 24 + min); // 窗口内（now-1d 起）
  let seq = 0;
  const feed = async (s: ExecutionRecord["status"], versionId: string, at: Date) =>
    insertExec(w, { projectId: project.id, versionId, envId: env.id, s, at });
  // A：passed 2 + flaky 3 + failed 2 = 终态 7；infra 3 与 queued 1 不进分母；窗口外（-10d）flaky 不计
  for (const s of ["passed", "flaky", "failed", "flaky", "passed", "failed", "flaky"] as const)
    await feed(s, a.versionId, t(seq++ * 10));
  for (let i = 0; i < 3; i++) await feed("infra_failed", a.versionId, t(200 + i * 10));
  await feed("queued", a.versionId, t(300));
  await feed("flaky", a.versionId, minutesFrom(NOW, -10 * 24 * 60));
  const aLastFlaky = t(60); // A 的 flaky 出现在 seq 1/3/6 -> t(10), t(30), t(60)
  // B：passed 9 + flaky 1 -> 率 0.1，不建议隔离
  for (let i = 0; i < 9; i++) await feed("passed", b.versionId, t(400 + i * 10));
  await feed("flaky", b.versionId, t(500));
  // C：passed -> flaky x5 连串 -> passed x19：终态 25、flaky 5、率恰 0.2（不 > 0.2），仅靠连串规则建议
  await feed("passed", c.versionId, t(600));
  for (let i = 0; i < 5; i++) await feed("flaky", c.versionId, t(610 + i * 10));
  for (let i = 0; i < 19; i++) await feed("passed", c.versionId, t(700 + i * 10));
  // D：全 passed（无 flaky 也入榜、垫底）
  for (let i = 0; i < 4; i++) await feed("passed", d.versionId, t(1000 + i * 10));

  const res = await w.stats.flaky(TENANT, project.id, 7, NOW);
  assert.equal(res.windowDays, 7);
  assert.equal(res.items.length, 4);
  assert.deepEqual(res.items.map(i => i.caseId), [a.case.id, c.case.id, b.case.id, d.case.id]);
  const ia = res.items[0];
  assert.equal(ia.totalTerminal, 7); // infra_failed / queued / 窗口外 flaky 都被剔除
  assert.equal(ia.passed, 2); assert.equal(ia.flaky, 3); assert.equal(ia.failed, 2); assert.equal(ia.timeout, 0);
  assert.ok(Math.abs(ia.flakyRate - 3 / 7) < 1e-9);
  assert.equal(ia.lastFlakyAt?.getTime(), aLastFlaky.getTime());
  assert.equal(ia.quarantineSuggested, true);
  assert.match(ia.quarantineReason ?? "", /flaky 率/);
  const ic = res.items[1];
  assert.equal(ic.totalTerminal, 25);
  assert.ok(Math.abs(ic.flakyRate - 0.2) < 1e-9); // 恰好 0.2 不触发率规则
  assert.equal(ic.maxConsecutiveFlaky, 5);
  assert.equal(ic.quarantineSuggested, true); // 靠连串规则
  assert.match(ic.quarantineReason ?? "", /连续 flaky 5 次/);
  const ib = res.items[2];
  assert.equal(ib.flakyRate, 0.1);
  assert.equal(ib.quarantineSuggested, false);
  assert.equal(ib.quarantineReason, undefined);
  const idRow = res.items[3];
  assert.equal(idRow.flaky, 0);
  assert.equal(idRow.flakyRate, 0);
  assert.equal(idRow.quarantineSuggested, false);
});

test("flaky leaderboard: quarantine suggestion off below both thresholds; per-plan rows split", async () => {
  const w = makeWeek4();
  const { project, env } = await seedProject(w, "flaky-calm");
  const a = await seedCase(w, project.id, "轻微 flaky");
  const plan = await seedPlan(w, project.id, env.id, a.case.id);
  const base = minutesFrom(NOW, -600);
  // 同一用例：计划内 flaky 4 连串（< 5）+ 率 4/21 ≈ 0.19（< 0.2）-> 不建议；手动行单独成行
  for (let i = 0; i < 4; i++)
    await insertExec(w, { projectId: project.id, versionId: a.versionId, envId: env.id, s: "flaky", at: minutesFrom(base, i * 5), planId: plan.id });
  for (let i = 0; i < 17; i++)
    await insertExec(w, { projectId: project.id, versionId: a.versionId, envId: env.id, s: "passed", at: minutesFrom(base, 30 + i * 5), planId: plan.id });
  await insertExec(w, { projectId: project.id, versionId: a.versionId, envId: env.id, s: "flaky", at: minutesFrom(base, 200) });
  const res = await w.stats.flaky(TENANT, project.id, 7, NOW);
  assert.equal(res.items.length, 2); // (case, plan) 与 (case, 无 plan) 分行
  const planRow = res.items.find(i => i.planId === plan.id);
  assert.ok(planRow);
  assert.equal(planRow.maxConsecutiveFlaky, 4);
  assert.equal(planRow.quarantineSuggested, false);
  assert.equal(planRow.quarantineReason, undefined);
  const manualRow = res.items.find(i => !i.planId);
  assert.ok(manualRow);
  assert.equal(manualRow.flaky, 1);
});

test("flaky leaderboard: days must be an integer within 1..30", async () => {
  const w = makeWeek4();
  const { project } = await seedProject(w, "flaky-days");
  for (const bad of [0, 31, 2.5, Number.NaN])
    await assert.rejects(() => w.stats.flaky(TENANT, project.id, bad, NOW),
      (e: unknown) => status(e) === 400);
  const ok = await w.stats.flaky(TENANT, project.id, 30, NOW);
  assert.equal(ok.windowDays, 30);
  assert.deepEqual(ok.items, []);
});

// ---------- alert test-send (Week 4) ----------
test("alert test-send: sends kind=test to every channel of the rule and logs masked targets", async () => {
  const w = makeWeek4();
  const { project } = await seedProject(w, "testsend-proj");
  const rule = await w.rules.create(TENANT, {
    scopeType: "project", scopeId: project.id,
    channels: [
      { type: "feishu", label: "值班群", target: "https://open.feishu.cn/open-apis/bot/v2/hook/FAKE-TOKEN-999" },
      { type: "wecom", label: "企微群", target: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=FAKEKEY-888" },
    ],
  });
  const rec = await w.rules.get(TENANT, rule.id);
  const logs = await w.dispatch.testSend(TENANT, rec);
  assert.equal(w.sent.length, 2);
  assert.ok(w.sent.every(e => e.kind === "test"));
  assert.equal(logs.length, 2);
  assert.ok(logs.every(l => l.kind === "test" && l.status === "sent" && !l.incidentId));
  assert.ok(!JSON.stringify(logs).includes("FAKE-TOKEN-999")); // 日志里只有掩码 target
  assert.ok(!JSON.stringify(logs).includes("FAKEKEY-888"));
});

// ---------- public status page ----------
const FORBIDDEN = ["baseUrl", "snapshot", "webhook", "artifact", "error", "environment",
  "tenant", "summary", "s3Key", "token", "planId", "caseId", "incidentId", "regionVotes"];
function assertNoForbidden(payload: unknown) {
  const text = JSON.stringify(payload);
  for (const word of FORBIDDEN)
    assert.ok(!text.includes(word), `公开载荷不应包含 \"${word}\": ${text.slice(0, 200)}`);
}

test("public status: uptime from incident durations (active + resolved), minimized active incident, last verdict time", async () => {
  const w = makeWeek4();
  const { project, env } = await seedProject(w, "pub-a", "公开项目甲");
  const { case: c, versionId } = await seedCase(w, project.id, "登录监控");
  const plan = await seedPlan(w, project.id, env.id, c.id);
  await insertMonitor(w, project.id, plan.id, "down");
  // 已恢复 incident：10 天前持续 60 分钟；进行中 incident：120 分钟前开始未恢复 -> downtime 合计 180 分钟
  await insertIncident(w, {
    projectId: project.id, planId: plan.id,
    startedAt: minutesFrom(NOW, -10 * 24 * 60), resolvedAt: minutesFrom(NOW, -10 * 24 * 60 + 60),
  });
  await insertIncident(w, { projectId: project.id, planId: plan.id, startedAt: minutesFrom(NOW, -120) });
  await insertExec(w, {
    projectId: project.id, versionId, envId: env.id, s: "failed",
    at: minutesFrom(NOW, -30), planId: plan.id,
  });
  const payload = await w.pub.getBySlug("pub-a", NOW);
  assert.equal(payload.projectName, "公开项目甲");
  assert.equal(payload.overall, "major_outage"); // 唯一监控 down
  assert.equal(payload.monitors.length, 1);
  const m = payload.monitors[0];
  assert.equal(m.name, "登录监控");
  assert.equal(m.status, "down");
  assert.equal(m.lastVerdictAt?.getTime(), minutesFrom(NOW, -30).getTime());
  // (43200 - 180) / 43200 = 99.5833 -> 99.58
  assert.equal(m.uptime30dPct, 99.58);
  assert.equal(payload.activeIncidents.length, 1);
  assert.deepEqual(Object.keys(payload.activeIncidents[0]).sort(),
    ["durationSec", "monitorName", "startedAt"]);
  assert.equal(payload.activeIncidents[0].monitorName, "登录监控");
  assert.equal(payload.activeIncidents[0].durationSec, 7200);
  assertNoForbidden(payload);
});

test("public status: maintenance minutes excluded from both downtime overlap and denominator", async () => {
  const w = makeWeek4();
  const { project, env } = await seedProject(w, "pub-b", "公开项目乙");
  const { case: c } = await seedCase(w, project.id, "首页监控");
  const plan = await seedPlan(w, project.id, env.id, c.id);
  await insertMonitor(w, project.id, plan.id, "up");
  const incStart = minutesFrom(NOW, -2 * 24 * 60);
  await insertIncident(w, {
    projectId: project.id, planId: plan.id, startedAt: incStart, resolvedAt: minutesFrom(incStart, 120),
  });
  // 维护窗口与 incident 重叠 60 分钟（+30 ~ +90）：downtime 120-60=60；分母 43200-60=43140
  await w.maintenance.create(TENANT, {
    scopeType: "plan", scopeId: plan.id,
    startsAt: minutesFrom(incStart, 30).toISOString(), endsAt: minutesFrom(incStart, 90).toISOString(),
    reason: "发布维护",
  });
  const payload = await w.pub.getBySlug("pub-b", NOW);
  // (43140 - 60) / 43140 = 99.8609 -> 99.86
  assert.equal(payload.monitors[0].uptime30dPct, 99.86);
  assert.equal(payload.overall, "operational");
  assert.deepEqual(payload.activeIncidents, []);
  assertNoForbidden(payload);
});

test("public status: maintenance display state + partial outage overall + unknown slug 404", async () => {
  const w = makeWeek4();
  const { project, env } = await seedProject(w, "pub-c", "公开项目丙");
  const c1 = await seedCase(w, project.id, "维护中监控");
  const c2 = await seedCase(w, project.id, "故障监控");
  const p1 = await seedPlan(w, project.id, env.id, c1.case.id);
  const p2 = await seedPlan(w, project.id, env.id, c2.case.id);
  await insertMonitor(w, project.id, p1.id, "up");
  await insertMonitor(w, project.id, p2.id, "down");
  await w.maintenance.create(TENANT, {
    scopeType: "plan", scopeId: p1.id,
    startsAt: minutesFrom(NOW, -10).toISOString(), endsAt: minutesFrom(NOW, 50).toISOString(),
    reason: "例行维护",
  });
  await insertIncident(w, { projectId: project.id, planId: p2.id, startedAt: minutesFrom(NOW, -45) });
  const payload = await w.pub.getBySlug("pub-c", NOW);
  const byName = new Map(payload.monitors.map(m => [m.name, m]));
  assert.equal(byName.get("维护中监控")?.status, "maintenance");
  assert.equal(byName.get("维护中监控")?.uptime30dPct, 100); // 无 incident：维护只减分母、不产生 downtime
  assert.equal(byName.get("故障监控")?.status, "down");
  assert.equal(payload.overall, "partial_outage"); // 一 down 一正常/维护
  assert.equal(payload.activeIncidents.length, 1);
  assert.equal(payload.activeIncidents[0].monitorName, "故障监控");
  assertNoForbidden(payload);
  await assert.rejects(() => w.pub.getBySlug("no-such-project", NOW),
    (e: unknown) => status(e) === 404);
});
