import { Module } from "@nestjs/common";
import { HeartbeatAdminController, HeartbeatPingController } from "./heartbeat.controller";
import { HeartbeatNestService } from "./heartbeat.service";
@Module({
  controllers: [HeartbeatAdminController, HeartbeatPingController],
  providers: [HeartbeatNestService],
  exports: [HeartbeatNestService],
})
export class HeartbeatModule {}
