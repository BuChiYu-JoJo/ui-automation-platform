import { ArgumentsHost, Catch, ExceptionFilter } from "@nestjs/common";
import { DomainError } from "./index";
/** DomainError -> HTTP：400/404/409 等按领域语义返回 {statusCode, message}，不泄露堆栈。 */
@Catch(DomainError)
export class DomainExceptionFilter implements ExceptionFilter {
  catch(err: DomainError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    res.status(err.httpStatus).json({ statusCode: err.httpStatus, message: err.message });
  }
}