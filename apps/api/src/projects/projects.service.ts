import { Inject, Injectable } from "@nestjs/common";
import { PROJECT_SERVICE } from "../core.module";
import type { ProjectService } from "../domain";
/** Nest 薄封装：业务逻辑在 domain/ProjectService（框架无关、可单测），此处只做注入适配，旧 ping 保留兼容。 */
@Injectable()
export class ProjectsService {
  constructor(@Inject(PROJECT_SERVICE) readonly core: ProjectService) {}
  ping() { return { module: "projects", status: "ok" }; }
}
