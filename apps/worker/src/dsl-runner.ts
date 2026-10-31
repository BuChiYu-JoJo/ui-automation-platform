import type { BrowserContext, Page } from "playwright";
import type { DslCase, DslStep } from "@uip/dsl";
import type { UnifiedExecution, UnifiedStepResult } from "@uip/shared";
import { resolveWithFallback } from "./locator";
import { applyStorageState, type LoginPresetResolver } from "./login-preset";
export interface RunEnv {
  baseUrl: string;
  variables: Record<string, string>;
  /** 登录预设的建 context 注入路径：job 带 storageStatePath 时，BrowserPool.acquire 已用它建 context
   *  （见 index.ts / browser-pool.ts 的 acquire({ storageState })），runner 这里只是透传记录。 */
  storageStatePath?: string;
  /** 步骤级 login_preset 的解析器（Week 3）：按名查预设的新鲜度并把 state 注入当前 context */
  loginPresets?: LoginPresetResolver;
  allowEvalJs: boolean;
}
const DEFAULT_STEP_TIMEOUT = 10_000;
export function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl
    .replace(/\{\{\$timestamp\}\}/g, String(Date.now()))
    .replace(/\{\{\$random\}\}/g, Math.random().toString(36).slice(2, 8))
    .replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);
}
/** DSL 解释器：把声明式步骤翻译为 Playwright 调用，产出统一执行模型。
 *  禁止固定 sleep 思维：等待一律走条件等待；wait_timeout 仅作受限逃生（校验层已限 30s）。 */
export async function runDslCase(
  ctx: BrowserContext, dslCase: DslCase, env: RunEnv, executionId: string,
): Promise<UnifiedExecution> {
  const page = await ctx.newPage();
  const vars: Record<string, string> = { ...(dslCase.variables ?? {}), ...env.variables };
  const steps: UnifiedStepResult[] = [];
  const started = Date.now();
  let failed = false;
  for (let i = 0; i < dslCase.steps.length; i++) {
    const step = dslCase.steps[i];
    const t0 = Date.now();
    const res: UnifiedStepResult = { stepNo: i + 1, name: step.comment ?? step.type, stepType: step.type, status: "passed", durationMs: 0 };
    if (failed && !step.optional) { res.status = "skipped"; steps.push(res); continue; }
    try {
      const healed = await execStep(page, ctx, step, vars, env, dslCase);
      if (healed) res.locatorHealed = true;
    } catch (err) {
      res.status = "failed"; res.errorMessage = err instanceof Error ? err.message : String(err);
      if (!step.optional) failed = true;
      if (step.screenshotOnFail !== false) {
        // TODO(artifacts): 截图直传 S3 并回填 res.screenshotArtifactKey = artifactKey(...)
        await page.screenshot({ path: `/tmp/${executionId}-step${i + 1}.png` }).catch(() => {});
      }
    }
    res.durationMs = Date.now() - t0;
    steps.push(res);
  }
  return { executionId, track: "dsl", caseName: dslCase.name,
    status: failed ? "failed" : "passed", durationMs: Date.now() - started, steps, artifacts: [] };
}
async function execStep(page: Page, ctx: BrowserContext, step: DslStep,
  vars: Record<string, string>, env: RunEnv, dslCase: DslCase): Promise<boolean> {
  const timeout = step.timeoutMs ?? DEFAULT_STEP_TIMEOUT;
  const val = step.value !== undefined ? renderTemplate(step.value, vars) : undefined;
  const needLoc = async () => {
    if (!step.locator) throw new Error(`${step.type} requires locator`);
    return resolveWithFallback(page, step.locator);
  };
  switch (step.type) {
    case "goto": await page.goto(new URL(renderTemplate(step.url ?? val ?? "", vars), env.baseUrl).toString(),
      { timeout: 30_000 }); return false;
    case "click": { const r = await needLoc(); await r.locator.click({ timeout }); return r.healed; }
    case "fill": { const r = await needLoc(); await r.locator.fill(val ?? "", { timeout }); return r.healed; }
    case "press": if (step.locator) { const r = await needLoc(); await r.locator.press(val ?? "Enter", { timeout }); return r.healed; }
      await page.keyboard.press(val ?? "Enter"); return false;
    case "select": { const r = await needLoc(); await r.locator.selectOption(val ?? "", { timeout }); return r.healed; }
    case "check": { const r = await needLoc(); await r.locator.check({ timeout }); return r.healed; }
    case "uncheck": { const r = await needLoc(); await r.locator.uncheck({ timeout }); return r.healed; }
    case "hover": { const r = await needLoc(); await r.locator.hover({ timeout }); return r.healed; }
    case "wait_for_selector": { const r = await needLoc(); await r.locator.waitFor({ timeout }); return r.healed; }
    case "wait_for_url": await page.waitForURL(renderTemplate(step.url ?? val ?? "", vars), { timeout }); return false;
    case "wait_timeout": await page.waitForTimeout(Math.min(step.timeoutMs ?? 1000, 30_000)); return false;
    case "assert_visible": { const r = await needLoc();
      if (!(await r.locator.isVisible())) throw new Error("assert_visible failed"); return r.healed; }
    case "assert_text": { const r = await needLoc();
      const txt = (await r.locator.innerText({ timeout })).trim();
      const exp = renderTemplate(String(step.expected ?? val ?? ""), vars);
      if (!txt.includes(exp)) throw new Error(`assert_text: expected to contain "${exp}", got "${txt.slice(0, 120)}"`); return r.healed; }
    case "assert_value": { const r = await needLoc();
      const v = await r.locator.inputValue({ timeout });
      if (v !== String(step.expected ?? val ?? "")) throw new Error(`assert_value: got "${v}"`); return r.healed; }
    case "assert_url": { const exp = renderTemplate(String(step.expected ?? step.url ?? val ?? ""), vars);
      if (!page.url().includes(exp)) throw new Error(`assert_url: ${page.url()} does not contain "${exp}"`); return false; }
    case "assert_api_status": case "api_request": {
      const url = new URL(renderTemplate(step.url ?? "", vars), env.baseUrl).toString();
      const resp = await page.request.fetch(url, { method: step.method ?? "GET" });
      if (step.variable) vars[step.variable] = await resp.text();
      if (step.type === "assert_api_status" && resp.status() !== Number(step.expected))
        throw new Error(`assert_api_status: expected ${step.expected}, got ${resp.status()}`);
      return false; }
    case "screenshot": await page.screenshot({ path: `/tmp/${step.id}.png` }); return false; // TODO(artifacts): 上传 S3
    case "set_variable": if (!step.variable) throw new Error("set_variable requires variable");
      vars[step.variable] = val ?? ""; return false;
    case "login_preset": {
      // 登录预设：把指定预设的 storageState 注入当前 context。预设名 = step.value，缺省用用例级 loginPreset。
      const presetName = step.value ?? dslCase.loginPreset;
      if (!presetName) throw new Error("login_preset requires a preset name (step.value or case.loginPreset)");
      if (!env.loginPresets)
        throw new Error(`login_preset "${presetName}": no preset resolver configured on this worker (set UIP_STORAGE_STATE_DIR)`);
      const res = await env.loginPresets.resolve(presetName);
      if (res.status !== "fresh")
        throw new Error(`login_preset "${presetName}" unavailable: storageState ${res.status} — refresh it by running the login case first`);
      await applyStorageState(ctx, res.state, page);
      return false; }
    case "run_case":
      // 子流程组合：MVP 骨架先明确报错，V1 实现（按 caseRef 递归执行子用例并合并 stepNo）。
      throw new Error("run_case not implemented in skeleton: sub-case composition lands in V1");
    case "eval_js":
      if (!env.allowEvalJs) throw new Error("eval_js disabled (set ALLOW_EVAL_JS=true per project)");
      await page.evaluate(val ?? ""); return false;
    default: throw new Error(`unknown action ${(step as DslStep).type}`);
  }
}
