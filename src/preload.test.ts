import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const mainPath = fileURLToPath(new URL("../electron/main.ts", import.meta.url));
const preloadPath = fileURLToPath(new URL("../electron/preload.cts", import.meta.url));
const packagePath = fileURLToPath(new URL("../package.json", import.meta.url));
const appIconPath = fileURLToPath(new URL("../resources/icons/app.ico", import.meta.url));
const trayIconPath = fileURLToPath(new URL("../resources/icons/tray.png", import.meta.url));

describe("Electron preload build contract", () => {
  it("uses a CommonJS preload entry that Electron can execute", () => {
    assert.equal(existsSync(preloadPath), true);
    assert.match(readFileSync(mainPath, "utf8"), /preload\.cjs/);
    const main = readFileSync(mainPath, "utf8");
    const preload = readFileSync(preloadPath, "utf8");
    assert.match(preload, /window:hide/);
    assert.match(preload, /ai:setApiKey/);
    assert.match(main, /safeStorage\.encryptString/);
    assert.match(main, /ai-credential\.json/);
  });

  it("uses project icon assets for the packaged app and tray", () => {
    const main = readFileSync(mainPath, "utf8");
    const packageJson = readFileSync(packagePath, "utf8");
    assert.equal(existsSync(appIconPath), true);
    assert.equal(existsSync(trayIconPath), true);
    assert.match(main, /nativeImage\.createFromPath\(TRAY_ICON_PATH\)/);
    assert.match(main, /icon: APP_ICON_PATH/);
    assert.match(packageJson, /resources\/icons\/app\.ico/);
  });
});
