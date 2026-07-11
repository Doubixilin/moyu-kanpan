import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { loadAppConfigFromObject, toUserSettings } from "../../config";
import { SettingsStore } from "../store";

const defaults = {
  watchlist: ["000001", "600519"],
  quotes: { fields: ["price", "changePercent"], sort: "manual" },
  news: { mode: "all", maxItems: 5 },
  appearance: { theme: "standard", backgroundOpacity: 0.82 }
};

function exampleSettings() {
  return toUserSettings(loadAppConfigFromObject({
    securities: [
      { code: "300750", name: "宁德时代", alias: "宁德", market: "SZ" },
      { code: "600519", name: "贵州茅台", alias: "茅台", market: "SH" }
    ],
    holdings: [
      { securityCode: "300750", quantity: 200, costPrice: 180.12 }
    ],
    watchlist: [
      { securityCode: "300750", visible: true, order: 0 },
      { securityCode: "600519", visible: true, order: 1 }
    ],
    navigation: { defaultTabId: "holdings", rememberLastTab: true },
    quotes: { fields: ["price", "high"], sort: "manual" },
    news: { mode: "watchlist_related", maxItems: 5 },
    appearance: { theme: "stealth", backgroundOpacity: 0.35 },
    window: {
      width: 420,
      height: 600,
      x: 120,
      y: 80,
      alwaysOnTop: false,
      trayOnly: true,
      bossKeyEnabled: true,
      bossKeyAccelerator: "Ctrl+Shift+H",
      clickThrough: true,
      locked: true
    }
  }));
}

describe("SettingsStore", () => {
  it("persists normalized settings and reloads them repeatedly", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "floating-widget-settings-"));
    const filePath = path.join(directory, "settings.json");
    const store = new SettingsStore(filePath, defaults, {});

    try {
      const settings = exampleSettings();
      await store.save(settings);
      const reloaded = await store.load();
      assert.deepEqual(reloaded.watchlist.map((item) => item.securityCode), ["300750", "600519"]);
      assert.equal(reloaded.holdings[0]?.quantity, 200);
      assert.equal(reloaded.appearance.theme, "stealth");
      assert.equal(reloaded.window.bossKeyAccelerator, "CommandOrControl+Shift+H");
      assert.equal(reloaded.window.clickThrough, true);
      assert.deepEqual(
        { x: reloaded.window.x, y: reloaded.window.y, width: reloaded.window.width, height: reloaded.window.height },
        { x: 120, y: 80, width: 420, height: 600 }
      );
      assert.match(await readFile(filePath, "utf8"), /"schemaVersion": 8/);

      settings.appearance.theme = "standard";
      await store.save(settings);
      assert.equal((await store.load()).appearance.theme, "standard");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("persists schema upgrades and migrates the legacy default boss key", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "floating-widget-migration-"));
    const filePath = path.join(directory, "settings.json");
    await writeFile(filePath, JSON.stringify({
      schemaVersion: 4,
      watchlist: ["000001", "600519"],
      window: {
        bossKeyAccelerator: "CommandOrControl+Shift+F11",
        width: 1000,
        height: 900,
        x: 0,
        y: 0
      }
    }), "utf8");

    try {
      const store = new SettingsStore(filePath, defaults, {});
      const migrated = await store.load();
      const persisted = await readFile(filePath, "utf8");
      assert.equal(migrated.schemaVersion, 8);
      assert.equal(
        migrated.window.bossKeyAccelerator,
        "CommandOrControl+Shift+Space"
      );
      assert.equal(migrated.window.width, 380);
      assert.equal(migrated.window.height, 520);
      assert.match(persisted, /"schemaVersion": 8/);
      assert.match(persisted, /"bossKeyAccelerator": "CommandOrControl\+Shift\+Space"/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("applies a personal seed once to a default-like existing profile", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "floating-widget-seed-"));
    const filePath = path.join(directory, "settings.json");
    const seedPath = path.join(directory, "personal.local.json");
    await writeFile(filePath, JSON.stringify({
      watchlist: ["000001", "600519"],
      appearance: { theme: "stealth", backgroundOpacity: 0.5 }
    }), "utf8");
    await writeFile(seedPath, JSON.stringify({
      version: 3,
      settings: {
        securities: [
          { code: "600000", name: "浦发银行", market: "SH" },
          { code: "000001", name: "平安银行", market: "SZ" }
        ],
        holdings: [
          { securityCode: "600000", quantity: 300, costPrice: 10.25 }
        ],
        watchlist: [
          { securityCode: "600000", visible: true, order: 0 },
          { securityCode: "000001", visible: true, order: 1 }
        ],
        navigation: { defaultTabId: "holdings" }
      }
    }), "utf8");

    try {
      const store = new SettingsStore(filePath, defaults, {}, seedPath);
      const seeded = await store.load();
      assert.equal(seeded.personalSeedVersion, 3);
      assert.deepEqual(seeded.watchlist.map((item) => item.securityCode), ["600000", "000001"]);
      assert.equal(seeded.holdings[0]?.costPrice, 10.25);
      assert.equal(seeded.appearance.theme, "stealth");

      const reloaded = await store.load();
      assert.deepEqual(reloaded.watchlist.map((item) => item.securityCode), ["600000", "000001"]);
      assert.match(await readFile(filePath, "utf8"), /"personalSeedVersion": 3/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("does not overwrite a customized watchlist with the personal seed", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "floating-widget-seed-"));
    const filePath = path.join(directory, "settings.json");
    const seedPath = path.join(directory, "personal.local.json");
    await writeFile(filePath, JSON.stringify({ watchlist: ["300750"] }), "utf8");
    await writeFile(seedPath, JSON.stringify({
      version: 1,
      settings: {
        securities: [{ code: "600000", name: "浦发银行" }],
        holdings: [{ securityCode: "600000", quantity: 300, costPrice: 10.25 }],
        watchlist: [{ securityCode: "600000", visible: true, order: 0 }]
      }
    }), "utf8");

    try {
      const store = new SettingsStore(filePath, defaults, {}, seedPath);
      const config = await store.load();
      assert.deepEqual(config.watchlist.map((item) => item.securityCode), ["300750"]);
      assert.equal(config.holdings.length, 0);
      assert.equal(config.personalSeedVersion, 0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("creates and restores the last pre-import settings backup", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "floating-widget-import-backup-"));
    const filePath = path.join(directory, "settings.json");
    const store = new SettingsStore(filePath, defaults, {});
    const settings = exampleSettings();

    try {
      await store.save(settings);
      assert.equal(await store.createImportBackup(), true);
      settings.holdings[0]!.quantity = 999;
      await store.save(settings);
      assert.equal((await store.load()).holdings[0]?.quantity, 999);
      const restored = await store.restoreImportBackup();
      assert.equal(restored.holdings[0]?.quantity, 200);
      assert.equal((await store.load()).holdings[0]?.quantity, 200);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("quarantines a corrupt file and restores the last known good settings", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "floating-widget-recovery-"));
    const filePath = path.join(directory, "settings.json");
    const store = new SettingsStore(filePath, defaults, {});
    const settings = exampleSettings();

    try {
      await store.save(settings);
      settings.appearance.theme = "standard";
      await store.save(settings);
      await writeFile(filePath, "{broken", "utf8");

      const recovered = await store.load();
      assert.equal(recovered.appearance.theme, "stealth");
      assert.match(store.consumeRecoveryMessage() ?? "", /已恢复上一次有效设置/);
      const persisted = await readFile(filePath, "utf8");
      assert.doesNotThrow(() => JSON.parse(persisted));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("recovers when the settings JSON has the wrong top-level type", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "floating-widget-recovery-"));
    const filePath = path.join(directory, "settings.json");
    await writeFile(filePath, "[]", "utf8");
    const store = new SettingsStore(filePath, defaults, {});
    try {
      const recovered = await store.load();
      assert.deepEqual(recovered.watchlist.map((item) => item.securityCode), ["000001", "600519"]);
      assert.match(store.consumeRecoveryMessage() ?? "", /恢复默认设置/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects invalid holding values", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "floating-widget-settings-"));
    const store = new SettingsStore(path.join(directory, "settings.json"), defaults, {});
    const settings = exampleSettings();
    settings.holdings[0]!.quantity = 0;

    try {
      await assert.rejects(store.save(settings), /持仓数量无效/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
