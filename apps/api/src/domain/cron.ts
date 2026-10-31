/** 严格 5 段 cron（分 时 日 月 周）解析/校验/触发点计算。
 *  不引入新依赖：cron-parser 虽在依赖树里（BullMQ 传递依赖），但不是 api 的直接依赖，
 *  直接 import 传递依赖不可靠；监控场景的 cron 语义简单，自研可控且可单测。
 *  语义与 Vixie cron 一致：dom 与 dow 同时受限时取「或」（任一匹配即触发）。
 *  触发点按计划时区的墙钟时间对齐（分钟粒度）。 */
export interface CronSchedule {
  minute: Set<number>; hour: Set<number>; dom: Set<number>; month: Set<number>; dow: Set<number>;
  domRestricted: boolean; dowRestricted: boolean;
}
const FIELD_RANGES: [string, number, number][] = [
  ["minute", 0, 59], ["hour", 0, 23], ["dom", 1, 31], ["month", 1, 12], ["dow", 0, 7],
];
function parseField(field: string, min: number, max: number, name: string): Set<number> {
  const out = new Set<number>();
  for (const part of field.split(",")) {
    const m = /^(\*|\d+)(?:-(\d+))?(?:\/(\d+))?$/.exec(part);
    if (!m) throw new Error(`${name} 字段非法: "${part}"`);
    const step = m[3] ? Number(m[3]) : 1;
    if (step < 1) throw new Error(`${name} 字段步长必须 >= 1: "${part}"`);
    let lo: number, hi: number;
    if (m[1] === "*") { lo = min; hi = max; }
    else if (m[2] !== undefined) { lo = Number(m[1]); hi = Number(m[2]); }
    else { lo = Number(m[1]); hi = m[3] ? max : lo; }
    if (lo < min || hi > max || lo > hi)
      throw new Error(`${name} 字段超出范围 ${min}-${max}: "${part}"`);
    for (let v = lo; v <= hi; v += step) out.add(name === "dow" && v === 7 ? 0 : v);
  }
  if (!out.size) throw new Error(`${name} 字段为空`);
  return out;
}
export function parseCron(expr: string): CronSchedule {
  const fields = (expr ?? "").trim().split(/\s+/);
  if (fields.length !== 5)
    throw new Error(`cron 必须是 5 段 (分 时 日 月 周)，收到 ${fields.length} 段: "${expr}"`);
  const sets = fields.map((f, i) => parseField(f, FIELD_RANGES[i][1], FIELD_RANGES[i][2], FIELD_RANGES[i][0]));
  return {
    minute: sets[0], hour: sets[1], dom: sets[2], month: sets[3], dow: sets[4],
    domRestricted: fields[2] !== "*", dowRestricted: fields[4] !== "*",
  };
}
export function validateCron(expr: string): { ok: true } | { ok: false; error: string } {
  try { parseCron(expr); return { ok: true }; }
  catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}
export function isValidTimezone(tz: string): boolean {
  if (typeof tz !== "string" || !tz) return false;
  // 以 DateTimeFormat 构造是否抛 RangeError 为准：supportedValuesOf 的清单在不同 Node/ICU 构建下
  // 可能不含 "UTC" 等合法值（实测 Node 24 此机即如此），不能拿它做唯一判据。
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; }
  catch { return false; }
}
const DOW_MAP: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const fmtCache = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", weekday: "short",
      year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric",
    });
    fmtCache.set(tz, f);
  }
  return f;
}
interface WallParts { minute: number; hour: number; dom: number; month: number; dow: number }
function wallParts(instant: Date, tz: string): WallParts {
  const parts = formatter(tz).formatToParts(instant);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? "";
  return {
    minute: Number(get("minute")), hour: Number(get("hour")) % 24,
    dom: Number(get("day")), month: Number(get("month")), dow: DOW_MAP[get("weekday")] ?? 0,
  };
}
export function cronMatches(sched: CronSchedule, instant: Date, tz: string): boolean {
  const w = wallParts(instant, tz);
  if (!sched.minute.has(w.minute) || !sched.hour.has(w.hour) || !sched.month.has(w.month)) return false;
  const domOk = sched.dom.has(w.dom), dowOk = sched.dow.has(w.dow);
  if (sched.domRestricted && sched.dowRestricted) return domOk || dowOk;
  if (sched.domRestricted) return domOk;
  if (sched.dowRestricted) return dowOk;
  return true;
}
/** 扫描上限：40 天。监控类 cron 的间隔远小于此；更稀疏的计划（如每月一次且刚错过）超出 MVP 范围，会在下个窗口被扫到。 */
const MAX_SCAN_MINUTES = 40 * 24 * 60;
const floorMinute = (d: Date) => { const x = new Date(d); x.setUTCSeconds(0, 0); return x; };
/** <= at 的最近一个触发点；若给出 notBeforeExclusive，结果必须严格晚于它（调度游标，防同一触发点重复建单）。 */
export function lastCronFire(expr: string, tz: string, at: Date, notBeforeExclusive?: Date): Date | null {
  const sched = parseCron(expr);
  let t = floorMinute(at);
  for (let i = 0; i < MAX_SCAN_MINUTES; i++) {
    if (notBeforeExclusive && t.getTime() <= notBeforeExclusive.getTime()) return null;
    if (cronMatches(sched, t, tz)) return t;
    t = new Date(t.getTime() - 60_000);
  }
  return null;
}
/** > after 的下一个触发点（UI 展示 nextRun 用）。 */
export function nextCronFire(expr: string, tz: string, after: Date): Date | null {
  const sched = parseCron(expr);
  let t = new Date(floorMinute(after).getTime() + 60_000);
  for (let i = 0; i < MAX_SCAN_MINUTES; i++) {
    if (cronMatches(sched, t, tz)) return t;
    t = new Date(t.getTime() + 60_000);
  }
  return null;
}
