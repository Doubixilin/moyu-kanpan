import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_MARKET_INDICES } from "../../domain/market";
import type {
  DailyCandle,
  IntradayPoint,
  MarketIndexQuote,
  MarketInstrument,
  MarketSector
} from "../../domain/types";
import {
  MarketDataCoordinator,
  type MarketCacheData,
  type MarketCacheStore,
  type MarketProviderSet
} from "../marketData";

const nowMs = Date.parse("2026-07-10T06:00:00.000Z");

function indexQuote(
  instrument: MarketInstrument,
  source: "eastmoney" | "tencent"
): MarketIndexQuote {
  return {
    instrument,
    price: 4000,
    change: 10,
    changePercent: 0.25,
    amount: 100,
    upCount: source === "eastmoney" ? 100 : null,
    downCount: source === "eastmoney" ? 80 : null,
    flatCount: source === "eastmoney" ? 5 : null,
    updatedAt: "2026-07-10T05:59:30.000Z",
    source
  };
}

function intraday(name = "上证指数") {
  const items: IntradayPoint[] = [
    { time: "2026-07-10T05:59:00.000Z", price: 4000, average: 3990, volume: 1, amount: 1 }
  ];
  return { name, previousClose: 3990, items, updatedAt: items[0]!.time };
}

function daily(name = "上证指数") {
  const items: DailyCandle[] = Array.from({ length: 25 }, (_, index) => ({
    date: `2026-06-${String(index + 1).padStart(2, "0")}`,
    open: 100 + index,
    close: 101 + index,
    high: 102 + index,
    low: 99 + index,
    volume: 1000 + index,
    amount: 10_000 + index,
    bollMid: null,
    bollUpper: null,
    bollLower: null
  }));
  return { name, items, updatedAt: items.at(-1)!.date };
}

function sector(): MarketSector {
  return {
    code: "BK1",
    name: "半导体",
    price: 100,
    changePercent: 2,
    amount: 1,
    source: "eastmoney"
  };
}

function providers(): MarketProviderSet {
  return {
    eastmoneyIndices: async (instruments) =>
      instruments.map((item) => indexQuote(item, "eastmoney")),
    tencentIndices: async (instruments) => instruments.map((item) => indexQuote(item, "tencent")),
    eastmoneySectors: async () => [sector()],
    eastmoneyIntraday: async () => intraday(),
    tencentIntraday: async () => intraday(),
    eastmoneyDaily: async () => daily(),
    tencentDaily: async () => daily()
  };
}

class MemoryCache implements MarketCacheStore {
  value: MarketCacheData | null = null;
  writes = 0;

  async read(): Promise<MarketCacheData | null> {
    return this.value;
  }

  async write(value: MarketCacheData): Promise<void> {
    this.value = structuredClone(value);
    this.writes += 1;
  }
}

describe("market data coordinator", () => {
  it("caps the cached details and keeps the most recently written instruments", async () => {
    const cache = new MemoryCache();
    const coordinator = new MarketDataCoordinator(providers(), cache, { detailsLimit: 2 });
    const instruments = DEFAULT_MARKET_INDICES;

    for (const [index, instrument] of instruments.entries()) {
      // 每次推进 60s，确保都越过分时 TTL、是真实抓取，并按时间可确定淘汰顺序。
      await coordinator.fetchDetail(instrument, "eastmoney", {
        marketOpen: true,
        nowMs: nowMs + index * 60_000
      });
    }

    const details = cache.value?.details ?? {};
    assert.equal(Object.keys(details).length, 2);
    assert.equal(details[instruments[0]!.key], undefined);
    assert.notEqual(details[instruments[2]!.key], undefined);
  });

  it("does not rewrite the cache file when both series came from cache", async () => {
    const cache = new MemoryCache();
    const coordinator = new MarketDataCoordinator(providers(), cache);
    const instrument = DEFAULT_MARKET_INDICES[0]!;

    await coordinator.fetchDetail(instrument, "eastmoney", { marketOpen: true, nowMs });
    const writesAfterFetch = cache.writes;
    assert.equal(writesAfterFetch, 1);

    // 分时 TTL 25s、日 K TTL 5min：5 秒后两者都命中缓存，不应再全量重写。
    await coordinator.fetchDetail(instrument, "eastmoney", {
      marketOpen: true,
      nowMs: nowMs + 5_000
    });
    assert.equal(cache.writes, writesAfterFetch);
  });

  it("merges concurrent detail requests for the same instrument into one fan-out", async () => {
    const set = providers();
    let intradayCalls = 0;
    let dailyCalls = 0;
    set.eastmoneyIntraday = async () => {
      intradayCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return intraday();
    };
    set.eastmoneyDaily = async () => {
      dailyCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return daily();
    };
    const coordinator = new MarketDataCoordinator(set);
    const instrument = DEFAULT_MARKET_INDICES[0]!;
    const context = { marketOpen: true, nowMs };

    const [first, second] = await Promise.all([
      coordinator.fetchDetail(instrument, "eastmoney", context),
      coordinator.fetchDetail(instrument, "eastmoney", context)
    ]);

    assert.equal(intradayCalls, 1);
    assert.equal(dailyCalls, 1);
    assert.equal(first.instrument.key, second.instrument.key);
    // settle 之后条目要清除，后续请求不应被永久复用。
    await coordinator.fetchDetail(instrument, "eastmoney", {
      marketOpen: true,
      nowMs: nowMs + 60_000
    });
    assert.equal(intradayCalls, 2);
  });

  it("reuses a recent fast-index result in the heavier overview", async () => {
    const set = providers();
    let indexCalls = 0;
    set.eastmoneyIndices = async (instruments) => {
      indexCalls += 1;
      return instruments.map((item) => indexQuote(item, "eastmoney"));
    };
    const coordinator = new MarketDataCoordinator(set);
    await coordinator.fetchFastIndices("eastmoney", { marketOpen: true, nowMs });
    const overview = await coordinator.fetchOverview("eastmoney", {
      marketOpen: true,
      nowMs: nowMs + 5_000
    });

    assert.equal(indexCalls, 1);
    assert.equal(overview.indices.length, 3);
  });

  it("fills only missing indices from fallback and preserves requested order", async () => {
    const set = providers();
    let fallbackRequest: string[] = [];
    set.eastmoneyIndices = async (instruments) => [indexQuote(instruments[0]!, "eastmoney")];
    set.tencentIndices = async (instruments) => {
      fallbackRequest = instruments.map((item) => item.key);
      return instruments.map((item) => indexQuote(item, "tencent"));
    };
    const result = await new MarketDataCoordinator(set).fetchOverview("eastmoney", {
      marketOpen: true,
      nowMs
    });

    assert.deepEqual(
      fallbackRequest,
      DEFAULT_MARKET_INDICES.slice(1).map((item) => item.key)
    );
    assert.deepEqual(
      result.indices.map((item) => item.instrument.key),
      DEFAULT_MARKET_INDICES.map((item) => item.key)
    );
    assert.equal(result.source, "mixed");
    assert.equal(result.degraded, true);
  });

  it("keeps the last cached overview when both index sources fail", async () => {
    const cache = new MemoryCache();
    const set = providers();
    const coordinator = new MarketDataCoordinator(set, cache);
    const trusted = await coordinator.fetchOverview("eastmoney", { marketOpen: false, nowMs });
    assert.equal(trusted.indices.length, 3);

    set.eastmoneyIndices = async () => {
      throw new Error("east down");
    };
    set.tencentIndices = async () => {
      throw new Error("tencent down");
    };
    set.eastmoneySectors = async () => {
      throw new Error("sector down");
    };
    const retained = await coordinator.fetchOverview("eastmoney", {
      marketOpen: false,
      nowMs: nowMs + 60_000
    });

    assert.equal(retained.indices.length, 3);
    assert.equal(retained.stale, true);
    assert.equal(retained.degraded, true);
    assert.ok(retained.errors.some((error) => error.includes("east down")));
  });

  it("falls back intraday independently while keeping daily data on the primary", async () => {
    const set = providers();
    let tencentDailyCalls = 0;
    set.eastmoneyIntraday = async () => {
      throw new Error("intraday down");
    };
    set.tencentDaily = async () => {
      tencentDailyCalls += 1;
      return daily();
    };
    const detail = await new MarketDataCoordinator(set).fetchDetail(
      { key: "stock:SH:600519", kind: "stock", code: "600519", market: "SH", name: "贵州茅台" },
      "eastmoney",
      { marketOpen: false, nowMs }
    );

    assert.equal(detail.intraday.source, "tencent");
    assert.equal(detail.intraday.stale, false);
    assert.match(detail.intraday.error ?? "", /intraday down/);
    assert.equal(detail.daily.source, "eastmoney");
    assert.equal(tencentDailyCalls, 0);
    assert.notEqual(detail.daily.items.at(-1)?.bollMid, null);
  });

  it("returns stale local chart cache instead of throwing when both sources fail", async () => {
    const cache = new MemoryCache();
    const set = providers();
    const coordinator = new MarketDataCoordinator(set, cache, {
      intradayTtlMs: 1,
      dailyTtlMs: 1
    });
    const instrument = DEFAULT_MARKET_INDICES[0]!;
    await coordinator.fetchDetail(instrument, "eastmoney", { marketOpen: false, nowMs });

    set.eastmoneyIntraday = async () => {
      throw new Error("east down");
    };
    set.tencentIntraday = async () => {
      throw new Error("tencent down");
    };
    set.eastmoneyDaily = async () => {
      throw new Error("east down");
    };
    set.tencentDaily = async () => {
      throw new Error("tencent down");
    };
    const retained = await coordinator.fetchDetail(instrument, "eastmoney", {
      marketOpen: false,
      nowMs: nowMs + 10_000
    });

    assert.equal(retained.intraday.source, "local");
    assert.equal(retained.intraday.stale, true);
    assert.equal(retained.daily.source, "local");
    assert.equal(retained.daily.stale, true);
    assert.ok(cache.writes > 0);
  });

  it("ignores cache write failures without dropping live market data", async () => {
    const brokenCache: MarketCacheStore = {
      read: async () => null,
      write: async () => {
        throw new Error("disk full");
      }
    };
    const result = await new MarketDataCoordinator(providers(), brokenCache).fetchOverview(
      "eastmoney",
      { marketOpen: false, nowMs }
    );
    assert.equal(result.indices.length, 3);
  });
});
