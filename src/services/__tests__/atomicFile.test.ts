import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { atomicWriteText } from "../atomicFile";

describe("atomic text persistence", () => {
  it("replaces a file and preserves its last known good backup", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "floating-atomic-"));
    const filePath = path.join(directory, "settings.json");
    const backupPath = filePath + ".bak";
    try {
      await writeFile(filePath, "first", "utf8");
      await atomicWriteText(filePath, "second", { backupPath });
      assert.equal(await readFile(filePath, "utf8"), "second");
      assert.equal(await readFile(backupPath, "utf8"), "first");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
