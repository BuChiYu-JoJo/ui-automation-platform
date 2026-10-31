import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
/** 信封加密接口 + 工作实现：AES-256-GCM，主密钥来自 env MASTER_KEY_B64（32 bytes base64）。
 *  生产应把主密钥换成 KMS 托管，此接口不变。返回格式: v1:<iv b64>:<tag b64>:<cipher b64> */
export interface EnvelopeCrypto { encrypt(plain: string): string; decrypt(payload: string): string; }
export class AesGcmEnvelopeCrypto implements EnvelopeCrypto {
  constructor(private key: Buffer) {
    if (key.length !== 32) throw new Error("master key must be 32 bytes");
  }
  static fromEnv(envKey = "MASTER_KEY_B64"): AesGcmEnvelopeCrypto {
    const b64 = process.env[envKey];
    if (!b64) throw new Error(`${envKey} not set`);
    return new AesGcmEnvelopeCrypto(Buffer.from(b64, "base64"));
  }
  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.key, iv);
    const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
    return `v1:${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${enc.toString("base64")}`;
  }
  decrypt(payload: string): string {
    const [ver, iv, tag, data] = payload.split(":");
    if (ver !== "v1") throw new Error(`unsupported cipher version ${ver}`);
    const d = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
  }
}
