import { Inject, Injectable } from "@nestjs/common";
import { PUBLIC_STATUS_SERVICE } from "../core.module";
import type { PublicStatusService } from "../domain";
/** Nest 薄封装：业务逻辑在 domain/PublicStatusService（数据最小化口径见该文件头）。 */
@Injectable()
export class StatusService {
  constructor(@Inject(PUBLIC_STATUS_SERVICE) readonly core: PublicStatusService) {}
  ping() { return { module: "status", status: "ok" }; }
}
