import { Inject, Injectable } from "@nestjs/common";
import { CASE_SERVICE } from "../core.module";
import type { CaseService } from "../domain";
/** Nest 薄封装：业务逻辑在 domain/CaseService。 */
@Injectable()
export class CasesService {
  constructor(@Inject(CASE_SERVICE) readonly core: CaseService) {}
  ping() { return { module: "cases", status: "ok" }; }
}
