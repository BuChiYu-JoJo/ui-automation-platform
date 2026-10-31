import { z } from "zod";
import { DSL_ACTIONS } from "./types";
const locatorSchema: z.ZodType<any> = z.lazy(() => z.object({
  strategy: z.enum(["testid","role","label","text","css","xpath"]),
  value: z.string().min(1),
  name: z.string().optional(),
  fallback: z.array(locatorSchema).optional(),
}));
export const stepSchema = z.object({
  id: z.string().min(1),
  type: z.enum(DSL_ACTIONS as [string, ...string[]]),
  locator: locatorSchema.optional(),
  value: z.string().optional(),
  url: z.string().optional(),
  method: z.string().optional(),
  expected: z.union([z.string(), z.number()]).optional(),
  variable: z.string().optional(),
  caseRef: z.string().optional(),
  timeoutMs: z.number().int().positive().max(120_000).optional(),
  optional: z.boolean().optional(),
  screenshotOnFail: z.boolean().optional(),
  comment: z.string().optional(),
}).superRefine((s, ctx) => {
  const needsLocator = ["click","fill","select","check","uncheck","hover","wait_for_selector","assert_visible","assert_text","assert_value"];
  if (needsLocator.includes(s.type) && !s.locator)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `action ${s.type} requires locator` });
  if (s.type === "goto" && !s.url && !s.value)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "goto requires url" });
  if (s.type === "run_case" && !s.caseRef)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "run_case requires caseRef" });
  if (s.type === "wait_timeout" && (s.timeoutMs ?? 0) > 30_000)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "wait_timeout capped at 30000ms; use condition waits instead of sleep" });
});
export const dslCaseSchema = z.object({
  dslVersion: z.literal("1"),
  name: z.string().min(1),
  loginPreset: z.string().optional(),
  variables: z.record(z.string()).optional(),
  steps: z.array(stepSchema).min(1),
});
export type ValidationResult = { ok: true } | { ok: false; errors: string[] };
export function validateDslCase(input: unknown): ValidationResult {
  const r = dslCaseSchema.safeParse(input);
  if (r.success) return { ok: true };
  return { ok: false, errors: r.error.issues.map(i => `${i.path.join(".")}: ${i.message}`) };
}
