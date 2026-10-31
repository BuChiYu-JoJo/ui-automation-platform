import { Inject, Injectable } from "@nestjs/common";
import { WORKER_NODE_SERVICE } from "../core.module";
import type { WorkerNodeService } from "../domain";
/** Nest 薄封装：业务逻辑在 domain/WorkerNodeService（注册/心跳/在线派生）。 */
@Injectable()
export class WorkersService {
  constructor(@Inject(WORKER_NODE_SERVICE) readonly core: WorkerNodeService) {}
  ping() { return { module: "workers", status: "ok" }; }
}
