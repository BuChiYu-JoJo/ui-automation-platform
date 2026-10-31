import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import type { ExecutionDispatchPayload, ExecutionDispatcher } from "../domain";
/** 执行队列生产者：调度器到期扫描 -> 以 (planId, scheduledAt) 幂等建 execution -> 入队。
 *  实现 ExecutionDispatcher 接口：UIP_DISPATCH=bullmq 时被 ExecutionService 选用（见 core.module.ts），
 *  连接懒初始化——未选用/Redis 未起时不产生连接噪音。
 *  TODO(scheduler): BullMQ Job Scheduler / 自研到期扫描任务；监控类错过不补跑，回归类可补跑一次。 */
@Injectable()
export class ExecutionQueueService implements ExecutionDispatcher, OnModuleDestroy {
  readonly mode = "bullmq";
  private connection?: IORedis;
  private queue?: Queue;
  private ensure() {
    if (!this.queue) {
      this.connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null });
      this.queue = new Queue("executions", { connection: this.connection });
    }
    return this.queue;
  }
  /** 原始入队（Worker 消费的 job 形状） */
  async enqueueExecution(payload: {
    executionId: string; track: "dsl" | "code"; tenantId: string; projectId: string;
    baseUrl: string; dslCase?: unknown; specDir?: string;
  }) {
    // jobId 用 executionId 天然防重复投递
    return this.ensure().add("execute", payload, { jobId: payload.executionId,
      attempts: 1, removeOnComplete: 1000, removeOnFail: 1000 });
  }
  /** ExecutionDispatcher 适配：dry-run 建 execution 后经此入队，Worker 端执行并回写 */
  async dispatch(payload: ExecutionDispatchPayload) {
    await this.enqueueExecution({
      executionId: payload.executionId, track: payload.track, tenantId: payload.tenantId,
      projectId: payload.projectId, baseUrl: payload.baseUrl, dslCase: payload.dslCase,
    });
  }
  async onModuleDestroy() { await this.queue?.close(); await this.connection?.quit(); }
}
