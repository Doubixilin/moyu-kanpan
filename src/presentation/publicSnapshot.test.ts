import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AppSnapshot, MarketDetail } from "../domain/types";
import {
  buildPublicSnapshot,
  buildPublicTrend,
  normalizePublicSnapshot,
  normalizePublicTrend
} from "./publicSnapshot";

describe("public local-web snapshot", () => {
  it("keeps useful display data and excludes sensitive settings", () => {
    const snapshot = {
      updatedAt: "2026-07-12T03:00:00.000Z",
      quotes: [
        {
          code: "600519",
          name: "甲",
          price: 100,
          changePercent: 1.2,
          updatedAt: "2026-07-12T03:00:00.000Z",
          quality: { state: "fresh" }
        }
      ],
      market: {
        indices: [
          {
            instrument: { name: "综合指标" },
            price: 4000,
            changePercent: 0.2,
            updatedAt: "2026-07-12T03:00:00.000Z"
          }
        ]
      },
      news: [
        {
          id: "n1",
          title: "公开事项更新",
          publishedAt: "2026-07-12T02:59:00.000Z",
          sourceTier: "official",
          url: "https://private.example/path",
          analysis: { priority: "high" }
        }
      ],
      settings: {
        securities: [{ code: "600519", name: "", alias: "项目甲" }],
        watchlist: [{ securityCode: "600519", visible: true, order: 0 }],
        holdings: [{ securityCode: "600519", quantity: 200, costPrice: 88.88 }],
        ai: { apiKey: "secret-key" }
      },
      feeds: {
        quotes: {
          marketState: "trading",
          lastSuccessAt: "2026-07-12T03:00:00.000Z",
          stale: false,
          degraded: false
        },
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
      daily: {
        updatedAt: "2026-07-12T02:59:00.000Z",
        stale: false,
        items: [
          {
            date: "2026-07-11",
            open: 99,
            high: 103,
            low: 98,
            close: 101,
            volume: 10_000,
            amount: 99_999,
            bollUpper: 110,
            bollMid: 100,
            bollLower: 90
          }
        ]
      }
    } as unknown as MarketDetail;
    const trend = buildPublicTrend(detail);
    const serialized = JSON.stringify(trend);
    assert.equal(trend.items[0]?.mid, 100);
    assert.ok(!serialized.includes("volume"));
    assert.ok(!serialized.includes("amount"));
    assert.ok(!serialized.includes("open"));
    assert.ok(!serialized.includes("high"));
    assert.deepEqual(Object.keys(trend.items[0] ?? {}).sort(), [
      "close",
      "date",
      "lower",
      "mid",
      "upper"
    ]);
  });
});

describe("public payload boundary validation", () => {
  it("rejects payloads whose skeleton is not an object", () => {
    for (const value of [null, undefined, "snapshot", 42, []]) {
      assert.equal(normalizePublicSnapshot(value), null, String(value));
      assert.equal(normalizePublicTrend(value), null, String(value));
    }
    // trend 的 items 必须是数组：缺了它就没有可画的东西
    assert.equal(normalizePublicTrend({ code: "600519", items: "nope" }), null);
  });

  it("repairs a snapshot with missing optional fields", () => {
    const snapshot = normalizePublicSnapshot({
      updatedAt: "2026-07-12T03:00:00.000Z",
      marketState: "trading",
      quotes: [{ code: "600519", name: "甲", price: 100, changePercent: 1.2 }]
    });
    assert.ok(snapshot);
    assert.equal(snapshot.marketState, "trading");
    assert.equal(snapshot.quotes[0]?.status, "");
    assert.equal(snapshot.quotes[0]?.updatedAt, null);
    assert.deepEqual(snapshot.indices, []);
    assert.deepEqual(snapshot.events, []);
    // feeds 缺失时补成"未知"而不是让渲染层读 undefined
    assert.deepEqual(snapshot.feeds, {
      quotesUpdatedAt: null,
      newsUpdatedAt: null,
      stale: false,
      degraded: false
    });
  });

  it("drops malformed entries and unknown enum values", () => {
    const snapshot = normalizePublicSnapshot({
      updatedAt: "now",
      marketState: "not-a-state",
      quotes: [{ name: "没有代码" }, { code: "000001", price: "12.3" }, "junk"],
      events: [{ id: "e1", title: "标题", priority: "高" }, { title: "没有 id" }]
    });
    assert.ok(snapshot);
    assert.equal(snapshot.marketState, null);
    assert.deepEqual(
      snapshot.quotes.map((item) => item.code),
      ["000001"]
    );
    // 非数字的 price 被降级为 null，而不是原样传给渲染层
    assert.equal(snapshot.quotes[0]?.price, null);
    assert.deepEqual(
      snapshot.events.map((item) => item.id),
      ["e1"]
    );
    assert.equal(snapshot.events[0]?.priority, "普通");
  });

  it("validates trend items and keeps nullable boll values", () => {
    const trend = normalizePublicTrend({
      code: "600519",
      name: "甲",
      updatedAt: "now",
      stale: true,
      items: [
        { date: "2026-07-11", close: 100, upper: 110, mid: null, lower: 90 },
        { date: "2026-07-12" },
        { close: 1 }
      ]
    });
    assert.ok(trend);
    assert.equal(trend.stale, true);
    assert.deepEqual(trend.items, [
      { date: "2026-07-11", close: 100, upper: 110, mid: null, lower: 90 }
    ]);
  });
});
