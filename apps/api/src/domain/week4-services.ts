import { lastCronFire } from "./cron";
import { notFound } from "./errors";
import type { Repositories } from "./repositories";
import type { MaintenanceChecker, StatsService } from "./week2-services";
import type { MaintenanceWindowRecord } from "./types";

/** Week 4：公开状态页服务（免登录、数据最小化）。
 *
 *  数据最小化口径（写死防扯皮）：返回里只有——项目展示名、各监控（plan）的展示状态、
 *  最近一次判定时间、30 天可用率、进行中 incident 的「监控名 + 开始时间 + 已持续秒数」。
 *  绝不返回：环境名/baseUrl、执行快照/变量、错误详情与 incident.summary、截图/trace 等产物引用、
 *  告警通道/webhook、租户 id、内部 id（planId/caseId/incidentId 一律不出）。
 *
 *  30 天可用率口径（近似，必须说清）：没有分钟桶时序数据（未上专用 TSDB，见 roadmap），
 *  这里用 incident 时长近似 downtime：
 *    downtime = 窗口内各 plan incident 的重叠时长之和 - 与维护窗口重叠的部分
 *    可用率   = (窗口总分钟 - 维护窗口总分钟 - downtime) / (窗口总分钟 - 维护窗口总分钟)
 *  近似的偏差来源：(1) incident 在连续失败达阈值后才打开，suspect 期与检测延迟不计 downtime（偏乐观）；
 *  (2) incident 按 plan 归属，heartbeat 型 incident 不计入 plan 可用率；
 *  (3) 维护窗口总分钟按窗口区间并集算（一次性 + 周期窗口展开），与 incident 的重叠按区间交集扣除。
 *  精确分钟桶口径要等 V1/V2 的时序层，届时替换本函数的 downtime 数据源即可。 */
export type PublicMonitorStatus = "up" | "suspect" | "down" | "maintenance";
export interface PublicMonitorView {
  name: string;
  status: PublicMonitorStatus;
  lastVerdictAt?: Date;
  uptime30dPct: number | null;
}
export interface PublicActiveIncident {
  monitorName: string;
  startedAt: Date;
  durationSec: number;
}
export interface PublicStatusPayload {
  projectName: string;
  overall: "operational" | "partial_outage" | "major_outage";
  generatedAt: Date;
  monitors: PublicMonitorView[];
  activeIncidents: PublicActiveIncident[];
}

const DAY_MS = 24 * 3600_000;
type Interval = { start: number; end: number };
const clip = (iv: Interval, lo: number, hi: number): Interval | null => {
  const start = Math.max(iv.start, lo), end = Math.min(iv.end, hi);
  return end > start ? { start, end } : null;
};
const overlapMs = (a: Interval, b: Interval) =>
  Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
/** 区间并集总时长（毫秒）：先排序再合并，避免重叠区间重复计。 */
function unionMs(intervals: Interval[]): number {
  const sorted = intervals.filter(i => i.end > i.start).sort((x, y) => x.start - y.start);
  let total = 0, cur: Interval | null = null;
  for (const iv of sorted) {
    if (!cur || iv.start > cur.end) { if (cur) total += cur.end - cur.start; cur = { ...iv }; }
    else cur.end = Math.max(cur.end, iv.end);
  }
  if (cur) total += cur.end - cur.start;
  return total;
}

export class PublicStatusService {
  constructor(
    private repos: Repositories,
    private stats: StatsService,
    private maintenance?: MaintenanceChecker,
  ) {}

  async getBySlug(slug: string, now: Date = new Date()): Promise<PublicStatusPayload> {
    const project = await this.repos.projects.findBySlugGlobal(slug);
    if (!project) throw notFound(`status page \"${slug}\" not found`);
    const tenantId = project.tenantId;
    // 展示状态复用 StatsService 的 displayStatus 口径（窗口中且非 down -> maintenance，已 down 不洗白）
    const overview = await this.stats.overview(tenantId, project.id, now);
    const nameByPlan = new Map(overview.monitors.map(m => [m.planId, m.caseName]));
    const incidents = (await this.repos.incidents.listByProject(tenantId, project.id))
      .filter(i => i.sourceType === "plan");
    const windows = await this.repos.maintenance.listByProject(tenantId, project.id);
    const windowStart = now.getTime() - 30 * DAY_MS;

    const monitors: PublicMonitorView[] = [];
    for (const m of overview.monitors) {
      const planWindows = windows.filter(w =>
        (w.scopeType === "plan" && w.scopeId === m.planId)
        || (w.scopeType === "project" && w.scopeId === project.id));
      const maintIntervals = this.maintenanceIntervals(planWindows, windowStart, now.getTime());
      const maintMs = unionMs(maintIntervals);
      let downtimeMs = 0;
      for (const inc of incidents) {
        if (inc.planId !== m.planId) continue;
        const iv = clip(
          { start: inc.startedAt.getTime(), end: (inc.resolvedAt ?? now).getTime() },
          windowStart, now.getTime());
        if (!iv) continue;
        let ms = iv.end - iv.start;
        for (const mw of maintIntervals) ms -= overlapMs(iv, mw);
        downtimeMs += Math.max(0, ms);
      }
      const denomMs = 30 * DAY_MS - maintMs;
      const uptime30dPct = denomMs > 0
        ? Math.round(((denomMs - downtimeMs) / denomMs) * 10000) / 100
        : null;
      monitors.push({
        name: m.caseName,
        status: m.displayStatus,
        lastVerdictAt: await this.lastVerdictAt(tenantId, m.planId, m.lastTransitionAt),
        uptime30dPct,
      });
    }

    const activeIncidents: PublicActiveIncident[] = incidents
      .filter(i => i.status !== "resolved")
      .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
      .map(i => ({
        monitorName: nameByPlan.get(i.planId) ?? "(unknown monitor)",
        startedAt: i.startedAt,
        durationSec: Math.max(0, Math.floor((now.getTime() - i.startedAt.getTime()) / 1000)),
      }));

    const downCount = monitors.filter(m => m.status === "down").length;
    const overall = monitors.length > 0 && downCount === monitors.length
      ? "major_outage" as const
      : downCount > 0 ? "partial_outage" as const
        : "operational" as const;
    return { projectName: project.name, overall, generatedAt: now, monitors, activeIncidents };
  }

  /** 最近判定时间：优先取该 plan 最近一条执行的完成时间，其次状态机最近迁移时间。 */
  private async lastVerdictAt(tenantId: string, planId: string, lastTransitionAt?: Date): Promise<Date | undefined> {
    const execs = await this.repos.executions.listByPlan(tenantId, planId);
    let latest: Date | undefined;
    for (const e of execs) {
      const at = e.finishedAt ?? e.createdAt;
      if (!latest || at > latest) latest = at;
    }
    if (latest) return latest;
    return lastTransitionAt;
  }

  /** 把维护窗口展开成 [lo, hi] 内的区间：一次性窗口直接取起止；周期窗口按 cron 触发点 + durationMinutes 逐个展开
   *  （用 lastCronFire 自 hi 向前回溯，上限 5000 个触发点防病态 cron 把展开打爆）。 */
  private maintenanceIntervals(windows: MaintenanceWindowRecord[], lo: number, hi: number): Interval[] {
    const out: Interval[] = [];
    for (const w of windows) {
      if (w.startsAt && w.endsAt) {
        const iv = clip({ start: w.startsAt.getTime(), end: w.endsAt.getTime() }, lo, hi);
        if (iv) out.push(iv);
        continue;
      }
      if (w.cronExpr && w.durationMinutes) {
        const durMs = w.durationMinutes * 60_000;
        let cursor = new Date(hi);
        for (let n = 0; n < 5000; n++) {
          const fire = lastCronFire(w.cronExpr, w.timezone, cursor);
          if (!fire || fire.getTime() + durMs <= lo) break;
          const iv = clip({ start: fire.getTime(), end: fire.getTime() + durMs }, lo, hi);
          if (iv) out.push(iv);
          cursor = new Date(fire.getTime() - 1);
        }
      }
    }
    return out;
  }
}
