import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { DEFAULT_BOSS_KEY_ACCELERATOR } from "./shortcut";

describe("boss key window safety", () => {
  it("does not use a function key as the default global shortcut", () => {
    assert.doesNotMatch(DEFAULT_BOSS_KEY_ACCELERATOR, /\+F\d+$/);
    assert.notEqual(DEFAULT_BOSS_KEY_ACCELERATOR, "CommandOrControl+Alt+Space");
  });

  it("prevents fullscreen/maximize and never persists transient fullscreen bounds", async () => {
    const main = await readFile(path.join(process.cwd(), "electron", "main.ts"), "utf8");
    assert.match(main, /maximizable:\s*false/);
    assert.match(main, /fullscreenable:\s*false/);

    const persistStart = main.indexOf("async function persistWindowBounds");
    const persistEnd = main.indexOf("function restoreConfiguredAlwaysOnTop", persistStart);
    const persist = main.slice(persistStart, persistEnd);
    assert.match(persist, /isMaximized\(\)/);
    assert.match(persist, /isFullScreen\(\)/);
  });

  it("lets the first real snapshot restore the configured active tab", async () => {
    const renderer = await readFile(path.join(process.cwd(), "src", "renderer.ts"), "utf8");
    assert.match(renderer, /render\(emptySnapshot\);\s*navigationInitialized = false;/);
  });

  it("keeps secure runtime credentials across bounds and public settings saves", async () => {
    const main = await readFile(path.join(process.cwd(), "electron", "main.ts"), "utf8");

    const boundsStart = main.indexOf("async function persistWindowBounds");
    const boundsEnd = main.indexOf("function restoreConfiguredAlwaysOnTop", boundsStart);
    const boundsSave = main.slice(boundsStart, boundsEnd);
    assert.match(
      boundsSave,
      /config = preserveRuntimeSecrets\(await settingsStore\.save\(next\), config\)/
    );

    const settingsStart = main.indexOf("async function saveSettings");
    const settingsEnd = main.indexOf("async function toggleTheme", settingsStart);
    const publicSettingsSave = main.slice(settingsStart, settingsEnd);
    assert.match(publicSettingsSave, /config = preserveRuntimeSecrets\(saved, previous\)/);
  });

  it("keeps macOS Dock, tray template image and floating level platform-aware", async () => {
    const main = await readFile(path.join(process.cwd(), "electron", "main.ts"), "utf8");
    assert.match(main, /app\.setName\("摸鱼看盘"\)/);
    assert.match(main, /process\.platform === "darwin" \? "floating" : "screen-saver"/);
    assert.match(main, /app\.dock\.hide\(\)/);
    assert.match(main, /app\.dock\.show\(\)/);
    assert.match(main, /resources\/icons\/trayTemplate\.png/);
    assert.match(main, /createFromPath\(MAC_TRAY_TEMPLATE_ICON_PATH\)/);
    assert.match(main, /setTemplateImage\(true\)/);
    assert.match(main, /setHiddenInMissionControl\(config\.window\.trayOnly\)/);
    assert.match(main, /migrateConflictingMacDefaultShortcut\(\)/);
    assert.match(main, /scheduleSecureStorageAvailabilityCheck\(\)/);
    assert.match(main, /secureStorageAvailable \?\? false/);

    const settingsStart = main.indexOf("function openSettingsWindow");
    const settingsEnd = main.indexOf("function createTray", settingsStart);
    const settingsWindow = main.slice(settingsStart, settingsEnd);
    assert.match(settingsWindow, /window\.on\("hide"/);
    assert.match(settingsWindow, /restoreConfiguredAlwaysOnTop\(\)/);
  });

  it("packages the current macOS architecture as an app and DMG without replacing Windows", async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(process.cwd(), "package.json"), "utf8")
    ) as {
      scripts: Record<string, string>;
      productName: string;
      build: {
        win: { target: string; icon: string };
        mac: { target: string; identity: string; icon: string };
      };
    };
    assert.equal(packageJson.productName, "摸鱼看盘");
    assert.match(packageJson.scripts["package:win"] ?? "", /--win --x64/);
    assert.match(packageJson.scripts["package:mac"] ?? "", /package-mac\.mjs/);
    assert.equal(packageJson.build.win.target, "nsis");
    assert.equal(packageJson.build.win.icon, "resources/icons/app.ico");
    assert.equal(packageJson.build.mac.target, "dmg");
    assert.equal(packageJson.build.mac.identity, "-");
    assert.equal(packageJson.build.mac.icon, "resources/icons/app.icns");

    const packager = await readFile(path.join(process.cwd(), "scripts", "package-mac.mjs"), "utf8");
    assert.match(packager, /process\.arch/);
    assert.match(packager, /`--\$\{process\.arch\}`/);
    assert.match(packager, /node_modules", "electron", "dist/);
    assert.match(packager, /--config\.electronDist=/);
  });
});
