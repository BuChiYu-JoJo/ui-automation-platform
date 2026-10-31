import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { AesGcmEnvelopeCrypto } from "@uip/shared";
import type { DslCase } from "@uip/dsl";
import type { UnifiedExecution } from "@uip/shared";
import {
  InMemoryPresetStateSource, LoginPresetResolver, applyStorageState, type StorageStateJson,
} from "../login-preset";
import { runDslCase } from "../dsl-runner";

/** 本文件全部是逻辑级测试：用 fake 的 source/context/page 验证预设解析与注入逻辑，不启动真实浏览器。 */
const state: StorageStateJson = {
  cookies: [{ name: "sid", value: "abc", domain: "example.com", path: "/" }],
  origins: [{ origin: "https://example.com", localStorage: [{ name: "k", value: "v" }] }],
};
const NOW = new Date("2026-10-31T12:00:00Z");
const fixedNow = () => NOW;

function makeResolver(savedAt: Date, content = JSON.stringify(state)) {
  const source = new InMemoryPresetStateSource();
  source.set("admin", content, savedAt);
  return new LoginPresetResolver(source, { ttlSec: 3600, now: fixedNow });
}

test("login preset resolver: fresh state within TTL is reused", async () => {
  const res = await makeResolver(new Date(NOW.getTime() - 100_000)).resolve("admin");
  assert.equal(res.status, "fresh");
  if (res.status === "fresh") {
    assert.equal(res.state.cookies.length, 1);
    assert.equal(res.ageSec, 100);
  }
});

test("login preset resolver: state older than TTL is expired (needs re-login)", async () => {
  const res = await makeResolver(new Date(NOW.getTime() - 3601_000)).resolve("admin");
  assert.equal(res.status, "expired");
});

test("login preset resolver: unknown preset is missing", async () => {
  const res = await makeResolver(new Date()).resolve("ghost");
  assert.equal(res.status, "missing");
});

test("login preset resolver: encrypted-at-rest state decrypts with the shared envelope key", async () => {
  const crypto = new AesGcmEnvelopeCrypto(createHash("sha256").update("worker-test-key").digest());
  const source = new InMemoryPresetStateSource();
  source.set("admin", crypto.encrypt(JSON.stringify(state)), new Date(NOW.getTime() - 1000));
  const resolver = new LoginPresetResolver(source, { ttlSec: 3600, crypto, now: fixedNow });
  const res = await resolver.resolve("admin");
  assert.equal(res.status, "fresh");
  if (res.status === "fresh") assert.equal(res.state.cookies[0].name, "sid");
});

test("applyStorageState: cookies go through addCookies, localStorage entries are evaluated per origin", async () => {
  const calls: { cookies?: unknown; gotos: string[]; evals: unknown[] } = { gotos: [], evals: [] };
  const fakePage = {
    goto: async (url: string) => { calls.gotos.push(url); },
    evaluate: async (_fn: unknown, arg: unknown) => { calls.evals.push(arg); },
    close: async () => {},
  };
  const fakeCtx = {
    addCookies: async (cookies: unknown) => { calls.cookies = cookies; },
    newPage: async () => fakePage,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await applyStorageState(fakeCtx as any, state, fakePage as any);
  assert.equal((calls.cookies as unknown[]).length, 1);
  assert.deepEqual(calls.gotos, ["https://example.com"]);
  assert.deepEqual(calls.evals, [[{ name: "k", value: "v" }]]);
});

/** fake context/page：只实现 runner 在这两步里用到的面（newPage/url/addCookies）。 */
function fakeBrowser(resolver: LoginPresetResolver) {
  const added: unknown[] = [];
  const fakePage = {
    url: () => "https://example.com/home",
    screenshot: async () => {},
    goto: async () => {},       // applyStorageState 注入 localStorage 时会用到
    evaluate: async () => {},
  };
  const fakeCtx = {
    newPage: async () => fakePage,
    addCookies: async (c: unknown) => { added.push(c); },
  };
  const dslCase: DslCase = {
    dslVersion: "1", name: "带预设的旅程", loginPreset: "admin",
    steps: [
      { id: "s1", type: "login_preset" },
      { id: "s2", type: "assert_url", expected: "example.com" },
    ],
  };
  return { added, fakeCtx, fakePage, dslCase,
    env: { baseUrl: "https://example.com", variables: {}, loginPresets: resolver, allowEvalJs: false } };
}

test("dsl runner login_preset step: fresh preset is injected into the context and the journey passes", async () => {
  const { added, fakeCtx, dslCase, env } = fakeBrowser(makeResolver(new Date(NOW.getTime() - 1000)));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: UnifiedExecution = await runDslCase(fakeCtx as any, dslCase, env, "exec-preset-1");
  assert.equal(out.status, "passed");
  assert.equal(out.steps[0].status, "passed");
  assert.equal(added.length, 1); // addCookies 被调用一次 = state 已注入
});

test("dsl runner login_preset step: missing/expired preset fails the step with a clear refresh instruction", async () => {
  const missing = fakeBrowser(makeResolver(new Date())); // source 里只有别的预设名时同样走 missing——这里用空 source
  const emptyResolver = new LoginPresetResolver(new InMemoryPresetStateSource(), { now: fixedNow });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const outMissing: UnifiedExecution = await runDslCase(missing.fakeCtx as any, missing.dslCase,
    { ...missing.env, loginPresets: emptyResolver }, "exec-preset-2");
  assert.equal(outMissing.status, "failed");
  assert.match(outMissing.steps[0].errorMessage ?? "", /missing.*refresh/i);

  const expired = fakeBrowser(makeResolver(new Date(NOW.getTime() - 7200_000)));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const outExpired: UnifiedExecution = await runDslCase(expired.fakeCtx as any, expired.dslCase,
    expired.env, "exec-preset-3");
  assert.equal(outExpired.status, "failed");
  assert.match(outExpired.steps[0].errorMessage ?? "", /expired.*refresh/i);
});
