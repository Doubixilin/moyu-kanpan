import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

if (process.platform !== "darwin") {
  throw new Error("package:mac must run on macOS");
}
if (process.arch !== "arm64" && process.arch !== "x64") {
  throw new Error(`Unsupported macOS architecture: ${process.arch}`);
}

const root = process.cwd();
const cli = path.join(root, "node_modules", "electron-builder", "out", "cli", "cli.js");
const electronDist = path.join(root, "node_modules", "electron", "dist");
const temporaryDir = await mkdtemp(path.join(os.tmpdir(), "moyu-electron-dist-"));
const electronArchive = path.join(temporaryDir, `electron-${process.arch}.zip`);

try {
  const zipExitCode = await runChild(
    "/usr/bin/zip",
    ["-qry", "-y", electronArchive, "."],
    electronDist
  );
  if (zipExitCode !== 0) throw new Error(`Electron archive creation failed (${zipExitCode})`);

  const exitCode = await runChild(
    process.execPath,
    [
      cli,
      "--mac",
      "dmg",
      `--${process.arch}`,
      "--publish",
      "never",
      `--config.electronDist=${electronArchive}`
    ],
    root
  );
  if (exitCode !== 0) process.exitCode = exitCode;
} finally {
  await rm(temporaryDir, { recursive: true, force: true });
}

function runChild(command, args, cwd) {
  const child = spawn(command, args, {
    cwd,
    env: process.env,
    stdio: "inherit"
  });
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`${path.basename(command)} terminated by ${signal}`));
      else resolve(code ?? 1);
    });
  });
}
