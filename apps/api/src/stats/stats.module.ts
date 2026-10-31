import { Module } from "@nestjs/common";
import { StatsController } from "./stats.controller";
import { StatsNestService } from "./stats.service";
@Module({ controllers: [StatsController], providers: [StatsNestService], exports: [StatsNestService] })
export class StatsModule {}
