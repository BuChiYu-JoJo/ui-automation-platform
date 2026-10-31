import { Inject, Injectable } from "@nestjs/common";
import { HEARTBEAT_SERVICE } from "../core.module";
import type { HeartbeatService } from "../domain";
/** Nest 薄封装：业务逻辑在 domain/HeartbeatService（token 哈希、超时扫描、恢复关单）。 */
@Injectable()
export class HeartbeatNestService {
  constructor(@Inject(HEARTBEAT_SERVICE) readonly core: HeartbeatService) {}
  ping() { return { module: "heartbeat", status: "ok" }; }
}
