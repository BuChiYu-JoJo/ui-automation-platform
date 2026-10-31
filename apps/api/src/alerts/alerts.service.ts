import { Inject, Injectable } from "@nestjs/common";
import { ALERT_DISPATCH_SERVICE, ALERT_RULE_SERVICE } from "../core.module";
import type { AlertDispatchService, AlertRuleService } from "../domain";
/** Nest 薄封装：业务逻辑在 domain/AlertRuleService + domain/AlertDispatchService。 */
@Injectable()
export class AlertsService {
  constructor(
    @Inject(ALERT_RULE_SERVICE) readonly core: AlertRuleService,
    @Inject(ALERT_DISPATCH_SERVICE) readonly dispatch: AlertDispatchService,
  ) {}
  ping() { return { module: "alerts", status: "ok" }; }
  /** 通道连通性测试：给该规则的每个通道发一条 test 消息，返回逐通道发送日志（target 已掩码）。 */
  async testSend(tenantId: string, ruleId: string) {
    const rule = await this.core.get(tenantId, ruleId);
    return this.dispatch.testSend(tenantId, rule);
  }
}
