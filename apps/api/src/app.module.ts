import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { AuthModule } from "./auth/auth.module";
import { ProjectsModule } from "./projects/projects.module";
import { EnvironmentsModule } from "./environments/environments.module";
import { CasesModule } from "./cases/cases.module";
import { PlansModule } from "./plans/plans.module";
import { ExecutionsModule } from "./executions/executions.module";
import { AlertsModule } from "./alerts/alerts.module";
import { IncidentsModule } from "./incidents/incidents.module";
import { WorkersModule } from "./workers/workers.module";
import { StatusModule } from "./status/status.module";
import { HeartbeatModule } from "./heartbeat/heartbeat.module";
import { StatsModule } from "./stats/stats.module";
import { MaintenanceModule } from "./maintenance/maintenance.module";
import { AdminModule } from "./admin/admin.module";
import { CoreModule } from "./core.module";
import { DomainExceptionFilter } from "./domain/domain-exception.filter";
@Module({
  imports: [CoreModule, AuthModule, ProjectsModule, EnvironmentsModule, CasesModule, PlansModule, ExecutionsModule, AlertsModule, IncidentsModule, WorkersModule, StatusModule, HeartbeatModule, StatsModule, MaintenanceModule, AdminModule],
  providers: [{ provide: APP_FILTER, useClass: DomainExceptionFilter }],
})
export class AppModule {}
