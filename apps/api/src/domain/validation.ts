import { z } from "zod";
import { dslCaseSchema } from "@uip/dsl";
import { badRequest } from "./errors";
import { isValidTimezone, validateCron } from "./cron";

/** DTO 校验：全部走 zod（已在依赖树中，@uip/dsl 同款），失败统一转 DomainError(400) 并带字段级信息。 */
export function parseOr400<S extends z.ZodTypeAny>(schema: S, input: unknown, label: string): z.output<S> {
  const r = schema.safeParse(input);
  if (!r.success)
    throw badRequest(`${label} 校验失败: ${r.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
  return r.data;
}
const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/, "slug 只能含小写字母/数字/连字符，且以字母或数字开头");
export const createProjectDto = z.object({
  name: z.string().min(1).max(120),
  slug,
  description: z.string().max(500).optional(),
  ownerId: z.string().min(1).default("demo-user"),
});
export const updateProjectDto = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).optional(),
}).refine(o => Object.keys(o).length > 0, { message: "至少提供一个要更新的字段" });
const httpUrl = z.string().url("baseUrl 必须是合法 URL").refine(
  u => u.startsWith("http://") || u.startsWith("https://"), { message: "baseUrl 只允许 http/https" });
export const createEnvironmentDto = z.object({
  name: z.string().min(1).max(60),
  baseUrl: httpUrl,
  browserConfig: z.record(z.unknown()).optional(),
  isDefault: z.boolean().optional(),
});
export const updateEnvironmentDto = z.object({
  name: z.string().min(1).max(60).optional(),
  baseUrl: httpUrl.optional(),
  browserConfig: z.record(z.unknown()).optional(),
  isDefault: z.boolean().optional(),
}).refine(o => Object.keys(o).length > 0, { message: "至少提供一个要更新的字段" });
export const upsertVariableDto = z.object({
  key: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "变量名只能含字母/数字/下划线且不以数字开头"),
  value: z.string().min(1, "value 不能为空"),
  isSecret: z.boolean().default(false),
  kind: z.enum(["variable", "storage_state", "totp_seed"]).default("variable"),
});
export const createDslCaseDto = z.object({
  name: z.string().min(1).max(120),
  tags: z.array(z.string().max(40)).default([]),
  ownerId: z.string().optional(),
  dsl: dslCaseSchema,
  changeNote: z.string().max(500).optional(),
});
export const createCaseVersionDto = z.object({
  dsl: dslCaseSchema,
  changeNote: z.string().max(500).optional(),
});
export const dryRunDto = z.object({
  environmentId: z.string().min(1),
  triggerType: z.enum(["manual", "ci", "schedule"]).default("manual"),
});
// ---------------- Week 2 ----------------
export const createCodeCaseDto = z.object({
  name: z.string().min(1).max(120),
  /** 代码轨 spec 文件夹约定：相对 UIP_CODE_CASES_DIR 的目录名，或仓库内相对路径；禁止 .. 穿越 */
  sourceRef: z.string().min(1).max(300).refine(s => !s.split(/[\\/]/).includes(".."),
    { message: "sourceRef 不允许包含 .. 路径穿越" }),
  tags: z.array(z.string().max(40)).default([]),
  ownerId: z.string().optional(),
});
const cronExpr = z.string().min(1).max(120).superRefine((v, ctx) => {
  const r = validateCron(v);
  if (!r.ok) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `cronExpr 非法: ${r.error}` });
});
const timezone = z.string().min(1).max(64).superRefine((v, ctx) => {
  if (!isValidTimezone(v)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `timezone 不是合法 IANA 时区: "${v}"` });
});
export const createPlanDto = z.object({
  caseId: z.string().min(1),
  environmentId: z.string().min(1),
  cronExpr,
  timezone: timezone.default("Asia/Shanghai"),
  regions: z.array(z.string().min(1).max(40)).max(20).default([]),
  failThreshold: z.number().int().min(1).max(10).default(3),
  concurrencyPolicy: z.enum(["skip", "queue", "parallel"]).default("skip"),
  enabled: z.boolean().default(true),
});
export const updatePlanDto = z.object({
  cronExpr: cronExpr.optional(),
  timezone: timezone.optional(),
  regions: z.array(z.string().min(1).max(40)).max(20).optional(),
  failThreshold: z.number().int().min(1).max(10).optional(),
  concurrencyPolicy: z.enum(["skip", "queue", "parallel"]).optional(),
  enabled: z.boolean().optional(),
}).refine(o => Object.keys(o).length > 0, { message: "至少提供一个要更新的字段" });
export const alertChannelDto = z.object({
  type: z.enum(["feishu", "wecom", "webhook"]),
  label: z.string().max(60).optional(),
  /** webhook URL（内含 token 按密钥处理）：创建时必填明文，落库前加密，之后只回掩码 */
  target: z.string().min(1).max(2000),
});
export const createAlertRuleDto = z.object({
  scopeType: z.enum(["plan", "project"]),
  scopeId: z.string().min(1),
  channels: z.array(alertChannelDto).min(1, "至少配置一个通道").max(10),
  dedupWindowSec: z.number().int().min(0).max(86400).default(3600),
  enabled: z.boolean().default(true),
});
export const updateAlertRuleDto = z.object({
  channels: z.array(alertChannelDto).min(1).max(10).optional(),
  dedupWindowSec: z.number().int().min(0).max(86400).optional(),
  enabled: z.boolean().optional(),
}).refine(o => Object.keys(o).length > 0, { message: "至少提供一个要更新的字段" });
// ---------------- Week 3 ----------------
export const registerWorkerDto = z.object({
  name: z.string().min(1).max(80),
  region: z.string().min(1).max(40),
  totalSlots: z.number().int().min(1).max(200).default(4),
  browserVersion: z.string().max(60).optional(),
});
export const workerHeartbeatDto = z.object({
  usedSlots: z.number().int().min(0).max(1000).optional(),
  totalSlots: z.number().int().min(1).max(200).optional(),
  browserVersion: z.string().max(60).optional(),
}).refine(o => Object.keys(o).length > 0, { message: "心跳至少携带一个字段（usedSlots/totalSlots/browserVersion）" });
const windowTime = z.string().datetime({ message: "时间必须是 ISO 8601 datetime" });
export const createMaintenanceWindowDto = z.object({
  scopeType: z.enum(["project", "plan"]),
  scopeId: z.string().min(1),
  startsAt: windowTime.optional(),
  endsAt: windowTime.optional(),
  cronExpr: cronExpr.optional(),
  durationMinutes: z.number().int().min(1).max(7 * 24 * 60).optional(),
  timezone: timezone.default("Asia/Shanghai"),
  reason: z.string().min(1).max(500),
}).superRefine((o, ctx) => {
  const once = o.startsAt !== undefined || o.endsAt !== undefined;
  const recurring = o.cronExpr !== undefined;
  if (once === recurring)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "窗口必须二选一：一次性（startsAt+endsAt）或周期（cronExpr+durationMinutes）" });
  if (once) {
    if (!o.startsAt || !o.endsAt)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "一次性窗口必须同时提供 startsAt 与 endsAt" });
    else if (new Date(o.endsAt) <= new Date(o.startsAt))
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "endsAt 必须晚于 startsAt" });
  }
  if (recurring && o.durationMinutes === undefined)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "周期窗口必须提供 durationMinutes" });
});
export const updateMaintenanceWindowDto = z.object({
  startsAt: windowTime.optional(),
  endsAt: windowTime.optional(),
  cronExpr: cronExpr.optional(),
  durationMinutes: z.number().int().min(1).max(7 * 24 * 60).optional(),
  timezone: timezone.optional(),
  reason: z.string().min(1).max(500).optional(),
}).refine(o => Object.keys(o).length > 0, { message: "至少提供一个要更新的字段" })
  .superRefine((o, ctx) => {
    if (o.startsAt && o.endsAt && new Date(o.endsAt) <= new Date(o.startsAt))
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "endsAt 必须晚于 startsAt" });
  });
export const createHeartbeatDto = z.object({
  name: z.string().min(1).max(120),
  expectIntervalSec: z.number().int().min(10).max(7 * 24 * 3600),
  alertRuleId: z.string().min(1).optional(),
});
export const saveStorageStateDto = z.object({
  role: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/, "role 只能含字母/数字/连字符/下划线"),
  /** Playwright storageState JSON（对象或 JSON 字符串均可），落盘前信封加密 */
  state: z.union([z.string().min(2), z.record(z.unknown())]),
  ttlSec: z.number().int().min(60).max(90 * 24 * 3600).optional(),
});
