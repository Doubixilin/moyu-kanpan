import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { EncryptedApiKeyStore, type SecretEncryption } from "../credentials";

function encryption(available = true): SecretEncryption {
  return {
    isAvailable: () => available,
    encryptString: (value) => Buffer.from([...Buffer.from(value, "utf8")].map((byte) => byte ^ 0xa5)),
    decryptString: (value) => Buffer.from([...value].map((byte) => byte ^ 0xa5)).toString("utf8")
  };
}

describe("encrypted AI credential store", () => {
  it("persists only encrypted bytes and can clear them", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "ai-key-"));
    const filePath = path.join(directory, "credential.json");
    const store = new EncryptedApiKeyStore(filePath, encryption());
    try {
      await store.write("sk-personal-secret");
      const raw = await readFile(filePath, "utf8");
      assert.equal(raw.includes("sk-personal-secret"), false);
      assert.equal(await store.read(), "sk-personal-secret");
      await store.clear();
      assert.equal(await store.read(), "");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("refuses plaintext persistence when secure storage is unavailable", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "ai-key-"));
    try {
      const store = new EncryptedApiKeyStore(
        path.join(directory, "credential.json"),
        encryption(false)
      );
      await assert.rejects(() => store.write("sk-secret"), /拒绝以明文保存/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});