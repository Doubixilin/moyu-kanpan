import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const releaseDir = path.join(root, "release");
const asarBin = path.join(root, "node_modules", "@electron", "asar", "bin", "asar.js");
const platformArg = process.argv.indexOf("--platform");
const platform = platformArg >= 0 ? process.argv[platformArg + 1] : "win";
if (platform !== "win" && platform !== "mac") {
  throw new Error(`Unsupported packaged-app verification platform: ${platform}`);
}

const entries = await readdir(releaseDir, { withFileTypes: true });
const packageInfo = platform === "mac"
  ? await resolveMacPackage(entries)
  : await resolveWindowsPackage(entries);

for (const artifact of packageInfo.artifacts) {
  const info = await stat(artifact);
  if (Date.now() - info.mtimeMs > 20 * 60_000) {
    throw new Error("Packaged artifact is stale: " + path.relative(root, artifact));
  }
}

const { stdout } = await execFileAsync(
  process.execPath,
  [asarBin, "list", packageInfo.asarPath],
  { encoding: "utf8", windowsHide: true, maxBuffer: 20 * 1024 * 1024 }
);
const normalizedListing = stdout.replaceAll("\\", "/");
for (const required of [
  "dist/index.html",
  "dist/settings.html",
  "dist-electron/electron/main.js",
  "dist-electron/electron/preload.cjs",
  "config/defaults.json",
  "resources/icons/app-256.png",
  "resources/icons/app.icns",
  "resources/icons/tray.png",
  "resources/icons/trayTemplate.png",
  "resources/icons/trayTemplate@2x.png",
  "LICENSE"
]) {
  if (!normalizedListing.includes(required)) {
    throw new Error("Packaged ASAR is missing " + required);
  }
}

const packagedPaths = normalizedListing.split("\n").filter(Boolean);
for (const forbidden of [".env", "personal.local.json"]) {
  if (packagedPaths.some((entry) => path.posix.basename(entry) === forbidden)) {
    throw new Error(`Packaged ASAR contains forbidden file: ${forbidden}`);
  }
}
for (const developmentDependency of [
  "electron",
  "electron-builder",
  "tsx",
  "typescript",
  "@types"
]) {
  const marker = `/node_modules/${developmentDependency}/`;
  if (packagedPaths.some((entry) => entry.includes(marker))) {
    throw new Error(`Packaged ASAR contains development dependency: ${developmentDependency}`);
  }
}

const extractedDir = await mkdtemp(path.join(os.tmpdir(), "moyu-kanpan-asar-"));
try {
  await execFileAsync(process.execPath, [asarBin, "extract", packageInfo.asarPath, extractedDir], {
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024
  });
  await scanPackagedText(extractedDir);
} finally {
  await rm(extractedDir, { recursive: true, force: true });
}

async function resolveWindowsPackage(releaseEntries) {
  const asarPath = path.join(releaseDir, "win-unpacked", "resources", "app.asar");
  const installer = releaseEntries.find((entry) => entry.isFile() && entry.name.endsWith(".exe"));
  if (!installer) throw new Error("Windows installer was not produced");
  return {
    asarPath,
    artifacts: [asarPath, path.join(releaseDir, installer.name)]
  };
}

async function resolveMacPackage(releaseEntries) {
  const archive = releaseEntries.find((entry) =>
    entry.isFile() && (entry.name.endsWith(".dmg") || entry.name.endsWith(".zip"))
  );
  if (!archive) throw new Error("macOS DMG or ZIP was not produced");

  for (const entry of releaseEntries) {
    if (!entry.isDirectory() || !entry.name.startsWith("mac")) continue;
    const directory = path.join(releaseDir, entry.name);
    const app = (await readdir(directory, { withFileTypes: true }))
      .find((candidate) => candidate.isDirectory() && candidate.name.endsWith(".app"));
    if (!app) continue;
    const appPath = path.join(directory, app.name);
    const asarPath = path.join(appPath, "Contents", "Resources", "app.asar");
    return {
      asarPath,
      artifacts: [
        asarPath,
        appPath,
        path.join(appPath, "Contents", "Resources", "icon.icns"),
        path.join(releaseDir, archive.name)
      ]
    };
  }
  throw new Error("macOS .app bundle was not produced");
}

async function scanPackagedText(directory) {
  const pending = [directory];
  const absolutePathPattern = /(?:\/Users\/[^/\s]+\/|\/home\/[^/\s]+\/|[A-Za-z]:\\Users\\[^\\\s]+\\)/;
  const apiKeyPattern = /\b(?:sk|rk|ak)-[A-Za-z0-9_-]{20,}\b/;

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const filePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(filePath);
        continue;
      }
      if (!entry.isFile() || (await stat(filePath)).size > 2 * 1024 * 1024) continue;
      const bytes = await readFile(filePath);
      if (bytes.includes(0)) continue;
      const text = bytes.toString("utf8");
      const relative = path.relative(directory, filePath);
      if (absolutePathPattern.test(text)) {
        throw new Error(`Packaged file contains an absolute user path: ${relative}`);
      }
      if (apiKeyPattern.test(text)) {
        throw new Error(`Packaged file resembles a real API key: ${relative}`);
      }
    }
  }
}
