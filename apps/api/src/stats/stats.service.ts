import { Inject, Injectable } from "@nestjs/common";
import { STATS_SERVICE } from "../core.module";
import type { StatsService } from "../domain";
/** Nest 薄封装：业务逻辑在 domain/StatsService。 */
@Injectable()
export class StatsNestService {
  constructor(@Inject(STATS_SERVICE) readonly core: StatsService) {}
  ping() { return { module: "stats", status: "ok" }; }
}
