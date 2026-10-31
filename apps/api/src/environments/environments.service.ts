import { Inject, Injectable } from "@nestjs/common";
import { ENVIRONMENT_SERVICE, STORAGE_STATE_SERVICE, VARIABLE_SERVICE } from "../core.module";
import type { EnvironmentService, EnvVariableService, StorageStateService } from "../domain";
/** Nest 薄封装：业务逻辑在 domain 层（含密钥加密、单默认规则、storageState 预设），此处只做注入适配。 */
@Injectable()
export class EnvironmentsService {
  constructor(
    @Inject(ENVIRONMENT_SERVICE) readonly core: EnvironmentService,
    @Inject(VARIABLE_SERVICE) readonly variables: EnvVariableService,
    @Inject(STORAGE_STATE_SERVICE) readonly storageStates: StorageStateService,
  ) {}
  ping() { return { module: "environments", status: "ok" }; }
}
