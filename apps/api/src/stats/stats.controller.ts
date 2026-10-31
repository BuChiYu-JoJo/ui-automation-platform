import { Controller, Get, Query, Req } from "@nestjs/common";
import type { ReqLike } from "../domain/tenant";
import { StatsNestService } from "./stats.service";
import { tenantOf } from "../domain/tenant";
/** 仪表盘统计（Week 2）：GET /stats/overview?projectId=
 *  成功率口径见 domain/StatsService：分母剔除 infra_failed 与未终态执行。 */
@Controller()
export class StatsController {
  constructor(private readonly svc: StatsNestService) {}
  @Get("stats/ping") ping() { return this.svc.ping(); }
  @Get("stats/overview") overview(@Req() req: ReqLike, @Query("projectId") projectId: string) {
    return this.svc.core.overview(tenantOf(req), projectId);
  }
  /** Week 4 Flaky 榜：GET /stats/flaky?projectId=&days=7（days 允许 1-30，缺省 7；非法值由领域层 400） */
  @Get("stats/flaky") flaky(@Req() req: ReqLike,
    @Query("projectId") projectId: string, @Query("days") days?: string) {
    return this.svc.core.flaky(tenantOf(req), projectId, days === undefined ? 7 : Number(days));
  }
}
