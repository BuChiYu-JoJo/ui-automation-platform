import { Inject, Injectable } from "@nestjs/common";
import { PLAN_SERVICE, SCHEDULER_SERVICE } from "../core.module";
import type { PlanService, SchedulerService } from "../domain";
/** Nest 薄封装：业务逻辑在 domain/PlanService 与 domain/SchedulerService。 */
@Injectable()
export class PlansService {
  constructor(
    @Inject(PLAN_SERVICE) readonly core: PlanService,
    @Inject(SCHEDULER_SERVICE) readonly scheduler: SchedulerService,
  ) {}
  ping() { return { module: "plans", status: "ok" }; }
}
