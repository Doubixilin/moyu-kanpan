import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { NewsAnalysis, NewsItem } from "../../domain/types";
import {
  CachedNewsAnalyzer,
  JsonNewsAnalysisCache
} from "../batch";

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
    const analyzer = new CachedNewsAnalyzer(async (items) => {
      batches.push(items.map((item) => item.id));
      return items.map((item) => analysis(item.id));
    }, undefined, 2);

    const items = [news("1"), news("2"), news("3"), news("4")];
    await analyzer.analyze(items, "ai:model:v1");
    await analyzer.analyze(items, "ai:model:v1");

    assert.deepEqual(batches, [["1", "2"], ["3", "4"]]);
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
});