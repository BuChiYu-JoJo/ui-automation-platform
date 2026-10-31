import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import type { ReqLike } from "../domain/tenant";
import { ExecutionsService } from "./executions.service";
import { tenantOf } from "../domain/tenant";
/** 执行（Week 1 最小）：POST /cases/:id/dry-run 建 execution(queued, 绑最新版本) 并分发
 *  （BullMQ 或进程内，见 core.module 分发选择）；GET /executions/:id 返回 execution + step_results + artifacts。
 *  cancel/rerun、产物签名 URL 为后续里程碑。 */
@Controller()
export class ExecutionsController {
  constructor(private readonly svc: ExecutionsService) {}
  @Get("executions/ping") ping() { return this.svc.ping(); }
  @Post("cases/:id/dry-run") dryRun(@Req() req: ReqLike, @Param("id") id: string, @Body() body: unknown) {
    return this.svc.core.dryRun(tenantOf(req), id, body);
  }
  /** 双轨统一列表：每条带 track(dsl|code) + caseName（Week 2） */
  @Get("executions") list(@Req() req: ReqLike, @Query("projectId") projectId: string) {
    return this.svc.core.listEnriched(tenantOf(req), projectId);
  }
  @Get("executions/:id") getOne(@Req() req: ReqLike, @Param("id") id: string) {
    return this.svc.core.getDetail(tenantOf(req), id);
  }
}
