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

  it("keeps macOS Dock, tray template image and floating level platform-aware", async () => {
    const main = await readFile(path.join(process.cwd(), "electron", "main.ts"), "utf8");
    assert.match(main, /process\.platform === "darwin" \? "floating" : "screen-saver"/);
    assert.match(main, /app\.dock\.hide\(\)/);
    assert.match(main, /app\.dock\.show\(\)/);
    assert.match(main, /createFromNamedImage\("chart\.line\.uptrend\.xyaxis"\)/);
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
      build: { win: { target: string }; mac: { target: string; identity: string } };
    };
    assert.match(packageJson.scripts["package:win"] ?? "", /--win --x64/);
    assert.match(packageJson.scripts["package:mac"] ?? "", /package-mac\.mjs/);
    assert.equal(packageJson.build.win.target, "nsis");
    assert.equal(packageJson.build.mac.target, "dmg");
    assert.equal(packageJson.build.mac.identity, "-");

    const packager = await readFile(path.join(process.cwd(), "scripts", "package-mac.mjs"), "utf8");
    assert.match(packager, /process\.arch/);
    assert.match(packager, /`--\$\{process\.arch\}`/);
  });
});
