import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import type { UserSettings } from "../../config";
import { exportProfile, previewProfileImport, profilePrompt } from "../profile";

function current(): UserSettings {
  return {
    schemaVersion: 8,
    personalSeedVersion: 1,
    securities: [{ code: "000001", market: "SZ", name: "平安银行", alias: "" }],
    holdings: [{
      securityCode: "000001", quantity: 3000, costPrice: 10, groupId: "all", note: "",
      alertRules: {
        enabled: true, stopLossPrice: 9, watchPrice: 11, priceAbove: null, priceBelow: null,
        risePercent: null, fallPercent: null, dailyProfitAmount: null, dailyLossAmount: null,
        totalProfitAmount: null, totalLossAmount: null
      }
    }],
    watchlist: [{ securityCode: "000001", visible: true, order: 0, groupId: "all" }],
    tabs: [{ id: "holdings", type: "holdings", title: "持仓", builtIn: true, visible: true, order: 0, securityCodes: [], maxItems: 8, newsMode: "important" }],
    navigation: { defaultTabId: "holdings", rememberLastTab: false, lastActiveTabId: "holdings" },
    quotes: { fields: ["price", "changePercent"], sort: "manual" },
    news: { mode: "important", maxItems: 5 },
    appearance: { theme: "stealth", backgroundOpacity: 0.8 },
    ai: { enabled: true, provider: "deepseek", baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash", timeoutSeconds: 20 },
    risk: {
      mode: "active", accountBaseline: 50_000, oneR: 500, maxPositionValue: null,
      maxHoldingCount: null, maxTotalExposurePercent: null,
      portfolioDailyProfitThreshold: null, portfolioDailyLossThreshold: null,
      stopWarningPercent: 2, hysteresisPercent: 0.2, cooldownMinutes: 15,
      oncePerDay: false, onlyDuringTrading: true,
      notifications: { widget: true, tray: true, windows: false }, groups: []
    },
    window: { width: 380, height: 680, x: null, y: null, alwaysOnTop: true, trayOnly: true, bossKeyEnabled: true, bossKeyAccelerator: "CommandOrControl+Alt+Space", clickThrough: false, locked: false }
  };
}

describe("portable profile packages", () => {
  it("keeps the public example as a valid simulated portfolio worth about 200,000 yuan", () => {
    const text = readFileSync(path.join(process.cwd(), "config", "example-profile.json"), "utf8");
    const preview = previewProfileImport(current(), text, "replace");
    assert.equal(preview.valid, true);
    const simulatedCost = preview.nextSettings?.holdings.reduce(
      (total, holding) => total + holding.quantity * holding.costPrice,
      0
    );
    assert.equal(simulatedCost, 200_000);
  });
  it("merges AI-generated holdings and preserves omitted existing alert rules", () => {
    const payload = JSON.stringify({
      profileVersion: 1,
      securities: [{ code: "000001", market: "SZ", name: "平安银行", alias: "平安" }],
      holdings: [{ securityCode: "000001", quantity: 3200, costPrice: 10.2 }]
    });
    const preview = previewProfileImport(current(), payload, "merge");
    assert.equal(preview.valid, true);
    assert.equal(preview.nextSettings?.holdings[0]?.quantity, 3200);
    assert.equal(preview.nextSettings?.holdings[0]?.alertRules.stopLossPrice, 9);
    assert.deepEqual(preview.diff.holdingsUpdated, ["000001"]);
  });

  it("replaces only collections explicitly present and forces imported rules to shadow mode", () => {
    const payload = JSON.stringify({
      profileVersion: 1,
      securities: [{ code: "600519", market: "SH", name: "贵州茅台", alias: "" }],
      holdings: [{
        securityCode: "600519", quantity: 100, costPrice: 1200,
        alertRules: { enabled: true, stopLossPrice: 1080 }
      }],
      watchlist: ["600519"]
    });
    const preview = previewProfileImport(current(), payload, "replace");
    assert.equal(preview.valid, true);
    assert.deepEqual(preview.nextSettings?.holdings.map((item) => item.securityCode), ["600519"]);
    assert.equal(preview.nextSettings?.risk.mode, "shadow");
    assert.deepEqual(preview.diff.holdingsRemoved, ["000001"]);
    assert.ok(preview.issues.some((issue) => issue.severity === "warning"));
  });

  it("rejects guessed, unknown and malformed fields instead of silently normalizing them", () => {
    const payload = JSON.stringify({
      profileVersion: 1,
      securities: [{ code: "34", market: "SZ", name: "错误" }],
      holdings: [{ securityCode: "000001", quantity: -1, costPrice: 0, magicFormula: "buy" }],
      apiKey: "must-not-import"
    });
    const preview = previewProfileImport(current(), payload, "merge");
    assert.equal(preview.valid, false);
    assert.ok(preview.issues.some((issue) => issue.path === "$.apiKey"));
    assert.ok(preview.issues.some((issue) => issue.path.includes("magicFormula")));
  });

  it("exports no credentials or window configuration and creates a constrained AI prompt", () => {
    const exported = exportProfile(current());
    const prompt = profilePrompt();
    assert.equal(exported.includes("apiKey"), false);
    assert.equal(exported.includes("bossKeyAccelerator"), false);
    assert.match(prompt, /绝对禁止猜测/);
    assert.match(prompt, /只输出一个 JSON 对象/);
  });

  it("accepts a JSON code fence for convenient agent handoff", () => {
    const preview = previewProfileImport(current(), "```json\n{\"profileVersion\":1,\"watchlist\":[\"000001\"]}\n```", "merge");
    assert.equal(preview.valid, true);
    assert.equal(preview.hasChanges, false);
  });

  it("marks identical portable configuration as a no-op", () => {
    const settings = current();
    settings.risk.mode = "shadow";
    const preview = previewProfileImport(settings, exportProfile(settings), "replace");
    assert.equal(preview.valid, true);
    assert.equal(preview.hasChanges, false);
  });

  it("does not delete portfolio collections when replace only updates security metadata", () => {
    const preview = previewProfileImport(current(), JSON.stringify({
      profileVersion: 1,
      securities: [{ code: "000001", market: "SZ", name: "平安银行", alias: "新别名" }]
    }), "replace");
    assert.equal(preview.valid, true);
    assert.equal(preview.nextSettings?.holdings.length, 1);
    assert.equal(preview.nextSettings?.watchlist.length, 1);
    assert.equal(preview.nextSettings?.securities[0]?.alias, "新别名");
  });

  it("rejects a market that conflicts with the security code", () => {
    const preview = previewProfileImport(current(), JSON.stringify({
      profileVersion: 1,
      securities: [{ code: "600519", market: "SZ", name: "示例股票" }]
    }), "merge");
    assert.equal(preview.valid, false);
    assert.ok(preview.issues.some((issue) => issue.path.endsWith(".market")));
  });

  it("reports watchlist visibility and order changes", () => {
    const settings = current();
    settings.securities.push({ code: "600519", market: "SH", name: "示例股票", alias: "" });
    settings.watchlist.push({ securityCode: "600519", visible: true, order: 1, groupId: "all" });
    const preview = previewProfileImport(settings, JSON.stringify({
      profileVersion: 1,
      watchlist: [
        { securityCode: "600519", visible: true, order: 0 },
        { securityCode: "000001", visible: false, order: 1 }
      ]
    }), "replace");
    assert.equal(preview.valid, true);
    assert.deepEqual(preview.diff.watchlistUpdated.sort(), ["000001", "600519"]);
  });

  it("rejects a package that exceeds the savable watchlist limit", () => {
    const securities = Array.from({ length: 51 }, (_, index) => ({
      code: String(600000 + index), market: "SH", name: `示例${index}`
    }));
    const preview = previewProfileImport(current(), JSON.stringify({
      profileVersion: 1,
      securities,
      watchlist: securities.map((security) => security.code)
    }), "replace");
    assert.equal(preview.valid, false);
    assert.ok(preview.issues.some((issue) => /最多50只/.test(issue.message)));
  });
});
