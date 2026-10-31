import { Module } from "@nestjs/common";
import { PlansController } from "./plans.controller";
import { PlansService } from "./plans.service";
import { SchedulerTimer } from "./scheduler.timer";
@Module({ controllers: [PlansController], providers: [PlansService, SchedulerTimer], exports: [PlansService] })
export class PlansModule {}
