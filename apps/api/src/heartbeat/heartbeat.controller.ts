import { All, Body, Controller, Delete, Get, Param, Post, Req } from "@nestjs/common";
import type { ReqLike } from "../domain/tenant";
import { HeartbeatNestService } from "./heartbeat.service";
import { tenantOf } from "../domain/tenant";
/** Heartbeat 管理面（Week 3 真实现）：
 *  POST /projects/:projectId/heartbeats 建监控——响应里的 token 只出现这一次，之后只能重置（删了重建）；
 *  GET 列表只回 tokenPrefix；DELETE 删除。 */
@Controller()
export class HeartbeatAdminController {
  constructor(private readonly svc: HeartbeatNestService) {}
  @Get("heartbeat/ping") ping() { return this.svc.ping(); }
  @Post("projects/:projectId/heartbeats") create(
    @Req() req: ReqLike, @Param("projectId") projectId: string, @Body() body: unknown) {
    return this.svc.core.create(tenantOf(req), projectId, body);
  }
  @Get("projects/:projectId/heartbeats") list(
    @Req() req: ReqLike, @Param("projectId") projectId: string) {
    return this.svc.core.list(tenantOf(req), projectId);
  }
  @Delete("projects/:projectId/heartbeats/:id") remove(
    @Req() req: ReqLike, @Param("projectId") projectId: string, @Param("id") id: string) {
    return this.svc.core.remove(tenantOf(req), projectId, id);
  }
}
/** Heartbeat 打点面：ANY /heartbeat/:token —— 任意方法都算一次打点（被监控方用 GET cron / POST 都行）。
 *  鉴权就是 token 本身：token 是被监控方与平台的共享秘密，因此不需要也不接受租户 header
 *  （租户由 token 哈希反查）；未知 token 统一 404 防枚举。 */
@Controller("heartbeat")
export class HeartbeatPingController {
  constructor(private readonly svc: HeartbeatNestService) {}
  @All(":token") ping(@Param("token") token: string) {
    return this.svc.core.ping(token);
  }
}
