import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix("api");
  await app.listen(Number(process.env.API_PORT ?? 3000));
  console.log(`[api] listening on :${process.env.API_PORT ?? 3000}`);
}
void bootstrap();
