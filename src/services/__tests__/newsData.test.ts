import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import type { NewsItem } from "../../domain/types";
import { NewsDataCoordinator, type NewsProviderSet } from "../newsData";
import { SqliteNewsEventStore } from "../newsEvents";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function setup(providers: NewsProviderSet) {
  const directory = mkdtempSync(path.join(tmpdir(), "floating-news-data-"));
  directories.push(directory);
  const store = new SqliteNewsEventStore(path.join(directory, "events.sqlite"));
  return {
    store,
    coordinator: new NewsDataCoordinator(store, providers, {
      officialMs: 300_000,
      policyMs: 900_000
    })
  };
}

function doc(source: string, code = "000001"): NewsItem {
  return {
    id: `${source}-1`,
    title: "平安银行关于担保事项的公告",
    url: `https://example.com/${source}`,
    source,
    sourceTier: source === "eastmoney" ? "media" : "official",
    documentType: source === "eastmoney" ? "fast_news" : "announcement",
    materialStatus: "title_only",
    publishedAt: "2026-07-11T00:00:00.000Z",
    relatedCodes: [code]
  };
}

function providers(): NewsProviderSet {
  return {
    media: async () => [doc("eastmoney")],
    cninfo: async () => [doc("cninfo")],
    sse: async () => [],
    szse: async () => [],
    policy: async () => []
  };
}

describe("news data coordinator", () => {
  it("merges official and media documents before returning events", async () => {
    const { store, coordinator } = setup(providers());
    const result = await coordinator.refresh(["000001"], {
      now: new Date("2026-07-11T01:00:00.000Z")
    });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]?.source, "cninfo");
    assert.equal(result.items[0]?.documentCount, 2);
    store.close();
  });

  it("uses the exchange fallback and retains history when later sources fail", async () => {
    const set = providers();
    set.cninfo = async () => {
      throw new Error("cninfo down");
    };
    set.szse = async () => [doc("szse")];
    const { store, coordinator } = setup(set);
    const first = await coordinator.refresh(["000001"], {
      now: new Date("2026-07-11T01:00:00.000Z")
    });
    assert.equal(first.items[0]?.source, "szse");
    assert.ok(first.errors.some((error) => error.startsWith("cninfo:")));

    set.media = async () => {
      throw new Error("media down");
    };
    set.szse = async () => {
      throw new Error("szse down");
    };
    const second = await coordinator.refresh(["000001"], {
      now: new Date("2026-07-11T01:06:00.000Z")
    });
    assert.equal(second.items.length, 1);
    store.close();
  });

  it("throttles official and policy connectors between fast-news polls", async () => {
    const set = providers();
    let officialCalls = 0;
    let policyCalls = 0;
    set.cninfo = async () => {
      officialCalls += 1;
      return [];
    };
    set.policy = async () => {
      policyCalls += 1;
      return [];
    };
    const { store, coordinator } = setup(set);
    await coordinator.refresh(["000001"], { now: new Date("2026-07-11T01:00:00.000Z") });
    await coordinator.refresh(["000001"], { now: new Date("2026-07-11T01:01:00.000Z") });
    assert.equal(officialCalls, 1);
    assert.equal(policyCalls, 1);
    store.close();
  });

  it("does not report an empty media response as a successful live refresh", async () => {
    const set = providers();
    const { store, coordinator } = setup(set);
    await coordinator.refresh(["000001"], {
      now: new Date("2026-07-11T01:00:00.000Z")
    });
    set.media = async () => [];
    set.cninfo = async () => {
      throw new Error("official unavailable");
    };
    set.szse = async () => {
      throw new Error("exchange unavailable");
    };
    set.policy = async () => [];
    const result = await coordinator.refresh(["000001"], {
      now: new Date("2026-07-11T01:16:00.000Z")
    });
    assert.equal(result.attempted, true);
    assert.equal(result.liveSuccess, false);
    assert.equal(result.sources.includes("eastmoney"), false);
    assert.ok(result.errors.some((entry) => entry.includes("empty response")));
    store.close();
  });
});
