import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AppSnapshot } from "../types";
import { buildTrayPresentation } from "../trayStatus";

function snapshot(): AppSnapshot {
  return {
    quotes: [
      {
        code: "600519",
        name: "甲",
        market: "SH",
        price: 100,
        change: 1,
        changePercent: 1,
        open: 99,
        previousClose: 99,
        high: 101,
        low: 98,
        volume: 1,
        amount: 1,
        source: "eastmoney"
      },
      {
        code: "000001",
        name: "乙",
        market: "SZ",
        price: 20,
        change: -0.2,
        changePercent: -1,
        open: 20,
        previousClose: 20.2,
        high: 20.3,
        low: 19.8,
        volume: 1,
        amount: 1,
        source: "eastmoney"
      }
    ],
    news: [],
    market: {
      indices: [
        {
          instrument: {
            key: "index:SH:000001",
            kind: "index",
            code: "000001",
            market: "SH",
            name: "上证"
          },
          price: 3000,
          change: 10,
          changePercent: 0.33,
          amount: 1,
          upCount: 1,
          downCount: 1,
          flatCount: 0,
          updatedAt: "2026-07-10T02:00:00.000Z",
          source: "eastmoney"
        }
      ],
      breadth: { upCount: 1, downCount: 1, flatCount: 0, amount: 1 },
      sectors: [],
      intraday: { items: [], source: null, stale: false, updatedAt: null, error: null },
      source: "eastmoney",
      stale: false,
      degraded: false,
      updatedAt: "2026-07-10T02:00:00.000Z",
      errors: []
    },
    risk: {
      mode: "shadow",
      paused: false,
      pausedThroughDate: null,
      dataSafe: true,
      holdings: [],
      groups: [],
      portfolio: {
        marketValue: 0,
        dailyPnl: 0,
        totalPnl: 0,
        dailyPnlR: null,
        totalPnlR: null,
        exposurePercent: null,
        holdingCount: 0,
        dataSafe: true,
        violations: []
      },
      recentEvents: [],
      updatedAt: "2026-07-10T02:00:00.000Z"
    },
    ai: {
      enabled: false,
      configured: false,
      secureStorageAvailable: false,
      credentialSource: "none",
      state: "unconfigured",
      provider: "deepseek",
      model: "x",
      lastTestedAt: null,
      lastSuccessAt: null,
      message: ""
    },
    errors: [],
    updatedAt: "2026-07-10T02:00:00.000Z",
    settings: {
      schemaVersion: 8,
      personalSeedVersion: 0,
      securities: [
        { code: "600519", market: "SH", name: "甲", alias: "项目甲" },
        { code: "000001", market: "SZ", name: "乙", alias: "" }
      ],
      holdings: [],
      watchlist: [
        { securityCode: "600519", visible: true, order: 0, groupId: "all" },
        { securityCode: "000001", visible: true, order: 1, groupId: "all" }
      ],
      tabs: [],
      navigation: {
        defaultTabId: "watchlist",
        rememberLastTab: false,
        lastActiveTabId: "watchlist"
      },
      quotes: { fields: ["price", "changePercent"], sort: "manual" },
      news: { mode: "all", maxItems: 5 },
      appearance: { theme: "standard", backgroundOpacity: 0.8 },
      ai: {
        enabled: false,
        provider: "deepseek",
        baseUrl: "https://api.deepseek.com",
        model: "x",
        timeoutSeconds: 20
      },
      risk: {
        mode: "shadow",
        accountBaseline: null,
        oneR: null,
        maxPositionValue: null,
        maxHoldingCount: null,
        maxTotalExposurePercent: null,
        portfolioDailyProfitThreshold: null,
        portfolioDailyLossThreshold: null,
        stopWarningPercent: 2,
        hysteresisPercent: 0.2,
        cooldownMinutes: 15,
        oncePerDay: false,
        onlyDuringTrading: true,
        notifications: { widget: true, tray: true, windows: false },
        groups: []
      },
      window: {
        width: 380,
        height: 520,
        x: null,
        y: null,
        alwaysOnTop: true,
        trayOnly: true,
        bossKeyEnabled: true,
        bossKeyAccelerator: "Control+Alt+Space",
        clickThrough: false,
        locked: false
      }
    },
    feeds: {
      quotes: {
        lastSuccessAt: "2026-07-10T02:00:00.000Z",
        dataUpdatedAt: "2026-07-10T02:00:00.000Z",
        lastChangedAt: "2026-07-10T02:00:00.000Z",
        stale: false,
        stalled: false,
        source: "eastmoney",
        coverage: 1,
        degraded: false,
        conflictCount: 0,
        retainedCount: 0,
        missingCount: 0,
        alertSafe: true,
        providerHealth: [],
        marketState: "trading"
      },
      news: {
        lastSuccessAt: null,
        dataUpdatedAt: null,
        lastChangedAt: null,
        stale: false,
        stalled: false,
        source: null,
        coverage: null,
        degraded: false,
        conflictCount: 0,
        retainedCount: 0,
        missingCount: 0,
        alertSafe: false,
        providerHealth: [],
        marketState: null
      }
    },
    ui: { clickThrough: false }
  };
}

describe("tray presentation", () => {
  it("summarizes indices and visible watchlist rows", () => {
    const result = buildTrayPresentation(snapshot());
    assert.equal(result.state, "neutral");
    assert.match(result.tooltip, /上证 \+0\.33%/);
    assert.match(result.tooltip, /自选1涨1跌/);
    assert.equal(result.quoteLabels[0], "项目甲 100.00 +1.00%");
  });

  it("prioritizes degraded quote health", () => {
    const value = snapshot();
    value.feeds.quotes.degraded = true;
    assert.equal(buildTrayPresentation(value).state, "degraded");
  });

  it("keeps attention only for alerts inside the recent window", () => {
    const value = snapshot();
    value.risk.recentEvents = [
      {
        id: "e1",
        ruleId: "holding:600519:price-above",
        type: "price_above",
        title: "测试股价格向上突破",
        message: "现价 11",
        value: 11,
        threshold: 10,
        triggeredAt: "2026-07-10T02:00:00.000Z",
        mode: "active"
      }
    ];

    assert.equal(
      buildTrayPresentation(value, new Date("2026-07-10T02:10:00.000Z")).state,
      "attention"
    );
    // 40 分钟后不应再让托盘停留在"注意"（此前只看事件条数，永不过期）。
    assert.equal(
      buildTrayPresentation(value, new Date("2026-07-10T02:40:00.000Z")).state,
      "neutral"
    );
    // 暂停提醒时同样不显示。
    const paused = { ...value, risk: { ...value.risk, paused: true } };
    assert.equal(
      buildTrayPresentation(paused, new Date("2026-07-10T02:10:00.000Z")).state,
      "neutral"
    );
  });
});
