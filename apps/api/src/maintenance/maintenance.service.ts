import { Inject, Injectable } from "@nestjs/common";
import { MAINTENANCE_SERVICE } from "../core.module";
import type { MaintenanceService } from "../domain";
/** Nest 薄封装：业务逻辑在 domain/MaintenanceService。 */
@Injectable()
export class MaintenanceNestService {
  constructor(@Inject(MAINTENANCE_SERVICE) readonly core: MaintenanceService) {}
  ping() { return { module: "maintenance", status: "ok" }; }
}
