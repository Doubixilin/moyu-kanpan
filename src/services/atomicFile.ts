import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export interface AtomicWriteOptions {
  backupPath?: string;
}

export async function atomicWriteText(
  filePath: string,
  content: string,
  options: AtomicWriteOptions = {}
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  if (options.backupPath) await preserveExisting(filePath, options.backupPath);

  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(tempPath, content, { encoding: "utf8", flush: true });
    await rename(tempPath, filePath);
  } finally {
    await rm(tempPath, { force: true }).catch(() => undefined);
  }
}

async function preserveExisting(filePath: string, backupPath: string): Promise<void> {
  try {
    const content = await readFile(filePath, "utf8");
    await atomicWriteText(backupPath, content);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export async function copyFileAtomically(sourcePath: string, targetPath: string): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await copyFile(sourcePath, tempPath);
    await rename(tempPath, targetPath);
  } finally {
    await rm(tempPath, { force: true }).catch(() => undefined);
  }
}
