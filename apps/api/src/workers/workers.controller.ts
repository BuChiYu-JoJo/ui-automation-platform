import { Body, Controller, Get, Param, Post, Req } from "@nestjs/common";
import type { ReqLike } from "../domain/tenant";
import { WorkersService } from "./workers.service";
import { tenantOf } from "../domain/tenant";
/** Worker 节点（Week 3 真实现）：
 *  POST /workers/register 注册节点（注册即首跳，上线即 online）；
 *  POST /workers/:id/heartbeat 心跳上报槽位/版本（>60s 无心跳派生 offline）；
 *  GET /workers 节点列表（含派生状态与空闲槽位）。
 *  TODO(worker-auth): 接入节点 token 前禁止对公网暴露（当前与其它内部接口一样靠部署边界）。 */
@Controller()
export class WorkersController {
  constructor(private readonly svc: WorkersService) {}
  @Get("workers/ping") ping() { return this.svc.ping(); }
  @Post("workers/register") register(@Req() req: ReqLike, @Body() body: unknown) {
    return this.svc.core.register(tenantOf(req), body);
  }
  @Post("workers/:id/heartbeat") heartbeat(
    @Req() req: ReqLike, @Param("id") id: string, @Body() body: unknown) {
    return this.svc.core.heartbeat(tenantOf(req), id, body);
  }
  @Get("workers") list(@Req() req: ReqLike) {
    return this.svc.core.list(tenantOf(req));
  }
  @Get("workers/:id") getOne(@Req() req: ReqLike, @Param("id") id: string) {
    return this.svc.core.get(tenantOf(req), id);
  }
}
