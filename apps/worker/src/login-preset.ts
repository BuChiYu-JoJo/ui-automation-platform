import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { BrowserContext, Page } from "playwright";
import type { EnvelopeCrypto } from "@uip/shared";

/** Playwright storageState 结构（只取本模块用到的部分）。
 *  ⚠️ 安全口径：storageState == 登录凭证。落盘必须加密（与 API 侧 StorageStateService 同一把信封加密），
 *  解密只发生在 worker 内存里；禁止打印/回传 state 内容到日志与执行快照。 */
export interface StorageStateJson {
  cookies: Record<string, unknown>[];
  origins?: { origin: string; localStorage: { name: string; value: string }[] }[];
}
/** 预设内容来源抽象：get 返回原文（密文或明文 JSON，由 resolver 按是否配置 crypto 决定如何解）+ 保存时间。 */
export interface PresetStateSource {
  get(name: string): Promise<{ content: string; savedAt: Date } | null>;
}
/** 文件来源：artifacts 根目录下 `<name>.json.enc`（加密）或 `<name>.json`（无 crypto 时），保存时间取文件 mtime。
 *  与 API 侧 StorageStateService 的落盘布局对应：API 写 `.enc` 密文文件，worker 配同一主密钥读取。 */
export class FilePresetStateSource implements PresetStateSource {
  constructor(private rootDir: string) {}
  async get(name: string): Promise<{ content: string; savedAt: Date } | null> {
    const safe = name.replace(/[^A-Za-z0-9_-]/g, "_");
    for (const suffix of [".json.enc", ".json"]) {
      const p = join(this.rootDir, `${safe}${suffix}`);
      try {
        const [content, st] = await Promise.all([readFile(p, "utf8"), stat(p)]);
        return { content, savedAt: st.mtime };
      } catch { /* 试下一个后缀 */ }
    }
    return null;
  }
}
/** 内存来源：测试用（也适合 worker 进程内缓存一层）。 */
export class InMemoryPresetStateSource implements PresetStateSource {
  constructor(private map: Map<string, { content: string; savedAt: Date }> = new Map()) {}
  set(name: string, content: string, savedAt: Date) { this.map.set(name, { content, savedAt }); }
  async get(name: string) { return this.map.get(name) ?? null; }
}
export type PresetResolution =
  | { status: "fresh"; state: StorageStateJson; savedAt: Date; ageSec: number }
  | { status: "missing" }
  | { status: "expired"; savedAt: Date };
export const LOGIN_PRESET_DEFAULT_TTL_SEC = 7 * 24 * 3600;
/** 预设解析器（纯逻辑，可单测）：存在 + 未超 TTL 才算 fresh；解密失败按 missing 处理并说明原因，不静默放行。 */
export class LoginPresetResolver {
  constructor(
    private source: PresetStateSource,
    private opts: { ttlSec?: number; crypto?: EnvelopeCrypto; now?: () => Date } = {},
  ) {}
  async resolve(name: string): Promise<PresetResolution> {
    const found = await this.source.get(name);
    if (!found) return { status: "missing" };
    const now = this.opts.now?.() ?? new Date();
    const ageSec = Math.floor((now.getTime() - found.savedAt.getTime()) / 1000);
    if (ageSec > (this.opts.ttlSec ?? LOGIN_PRESET_DEFAULT_TTL_SEC))
      return { status: "expired", savedAt: found.savedAt };
    let text = found.content;
    if (this.opts.crypto) text = this.opts.crypto.decrypt(text);
    let state: StorageStateJson;
    try { state = JSON.parse(text) as StorageStateJson; }
    catch { throw new Error(`login_preset "${name}": stored state is not valid JSON (corrupt or wrong key)`); }
    if (!Array.isArray(state.cookies))
      throw new Error(`login_preset "${name}": stored state has no cookies array (not a Playwright storageState)`);
    return { status: "fresh", state, savedAt: found.savedAt, ageSec };
  }
}
/** 把 storageState 注入已存在的 context（DSL login_preset 步骤的执行方式）：
 *  cookies 走 context.addCookies（Playwright 官方通道）；localStorage 没有 context 级 API，
 *  只能逐 origin 用临时页导航后 evaluate 写入——这也是为什么优先在建 context 时用 storageStatePath 注入，
 *  步骤级注入是给「跑到一半才需要登录态」的旅程用的兜底。 */
export async function applyStorageState(
  ctx: BrowserContext, state: StorageStateJson, page?: Page,
): Promise<void> {
  if (state.cookies.length)
    // Playwright 的 Cookie 类型要求 name/value 等字段，storageState 的 cookie 记录结构一致，经 unknown 透传
    await ctx.addCookies(state.cookies as unknown as Parameters<BrowserContext["addCookies"]>[0]);
  const origins = (state.origins ?? []).filter(o => o.localStorage?.length);
  if (!origins.length) return;
  const ownPage = !page;
  const p = page ?? await ctx.newPage();
  try {
    for (const o of origins) {
      await p.goto(o.origin, { waitUntil: "domcontentloaded" }).catch(() => {});
      await p.evaluate((entries: { name: string; value: string }[]) => {
        // evaluate 回调运行在浏览器页面上下文（有 window），Node 侧类型检查看不到 DOM lib
        const w = globalThis as unknown as { localStorage: Storage };
        for (const e of entries) w.localStorage.setItem(e.name, e.value);
      }, o.localStorage);
    }
  } finally {
    if (ownPage) await p.close().catch(() => {});
  }
}
