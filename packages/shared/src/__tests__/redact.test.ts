import { test } from "node:test";
import assert from "node:assert/strict";
import { redactSecrets, redactObject } from "../redact";
test("redactSecrets masks a secret value in a string", () => {
  const out = redactSecrets("login failed for user bob with password Sup3rSecret! at https://x", ["Sup3rSecret!"]);
  assert.ok(!out.includes("Sup3rSecret!")); assert.ok(out.includes("***"));
});
test("redactObject masks sensitive keys", () => {
  const out = redactObject({ user: "bob", password: "p", nested: { api_token: "t" } }) as any;
  assert.equal(out.password, "***"); assert.equal(out.nested.api_token, "***"); assert.equal(out.user, "bob");
});
