import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from "@nestjs/common";
import type { ReqLike } from "../domain/tenant";
import { EnvironmentsService } from "./environments.service";
import { actorOf, tenantOf } from "../domain/tenant";
/** 环境与变量（Week 1 里程碑，真实 CRUD）：
 *  /api/projects/:projectId/environments  环境 CRUD（单默认规则在 domain 层）
 *  /api/environments/:envId/variables     变量 CRUD（密钥只进不出：DTO 恒为掩码，无明文/密文） */
@Controller()
export class EnvironmentsController {
  constructor(private readonly svc: EnvironmentsService) {}
  @Get("environments/ping") ping() { return this.svc.ping(); }

  @Post("projects/:projectId/environments") createEnv(
    @Req() req: ReqLike, @Param("projectId") projectId: string, @Body() body: unknown) {
    return this.svc.core.create(tenantOf(req), projectId, body);
  }
  @Get("projects/:projectId/environments") listEnv(@Req() req: ReqLike, @Param("projectId") projectId: string) {
    return this.svc.core.list(tenantOf(req), projectId);
  }
  @Get("environments/:id") getEnv(@Req() req: ReqLike, @Param("id") id: string) {
    return this.svc.core.get(tenantOf(req), id);
  }
  @Patch("environments/:id") updateEnv(@Req() req: ReqLike, @Param("id") id: string, @Body() body: unknown) {
    return this.svc.core.update(tenantOf(req), id, body);
  }
  @Delete("environments/:id") removeEnv(@Req() req: ReqLike, @Param("id") id: string) {
    return this.svc.core.remove(tenantOf(req), id);
  }

  @Post("environments/:envId/variables") upsertVar(
    @Req() req: ReqLike, @Param("envId") envId: string, @Body() body: unknown) {
    return this.svc.variables.upsert(tenantOf(req), envId, body, actorOf(req));
  }
  @Get("environments/:envId/variables") listVars(@Req() req: ReqLike, @Param("envId") envId: string) {
    return this.svc.variables.list(tenantOf(req), envId);
  }
  @Delete("environments/:envId/variables/:varId") removeVar(
    @Req() req: ReqLike, @Param("envId") envId: string, @Param("varId") varId: string) {
    return this.svc.variables.remove(tenantOf(req), envId, varId);
  }

  /** storageState 登录预设（Week 3）：POST 保存某角色的 storageState（加密落盘，只回引用不回内容）；
   *  GET .../:role 只回复用判定（fresh/missing/expired + needsLogin），state 本体永不经 API 出。 */
  @Post("environments/:envId/storage-state") saveState(
    @Req() req: ReqLike, @Param("envId") envId: string, @Body() body: unknown) {
    return this.svc.storageStates.save(tenantOf(req), envId, body);
  }
  @Get("environments/:envId/storage-state/:role") stateStatus(
    @Req() req: ReqLike, @Param("envId") envId: string, @Param("role") role: string) {
    return this.svc.storageStates.ensureStorageState(tenantOf(req), envId, role);
  }
}
