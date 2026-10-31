import { Controller, Get, Post, Body, Param } from "@nestjs/common";
import { AuthService } from "./auth.service";
/** POST /auth/login (TODO: bcrypt + JWT), GET /me —— 骨架 stub，业务逻辑见各 service 的 TODO。 */
@Controller("auth")
export class AuthController {
  constructor(private readonly svc: AuthService) {}
  @Get("ping") ping() { return this.svc.ping(); }
  // TODO: 在此按模块说明补齐路由
  @Post("todo") todo(@Body() _body: unknown) { return { todo: true, module: "auth" }; }
  @Get(":id") getOne(@Param("id") id: string) { return { todo: true, module: "auth", id }; }
}
