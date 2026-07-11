import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  activeSecurityCodes,
  assertSavableSettings,
  loadAppConfigFromObject,
  preserveRuntimeSecrets,
  toUserSettings
} from "./config";
import { parseBossKeyAccelerator } from "./shortcut";

describe("config", () => {
  it("migrates a legacy watchlist into normalized securities and memberships", () => {
    const config = loadAppConfigFromObject(
      {
        watchlist: [
          { code: "600519", alias: "茅台", visible: true, order: 0 },
          "000001"
        ],
        pollIntervals: { quotesMs: 15000, newsMs: 60000 },
        providers: { quote: "eastmoney", news: "eastmoney" },
        window: { opacity: 0.78, width: 360, height: 460 }
      },
      {
        AI_API_KEY: "secret",
        AI_API_BASE_URL: "https://api.example.com/v1",
        AI_MODEL: "gpt-test"
      }
    );

    assert.deepEqual(config.securities.map((item) => item.code), ["600519", "000001"]);
    assert.equal(config.securities[0]?.alias, "茅台");
    assert.deepEqual(config.watchlist.map((item) => item.securityCode), ["600519", "000001"]);
    assert.deepEqual(activeSecurityCodes(config), ["600519", "000001"]);
    assert.equal(config.navigation.defaultTabId, "watchlist");
    assert.deepEqual(config.tabs.filter((tab) => tab.visible).map((tab) => tab.id), [
      "holdings", "watchlist", "market", "drivers"
    ]);
    assert.equal(config.appearance.backgroundOpacity, 0.78);
    assert.deepEqual(config.window, {
      width: 360,
      height: 460,
      x: null,
      y: null,
      alwaysOnTop: true,
      trayOnly: true,
      bossKeyEnabled: true,
      bossKeyAccelerator: "CommandOrControl+Alt+Space",
      clickThrough: false,
      locked: false
    });
    assert.deepEqual(config.ai, {
      enabled: true,
      provider: "deepseek",
      apiKey: "secret",
      baseUrl: "https://api.example.com/v1",
      model: "gpt-test",
      timeoutSeconds: 20
    });
  });

  it("normalizes holdings, custom tabs and public settings without credentials", () => {
    const config = loadAppConfigFromObject({
      securities: [
        { code: "300750", name: "宁德时代", alias: "宁德", market: "SZ" },
        { code: "600519", name: "贵州茅台", alias: "", market: "SH" }
      ],
      holdings: [
        { securityCode: "300750", quantity: 200, costPrice: 180.12345 }
      ],
      watchlist: [
        { securityCode: "300750", visible: true, order: 1 },
        { securityCode: "600519", visible: false, order: 0 }
      ],
      tabs: [
        { id: "watchlist", visible: true, order: 0 },
        {
          id: "custom-tech",
          type: "stock-list",
          title: "算力",
          visible: true,
          order: 1,
          securityCodes: ["300750", "bad"]
        }
      ],
      navigation: { defaultTabId: "holdings", rememberLastTab: true },
      quotes: { fields: ["price", "high", "bad-field"], sort: "changePercentDesc" },
      news: { mode: "watchlist_related", maxItems: 12 },
      appearance: { theme: "stealth", backgroundOpacity: 0.4 }
    }, { AI_API_KEY: "never-expose" });

    assert.equal(config.holdings[0]?.costPrice, 180.1235);
    assert.equal(config.navigation.defaultTabId, "holdings");
    assert.equal(config.navigation.rememberLastTab, true);
    assert.deepEqual(
      config.tabs.find((tab) => tab.id === "custom-tech")?.securityCodes,
      ["300750"]
    );

    const settings = toUserSettings(config);
    assert.deepEqual(settings.watchlist.map((item) => item.securityCode), ["600519", "300750"]);
    assert.deepEqual(settings.quotes.fields, ["price", "high"]);
    assert.equal(settings.appearance.theme, "stealth");
    assert.equal(settings.ai.model, "deepseek-v4-flash");
    assert.equal("apiKey" in settings.ai, false);
    assert.equal(settings.schemaVersion, 8);
    assert.equal(settings.window.trayOnly, true);
  });

  it("normalizes local risk settings and holding alert rules", () => {
    const config = loadAppConfigFromObject({
      securities: [{ code: "600519", market: "SH", name: "贵州茅台" }],
      watchlist: [{ securityCode: "600519", visible: true, order: 0 }],
      risk: {
        mode: "active",
        accountBaseline: 100000,
        oneR: 500,
        cooldownMinutes: 20,
        notifications: { windows: true },
        groups: [{ id: "core", name: "核心", lossThreshold: 1000 }]
      },
      holdings: [{
        securityCode: "600519",
        quantity: 100,
        costPrice: 1000,
        groupId: "core",
        alertRules: { enabled: true, stopLossPrice: 900, fallPercent: 5 }
      }]
    });

    assert.equal(config.schemaVersion, 8);
    assert.equal(config.risk.mode, "active");
    assert.equal(config.risk.oneR, 500);
    assert.equal(config.risk.notifications.windows, true);
    assert.equal(config.holdings[0]?.groupId, "core");
    assert.equal(config.holdings[0]?.alertRules.stopLossPrice, 900);
    assert.equal(config.holdings[0]?.alertRules.priceAbove, null);
  });

  it("keeps AI credentials out of public settings and validates endpoints", () => {
    const settings = toUserSettings(loadAppConfigFromObject({
      ai: {
        enabled: true,
        provider: "custom",
        baseUrl: "http://127.0.0.1:11434/v1",
        model: "local-fast",
        timeoutSeconds: 30
      }
    }, { AI_API_KEY: "secret" }));

    assert.deepEqual(settings.ai, {
      enabled: true,
      provider: "custom",
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "local-fast",
      timeoutSeconds: 30
    });
    assert.equal(JSON.stringify(settings).includes("secret"), false);
    assert.doesNotThrow(() => assertSavableSettings(settings));
    assert.throws(
      () => assertSavableSettings({
        ...settings,
        ai: { ...settings.ai, apiKey: "must-not-persist" }
      }),
      /不能写入普通设置/
    );
  });

  it("preserves the secure runtime API key when public settings are saved", () => {
    const current = loadAppConfigFromObject({}, { AI_API_KEY: "secure-runtime-key" });
    const persisted = loadAppConfigFromObject(
      JSON.parse(JSON.stringify(toUserSettings(current))),
      {}
    );

    assert.equal(persisted.ai.apiKey, "");
    assert.equal(preserveRuntimeSecrets(persisted, current).ai.apiKey, "secure-runtime-key");
  });

  it("enables the Market tab once during schema 6 migration", () => {
    const migrated = loadAppConfigFromObject({
      schemaVersion: 5,
      tabs: [{ id: "market", visible: false }]
    });
    const current = loadAppConfigFromObject({
      schemaVersion: 6,
      tabs: [{ id: "market", visible: false }]
    });

    assert.equal(migrated.tabs.find((tab) => tab.id === "market")?.visible, true);
    assert.equal(current.tabs.find((tab) => tab.id === "market")?.visible, false);
  });
  it("migrates legacy boss keys and poisoned fullscreen bounds", () => {
    const firstLegacy = loadAppConfigFromObject({
      schemaVersion: 3,
      window: { bossKeyAccelerator: "CommandOrControl+Alt+S" }
    });
    const fullscreenLegacy = loadAppConfigFromObject({
      schemaVersion: 4,
      window: {
        bossKeyAccelerator: "CommandOrControl+Shift+F11",
        width: 1000,
        height: 900,
        x: 0,
        y: 0
      }
    });
    const currentCustom = loadAppConfigFromObject({
      schemaVersion: 5,
      window: { bossKeyAccelerator: "CommandOrControl+Alt+S" }
    });

    assert.equal(firstLegacy.window.bossKeyAccelerator, "CommandOrControl+Alt+Space");
    assert.equal(fullscreenLegacy.window.bossKeyAccelerator, "CommandOrControl+Alt+Space");
    assert.deepEqual(
      {
        width: fullscreenLegacy.window.width,
        height: fullscreenLegacy.window.height,
        x: fullscreenLegacy.window.x,
        y: fullscreenLegacy.window.y
      },
      { width: 380, height: 520, x: null, y: null }
    );
    assert.equal(currentCustom.window.bossKeyAccelerator, "CommandOrControl+Alt+S");
  });
  it("normalizes and validates custom boss keys", () => {
    assert.equal(parseBossKeyAccelerator("Ctrl+Shift+h"), "CommandOrControl+Shift+H");
    assert.equal(parseBossKeyAccelerator("Alt+F4"), null);
    assert.equal(parseBossKeyAccelerator("Super+L"), null);
    assert.equal(parseBossKeyAccelerator("S"), null);
    assert.equal(parseBossKeyAccelerator("F9"), "F9");
    assert.equal(parseBossKeyAccelerator("F11"), null);
    assert.equal(parseBossKeyAccelerator("Ctrl+Alt+Space"), "CommandOrControl+Alt+Space");
    assert.equal(parseBossKeyAccelerator("Ctrl+Shift+;"), "CommandOrControl+Shift+;");
    assert.equal(parseBossKeyAccelerator("Ctrl+Alt+F12"), "CommandOrControl+Alt+F12");
  });

  it("rejects holdings that do not reference a known security", () => {
    const settings = toUserSettings(loadAppConfigFromObject({
      securities: [{ code: "600519", name: "贵州茅台" }],
      watchlist: [{ securityCode: "600519", visible: true, order: 0 }]
    }));
    settings.holdings.push({
      securityCode: "000001",
      quantity: 100,
      costPrice: 10,
      groupId: "all",
      note: "",
      alertRules: {
        enabled: false,
        stopLossPrice: null,
        watchPrice: null,
        priceAbove: null,
        priceBelow: null,
        risePercent: null,
        fallPercent: null,
        dailyProfitAmount: null,
        dailyLossAmount: null,
        totalProfitAmount: null,
        totalLossAmount: null
      }
    });

    assert.throws(() => assertSavableSettings(settings), /持仓代码无效/);
  });
});
