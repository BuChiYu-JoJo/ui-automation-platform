/** API client：统一 baseURL/鉴权头/错误形态。租户/操作者骨架阶段走 header（见 api domain/tenant.ts）。 */
const base = import.meta.env.VITE_API_BASE ?? "/api";
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = localStorage.getItem("uip_token");
  const res = await fetch(`${base}${path}`, { ...init,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...init?.headers } });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}
export interface ProjectLite { id: string; name: string; slug: string }
export const projectsApi = {
  list: () => api<ProjectLite[]>("/projects"),
};
export interface EnrichedExecution {
  execution: {
    id: string; projectId: string; planId?: string; status: string; triggerType: string;
    region?: string; durationMs?: number; createdAt: string; finishedAt?: string;
  };
  track: "dsl" | "code";
  caseName: string;
}
export const executionsApi = {
  /** 双轨统一列表：每条带 track + caseName */
  list: (projectId: string) => api<EnrichedExecution[]>(`/executions?projectId=${encodeURIComponent(projectId)}`),
};
export interface MonitorStatusView {
  planId: string; caseId: string; caseName: string;
  status: "up" | "suspect" | "down";
  /** 展示口径（Week 3）：维护窗口中且非 down 时为 maintenance，原始 status 不变 */
  displayStatus: "up" | "suspect" | "down" | "maintenance";
  inMaintenance: boolean;
  consecutiveFailures: number; flakyCount: number; infraCount: number; lastTransitionAt?: string;
}
export interface OverviewStats {
  projectId: string; todayTotal: number; todayFinished: number;
  successRate: number | null; downCount: number; maintenanceCount: number;
  monitors: MonitorStatusView[];
  recentFailures: {
    executionId: string; caseName: string; planId?: string; track: "dsl" | "code";
    status: string; finishedAt?: string; durationMs?: number;
  }[];
}
export interface FlakyCaseStat {
  caseId: string; caseName: string; planId?: string;
  totalTerminal: number; passed: number; flaky: number; failed: number; timeout: number;
  flakyRate: number; lastFlakyAt?: string; maxConsecutiveFlaky: number;
  quarantineSuggested: boolean; quarantineReason?: string;
}
export interface FlakyStats {
  projectId: string; windowDays: number; generatedAt: string; items: FlakyCaseStat[];
}
export const statsApi = {
  overview: (projectId: string) => api<OverviewStats>(`/stats/overview?projectId=${encodeURIComponent(projectId)}`),
  flaky: (projectId: string, days = 7) =>
    api<FlakyStats>(`/stats/flaky?projectId=${encodeURIComponent(projectId)}&days=${days}`),
};
/** 公开状态页（Week 4）：免登录接口，不带任何鉴权头；载荷已在后端做数据最小化。 */
export interface PublicMonitorView {
  name: string; status: "up" | "suspect" | "down" | "maintenance";
  lastVerdictAt?: string; uptime30dPct: number | null;
}
export interface PublicStatusPayload {
  projectName: string;
  overall: "operational" | "partial_outage" | "major_outage";
  generatedAt: string;
  monitors: PublicMonitorView[];
  activeIncidents: { monitorName: string; startedAt: string; durationSec: number }[];
}
export const publicStatusApi = {
  get: async (slug: string): Promise<PublicStatusPayload> => {
    const res = await fetch(`${base}/public/status/${encodeURIComponent(slug)}`);
    if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
    return res.json() as Promise<PublicStatusPayload>;
  },
};
