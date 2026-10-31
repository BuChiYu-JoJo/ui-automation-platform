import { Body, Controller, Get, Param, Post, Req } from "@nestjs/common";
import type { ReqLike } from "../domain/tenant";
import { CasesService } from "./cases.service";
import { actorOf, tenantOf } from "../domain/tenant";
/** 用例：POST /projects/:projectId/cases 建 DSL 用例即原子建 case_version v1；
 *  POST /projects/:projectId/cases/code 建代码轨用例（Week 2：sourceRef 指向 spec 文件夹约定）；
 *  GET /cases/:id 返回用例 + 最新版本；POST /cases/:id/versions 追加版本（version_no 递增）。
 *  dry-run 在 executions 模块：POST /cases/:id/dry-run。录制导入为后续里程碑。 */
@Controller()
export class CasesController {
  constructor(private readonly svc: CasesService) {}
  @Get("cases/ping") ping() { return this.svc.ping(); }
  @Post("projects/:projectId/cases") create(
    @Req() req: ReqLike, @Param("projectId") projectId: string, @Body() body: unknown) {
    return this.svc.core.createDslCase(tenantOf(req), projectId, body, actorOf(req));
  }
  @Post("projects/:projectId/cases/code") createCode(
    @Req() req: ReqLike, @Param("projectId") projectId: string, @Body() body: unknown) {
    return this.svc.core.createCodeCase(tenantOf(req), projectId, body, actorOf(req));
  }
  @Get("projects/:projectId/cases") list(@Req() req: ReqLike, @Param("projectId") projectId: string) {
    return this.svc.core.list(tenantOf(req), projectId);
  }
  @Get("cases/:id") getOne(@Req() req: ReqLike, @Param("id") id: string) {
    return this.svc.core.get(tenantOf(req), id);
  }
  @Post("cases/:id/versions") addVersion(
    @Req() req: ReqLike, @Param("id") id: string, @Body() body: unknown) {
    return this.svc.core.addVersion(tenantOf(req), id, body, actorOf(req));
  }
}
