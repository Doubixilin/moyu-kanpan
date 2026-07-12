import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AppSnapshot, MarketDetail } from "../domain/types";
import { buildPublicSnapshot, buildPublicTrend } from "./publicSnapshot";

describe("public local-web snapshot", () => {
  it("keeps useful display data and excludes sensitive settings", () => {
    const snapshot = {
      updatedAt: "2026-07-12T03:00:00.000Z",
      quotes: [{ code: "600519", name: "甲", price: 100, changePercent: 1.2,
        updatedAt: "2026-07-12T03:00:00.000Z", quality: { state: "fresh" } }],
      market: { indices: [{ instrument: { name: "综合指标" }, price: 4000,
        changePercent: 0.2, updatedAt: "2026-07-12T03:00:00.000Z" }] },
      news: [{ id: "n1", title: "公开事项更新", publishedAt: "2026-07-12T02:59:00.000Z",
        sourceTier: "official", url: "https://private.example/path", analysis: { priority: "high" } }],
      settings: {
        securities: [{ code: "600519", name: "", alias: "项目甲" }],
        watchlist: [{ securityCode: "600519", visible: true, order: 0 }],
        holdings: [{ securityCode: "600519", quantity: 200, costPrice: 88.88 }],
        ai: { apiKey: "secret-key" }
      },
      feeds: {
        quotes: { marketState: "trading", lastSuccessAt: "2026-07-12T03:00:00.000Z", stale: false, degraded: false },
        news: { lastSuccessAt: "2026-07-12T02:59:00.000Z" }
      }
    } as unknown as AppSnapshot;
    const result = buildPublicSnapshot(snapshot);
    const serialized = JSON.stringify(result);
    assert.equal(result.quotes[0]?.name, "项目甲");
    assert.equal(result.events[0]?.priority, "重要");
    assert.ok(!serialized.includes("secret-key"));
    assert.ok(!serialized.includes("88.88"));
    assert.ok(!serialized.includes("quantity"));
    assert.ok(!serialized.includes("private.example"));
  });

  it("publishes only bounded BOLL display fields for an on-demand trend", () => {
    const detail = {
      instrument: { code: "600519", name: "项目甲" },
      fetchedAt: "2026-07-12T03:00:00.000Z",
      daily: { updatedAt: "2026-07-12T02:59:00.000Z", stale: false,
        items: [{ date: "2026-07-11", open: 99, high: 103, low: 98, close: 101,
          volume: 10_000, amount: 99_999, bollUpper: 110, bollMid: 100, bollLower: 90 }] }
    } as unknown as MarketDetail;
    const trend = buildPublicTrend(detail);
    const serialized = JSON.stringify(trend);
    assert.equal(trend.items[0]?.mid, 100);
    assert.ok(!serialized.includes("volume"));
    assert.ok(!serialized.includes("amount"));
    assert.ok(!serialized.includes("open"));
    assert.ok(!serialized.includes("high"));
    assert.deepEqual(Object.keys(trend.items[0] ?? {}).sort(), ["close", "date", "lower", "mid", "upper"]);
  });
});
