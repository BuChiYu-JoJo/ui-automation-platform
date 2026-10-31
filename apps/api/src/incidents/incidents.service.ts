import { Inject, Injectable } from "@nestjs/common";
import { INCIDENT_SERVICE, MONITOR_SERVICE } from "../core.module";
import type { IncidentService, MonitorStateService } from "../domain";
/** Nest 薄封装：业务逻辑在 domain/IncidentService 与 domain/MonitorStateService。 */
@Injectable()
export class IncidentsService {
  constructor(
    @Inject(INCIDENT_SERVICE) readonly core: IncidentService,
    @Inject(MONITOR_SERVICE) readonly monitors: MonitorStateService,
  ) {}
  ping() { return { module: "incidents", status: "ok" }; }
}
