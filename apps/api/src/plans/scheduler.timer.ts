import { Inject, Injectable, Optional, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { CLEANUP_SERVICE, HEARTBEAT_SERVICE, SCHEDULER_SERVICE } from "../core.module";
import type { ArtifactCleanupService, HeartbeatService, SchedulerService } from "../domain";

/** 真实定时器适配器（API 进程内）：每 30s 调一次 SchedulerService.tick。
 *  仅当 UIP_SCHEDULER_ENABLED=true 时启用（默认关，避免多实例 API 时重复调度；
 *  生产更推荐单实例调度进程或 BullMQ Job Scheduler，tick 是与载体无关的可测核心，见 domain/week2-services）。
 *  租户列表来自 UIP_TENANT_IDS（逗号分隔，默认 "default"）。
 *  Week 3 追加（同一开关下顺带跑，逻辑核心都在 domain 层可单测）：
 *  - 每轮 tick 后做 heartbeat 超时扫描（HeartbeatService.scanHeartbeats，宽限 x1.5）。
 *  - UIP_CLEANUP_ENABLED=true 时，每 24h 做一次产物过期实删（ArtifactCleanupService，进程内记 lastRun）。 */
@Injectable()
export class SchedulerTimer implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private lastCleanupAt = 0;
  constructor(
    @Inject(SCHEDULER_SERVICE) private readonly scheduler: SchedulerService,
    @Optional() @Inject(HEARTBEAT_SERVICE) private readonly heartbeats?: HeartbeatService,
    @Optional() @Inject(CLEANUP_SERVICE) private readonly cleanup?: ArtifactCleanupService,
  ) {}
  onModuleInit() {
    if (process.env.UIP_SCHEDULER_ENABLED !== "true") {
      console.log("[uip] scheduler timer disabled (set UIP_SCHEDULER_ENABLED=true to enable)");
      return;
    }
    const tenants = (process.env.UIP_TENANT_IDS ?? "default").split(",").map(s => s.trim()).filter(Boolean);
    const run = async () => {
      for (const t of tenants) {
        try {
          const r = await this.scheduler.tick(t, new Date());
          if (r.created.length || r.skipped.length || r.errors.length)
            console.log(`[uip] scheduler tick tenant=${t} created=${r.created.length} released=${r.released.length} skipped=${r.skipped.length} errors=${r.errors.length}`);
        } catch (err) {
          console.error(`[uip] scheduler tick failed tenant=${t}: ${err instanceof Error ? err.message : String(err)}`);
        }
        if (this.heartbeats) {
          try {
            const down = await this.heartbeats.scanHeartbeats(t, new Date());
            if (down.length) console.log(`[uip] heartbeat scan tenant=${t} newlyDown=${down.length}`);
          } catch (err) {
            console.error(`[uip] heartbeat scan failed tenant=${t}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }
      if (this.cleanup && process.env.UIP_CLEANUP_ENABLED === "true"
        && Date.now() - this.lastCleanupAt >= 24 * 3600_000) {
        this.lastCleanupAt = Date.now();
        for (const t of tenants) {
          try {
            const r = await this.cleanup.cleanupExpiredArtifacts(t, new Date());
            console.log(`[uip] artifact cleanup tenant=${t} expired=${r.expired} deleted=${r.deleted} errors=${r.errors.length}`);
          } catch (err) {
            console.error(`[uip] artifact cleanup failed tenant=${t}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }
    };
    this.timer = setInterval(run, 30_000);
    console.log(`[uip] scheduler timer enabled (every 30s, tenants=${tenants.join(",")})`);
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
}
