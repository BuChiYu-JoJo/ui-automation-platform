import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UnifiedExecution } from "@uip/shared";
import { parsePlaywrightJsonReport, type PwJsonReport } from "./reporter-parser";
/** 代码轨 runner：spec 以 文件夹约定 同步到本地（git sync 在 API 层，TODO），
 *  这里按约定目录 spawn `playwright test --reporter=json` 并把输出转统一模型。 */
export interface CodeRunRequest { executionId: string; specDir: string; grep?: string; }
export async function runCodeTrack(req: CodeRunRequest): Promise<UnifiedExecution> {
  const dir = await mkdtemp(join(tmpdir(), "uip-code-"));
  const outFile = join(dir, "report.json");
  const args = ["test", "--reporter=json"];
  if (req.grep) args.push("--grep", req.grep);
  const env = { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: outFile };
  const code = await new Promise<number | null>((resolve) => {
    const child = spawn("pnpm", ["exec", "playwright", ...args],
      { cwd: req.specDir, env, stdio: "pipe", shell: false });
    child.on("close", resolve); child.on("error", () => resolve(null));
  });
  // playwright 在有失败用例时退出码非 0，这不是 infra 失败 —— 以 reporter 文件为准
  let raw: string;
  try { raw = await readFile(outFile, "utf8"); }
  catch { try { raw = await readFile(join(req.specDir, "test-results.json"), "utf8"); }
    catch { throw new Error(`code-track: reporter output missing (exit=${code}) -> infra_failed`); } }
  await writeFile(join(dir, "raw.json"), raw).catch(() => {});
  return parsePlaywrightJsonReport(JSON.parse(raw) as PwJsonReport, req.executionId);
}
