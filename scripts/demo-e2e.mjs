#!/usr/bin/env node
/**
 * Week 1 端到端验收演示（pnpm demo:e2e）：
 * 服务层（内存仓库）建 项目 -> 环境 -> 变量（含密钥，加密落库） -> DSL 登录用例
 * -> dry-run（进程内分发） -> @uip/worker 真实 DSL 解释器 + 真实 Chromium 执行本地站点
 * -> step_results/产物（按共享 S3 key 命名落本地 artifacts/ 目录）回写同一仓库层 -> 断言 passed。
 *
 * 退出码：0 = execution.status=passed
 *         2 = 浏览器不可用（Playwright Chromium 未下载/下载失败等基础设施阻塞，如实报告，不伪造通过）
 *         1 = 其他失败（用例真失败或流程错误）
 * 无真实凭证、无外部站点：站点是 e2e-fixtures/local-site/ 的本地静态页，密码是演示值。
 */
import { createServer } from "node:http";
import { readFile, mkdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.env.MASTER_KEY_B64 ??= createHash("sha256").update("uip-demo-master-key").digest("base64");

const {
  InMemoryRepositories, ProjectService, EnvironmentService, EnvVariableService,
  CaseService, ExecutionService, InProcessDispatcher, createEnvelopeCrypto,
} = await import("../apps/api/dist/domain/index.js");
const { BrowserPool } = await import("../apps/worker/dist/browser-pool.js");
const { runDslCase } = await import("../apps/worker/dist/dsl-runner.js");
const { artifactKey } = await import("../packages/shared/dist/index.js");

const TENANT = "demo-tenant";
const PORT = 18089;
const BASE = `http://127.0.0.1:${PORT}`;
const artifactsDir = path.join(root, "artifacts");

// ---------- 1) 本地站点（纯 node http 静态服务，无新依赖） ----------
const siteDir = path.join(root, "e2e-fixtures/local-site");
const server = createServer(async (req, res) => {
  const name = (req.url ?? "/").split("?")[0].replace(/^\//, "") || "login.html";
  try {
    const body = await readFile(path.join(siteDir, path.basename(name)));
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(body);
  } catch { res.writeHead(404); res.end("not found"); }
});
await new Promise(r => server.listen(PORT, "127.0.0.1", r));
console.log(`[demo] local site serving at ${BASE}`);

// ---------- 2) 服务层装配（与 Nest CoreModule 同一套领域服务，仓库=内存实现） ----------
const repos = new InMemoryRepositories();
const crypto = createEnvelopeCrypto();
const projects = new ProjectService(repos);
const environments = new EnvironmentService(repos, projects);
const variables = new EnvVariableService(repos, environments, crypto);
const cases = new CaseService(repos, projects);

const pool = new BrowserPool({
  maxSlots: 2, maxContextsPerBrowser: 20, maxExecutionsPerBrowser: 200,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
});
let screenshotFile = null; // {s3Key, sizeBytes}
// 结果回写通道：dispatcher 的 onResult 把统一模型写回仓库（executions 在下方装配，闭包引用）
let executions;
const dispatcher = new InProcessDispatcher(async (result, payload) => {
  await executions.completeExecution(payload.tenantId, payload.executionId, result,
    screenshotFile ? [{ kind: "screenshot", s3Key: screenshotFile.s3Key, sizeBytes: screenshotFile.sizeBytes }] : []);
});
dispatcher.onExecute(async (payload) => {
  await executions.markRunning(payload.tenantId, payload.executionId);
  const ctx = await pool.acquire(); // 浏览器不可用时在此抛错 -> dryRun 落 infra_failed（含原因）
  try {
    const result = await runDslCase(ctx, payload.dslCase, {
      baseUrl: payload.baseUrl, variables: payload.variables, allowEvalJs: false,
    }, payload.executionId);
    if (result.status === "passed") {
      // 成功截图产物：按共享 S3 key 命名，本地 artifacts/ 目录模拟对象存储前缀布局
      const s3Key = artifactKey({
        tenantId: payload.tenantId, projectId: payload.projectId,
        executionId: payload.executionId, kind: "screenshot", filename: "final.png",
      });
      const localPath = path.join(artifactsDir, s3Key);
      await mkdir(path.dirname(localPath), { recursive: true });
      const page = ctx.pages()[0] ?? (await ctx.newPage());
      await page.screenshot({ path: localPath });
      screenshotFile = { s3Key, sizeBytes: (await stat(localPath)).size };
      console.log(`[demo] screenshot artifact: ${localPath} (${screenshotFile.sizeBytes} bytes)`);
    }
    return result;
  } finally { await pool.release(ctx); }
});
executions = new ExecutionService(repos, cases, environments, variables, dispatcher);

// ---------- 3) 业务流程 ----------
let exitCode = 1;
try {
  const project = await projects.create(TENANT, { name: "Demo Project", slug: "demo-project", ownerId: "demo" });
  const env = await environments.create(TENANT, project.id, { name: "local", baseUrl: BASE });
  console.log(`[demo] project=${project.slug} env=${env.name} baseUrl=${env.baseUrl} isDefault=${env.isDefault}`);

  const userDto = await variables.upsert(TENANT, env.id, { key: "login_user", value: "demo", isSecret: false }, "demo");
  const passDto = await variables.upsert(TENANT, env.id, { key: "login_password", value: "demo-password-123", isSecret: true }, "demo");
  console.log(`[demo] variables: ${userDto.key}=${userDto.value} | ${passDto.key}=${passDto.value} (masked=${passDto.masked})`);
  const rawPass = await variables.rawRecord(TENANT, env.id, "login_password");
  console.log(`[demo] secret persisted cipher-only: valuePlain=${rawPass.valuePlain} cipher starts "${rawPass.valueCipher.slice(0, 3)}..."`);

  const dsl = JSON.parse(await readFile(path.join(root, "e2e-fixtures/dsl/login-local.example.json"), "utf8"));
  delete dsl._note;
  const { case: createdCase, latestVersion } =
    await cases.createDslCase(TENANT, project.id, { name: dsl.name, dsl }, "demo");
  console.log(`[demo] case created: "${createdCase.name}" version=${latestVersion.versionNo} steps=${dsl.steps.length}`);

  const execution = await executions.dryRun(TENANT, createdCase.id, { environmentId: env.id });
  const detail = await executions.getDetail(TENANT, execution.id);
  console.log(`\n[demo] execution ${execution.id} (bound caseVersion=${execution.caseVersionId})`);
  console.log(`[demo] status=${detail.execution.status} durationMs=${detail.execution.durationMs ?? "-"}`);
  for (const s of detail.stepResults)
    console.log(`  step ${s.stepNo} [${s.stepType}] ${s.name}: ${s.status} (${s.durationMs}ms)${s.errorMessage ? " err=" + s.errorMessage : ""}`);
  for (const a of detail.artifacts)
    console.log(`  artifact kind=${a.kind} key=${a.s3Key} size=${a.sizeBytes}B`);

  if (detail.execution.status === "passed") {
    console.log("\n[demo] ✅ PASS: execution.status=passed — service layer + DSL interpreter + real Chromium e2e loop verified.");
    exitCode = 0;
  } else if (detail.execution.status === "infra_failed") {
    console.log("\n[demo] ⛔ BLOCKED (infrastructure): execution.status=infra_failed");
    console.log(`[demo] reason: ${detail.execution.snapshotJson?.infraError ?? "unknown infra error"}`);
    console.log("[demo] The service-layer flow above (project/env/secret-variable/case/dry-run) completed; " +
      "only the browser step could not start in this environment. See docs/PROGRESS.md for the recorded browser blocker.");
    exitCode = 2;
  } else {
    console.log(`\n[demo] ❌ FAIL: execution.status=${detail.execution.status}`);
    exitCode = 1;
  }
} catch (err) {
  console.error("[demo] fatal:", err instanceof Error ? err.message : err);
  exitCode = 1;
} finally {
  await pool.close().catch(() => {});
  server.close();
}
process.exit(exitCode);
