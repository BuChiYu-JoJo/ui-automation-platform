import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DslCase, DslStep } from "@uip/dsl";
import type { UnifiedExecution, UnifiedStepResult } from "@uip/shared";
import { parsePlaywrightJsonReport } from "../reporter-parser";

const read = (name: string) => JSON.parse(readFileSync(join(__dirname, "fixtures", name), "utf8")) as unknown;

/**
 * 双轨对照（解析/形状级，明确标注：不启动真实浏览器）：
 * 同一条「登录旅程」分别用 DSL fixture 和代码轨 reporter JSON fixture 表达，
 * 两边产出的统一模型（UnifiedExecution/UnifiedStep）字段形状必须逐项一致——
 * 这是 Week 2「两轨汇入同一 execution 模型」在 Week 3 的回归对照。
 * DSL 侧没有真实 runner 输出时，用 fixture 的步骤定义按 runner 的同一映射规则
 * （stepNo=序号、name=comment??type、stepType=type）构造统一模型再对照。
 */
function dslToUnified(dsl: DslCase, executionId: string): UnifiedExecution {
  const steps: UnifiedStepResult[] = (dsl.steps as DslStep[]).map((s, i) => ({
    stepNo: i + 1,
    name: s.comment ?? s.type,
    stepType: s.type,
    status: "passed" as const,
    durationMs: 10,
    errorMessage: undefined, // 与 dsl-runner 的产出一致：键恒在，成功时为 undefined
  }));
  return {
    executionId, track: "dsl", caseName: dsl.name, status: "passed",
    durationMs: steps.reduce((a, s) => a + s.durationMs, 0), steps, artifacts: [],
  };
}

test("dual-track cross-check (shape level): DSL journey and code-track reporter output share the identical unified shape", () => {
  const dsl = read("login-journey.dsl.json") as DslCase;
  const report = read("login-journey.report.json");
  const fromDsl = dslToUnified(dsl, "exec-cross-check");
  const fromCode = parsePlaywrightJsonReport(report as never, "exec-cross-check", dsl.name);

  // 执行级：字段键集合完全一致（除 track 标记）
  assert.deepEqual(Object.keys(fromCode).sort(), Object.keys(fromDsl).sort());
  for (const key of Object.keys(fromDsl) as (keyof UnifiedExecution)[]) {
    if (key === "track" || key === "steps" || key === "durationMs") continue;
    assert.deepEqual(fromCode[key], fromDsl[key], `execution.${key} 应一致`);
  }
  assert.equal(fromDsl.track, "dsl");
  assert.equal(fromCode.track, "code");
  assert.equal(fromCode.status, fromDsl.status);

  // 步骤级：键集合、序号、状态逐项一致；名称按约定比对——代码轨的步骤名是
  // 「<套件标题> > <spec 标题>」（reporter-parser 的既有口径），取 spec 部分与 DSL 的 comment 对照。
  const specName = (name: string) => name.split(" > ").at(-1);
  assert.equal(fromCode.steps.length, fromDsl.steps.length);
  for (let i = 0; i < fromDsl.steps.length; i++) {
    assert.deepEqual(Object.keys(fromCode.steps[i]).sort(), Object.keys(fromDsl.steps[i]).sort(),
      `step ${i + 1} 字段键应一致`);
    assert.equal(fromCode.steps[i].stepNo, fromDsl.steps[i].stepNo);
    assert.equal(specName(fromCode.steps[i].name), fromDsl.steps[i].name);
    assert.equal(fromCode.steps[i].status, fromDsl.steps[i].status);
  }
  assert.deepEqual(fromCode.steps.map((s: UnifiedStepResult) => specName(s.name)),
    ["open login page", "welcome heading visible", "capture result"]);
});
