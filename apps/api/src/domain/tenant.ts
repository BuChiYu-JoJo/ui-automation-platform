/** 租户/操作者上下文（骨架阶段）：header x-tenant-id / x-actor，缺省 default / demo-user。
 *  TODO(auth): 接入真实登录后从 JWT 取 tenantId 与 actor，禁止外部 header 冒充。
 *  用最小结构类型而非 express 类型，避免 api 包额外引入 @types/express。 */
export interface ReqLike { headers: Record<string, string | string[] | undefined> }
export function tenantOf(req: ReqLike): string {
  const v = req.headers["x-tenant-id"];
  return (Array.isArray(v) ? v[0] : v) || "default";
}
export function actorOf(req: ReqLike): string {
  const v = req.headers["x-actor"];
  return (Array.isArray(v) ? v[0] : v) || "demo-user";
}
