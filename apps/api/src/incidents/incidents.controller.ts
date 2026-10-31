import { Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import type { ReqLike } from "../domain/tenant";
import { IncidentsService } from "./incidents.service";
import { actorOf, tenantOf } from "../domain/tenant";
/** 事件（Week 2 真实现）：GET /incidents?projectId=、GET /incidents/:id、POST /incidents/:id/ack。
 *  resolve 由监控状态机在 recovered 时自动完成（不开放手动 resolve 接口，防口径漂移）。
 *  另有 GET /monitors?projectId= 返回各 plan 的当前监控状态（含迁移计数）。 */
@Controller()
export class IncidentsController {
  constructor(private readonly svc: IncidentsService) {}
  @Get("incidents/ping") ping() { return this.svc.ping(); }
  @Get("incidents") list(@Req() req: ReqLike, @Query("projectId") projectId: string) {
    return this.svc.core.listByProject(tenantOf(req), projectId);
  }
  @Get("incidents/:id") getOne(@Req() req: ReqLike, @Param("id") id: string) {
    return this.svc.core.get(tenantOf(req), id);
  }
  @Post("incidents/:id/ack") ack(@Req() req: ReqLike, @Param("id") id: string) {
    return this.svc.core.ack(tenantOf(req), id, actorOf(req));
  }
  @Get("monitors") monitors(@Req() req: ReqLike, @Query("projectId") projectId: string) {
    return this.svc.monitors.listByProject(tenantOf(req), projectId);
  }
}
