import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from "@nestjs/common";
import type { ReqLike } from "../domain/tenant";
import { PlansService } from "./plans.service";
import { tenantOf } from "../domain/tenant";
/** 计划（Week 2 真实现）：POST /projects/:projectId/plans（caseId 在 body，projectId 由用例推导）、
 *  CRUD /plans、POST /plans/:id/enable|disable、POST /plans/:id/run-now（立即按最新触发点 tick 一次该计划所在租户，
 *  主要供联调/演示；常规定时由 SchedulerTimer 或 BullMQ Job Scheduler 驱动 tick）。 */
@Controller()
export class PlansController {
  constructor(private readonly svc: PlansService) {}
  @Get("plans/ping") ping() { return this.svc.ping(); }
  @Post("projects/:projectId/plans") create(@Req() req: ReqLike, @Body() body: unknown) {
    return this.svc.core.create(tenantOf(req), body);
  }
  @Get("projects/:projectId/plans") list(@Req() req: ReqLike, @Param("projectId") projectId: string) {
    return this.svc.core.listByProject(tenantOf(req), projectId);
  }
  @Get("plans/:id") getOne(@Req() req: ReqLike, @Param("id") id: string) {
    return this.svc.core.get(tenantOf(req), id);
  }
  @Patch("plans/:id") update(@Req() req: ReqLike, @Param("id") id: string, @Body() body: unknown) {
    return this.svc.core.update(tenantOf(req), id, body);
  }
  @Delete("plans/:id") remove(@Req() req: ReqLike, @Param("id") id: string) {
    return this.svc.core.remove(tenantOf(req), id);
  }
  @Post("plans/:id/enable") enable(@Req() req: ReqLike, @Param("id") id: string) {
    return this.svc.core.setEnabled(tenantOf(req), id, true);
  }
  @Post("plans/:id/disable") disable(@Req() req: ReqLike, @Param("id") id: string) {
    return this.svc.core.setEnabled(tenantOf(req), id, false);
  }
  @Post("plans/:id/run-now") runNow(@Req() req: ReqLike, @Param("id") _id: string) {
    return this.svc.scheduler.tick(tenantOf(req), new Date());
  }
}
