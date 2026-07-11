import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadAppConfigFromObject } from "../../config";
import type { Quote } from "../types";
import { buildAlertCandidates, calculateRiskSnapshot } from "../risk";

function settings() {
  return loadAppConfigFromObject({
    securities: [{ code: "600519", market: "SH", name: "测试股" }],
    watchlist: [{ securityCode: "600519", visible: true, order: 0 }],
    risk: {
      mode: "shadow",
      accountBaseline: 1000,
      oneR: 100,
      maxPositionValue: 1000,
      maxHoldingCount: 1,
      maxTotalExposurePercent: 100,
      portfolioDailyProfitThreshold: 80,
      portfolioDailyLossThreshold: 50,
      stopWarningPercent: 5,
      groups: [{ id: "tech", name: "科技组", profitThreshold: 150, lossThreshold: 100 }]
    },
    holdings: [{
      securityCode: "600519",
      quantity: 100,
      costPrice: 10,
      groupId: "tech",
      alertRules: {
        enabled: true,
        stopLossPrice: 9,
        watchPrice: 13,
        priceAbove: 12.5,
        priceBelow: 9.5,
        risePercent: 5,
        fallPercent: 4,
        dailyProfitAmount: 80,
        dailyLossAmount: 50,
        totalProfitAmount: 150,
        totalLossAmount: 100
      }
    }]
  });
}

function quote(patch: Partial<Quote> = {}): Quote {
  return {
    code: "600519",
    name: "测试股",
    market: "SH",
    price: 12,
    change: 1,
    changePercent: 9.09,
    open: 11,
    previousClose: 11,
    high: 12,
    low: 10.8,
    volume: 1,
    amount: 1,
    source: "eastmoney",
    quality: {
      state: "fresh",
      receivedAt: "2026-07-10T02:00:00.000Z",
      reasons: [],
      originalSource: "eastmoney"
    },
    ...patch
  };
}

describe("deterministic risk calculations", () => {
  it("calculates market value, daily/total PnL and account-level R deterministically", () => {
    const result = calculateRiskSnapshot({
      settings: settings(),
      quotes: [quote()],
      feedHealthy: true,
      now: new Date("2026-07-10T02:00:00.000Z")
    });
    const holding = result.holdings[0]!;

    assert.equal(holding.marketValue, 1200);
    assert.equal(holding.dailyPnl, 100);
    assert.equal(holding.totalPnl, 200);
    assert.equal(holding.totalPnlR, 2);
    assert.equal(holding.plannedRiskAmount, 100);
    assert.equal(holding.plannedRiskR, 1);
    assert.equal(holding.stopDistancePercent, 25);
    assert.equal(result.portfolio.exposurePercent, 120);
    assert.equal(result.groups[0]?.totalPnl, 200);
    assert.ok(result.portfolio.violations.some((item) => item.id === "portfolio:exposure"));
    assert.ok(result.groups[0]?.violations.some((item) => item.id === "group:tech:profit"));
  });

  it("marks retained or conflicted quotes unsafe and suppresses threshold violations", () => {
    const result = calculateRiskSnapshot({
      settings: settings(),
      quotes: [quote({
        source: "local",
        quality: {
          state: "retained",
          receivedAt: "2026-07-10T02:00:00.000Z",
          reasons: ["provider_down"]
        }
      })],
      feedHealthy: true
    });

    assert.equal(result.holdings[0]?.dataSafe, false);
    assert.equal(result.portfolio.dataSafe, false);
    assert.equal(result.holdings[0]?.violations.length, 0);
  });

  it("builds explicit crossing candidates without inventing buy or sell actions", () => {
    const currentSettings = settings();
    const snapshot = calculateRiskSnapshot({
      settings: currentSettings,
      quotes: [quote()],
      feedHealthy: true
    });
    const candidates = buildAlertCandidates(currentSettings, snapshot);

    assert.equal(candidates.find((item) => item.type === "stop_loss")?.threshold, 9);
    assert.equal(candidates.find((item) => item.type === "fall_percent")?.threshold, -4);
    assert.equal(candidates.find((item) => item.type === "daily_loss")?.threshold, -50);
    assert.equal(candidates.find((item) => item.type === "group_loss")?.threshold, -100);
    assert.ok(candidates.every((item) => !/买入|卖出/.test(item.title + item.message)));
  });

  it("keeps account-level position limits active when local holding alerts are disabled", () => {
    const currentSettings = settings();
    currentSettings.holdings[0]!.alertRules.enabled = false;
    const snapshot = calculateRiskSnapshot({
      settings: currentSettings,
      quotes: [quote()],
      feedHealthy: true
    });
    const candidates = buildAlertCandidates(currentSettings, snapshot);

    assert.ok(candidates.some((item) => item.ruleId === "holding:600519:position"));
    assert.equal(candidates.some((item) => item.ruleId === "holding:600519:stop-loss"), false);
  });
});
