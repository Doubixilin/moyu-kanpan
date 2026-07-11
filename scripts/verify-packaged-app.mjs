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
for (const required of [
  "dist/index.html",
  "dist/settings.html",
  "dist-electron/electron/main.js",
  "dist-electron/electron/preload.cjs",
  "config/defaults.json",
  "LICENSE"
]) {
  if (!stdout.replaceAll("\\", "/").includes(required)) {
    throw new Error("Packaged ASAR is missing " + required);
  }
}
