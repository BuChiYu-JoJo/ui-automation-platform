import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { ReqLike } from "../domain/tenant";
import { MaintenanceNestService } from "./maintenance.service";
import { actorOf, tenantOf } from "../domain/tenant";
/** 维护窗口（Week 3 真实现）：POST /maintenance-windows（scopeType+scopeId 在 body，projectId 由作用域推导）、
 *  GET /maintenance-windows?projectId=、GET/PATCH/DELETE /maintenance-windows/:id。
 *  窗口语义：窗口内执行照跑，但状态机不告警不开单、downtime 不计 SLA（见 domain/MaintenanceService 与 decisions）。 */
@Controller()
export class MaintenanceController {
  constructor(private readonly svc: MaintenanceNestService) {}
  @Get("maintenance/ping") ping() { return this.svc.ping(); }
  @Post("maintenance-windows") create(@Req() req: ReqLike, @Body() body: unknown) {
    return this.svc.core.create(tenantOf(req), body, actorOf(req));
  }
  @Get("maintenance-windows") list(@Req() req: ReqLike, @Query("projectId") projectId: string) {
    return this.svc.core.listByProject(tenantOf(req), projectId);
  }
  @Get("maintenance-windows/:id") getOne(@Req() req: ReqLike, @Param("id") id: string) {
    return this.svc.core.get(tenantOf(req), id);
  }
  @Patch("maintenance-windows/:id") update(
    @Req() req: ReqLike, @Param("id") id: string, @Body() body: unknown) {
    return this.svc.core.update(tenantOf(req), id, body);
  }
  @Delete("maintenance-windows/:id") remove(@Req() req: ReqLike, @Param("id") id: string) {
    return this.svc.core.remove(tenantOf(req), id);
  }
}
