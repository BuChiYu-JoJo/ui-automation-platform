/** 脱敏：把已知密钥值从任意字符串中替换掉。贯穿日志/错误信息/告警文案，禁止明文泄漏。 */
export function redactSecrets(text: string, secrets: string[]): string {
  let out = text;
  for (const s of secrets) {
    if (!s || s.length < 3) continue;
    out = out.split(s).join("***");
    // 也处理 URL 编码形态
    const enc = encodeURIComponent(s);
    if (enc !== s) out = out.split(enc).join("***");
  }
  return out;
}
/** 兜底：对常见键名模式做结构化脱敏（对象序列化前用） */
const SENSITIVE_KEY = /(password|passwd|token|secret|authorization|cookie|api[-_]?key)/i;
export function redactObject<T>(input: T): T {
  if (Array.isArray(input)) return input.map(redactObject) as T;
  if (input && typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>))
      out[k] = SENSITIVE_KEY.test(k) ? "***" : redactObject(v);
    return out as T;
  }
  return input;
}
