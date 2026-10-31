import { Injectable } from "@nestjs/common";
// TODO(auth): 接 PrismaService 后实现真实逻辑；密钥字段只进不出、写审计日志。
@Injectable()
export class AuthService {
  ping() { return { module: "auth", status: "stub" }; }
}
