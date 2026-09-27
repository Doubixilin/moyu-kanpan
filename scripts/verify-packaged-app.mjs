import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const releaseDir = path.join(root, "release");
const asarPath = path.join(releaseDir, "win-unpacked", "resources", "app.asar");
const asarBin = path.join(root, "node_modules", "@electron", "asar", "bin", "asar.js");
const entries = await readdir(releaseDir);
const installer = entries.find((entry) => entry.endsWith(".exe"));
if (!installer) throw new Error("Windows installer was not produced");

for (const artifact of [asarPath, path.join(releaseDir, installer)]) {
  const info = await stat(artifact);
  if (Date.now() - info.mtimeMs > 20 * 60_000) {
    throw new Error("Packaged artifact is stale: " + path.relative(root, artifact));
  }
}

const { stdout } = await execFileAsync(process.execPath, [asarBin, "list", asarPath], {
  encoding: "utf8",
  windowsHide: true
});
const listing = stdout.replaceAll("\\", "/");
for (const required of [
  "dist/index.html",
  "dist/settings.html",
  "dist-electron/electron/main.js",
  "dist-electron/electron/preload.cjs",
  "config/defaults.json",
  "resources/icons/app-256.png",
  "resources/icons/tray.png",
  "LICENSE"
]) {
  if (!listing.includes(required)) {
    throw new Error("Packaged ASAR is missing " + required);
  }
}

// 负向断言：文档（docs/2026-07-11-final-pre-macos-release-audit.md:31/128）声称
// 打包产物不含个人配置与 `.env`。此前只检查"必需文件存在"，这条声明从未被验证过。
for (const forbidden of [".env", "personal.local.json", "settings.json", "ai-credential.json"]) {
  const hit = listing.split("\n").find((line) => line.trim().split("/").at(-1) === forbidden);
  if (hit) throw new Error("Packaged ASAR must not contain " + forbidden + " (" + hit.trim() + ")");
}
