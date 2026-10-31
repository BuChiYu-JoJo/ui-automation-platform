import { artifactKey } from "@uip/shared";
/** 产物收集 stub：本地临时文件 -> S3 key 命名与登记。
 *  TODO(artifacts): 用 @aws-sdk/client-s3 PutObject 直传 MinIO/OSS，回填 artifact 表并设 expires_at
 *  （成功 7 天 / 失败 30 天 / incident 关联 90 天），到期由清理任务删除。禁止失败才留之外的全量留存。 */
export interface LocalArtifact { kind: "screenshot"|"video"|"trace"|"har"|"log"; localPath: string; filename: string }
export function planArtifactUploads(
  scope: { tenantId: string; projectId: string; executionId: string }, locals: LocalArtifact[],
): { localPath: string; s3Key: string }[] {
  return locals.map(l => ({ localPath: l.localPath,
    s3Key: artifactKey({ ...scope, kind: l.kind, filename: l.filename }) }));
}
