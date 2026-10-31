import { Module } from "@nestjs/common";
import { MaintenanceController } from "./maintenance.controller";
import { MaintenanceNestService } from "./maintenance.service";
@Module({
  controllers: [MaintenanceController],
  providers: [MaintenanceNestService],
  exports: [MaintenanceNestService],
})
export class MaintenanceModule {}
