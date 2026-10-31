import { test } from "node:test";
import assert from "node:assert/strict";
import { validateDslCase } from "../schema";
const valid = { dslVersion: "1", name: "smoke", steps: [
  { id: "s1", type: "goto", url: "https://example.com" },
  { id: "s2", type: "assert_visible", locator: { strategy: "role", value: "heading" } },
]};
test("validator accepts a valid case", () => { assert.equal(validateDslCase(valid).ok, true); });
test("validator rejects unknown action", () => {
  const bad = { ...valid, steps: [{ id: "s1", type: "teleport", url: "https://example.com" }] };
  assert.equal(validateDslCase(bad).ok, false);
});
test("validator rejects locator-less click", () => {
  const bad = { ...valid, steps: [{ id: "s1", type: "click" }] };
  assert.equal(validateDslCase(bad).ok, false);
});
