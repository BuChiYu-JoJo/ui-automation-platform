import { Controller, Get, HttpException, Param, Req } from "@nestjs/common";
import { StatusService } from "./status.service";

/** 公开状态页（Week 4）：GET /api/public/status/:slug —— 免登录、只读、数据最小化
 *  （载荷口径见 domain/PublicStatusService 文件头：无环境/快照/错误详情/产物/webhook）。
 *  限流：进程内 per-IP 固定窗口 60 次/分钟——只防误刷，生产应在网关层限流（见 TODO）。
 *  TODO(gateway-ratelimit): 上线时把限流下沉到 Nginx/API 网关，进程内计数多实例不共享。 */
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 60;
const hits = new Map<string, { count: number; resetAt: number }>();
function rateLimit(ip: string, now = Date.now()): void {
  const cur = hits.get(ip);
  if (!cur || now >= cur.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  cur.count += 1;
  if (cur.count > MAX_PER_WINDOW) throw new HttpException("Too Many Requests", 429);
  if (hits.size > 10_000) { // 防 map 无限增长：粗暴清理过期键（状态页流量不大，够用）
    for (const [k, v] of hits) if (now >= v.resetAt) hits.delete(k);
  }
}

interface ReqIpLike { ip?: string; headers: Record<string, string | string[] | undefined> }

@Controller("public/status")
export class StatusController {
  constructor(private readonly svc: StatusService) {}
  @Get("ping") ping() { return this.svc.ping(); }
  @Get(":slug")
  getPublicStatus(@Req() req: ReqIpLike, @Param("slug") slug: string) {
    rateLimit(req.ip ?? "unknown");
    return this.svc.core.getBySlug(slug);
  }
}
