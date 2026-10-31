import { chromium, type Browser, type BrowserContext } from "playwright";
/** 浏览器池：BrowserContext 级隔离（context-per-execution，用完即弃）。
 *  槽位按内存封顶分发，超槽位排队而不是硬塞；进程定额回收对抗 Chromium 长驻碎片/僵尸。
 *  起步参数(经验值，需按被测站点校准)：4C8G -> 4-6 context。 */
export interface PoolConfig {
  maxSlots: number; maxContextsPerBrowser: number; maxExecutionsPerBrowser: number;
  /** 指定 Chromium 可执行文件：Playwright 自带浏览器未下载时（如本机用系统 Chromium）使用；
   *  也可由环境变量 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH 注入（见 index.ts/demo）。 */
  executablePath?: string;
}
export class BrowserPool {
  private browser: Browser | null = null;
  private active = 0; private executionsServed = 0; private contextsOnCurrent = 0;
  private waiters: (() => void)[] = [];
  constructor(private cfg: PoolConfig) {}
  get freeSlots() { return this.cfg.maxSlots - this.active; }
  get capacity() { return { total: this.cfg.maxSlots, free: this.freeSlots }; }
  private async ensureBrowser(): Promise<Browser> {
    if (this.browser && (this.contextsOnCurrent >= this.cfg.maxContextsPerBrowser
        || this.executionsServed >= this.cfg.maxExecutionsPerBrowser)) {
      await this.browser.close().catch(() => {}); this.browser = null;
      this.contextsOnCurrent = 0; this.executionsServed = 0;
    }
    if (!this.browser) this.browser = await chromium.launch({
      headless: true, args: ["--no-sandbox"],
      ...(this.cfg.executablePath ? { executablePath: this.cfg.executablePath } : {}),
    });
    return this.browser;
  }
  /** 申请一个隔离 context；无空闲槽位时等待（队列超时由调用方/队列层判定为 infra_failed，不算被测失败）。 */
  async acquire(opts?: { storageState?: string }): Promise<BrowserContext> {
    while (this.active >= this.cfg.maxSlots)
      await new Promise<void>(r => this.waiters.push(r));
    this.active++;
    try {
      const b = await this.ensureBrowser();
      this.contextsOnCurrent++; this.executionsServed++;
      return await b.newContext(opts?.storageState ? { storageState: opts.storageState } : {});
    } catch (e) { this.active--; this.wake(); throw e; }
  }
  async release(ctx: BrowserContext): Promise<void> {
    await ctx.close().catch(() => {});
    this.active--; this.wake();
  }
  private wake() { this.waiters.shift()?.(); }
  async close() { await this.browser?.close().catch(() => {}); this.browser = null; }
}
