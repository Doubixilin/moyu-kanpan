import { spawn } from "node:child_process";
import path from "node:path";

if (process.platform !== "darwin") {
  throw new Error("package:mac must run on macOS");
}
if (process.arch !== "arm64" && process.arch !== "x64") {
  throw new Error(`Unsupported macOS architecture: ${process.arch}`);
}

const root = process.cwd();
const cli = path.join(root, "node_modules", "electron-builder", "out", "cli", "cli.js");
const child = spawn(
  process.execPath,
  [cli, "--mac", "dmg", `--${process.arch}`, "--publish", "never"],
  { cwd: root, env: process.env, stdio: "inherit" }
);

const exitCode = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code, signal) => {
    if (signal) reject(new Error(`electron-builder terminated by ${signal}`));
    else resolve(code ?? 1);
  });
});
if (exitCode !== 0) process.exitCode = exitCode;
