import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CaseService, DomainError, EnvironmentService, EnvVariableService,
  ExecutionService, InMemoryRepositories, InProcessDispatcher, ProjectService,
  SECRET_MASK, createEnvelopeCrypto,
} from "../domain";
import type { DslCase } from "@uip/dsl";

const TENANT = "tenant-test";
function makeStack() {
  const repos = new InMemoryRepositories();
  const crypto = createEnvelopeCrypto();
  const projects = new ProjectService(repos);
  const environments = new EnvironmentService(repos, projects);
  const variables = new EnvVariableService(repos, environments, crypto);
  const cases = new CaseService(repos, projects);
  return { repos, crypto, projects, environments, variables, cases };
}
async function seedProjectEnv(s = makeStack()) {
  const project = await s.projects.create(TENANT, { name: "Demo", slug: "demo", ownerId: "tester" });
  const env = await s.environments.create(TENANT, project.id, { name: "local", baseUrl: "http://127.0.0.1:18080" });
  return { ...s, project, env };
}
const status = (e: unknown) => (e as DomainError).httpStatus;

test("secret variable round-trip: stored cipher != plaintext, decrypt == plaintext, DTO leaks neither", async () => {
  const s = await seedProjectEnv();
  const plain = "S3cret-demo-password";
  const dto = await s.variables.upsert(TENANT, s.env.id,
    { key: "login_password", value: plain, isSecret: true }, "tester");
  // DTO：只有掩码，没有明文也没有密文
  assert.equal(dto.value, SECRET_MASK);
  assert.equal(dto.masked, true);
  assert.ok(!JSON.stringify(dto).includes(plain), "DTO 不得含明文");
  // 落库：原始记录只有密文
  const raw = await s.variables.rawRecord(TENANT, s.env.id, "login_password");
  assert.ok(raw); assert.equal(raw.valuePlain, null);
  assert.ok(raw.valueCipher && raw.valueCipher !== plain, "落库必须是密文");
  assert.ok(!raw.valueCipher.includes(plain), "密文不得含明文子串");
  assert.ok(!JSON.stringify(dto).includes(raw.valueCipher), "DTO 不得含密文");
  // 解密往返（执行路径内部）
  const resolved = await s.variables.resolveForExecution(TENANT, s.env.id);
  assert.equal(resolved.login_password, plain);
  assert.equal(s.crypto.decrypt(raw.valueCipher), plain);
  // 审计桩已写且不含值
  const audits = await s.repos.audit.list(TENANT, `env_variable:${raw.id}`);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, "env_variable.secret.create");
  assert.ok(!JSON.stringify(audits[0]).includes(plain));
  // 非密钥变量照常明文返回
  const dto2 = await s.variables.upsert(TENANT, s.env.id,
    { key: "login_user", value: "demo", isSecret: false }, "tester");
  assert.equal(dto2.value, "demo"); assert.equal(dto2.masked, false);
});

test("project slug uniqueness per tenant -> 409; other tenant unaffected", async () => {
  const s = makeStack();
  await s.projects.create(TENANT, { name: "A", slug: "same-slug" });
  await assert.rejects(
    () => s.projects.create(TENANT, { name: "B", slug: "same-slug" }),
    (e: unknown) => status(e) === 409);
  const other = await s.projects.create("tenant-other", { name: "B", slug: "same-slug" });
  assert.equal(other.slug, "same-slug");
  // 非法 slug / 空名 -> 400
  await assert.rejects(() => s.projects.create(TENANT, { name: "X", slug: "Bad Slug!" }),
    (e: unknown) => status(e) === 400);
  await assert.rejects(() => s.projects.create(TENANT, { name: "", slug: "ok-slug" }),
    (e: unknown) => status(e) === 400);
});

test("single-default-environment rule: second isDefault clears the first", async () => {
  const s = await seedProjectEnv(); // 首个环境自动默认
  assert.equal(s.env.isDefault, true);
  const env2 = await s.environments.create(TENANT, s.project.id,
    { name: "staging", baseUrl: "http://127.0.0.1:18081", isDefault: true });
  const all = await s.environments.list(TENANT, s.project.id);
  const defaults = all.filter(e => e.isDefault);
  assert.equal(defaults.length, 1);
  assert.equal(defaults[0].id, env2.id);
  // update 把 env1 设回默认同样保持唯一
  await s.environments.update(TENANT, s.env.id, { isDefault: true });
  const defaults2 = (await s.environments.list(TENANT, s.project.id)).filter(e => e.isDefault);
  assert.equal(defaults2.length, 1); assert.equal(defaults2[0].id, s.env.id);
  // baseUrl 非法 -> 400
  await assert.rejects(
    () => s.environments.create(TENANT, s.project.id, { name: "bad", baseUrl: "ftp://x" }),
    (e: unknown) => status(e) === 400);
});

const dslV1: DslCase = {
  dslVersion: "1", name: "登录用例",
  steps: [{ id: "s1", type: "goto", url: "/" }],
};
test("case version increment: create makes v1 atomically, addVersion increments to v2/v3", async () => {
  const s = await seedProjectEnv();
  const { case: c, latestVersion } = await s.cases.createDslCase(TENANT, s.project.id,
    { name: "登录用例", dsl: dslV1 }, "tester");
  assert.equal(latestVersion?.versionNo, 1);
  const got = await s.cases.get(TENANT, c.id);
  assert.equal(got.latestVersion?.versionNo, 1);
  const v2 = await s.cases.addVersion(TENANT, c.id,
    { dsl: { ...dslV1, steps: [...dslV1.steps, { id: "s2", type: "screenshot" }] }, changeNote: "加截图" }, "tester");
  assert.equal(v2.versionNo, 2);
  const v3 = await s.cases.addVersion(TENANT, c.id, { dsl: dslV1 }, "tester");
  assert.equal(v3.versionNo, 3);
  assert.equal((await s.cases.get(TENANT, c.id)).latestVersion?.versionNo, 3);
  // 坏 DSL -> 400（未知字段形态：空 steps）
  await assert.rejects(
    () => s.cases.addVersion(TENANT, c.id, { dsl: { ...dslV1, steps: [] } }),
    (e: unknown) => status(e) === 400);
});

test("dry-run: creates queued execution bound to latest version, snapshot masks secret values, dispatch recorded", async () => {
  const s = await seedProjectEnv();
  await s.variables.upsert(TENANT, s.env.id, { key: "login_password", value: "pw-demo", isSecret: true }, "tester");
  const { case: c } = await s.cases.createDslCase(TENANT, s.project.id, { name: "登录用例", dsl: dslV1 }, "tester");
  const dispatcher = new InProcessDispatcher(); // 无 handler：只记派发，不执行
  const executions = new ExecutionService(s.repos, s.cases, s.environments, s.variables, dispatcher);
  const exec = await executions.dryRun(TENANT, c.id, { environmentId: s.env.id });
  assert.equal(exec.status, "queued");
  const { latestVersion } = await s.cases.get(TENANT, c.id);
  assert.equal(exec.caseVersionId, latestVersion?.id);
  assert.equal(dispatcher.dispatched.length, 1);
  assert.equal(dispatcher.dispatched[0].executionId, exec.id);
  // 派发 payload 内部含解密值（仅进程内），但落库快照必须是掩码
  assert.equal(dispatcher.dispatched[0].variables.login_password, "pw-demo");
  assert.ok(!JSON.stringify(exec.snapshotJson).includes("pw-demo"), "快照不得含密钥明文");
  const detail = await executions.getDetail(TENANT, exec.id);
  assert.equal(detail.stepResults.length, 0);
  assert.equal(detail.artifacts.length, 0);
});
