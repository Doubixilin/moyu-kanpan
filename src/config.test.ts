import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  activeSecurityCodes,
  assertSavableSettings,
  inferSecurityMarket,
  loadAppConfigFromObject,
  MAX_HOLDING_COST_PRICE,
  MAX_HOLDING_QUANTITY,
  MAX_TABS,
  MAX_TAB_SECURITY_CODES,
  MIN_HOLDING_COST_PRICE,
  preserveRuntimeSecrets,
  toUserSettings
} from "./config";
import { parseBossKeyAccelerator } from "./shortcut";

describe("config", () => {
  it("migrates a legacy watchlist into normalized securities and memberships", () => {
    const config = loadAppConfigFromObject(
      {
        watchlist: [{ code: "600519", alias: "茅台", visible: true, order: 0 }, "000001"],
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

    assert.deepEqual(
      config.securities.map((item) => item.code),
      ["600519", "000001"]
    );
    assert.equal(config.securities[0]?.alias, "茅台");
    assert.deepEqual(
      config.watchlist.map((item) => item.securityCode),
      ["600519", "000001"]
    );
    assert.deepEqual(activeSecurityCodes(config), ["600519", "000001"]);
    assert.equal(config.navigation.defaultTabId, "watchlist");
    assert.deepEqual(
      config.tabs.filter((tab) => tab.visible).map((tab) => tab.id),
      ["holdings", "watchlist", "market", "drivers"]
    );
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
    const config = loadAppConfigFromObject(
      {
        securities: [
          { code: "300750", name: "宁德时代", alias: "宁德", market: "SZ" },
          { code: "600519", name: "贵州茅台", alias: "", market: "SH" }
        ],
        holdings: [{ securityCode: "300750", quantity: 200, costPrice: 180.12345 }],
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
      },
      { AI_API_KEY: "never-expose" }
    );

    assert.equal(config.holdings[0]?.costPrice, 180.1235);
    assert.equal(config.navigation.defaultTabId, "holdings");
    assert.equal(config.navigation.rememberLastTab, true);
    assert.deepEqual(config.tabs.find((tab) => tab.id === "custom-tech")?.securityCodes, [
      "300750"
    ]);

    const settings = toUserSettings(config);
    assert.deepEqual(
      settings.watchlist.map((item) => item.securityCode),
      ["600519", "300750"]
    );
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
      holdings: [
        {
          securityCode: "600519",
          quantity: 100,
          costPrice: 1000,
          groupId: "core",
          alertRules: { enabled: true, stopLossPrice: 900, fallPercent: 5 }
        }
      ]
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
    const settings = toUserSettings(
      loadAppConfigFromObject(
        {
          ai: {
            enabled: true,
            provider: "custom",
            baseUrl: "http://127.0.0.1:11434/v1",
            model: "local-fast",
            timeoutSeconds: 30
          }
        },
        { AI_API_KEY: "secret" }
      )
    );

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
      () =>
        assertSavableSettings({
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
    const settings = toUserSettings(
      loadAppConfigFromObject({
        securities: [{ code: "600519", name: "贵州茅台" }],
        watchlist: [{ securityCode: "600519", visible: true, order: 0 }]
      })
    );
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

  it("bounds holding magnitude so round() cannot overflow into Infinity", () => {
    const base = {
      securities: [{ code: "600519", market: "SH", name: "测试股" }],
      watchlist: [{ securityCode: "600519", visible: true, order: 0 }]
    };

    const huge = loadAppConfigFromObject({
      ...base,
      holdings: [{ securityCode: "600519", quantity: 1e308, costPrice: 1e308 }]
    });
    const holding = huge.holdings[0]!;

    assert.equal(Number.isFinite(holding.costPrice), true);
    assert.equal(Number.isFinite(holding.quantity), true);
    assert.equal(holding.costPrice, MAX_HOLDING_COST_PRICE);
    assert.equal(holding.quantity, MAX_HOLDING_QUANTITY);
    // 关键回归：持久化后不能变成 null，否则下次启动该持仓会被静默丢弃。
    const reloaded = loadAppConfigFromObject(JSON.parse(JSON.stringify(toUserSettings(huge))), {});
    assert.equal(reloaded.holdings.length, 1);
    assert.equal(reloaded.holdings[0]!.costPrice, MAX_HOLDING_COST_PRICE);
  });

  it("does not round a tiny cost price down to zero", () => {
    const config = loadAppConfigFromObject({
      securities: [{ code: "600519", market: "SH", name: "测试股" }],
      watchlist: [{ securityCode: "600519", visible: true, order: 0 }],
      holdings: [{ securityCode: "600519", quantity: 100, costPrice: 1e-9 }]
    });

    assert.equal(config.holdings[0]!.costPrice, MIN_HOLDING_COST_PRICE);
    assert.notEqual(config.holdings[0]!.costPrice, 0);
  });

  it("keeps a near-zero account baseline out of the division instead of rounding it to 0", () => {
    const config = loadAppConfigFromObject({
      securities: [{ code: "600519", market: "SH", name: "测试股" }],
      watchlist: [{ securityCode: "600519", visible: true, order: 0 }],
      risk: { accountBaseline: 1e-9 }
    });

    assert.equal(config.risk.accountBaseline, null);
  });

  it("infers the BSE market for 920xxx without misreading Shanghai B-shares", () => {
    // 北交所新代码段。
    assert.equal(inferSecurityMarket("920099"), "BJ");
    assert.equal(inferSecurityMarket("832000"), "BJ");
    assert.equal(inferSecurityMarket("430047"), "BJ");
    // 900xxx 是沪市 B 股。
    assert.equal(inferSecurityMarket("900001"), "SH");
    assert.equal(inferSecurityMarket("600519"), "SH");
    assert.equal(inferSecurityMarket("000001"), "SZ");
    assert.equal(inferSecurityMarket("300750"), "SZ");
  });

  it("rejects out-of-range and fractional holding values at the save boundary", () => {
    const settings = toUserSettings(
      loadAppConfigFromObject({
        securities: [{ code: "600519", market: "SH", name: "测试股" }],
        watchlist: [{ securityCode: "600519", visible: true, order: 0 }],
        holdings: [{ securityCode: "600519", quantity: 100, costPrice: 10 }]
      })
    );
    const withHolding = (patch: { quantity?: number; costPrice?: number }) => ({
      ...settings,
      holdings: [{ ...settings.holdings[0]!, ...patch }]
    });

    assert.doesNotThrow(() => assertSavableSettings(settings));
    assert.throws(() => assertSavableSettings(withHolding({ quantity: 100.5 })), /持仓数量无效/);
    assert.throws(
      () => assertSavableSettings(withHolding({ quantity: MAX_HOLDING_QUANTITY + 1 })),
      /持仓数量无效/
    );
    assert.throws(
      () => assertSavableSettings(withHolding({ costPrice: MAX_HOLDING_COST_PRICE * 10 })),
      /持仓成本无效/
    );
    assert.throws(
      () => assertSavableSettings(withHolding({ costPrice: MIN_HOLDING_COST_PRICE / 10 })),
      /持仓成本无效/
    );
    assert.throws(
      () => assertSavableSettings(withHolding({ costPrice: Infinity })),
      /持仓成本无效/
    );
  });

  it("treats an explicit empty watchlist as empty but migrates a missing one", () => {
    const explicitEmpty = loadAppConfigFromObject({
      securities: [{ code: "600519", market: "SH", name: "测试股" }],
      watchlist: []
    });
    assert.equal(explicitEmpty.watchlist.length, 0);

    // 旧版配置没有 watchlist 字段，仍应迁移为"全部证券"。
    const missing = loadAppConfigFromObject({
      securities: [
        { code: "600519", market: "SH", name: "测试股" },
        { code: "000001", market: "SZ", name: "平安银行" }
      ]
    });
    assert.deepEqual(
      missing.watchlist.map((item) => item.securityCode),
      ["600519", "000001"]
    );
  });

  it("rejects coerced numbers instead of accepting strings, booleans and arrays", () => {
    const settings = toUserSettings(
      loadAppConfigFromObject({
        securities: [{ code: "600519", market: "SH", name: "测试股" }],
        watchlist: [{ securityCode: "600519", visible: true, order: 0 }],
        holdings: [{ securityCode: "600519", quantity: 100, costPrice: 10 }]
      })
    );

    // asNumber 会把 "100"、true、[100] 都转成数字；断言路径必须拒绝它们。
    for (const quantity of ["100", true, [100]] as unknown[]) {
      assert.throws(
        () =>
          assertSavableSettings({
            ...settings,
            holdings: [{ ...settings.holdings[0]!, quantity }]
          }),
        /持仓数量无效/,
        `quantity=${JSON.stringify(quantity)} 应被拒绝`
      );
    }
    assert.throws(
      () =>
        assertSavableSettings({
          ...settings,
          risk: { ...settings.risk, accountBaseline: "50000" }
        }),
      /风险参数无效/
    );
    assert.throws(
      () =>
        assertSavableSettings({
          ...settings,
          ai: { ...settings.ai, timeoutSeconds: "30" }
        }),
      /AI 请求超时/
    );
  });

  it("caps custom tabs and tab security codes", () => {
    const codes = Array.from({ length: MAX_TAB_SECURITY_CODES + 5 }, (_, index) =>
      String(600000 + index)
    );
    const config = loadAppConfigFromObject({
      securities: [{ code: "600519", market: "SH", name: "测试股" }],
      tabs: [
        {
          id: "wide",
          type: "stock-list",
          title: "大页",
          securityCodes: codes,
          visible: true,
          order: 9
        },
        ...Array.from({ length: MAX_TABS + 5 }, (_, index) => ({
          id: `custom-${index}`,
          type: "stock-list",
          title: `页${index}`,
          securityCodes: ["600519"],
          visible: true,
          order: index + 10
        }))
      ]
    });

    assert.equal(config.tabs.length, MAX_TABS);
    const wide = config.tabs.find((tab) => tab.id === "wide");
    assert.equal(wide?.securityCodes.length, MAX_TAB_SECURITY_CODES);

    // 超限时 assertSavableSettings 必须报错，而不是静默截断。
    // 注意：tab 里的代码会被 ensureSecurity 补进证券表，因此这里用最小配置单独构造载荷，
    // 否则会先撞上"证券资料最多100只"。
    const settings = toUserSettings(
      loadAppConfigFromObject({
        securities: [{ code: "600519", market: "SH", name: "测试股" }],
        watchlist: [{ securityCode: "600519", visible: true, order: 0 }]
      })
    );
    assert.throws(
      () =>
        assertSavableSettings({
          ...settings,
          tabs: [{ ...settings.tabs[0]!, securityCodes: codes }]
        }),
      /自定义代码最多/
    );
    assert.throws(
      () =>
        assertSavableSettings({
          ...settings,
          tabs: Array.from({ length: MAX_TABS + 1 }, (_, index) => ({
            ...settings.tabs[0]!,
            id: `t${index}`
          }))
        }),
      /页面最多/
    );
  });

  it("normalizes a stored market that contradicts the security code", () => {
    // 行情路由是按代码前缀推导的（920xxx → 北交所），若保留矛盾的显式值，
    // 就会出现"配置说沪市、实际按北交所取数"的不一致。
    const config = loadAppConfigFromObject({
      securities: [
        { code: "920099", market: "SH", name: "北交所标的" },
        { code: "600519", market: "SH", name: "沪市标的" },
        { code: "000001", market: "SZ", name: "深市标的" }
      ]
    });

    assert.equal(config.securities[0]?.market, "BJ");
    assert.equal(config.securities[1]?.market, "SH");
    assert.equal(config.securities[2]?.market, "SZ");
  });

  it("keeps a custom tab declared as watchlist instead of downgrading it", () => {
    const config = loadAppConfigFromObject({
      securities: [{ code: "600519", market: "SH", name: "测试股" }],
      tabs: [{ id: "my-watch", type: "watchlist", title: "自选", visible: true, order: 20 }]
    });

    assert.equal(config.tabs.find((tab) => tab.id === "my-watch")?.type, "watchlist");
  });
});
