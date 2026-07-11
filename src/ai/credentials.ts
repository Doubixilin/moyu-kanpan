import { readFile, rm } from "node:fs/promises";
import { atomicWriteText } from "../services/atomicFile.js";

export interface SecretEncryption {
  isAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

interface StoredCredential {
  version: 1;
  encrypted: string;
  updatedAt: string;
}

export class EncryptedApiKeyStore {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly encryption: SecretEncryption
  ) {}

  isAvailable(): boolean {
    return this.encryption.isAvailable();
  }

  async read(): Promise<string> {
    try {
      const content = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(content) as Partial<StoredCredential>;
      if (parsed.version !== 1 || typeof parsed.encrypted !== "string" || !parsed.encrypted) {
        throw new Error("invalid credential payload");
      }
      if (!this.encryption.isAvailable()) {
        throw new Error("secure storage unavailable");
      }
      return this.encryption.decryptString(Buffer.from(parsed.encrypted, "base64")).trim();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw new Error("AI 凭据无法安全读取，请清除后重新配置");
    }
  }

  async write(apiKey: string): Promise<void> {
    const normalized = apiKey.trim();
    if (!normalized || normalized.length > 2_000) throw new Error("API Key 无效");
    if (!this.encryption.isAvailable()) {
      throw new Error("系统安全存储不可用，拒绝以明文保存 API Key");
    }
    const operation = this.writeQueue.then(async () => {
      const payload: StoredCredential = {
        version: 1,
        encrypted: this.encryption.encryptString(normalized).toString("base64"),
        updatedAt: new Date().toISOString()
      };
      await atomicWriteText(this.filePath, JSON.stringify(payload, null, 2) + "\n");
    });
    this.writeQueue = operation.catch(() => undefined);
    await operation;
  }

  async clear(): Promise<void> {
    const operation = this.writeQueue.then(() => rm(this.filePath, { force: true }));
    this.writeQueue = operation.catch(() => undefined);
    await operation;
  }
}
