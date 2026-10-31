/** 领域错误：服务层只抛这个，Nest 层（domain-exception.filter）转 HTTP 状态码；测试/演示脚本直接读 httpStatus。 */
export class DomainError extends Error {
  constructor(public readonly httpStatus: number, message: string) {
    super(message); this.name = "DomainError";
  }
}
export const badRequest = (msg: string) => new DomainError(400, msg);
export const notFound = (msg: string) => new DomainError(404, msg);
export const conflict = (msg: string) => new DomainError(409, msg);
