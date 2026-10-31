/** 告警通道抽象。事件只在状态迁移时发（opened/recovered/escalated），不逐次失败刷屏。 */
export interface AlertEvent {
  kind: "opened" | "recovered" | "escalated" | "test";
  monitorName: string; environment: string;
  summary: string;                 // 含失败步骤/断言信息
  quorumDetail?: string;           // 如 "2/3 节点失败: A,B"
  screenshotUrl?: string; traceUrl?: string; executionUrl?: string;
  at: string;                      // ISO 时间
}
export interface NotifyResult { ok: boolean; status?: number; error?: string }
export interface Notifier {
  readonly channel: string;
  send(event: AlertEvent): Promise<NotifyResult>;
}
export function renderText(e: AlertEvent): string {
  const lines = [
    e.kind === "recovered" ? `✅ 已恢复: ${e.monitorName}` : `🔴 告警(${e.kind}): ${e.monitorName}`,
    `环境: ${e.environment}`, `详情: ${e.summary}`,
  ];
  if (e.quorumDetail) lines.push(`节点判定: ${e.quorumDetail}`);
  if (e.screenshotUrl) lines.push(`截图: ${e.screenshotUrl}`);
  if (e.traceUrl) lines.push(`Trace: ${e.traceUrl}`);
  if (e.executionUrl) lines.push(`执行详情: ${e.executionUrl}`);
  lines.push(`时间: ${e.at}`);
  return lines.join("\n");
}
async function postJson(url: string, body: unknown): Promise<NotifyResult> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const text = await res.text();
    // 飞书/企微均以业务 code 判断成功，HTTP 200 不等于送达
    let ok = res.ok;
    try { const j = JSON.parse(text); if (typeof j.code === "number") ok = ok && j.code === 0; if (typeof j.errcode === "number") ok = ok && j.errcode === 0; } catch {}
    return { ok, status: res.status, error: ok ? undefined : text.slice(0, 200) };
  } catch (err) { return { ok: false, error: String(err) }; }
}
/** 飞书群机器人 Webhook（text 消息）。加签场景请在网关层补 timestamp+sign，见官方文档当日规则。 */
export class FeishuNotifier implements Notifier {
  readonly channel = "feishu";
  constructor(private webhookUrl: string) {}
  send(e: AlertEvent) { return postJson(this.webhookUrl, { msg_type: "text", content: { text: renderText(e) } }); }
}
/** 企业微信群机器人 Webhook（text 消息，注意群机器人限频）。 */
export class WeComNotifier implements Notifier {
  readonly channel = "wecom";
  constructor(private webhookUrl: string) {}
  send(e: AlertEvent) { return postJson(this.webhookUrl, { msgtype: "text", text: { content: renderText(e) } }); }
}
/** 钉钉：stub —— TODO 加签（timestamp + HMAC-SHA256 sign）后按 markdown 消息发送。 */
export class DingTalkNotifier implements Notifier {
  readonly channel = "dingtalk";
  constructor(private webhookUrl: string, private secret?: string) {}
  async send(_e: AlertEvent): Promise<NotifyResult> { return { ok: false, error: "TODO: dingtalk signing not implemented" }; }
}
/** Email：stub —— TODO 接 SMTP（nodemailer），通道配置里存加密后的凭据引用。 */
export class EmailNotifier implements Notifier {
  readonly channel = "email";
  constructor(private to: string[]) {}
  async send(_e: AlertEvent): Promise<NotifyResult> { return { ok: false, error: "TODO: smtp not implemented" }; }
}
/** 通用 Webhook：把 AlertEvent 原样 POST 出去，供外部系统二次处理。 */
export class GenericWebhookNotifier implements Notifier {
  readonly channel = "webhook";
  constructor(private url: string) {}
  send(e: AlertEvent) { return postJson(this.url, e); }
}
