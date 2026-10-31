import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { ReqLike } from "../domain/tenant";
import { AlertsService } from "./alerts.service";
import { tenantOf } from "../domain/tenant";
/** 告警规则（Week 2 真实现）：CRUD /alert-rules（?projectId= 列表）。
 *  通道 target（webhook URL，含 token）按密钥处理：落库信封加密，响应只回 scheme+host 掩码。 */
@Controller()
export class AlertsController {
  constructor(private readonly svc: AlertsService) {}
  @Get("alerts/ping") ping() { return this.svc.ping(); }
  @Post("alert-rules") create(@Req() req: ReqLike, @Body() body: unknown) {
    return this.svc.core.create(tenantOf(req), body);
  }
  @Get("alert-rules") list(@Req() req: ReqLike, @Query("projectId") projectId: string) {
    return this.svc.core.listByProject(tenantOf(req), projectId);
  }
  @Get("alert-rules/:id") getOne(@Req() req: ReqLike, @Param("id") id: string) {
    return this.svc.core.getDto(tenantOf(req), id);
  }
  @Patch("alert-rules/:id") update(@Req() req: ReqLike, @Param("id") id: string, @Body() body: unknown) {
    return this.svc.core.update(tenantOf(req), id, body);
  }
  @Delete("alert-rules/:id") remove(@Req() req: ReqLike, @Param("id") id: string) {
    return this.svc.core.remove(tenantOf(req), id);
  }
  /** 通道连通性测试发送（验收真飞书/企微 webhook 用）：POST /alert-rules/:id/test-send */
  @Post("alert-rules/:id/test-send") testSend(@Req() req: ReqLike, @Param("id") id: string) {
    return this.svc.testSend(tenantOf(req), id);
  }
}
