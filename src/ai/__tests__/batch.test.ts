import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { NewsAnalysis, NewsItem } from "../../domain/types";
import { analysisFingerprint, CachedNewsAnalyzer, JsonNewsAnalysisCache } from "../batch";

function news(id: string): NewsItem {
  return {
    id,
    title: `新闻 ${id}`,
    url: `https://example.com/${id}`,
    source: "test",
    publishedAt: "2026-07-10T01:00:00.000Z"
  };
}

function analysis(id: string): NewsAnalysis {
  return {
    newsId: id,
    priority: "medium",
    status: "analyzed",
    useful: true,
    eventType: "other",
    relatedCodes: [],
    sourceRelatedCodes: [],
    inferredRelatedCodes: [],
    relation: "uncertain",
    direction: "neutral",
    horizon: "short",
    importance: 50,
    confidence: 50,
    modelConfidence: 60,
    materialLimited: false,
    summary: `摘要 ${id}`,
    mechanism: "机制",
    evidence: ["证据"],
    counterFactors: ["反向因素"],
    missingInformation: [],
    matchedKeywords: [],
    analyzedAt: "2026-07-10T01:00:00.000Z",
    provider: "ai",
    model: "test-model"
  };
}

describe("cached news analyzer", () => {
  it("batches up to five items and reuses namespaced memory cache", async () => {
    const batches: string[][] = [];
    const analyzer = new CachedNewsAnalyzer(
      async (items) => {
        batches.push(items.map((item) => item.id));
        return items.map((item) => analysis(item.id));
      },
      undefined,
      2
    );

    const items = [news("1"), news("2"), news("3"), news("4")];
    await analyzer.analyze(items, "ai:model:v1");
    await analyzer.analyze(items, "ai:model:v1");

    assert.deepEqual(batches, [
      ["1", "2"],
      ["3", "4"]
    ]);
  });

  it("persists successful AI results without storing credentials", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "ai-cache-"));
    const cachePath = path.join(directory, "analysis.json");
    let calls = 0;
    try {
      const first = new CachedNewsAnalyzer(async (items) => {
        calls += 1;
        return items.map((item) => analysis(item.id));
      }, new JsonNewsAnalysisCache(cachePath));
      await first.analyze([news("1")], "ai:model:v1");

      const second = new CachedNewsAnalyzer(async () => {
        calls += 1;
        return [];
      }, new JsonNewsAnalysisCache(cachePath));
      const restored = await second.analyze([news("1")], "ai:model:v1");

      assert.equal(calls, 1);
      assert.equal(restored[0]?.provider, "ai");
      assert.equal((await readFile(cachePath, "utf8")).includes("apiKey"), false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("caps the in-memory cache and expires entries", async () => {
    let calls = 0;
    // memoryMaxEntries = 2：分析 3 条后，最早的一条应被淘汰。
    const analyzer = new CachedNewsAnalyzer(
      async (items) => {
        calls += 1;
        return items.map((item) => analysis(item.id));
      },
      undefined,
      5,
      7 * 24 * 60 * 60_000,
      2
    );

    await analyzer.analyze([news("1"), news("2"), news("3")], "ai:model:v1");
    assert.equal(calls, 1);

    // 命中缓存不应再调用 analyzer。
    await analyzer.analyze([news("3"), news("2")], "ai:model:v1");
    assert.equal(calls, 1);

    // "1" 已被淘汰，必须重新分析。
    await analyzer.analyze([news("1")], "ai:model:v1");
    assert.equal(calls, 2);

    // TTL 为 0 时条目立即过期。
    let expiringCalls = 0;
    const expiring = new CachedNewsAnalyzer(
      async (items) => {
        expiringCalls += 1;
        return items.map((item) => analysis(item.id));
      },
      undefined,
      5,
      0,
      10
    );
    await expiring.analyze([news("9")], "ai:model:v1");
    await expiring.analyze([news("9")], "ai:model:v1");
    assert.equal(expiringCalls, 2);
  });

  it("keys analyses with a collision-resistant digest", () => {
    const key = analysisFingerprint(news("1"), "ai:model:v1");
    // 32 位 FNV 只有 8 个十六进制字符；128 位摘要为 32 个。
    assert.equal(key.length, 32);
    assert.match(key, /^[0-9a-f]{32}$/);
    // 不同输入必须得到不同键。
    assert.notEqual(key, analysisFingerprint(news("2"), "ai:model:v1"));
    assert.notEqual(key, analysisFingerprint(news("1"), "ai:model:v2"));
  });
});
