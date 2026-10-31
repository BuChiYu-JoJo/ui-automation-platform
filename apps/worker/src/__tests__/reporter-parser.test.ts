import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePlaywrightJsonReport } from "../reporter-parser";
test("parser converts sample report into unified step_results", () => {
  const fixture = JSON.parse(readFileSync(join(__dirname, "fixtures", "sample-report.json"), "utf8"));
  const out = parsePlaywrightJsonReport(fixture, "exec-1");
  assert.equal(out.track, "code");
  assert.equal(out.steps.length, 3);
  assert.equal(out.steps[0].status, "passed");
  assert.equal(out.steps[1].status, "flaky");   // 先败后过
  assert.equal(out.steps[2].status, "failed");
  assert.ok(out.steps[2].errorMessage?.includes("expect(title)"));
  assert.equal(out.status, "failed");
});
