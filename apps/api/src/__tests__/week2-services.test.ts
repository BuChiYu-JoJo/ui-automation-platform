import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AlertEvent } from "@uip/notifiers";
import {
  AlertDispatchService, AlertRuleService, CaseService, DomainError, EnvironmentService,
  EnvVariableService, ExecutionService, InMemoryRepositories, InProcessDispatcher,
  IncidentService, MonitorStateService, PlanService, ProjectService, SchedulerService,
  StatsService, createEnvelopeCrypto, lastCronFire, validateCron,
  type ExecutionRecord, type NotifierFactory, type PlanRecord,
} from "../domain";
import type { DslCase } from "@uip/dsl";

const TENANT = "tenant-week2";
const status = (e: unknown) => (e as DomainError).httpStatus;
const dsl: DslCase = { dslVersion: "1", name: "登录用例", steps: [{ id: "s1", type: "goto", url: "/" }] };

function makeWeek2() {
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
  const monitors = new MonitorStateService(repos, dispatch);
  const incidents = new IncidentService(repos);
  const dispatcher = new InProcessDispatcher();
  const executions = new ExecutionService(repos, cases, environments, variables, dispatcher);
  const scheduler = new SchedulerService(repos, executions);
  const stats = new StatsService(repos);
  return {
    repos, crypto, projects, environments, variables, cases, plans, rules,
    sent, monitors, incidents, dispatcher, executions, scheduler, stats,
  };
}
type W2 = ReturnType<typeof makeWeek2>;
async function seedPlan(w: W2, opts?: { threshold?: number; policy?: "skip" | "queue" | "parallel"; cron?: string }) {
  const project = await w.projects.create(TENANT, { name: "Demo", slug: `demo-${randomUUID().slice(0, 8)}`, ownerId: "tester" });
  const env = await w.environments.create(TENANT, project.id, { name: "prod", baseUrl: "https://example.com" });
  const { case: c } = await w.cases.createDslCase(TENANT, project.id, { name: "登录用例", dsl }, "tester");
  const plan = await w.plans.create(TENANT, {
    caseId: c.id, environmentId: env.id, cronExpr: opts?.cron ?? "*/5 * * * *", timezone: "UTC",
    failThreshold: opts?.threshold ?? 3, concurrencyPolicy: opts?.policy ?? "skip",
  });
  return { project, env, case: c, plan };
}
let seq = 0;
function fakeExec(plan: PlanRecord, execStatus: ExecutionRecord["status"], at: Date): ExecutionRecord {
  return {
    id: randomUUID(), tenantId: TENANT, projectId: plan.projectId, planId: plan.id,
    caseVersionId: "v-any", environmentId: plan.environmentId, triggerType: "schedule",
    status: execStatus, attempt: 1, startedAt: at, finishedAt: at, createdAt: at,
  };
}
const minutesFrom = (base: Date, n: number) => new Date(base.getTime() + n * 60_000);

// ---------- cron ----------
test("cron validation: accepts valid expressions, rejects garbage with 400 at plan create", async () => {
  assert.equal(validateCron("*/5 * * * *").ok, true);
  assert.equal(validateCron("0 9 * * 1-5").ok, true);
  assert.equal(validateCron("not a cron").ok, false);
  assert.equal(validateCron("61 * * * *").ok, false);
  assert.equal(validateCron("0 0 * *").ok, false);
  assert.equal(validateCron("*/0 * * * *").ok, false);
  const w = makeWeek2();
  const { case: c, env } = await seedPlan(w);
  await assert.rejects(
    () => w.plans.create(TENANT, { caseId: c.id, environmentId: env.id, cronExpr: "blabla", timezone: "UTC" }),
    (e: unknown) => status(e) === 400);
  await assert.rejects(
    () => w.plans.create(TENANT, { caseId: c.id, environmentId: env.id, cronExpr: "*/5 * * * *", timezone: "Mars/Olympus" }),
    (e: unknown) => status(e) === 400);
});

test("cron fire calculation honors plan timezone (09:00 Asia/Shanghai = 01:00Z)", () => {
  const fire = lastCronFire("0 9 * * *", "Asia/Shanghai", new Date("2026-11-02T02:30:00Z"));
  assert.equal(fire?.toISOString(), "2026-11-02T01:00:00.000Z");
});

// ---------- scheduler ----------
test("scheduler tick idempotency: double tick in same window creates exactly one execution", async () => {
  const w = makeWeek2();
  const { plan } = await seedPlan(w);
  const now = minutesFrom(plan.createdAt, 6);
  const r1 = await w.scheduler.tick(TENANT, now);
  assert.equal(r1.created.length, 1);
  assert.equal(r1.created[0].planId, plan.id);
  assert.equal(r1.created[0].triggerType, "schedule");
  const r2 = await w.scheduler.tick(TENANT, now);
  assert.equal(r2.created.length, 0);
  const all = await w.repos.executions.listByPlan(TENANT, plan.id);
  assert.equal(all.length, 1);
});

test("scheduler missed-run policy: tick 2h late creates 1 execution, not a backfill storm", async () => {
  const w = makeWeek2();
  const { plan } = await seedPlan(w); // */5 cron: 2h = 24 missed points
  const r = await w.scheduler.tick(TENANT, minutesFrom(plan.createdAt, 120));
  assert.equal(r.created.length, 1);
  assert.equal((await w.repos.executions.listByPlan(TENANT, plan.id)).length, 1);
});

test("scheduler skip policy: previous still running -> skip, cursor advances, skippedCount++", async () => {
  const w = makeWeek2();
  const { plan } = await seedPlan(w, { policy: "skip" });
  await w.repos.executions.insertExecution(fakeExec(plan, "running", plan.createdAt));
  const r = await w.scheduler.tick(TENANT, minutesFrom(plan.createdAt, 10));
  assert.equal(r.created.length, 0);
  assert.equal(r.skipped.length, 1);
  assert.equal((await w.plans.get(TENANT, plan.id)).skippedCount, 1);
});

test("scheduler queue policy: creates pending execution without dispatch, released by later tick", async () => {
  const w = makeWeek2();
  const { plan } = await seedPlan(w, { policy: "queue" });
  const running = await w.repos.executions.insertExecution(fakeExec(plan, "running", plan.createdAt));
  const r1 = await w.scheduler.tick(TENANT, minutesFrom(plan.createdAt, 10));
  assert.equal(r1.created.length, 1);
  assert.equal(r1.created[0].snapshotJson?.pendingDispatch, true);
  assert.equal(w.dispatcher.dispatched.length, 0); // 还没分发
  // 上一单结束 -> 下一次 tick 释放待分发单
  await w.repos.executions.saveExecution({ ...running, status: "passed", finishedAt: new Date() });
  const r2 = await w.scheduler.tick(TENANT, minutesFrom(plan.createdAt, 11));
  assert.equal(r2.released.length, 1);
  assert.equal(r2.released[0].id, r1.created[0].id);
  assert.equal(w.dispatcher.dispatched.length, 1);
  const after = await w.repos.executions.findExecutionById(TENANT, r1.created[0].id);
  assert.equal(after?.snapshotJson?.pendingDispatch, undefined);
});

// ---------- monitor state machine + alerting ----------
async function seedPlanWithRule(w: W2, threshold = 3) {
  const seeded = await seedPlan(w, { threshold });
  const dto = await w.rules.create(TENANT, {
    scopeType: "plan", scopeId: seeded.plan.id,
    channels: [{ type: "feishu", label: "值班群", target: "https://open.feishu.cn/open-apis/bot/v2/hook/FAKE-TOKEN-123" }],
  });
  return { ...seeded, ruleDto: dto };
}

test("monitor state machine: up->suspect->down at threshold, opened alert once, ack, recovered after 2 successes", async () => {
  const w = makeWeek2();
  const { plan, ruleDto } = await seedPlanWithRule(w, 3);
  // 规则 DTO 只回掩码：不含 token 明文，落库是密文
  assert.equal(ruleDto.channels[0].targetMasked, "https://open.feishu.cn/***");
  assert.ok(!JSON.stringify(ruleDto).includes("FAKE-TOKEN-123"));
  const rawRule = await w.rules.get(TENANT, ruleDto.id);
  assert.ok(!rawRule.channels[0].targetCipher.includes("FAKE-TOKEN-123"));

  const t0 = new Date();
  const feed = (s: ExecutionRecord["status"], n: number) =>
    w.monitors.onExecutionCompleted(TENANT, fakeExec(plan, s, minutesFrom(t0, n)));

  let st = await feed("failed", 1);
  assert.equal(st?.status, "suspect"); assert.equal(st?.consecutiveFailures, 1);
  assert.equal(w.sent.length, 0);
  st = await feed("failed", 2);
  assert.equal(st?.status, "suspect"); assert.equal(w.sent.length, 0);
  st = await feed("failed", 3);
  assert.equal(st?.status, "down");
  assert.equal(w.sent.length, 1); assert.equal(w.sent[0].kind, "opened");
  const incidentId = st?.openIncidentId; assert.ok(incidentId);
  const incident = await w.incidents.get(TENANT, incidentId);
  assert.equal(incident.status, "triggered");
  assert.equal(incident.escalateAt.getTime() - incident.startedAt.getTime(), 15 * 60_000);
  // down 期间继续失败：不再重复发 opened、不重复开单
  st = await feed("failed", 4);
  assert.equal(st?.status, "down"); assert.equal(w.sent.length, 1);
  assert.equal((await w.repos.incidents.listByProject(TENANT, plan.projectId)).length, 1);
  // ack
  const acked = await w.incidents.ack(TENANT, incidentId, "oncall-jo");
  assert.equal(acked.status, "acknowledged"); assert.equal(acked.ackBy, "oncall-jo");
  // 第 1 次成功：仍 down，不发恢复
  st = await feed("passed", 5);
  assert.equal(st?.status, "down"); assert.equal(w.sent.length, 1);
  // 第 2 次成功：recovered，关单并落 duration，恢复通知只发一次
  st = await feed("passed", 6);
  assert.equal(st?.status, "up");
  assert.equal(w.sent.length, 2); assert.equal(w.sent[1].kind, "recovered");
  const resolved = await w.incidents.get(TENANT, incidentId);
  assert.equal(resolved.status, "resolved");
  assert.ok(resolved.resolvedAt); assert.equal(typeof resolved.durationMs, "number");
  assert.ok((resolved.durationMs ?? 0) >= 3 * 60_000);
  // 迁移历史完整：up->suspect, suspect->down, down->up
  const hist = (await w.monitors.getByPlan(TENANT, plan.id))?.history ?? [];
  assert.deepEqual(hist.map(h => `${h.from}->${h.to}`), ["up->suspect", "suspect->down", "down->up"]);
  // 通知流水：opened + recovered 各一条 sent
  const logs = await w.repos.notifications.listByIncident(TENANT, incidentId);
  assert.deepEqual(logs.map(l => `${l.kind}:${l.status}`).sort(), ["opened:sent", "recovered:sent"]);
});

test("infra_failed never moves monitor toward down (infra counter only); flaky counts as success", async () => {
  const w = makeWeek2();
  const { plan } = await seedPlanWithRule(w, 2); // 阈值 2：若 infra 计失败，2 次就该 down
  const t0 = new Date();
  for (let i = 1; i <= 5; i++)
    await w.monitors.onExecutionCompleted(TENANT, fakeExec(plan, "infra_failed", minutesFrom(t0, i)));
  let st = await w.monitors.getByPlan(TENANT, plan.id);
  assert.equal(st?.status, "up");
  assert.equal(st?.infraCount, 5);
  assert.equal(st?.consecutiveFailures, 0);
  assert.equal(w.sent.length, 0);
  // 真失败 1 次 -> suspect；随后 flaky（先败后过）算成功 -> 静默回 up 且 flakyCount++
  await w.monitors.onExecutionCompleted(TENANT, fakeExec(plan, "failed", minutesFrom(t0, 6)));
  st = await w.monitors.onExecutionCompleted(TENANT, fakeExec(plan, "flaky", minutesFrom(t0, 7)));
  assert.equal(st?.status, "up");
  assert.equal(st?.flakyCount, 1);
  assert.equal(st?.consecutiveFailures, 0);
  assert.equal(w.sent.length, 0);
});

// ---------- stats overview 口径 ----------
test("stats overview: success rate excludes infra_failed and unfinished from denominator", async () => {
  const w = makeWeek2();
  const { plan, project } = await seedPlan(w);
  const now = new Date();
  const insert = (s: ExecutionRecord["status"]) => w.repos.executions.insertExecution({
    ...fakeExec(plan, s, now), caseVersionId: "v", projectId: project.id,
  });
  await insert("passed"); await insert("passed"); await insert("failed");
  await insert("infra_failed"); await insert("infra_failed"); await insert("infra_failed");
  await insert("queued");
  // 一个 down 的监控状态
  const t0 = new Date();
  await w.repos.monitors.insert({
    id: randomUUID(), tenantId: TENANT, projectId: project.id, planId: plan.id, status: "down",
    consecutiveFailures: 3, consecutiveSuccesses: 0, flakyCount: 0, infraCount: 0,
    history: [], createdAt: t0, updatedAt: t0,
  });
  const ov = await w.stats.overview(TENANT, project.id, now);
  assert.equal(ov.todayTotal, 7);
  assert.equal(ov.todayFinished, 3); // passed*2 + failed，infra/queued 不进分母
  assert.ok(Math.abs((ov.successRate ?? 0) - 2 / 3) < 1e-9);
  assert.equal(ov.downCount, 1);
  assert.equal(ov.monitors.length, 1); assert.equal(ov.monitors[0].status, "down");
  assert.equal(ov.recentFailures.length, 1);
});

// ---------- code track unified list (parser-level simulation, no browser) ----------
test("code track: dry-run dispatches with track=code + sourceRef, unified list shows both tracks (parser-level simulation, no browser run)", async () => {
  const w = makeWeek2();
  const project = await w.projects.create(TENANT, { name: "Demo", slug: "code-demo", ownerId: "tester" });
  const env = await w.environments.create(TENANT, project.id, { name: "prod", baseUrl: "https://example.com" });
  const { case: codeCase } = await w.cases.createCodeCase(TENANT, project.id,
    { name: "代码轨登录套件", sourceRef: "login-suite" }, "tester");
  assert.equal(codeCase.type, "code");
  // 用进程内分发模拟 code-runner：handler 返回与 worker reporter-parser 相同形状的统一结果。
  // ⚠️ 这是解析器级别的模拟（本机无可用浏览器，见 PROGRESS 阻塞 #2），不是一次真实浏览器运行。
  let executionsRef: ExecutionService;
  const simDispatcher = new InProcessDispatcher(async (result, payload) => {
    await executionsRef.completeExecution(TENANT, payload.executionId, result);
  });
  simDispatcher.onExecute(async (payload) => ({
    executionId: payload.executionId, track: "code" as const, caseName: payload.sourceRef ?? "code",
    status: "passed" as const, durationMs: 42,
    steps: [{ stepNo: 1, name: "login.spec.ts > logs in", stepType: "playwright-spec", status: "passed" as const, durationMs: 42 }],
    artifacts: [],
  }));
  executionsRef = new ExecutionService(w.repos, w.cases, w.environments, w.variables, simDispatcher);
  const exec = await executionsRef.dryRun(TENANT, codeCase.id, { environmentId: env.id });
  assert.equal(exec.status, "passed");
  assert.equal(simDispatcher.dispatched[0].track, "code");
  assert.equal(simDispatcher.dispatched[0].sourceRef, "login-suite");
  // DSL 轨也建一条，统一列表同时出现两种 track
  const { case: dslCase } = await w.cases.createDslCase(TENANT, project.id, { name: "登录用例", dsl }, "tester");
  await executionsRef.dryRun(TENANT, dslCase.id, { environmentId: env.id });
  const list = await executionsRef.listEnriched(TENANT, project.id);
  assert.equal(list.length, 2);
  assert.deepEqual(list.map(x => x.track).sort(), ["code", "dsl"]);
  assert.equal(list.find(x => x.track === "code")?.caseName, "代码轨登录套件");
});
