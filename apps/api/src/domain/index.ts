export * from "./errors";
export * from "./types";
export * from "./repositories";
export * from "./in-memory";
export * from "./prisma";
export * from "./validation";
export * from "./services";
export * from "./cron";
export * from "./week2-services";
export * from "./week3-services";
export * from "./week4-services";
import { createHash } from "node:crypto";
import { AesGcmEnvelopeCrypto, type EnvelopeCrypto } from "@uip/shared";
/** 主密钥来源：MASTER_KEY_B64（32B base64）。未设置且非 production 时用固定弱口令派生并告警（仅限本地开发/演示）。 */
export function createEnvelopeCrypto(): EnvelopeCrypto {
  if (process.env.MASTER_KEY_B64) return AesGcmEnvelopeCrypto.fromEnv();
  if (process.env.NODE_ENV === "production")
    throw new Error("MASTER_KEY_B64 is required in production");
  console.warn("[uip] MASTER_KEY_B64 not set: using DEV-ONLY derived key (do not use in production)");
  return new AesGcmEnvelopeCrypto(createHash("sha256").update("uip-dev-master-key").digest());
}
