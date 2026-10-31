/** 产物 S3 key 规范：tenant/project/execution/kind/filename —— 租户与项目前缀隔离，禁止产物存 DB/本地盘长期留存。 */
export function artifactKey(p: { tenantId: string; projectId: string; executionId: string;
  kind: "screenshot"|"video"|"trace"|"har"|"log"; filename: string }): string {
  const safe = p.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${p.tenantId}/${p.projectId}/${p.executionId}/${p.kind}/${safe}`;
}
export function storageStateKey(tenantId: string, projectId: string, envId: string, role: string): string {
  return `${tenantId}/${projectId}/storage-state/${envId}-${role}.json`;
}
