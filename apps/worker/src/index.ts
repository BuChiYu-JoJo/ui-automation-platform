import { Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import { validateDslCase, type DslCase } from "@uip/dsl";
import { AesGcmEnvelopeCrypto } from "@uip/shared";
import { BrowserPool } from "./browser-pool";
import { runDslCase } from "./dsl-runner";
import { runCodeTrack } from "./code-runner";
import { FilePresetStateSource, LoginPresetResolver } from "./login-preset";
/** Worker 入口：消费 executions 队列，按 track 分发 DSL/代码双轨，结果回写 API（TODO: 内部事件 API）。
 *  排队/认领超时、OOM 等记 infra_failed，绝不算被测系统失败。 */
interface ExecutionJob {
  executionId: string; track: "dsl" | "code"; tenantId: string; projectId: string;
  baseUrl: string; dslCase?: DslCase; specDir?: string; storageStatePath?: string;
  variables?: Record<string, string>;
}
/** 登录预设解析器（Week 3）：从 UIP_STORAGE_STATE_DIR 读加密的 storageState 文件，
 *  主密钥与 API 侧同一把（MASTER_KEY_B64）；未配主密钥时按明文 JSON 读（仅限本地 dev）。 */
function createPresetResolver(): LoginPresetResolver | undefined {
  const dir = process.env.UIP_STORAGE_STATE_DIR;
  if (!dir) return undefined;
  let crypto: AesGcmEnvelopeCrypto | undefined;
  try { crypto = AesGcmEnvelopeCrypto.fromEnv(); } catch { crypto = undefined; }
  return new LoginPresetResolver(new FilePresetStateSource(dir), {
    crypto,
    ttlSec: process.env.UIP_STORAGE_STATE_TTL_SEC ? Number(process.env.UIP_STORAGE_STATE_TTL_SEC) : undefined,
  });
}
const presetResolver = createPresetResolver();
const connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null });
const pool = new BrowserPool({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  maxSlots: Number(process.env.WORKER_CONCURRENCY ?? 4),
  maxContextsPerBrowser: Number(process.env.WORKER_MAX_CONTEXTS_PER_BROWSER ?? 20),
  maxExecutionsPerBrowser: Number(process.env.WORKER_MAX_EXECUTIONS_PER_BROWSER ?? 200),
});
async function handle(job: Job<ExecutionJob>) {
  const d = job.data;
  if (d.track === "code") {
    if (!d.specDir) throw new Error("code track job missing specDir");
    const result = await runCodeTrack({ executionId: d.executionId, specDir: d.specDir });
    console.log("[worker] code result", d.executionId, result.status); // TODO: 回写 API
    return result;
  }
  if (!d.dslCase) throw new Error("dsl track job missing dslCase");
  const v = validateDslCase(d.dslCase);
  if (!v.ok) throw new Error(`invalid DSL case: ${v.errors.join("; ")}`);
  // 建 context 时注入：job 带 storageStatePath（执行快照解析出的预设文件）就由浏览器池直接带登录态建 context，
  // 这是首选路径；DSL 里的 login_preset 步骤是跑到中途才需要登录态时的步骤级注入（见 dsl-runner）。
  const ctx = await pool.acquire(d.storageStatePath ? { storageState: d.storageStatePath } : undefined);
  try {
    const result = await runDslCase(ctx, d.dslCase, {
      baseUrl: d.baseUrl, variables: d.variables ?? {}, storageStatePath: d.storageStatePath,
      loginPresets: presetResolver,
      allowEvalJs: process.env.ALLOW_EVAL_JS === "true",
    }, d.executionId);
    console.log("[worker] dsl result", d.executionId, result.status); // TODO: 回写 API
    return result;
  } finally { await pool.release(ctx); }
}
if (require.main === module) {
  const w = new Worker("executions", handle, { connection, concurrency: Number(process.env.WORKER_CONCURRENCY ?? 4) });
  w.on("failed", (job, err) => console.error("[worker] job failed", job?.id, err.message));
  console.log("[worker] listening on queue: executions");
}
export { handle };
