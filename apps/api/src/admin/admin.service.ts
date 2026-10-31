import { Inject, Injectable } from "@nestjs/common";
import { CLEANUP_SERVICE } from "../core.module";
import type { ArtifactCleanupService } from "../domain";
/** Nest 薄封装：业务逻辑在 domain/ArtifactCleanupService。 */
@Injectable()
export class AdminService {
  constructor(@Inject(CLEANUP_SERVICE) readonly cleanup: ArtifactCleanupService) {}
  ping() { return { module: "admin", status: "ok" }; }
}
