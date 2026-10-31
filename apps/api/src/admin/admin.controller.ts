import { Controller, Get, Post, Query, Req } from "@nestjs/common";
import type { ReqLike } from "../domain/tenant";
import { AdminService } from "./admin.service";
import { tenantOf } from "../domain/tenant";
/** 管理端点（Week 3）：POST /admin/artifacts/cleanup?dryRun=true 只报将删清单不真删；
 *  不带 dryRun 时实删（先删存储对象，成功才软删记录）。定时跑法见 SchedulerTimer
 *  （UIP_CLEANUP_ENABLED=true 时每日一次实删）。TODO(admin-auth): 接入管理员鉴权前禁止对公网暴露。 */
@Controller()
export class AdminController {
  constructor(private readonly svc: AdminService) {}
  @Get("admin/ping") ping() { return this.svc.ping(); }
  @Post("admin/artifacts/cleanup") cleanup(
    @Req() req: ReqLike, @Query("dryRun") dryRun?: string) {
    return this.svc.cleanup.cleanupExpiredArtifacts(tenantOf(req), new Date(),
      { dryRun: dryRun === "true" });
  }
}
