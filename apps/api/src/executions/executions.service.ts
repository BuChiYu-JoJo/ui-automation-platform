import { Inject, Injectable } from "@nestjs/common";
import { EXECUTION_SERVICE } from "../core.module";
import type { ExecutionService } from "../domain";
/** Nest 薄封装：业务逻辑在 domain/ExecutionService。 */
@Injectable()
export class ExecutionsService {
  constructor(@Inject(EXECUTION_SERVICE) readonly core: ExecutionService) {}
  ping() { return { module: "executions", status: "ok" }; }
}
