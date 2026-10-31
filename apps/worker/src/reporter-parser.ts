import type { UnifiedExecution, UnifiedStepResult, ExecutionStatus } from "@uip/shared";
/** 代码轨：解析 `playwright test --reporter=json` 输出 -> 与 DSL 轨同一套统一模型。
 *  JSON reporter 结构: { suites: Suite[], stats }，Suite 递归含 specs，spec.tests[].results[]。
 *  判定口径与 Playwright Test 一致：先败后过 = flaky，全败 = failed。 */
interface PwResult { status: string; duration: number; error?: { message?: string }; steps?: unknown[] }
interface PwTest { results: PwResult[]; status?: string }
interface PwSpec { title: string; tests: PwTest[] }
interface PwSuite { title?: string; specs?: PwSpec[]; suites?: PwSuite[] }
export interface PwJsonReport { suites?: PwSuite[]; stats?: { duration?: number } }
function collectSpecs(suite: PwSuite, prefix: string, out: { title: string; spec: PwSpec }[]) {
  const here = prefix ? `${prefix} > ${suite.title ?? ""}` : (suite.title ?? "");
  for (const s of suite.specs ?? []) out.push({ title: here ? `${here} > ${s.title}` : s.title, spec: s });
  for (const sub of suite.suites ?? []) collectSpecs(sub, here, out);
}
export function parsePlaywrightJsonReport(report: PwJsonReport, executionId: string, caseName = "code-track"): UnifiedExecution {
  const flat: { title: string; spec: PwSpec }[] = [];
  for (const s of report.suites ?? []) collectSpecs(s, "", flat);
  const steps: UnifiedStepResult[] = flat.map((f, i) => {
    const results = f.spec.tests.flatMap(t => t.results);
    const final = results[results.length - 1];
    const anyPassed = results.some(r => r.status === "passed");
    const status: UnifiedStepResult["status"] =
      !final ? "skipped" : final.status === "passed" ? (results.length > 1 ? "flaky" : "passed")
      : final.status === "skipped" ? "skipped" : anyPassed ? "flaky" : "failed";
    const err = [...results].reverse().find(r => r.error?.message)?.error?.message;
    return { stepNo: i + 1, name: f.title, stepType: "playwright-spec",
      status, durationMs: results.reduce((a, r) => a + (r.duration ?? 0), 0),
      errorMessage: status === "failed" ? err : undefined };
  });
  const hasFailed = steps.some(s => s.status === "failed");
  const hasFlaky = steps.some(s => s.status === "flaky");
  const status: ExecutionStatus = hasFailed ? "failed" : hasFlaky ? "flaky" : "passed";
  return { executionId, track: "code", caseName, status,
    durationMs: report.stats?.duration ?? steps.reduce((a, s) => a + s.durationMs, 0),
    steps, artifacts: [] };
}
