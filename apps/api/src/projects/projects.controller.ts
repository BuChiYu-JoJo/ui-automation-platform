import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from "@nestjs/common";
import type { ReqLike } from "../domain/tenant";
import { ProjectsService } from "./projects.service";
import { actorOf, tenantOf } from "../domain/tenant";
/** /api/projects：真实 CRUD（Week 1 里程碑）。租户来自 x-tenant-id（骨架阶段，见 domain/tenant.ts）。 */
@Controller("projects")
export class ProjectsController {
  constructor(private readonly svc: ProjectsService) {}
  @Get("ping") ping() { return this.svc.ping(); }
  @Post() create(@Req() req: ReqLike, @Body() body: unknown) {
    return this.svc.core.create(tenantOf(req), { ...(body as object), ownerId: actorOf(req) });
  }
  @Get() list(@Req() req: ReqLike) { return this.svc.core.list(tenantOf(req)); }
  @Get(":id") getOne(@Req() req: ReqLike, @Param("id") id: string) {
    return this.svc.core.get(tenantOf(req), id);
  }
  @Patch(":id") update(@Req() req: ReqLike, @Param("id") id: string, @Body() body: unknown) {
    return this.svc.core.update(tenantOf(req), id, body);
  }
  @Delete(":id") remove(@Req() req: ReqLike, @Param("id") id: string) {
    return this.svc.core.softDelete(tenantOf(req), id);
  }
}
