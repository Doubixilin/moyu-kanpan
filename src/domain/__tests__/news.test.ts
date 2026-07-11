import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NewsAnalysis, NewsItem } from "../types";
import {
  aggregateNewsSource,
  dedupeNewsItems,
  hasLimitedNewsMaterial,
  importantDriverDecision
} from "../news";

function analyzed(patch: Partial<NewsAnalysis> = {}): NewsAnalysis {
  return {
    newsId: "1",
    priority: "high",
    status: "analyzed",
    useful: true,
    eventType: "other",
    relatedCodes: [],
    sourceRelatedCodes: [],
    inferredRelatedCodes: [],
    relation: "uncertain",
    direction: "neutral",
    horizon: "short",
    importance: 70,
    confidence: 60,
    modelConfidence: 70,
    materialLimited: true,
    summary: "事件摘要",
    mechanism: "潜在机制",
    evidence: ["公开事实"],
    counterFactors: ["反向因素"],
    missingInformation: [],
    matchedKeywords: [],
    analyzedAt: "2026-07-10T01:00:00.000Z",
    provider: "ai",
    model: "deepseek-v4-flash",
    ...patch
  };
}

const driverItem: NewsItem = {
  id: "1",
  title: "测试事件",
  summary: "一段用于测试的公开事件材料",
  url: "https://example.com/1",
  source: "eastmoney",
  publishedAt: "2026-07-10T01:00:00.000Z"
};

describe("news domain", () => {
  it("reports the aggregate event-library source instead of only the latest poll", () => {
    assert.equal(aggregateNewsSource([{
      ...driverItem,
      source: "cninfo",
      sources: ["cninfo", "eastmoney"],
      sourceTier: "official"
    }], ["eastmoney"]), "mixed");
    assert.equal(aggregateNewsSource([], ["cninfo"]), "official");
    assert.equal(aggregateNewsSource([], []), "local");
  });

  it("deduplicates news by url and normalized title while keeping newest items", () => {
    const items = [
      {
        id: "1",
        title: " 贵州茅台：今日上涨 ",
        url: "https://example.com/a",
        source: "eastmoney",
        publishedAt: "2026-07-09T09:30:00.000Z"
      },
      {
        id: "2",
        title: "贵州茅台：今日上涨",
        url: "https://example.com/a",
        source: "eastmoney",
        publishedAt: "2026-07-09T09:31:00.000Z"
      },
      {
        id: "3",
        title: "贵州茅台：今日上涨",
        url: "https://example.com/b",
        source: "tencent",
        publishedAt: "2026-07-09T09:32:00.000Z"
      }
    ];

    assert.deepEqual(dedupeNewsItems(items).map((item) => item.id), ["3"]);
  });

  it("only displays personally relevant or truly market-wide important drivers", () => {
    const tracked = new Set(["600519"]);
    assert.equal(
      importantDriverDecision(
        driverItem,
        analyzed({
          relation: "direct",
          relatedCodes: ["600519"],
          sourceRelatedCodes: ["600519"],
          importance: 50
        }),
        tracked
      ).display,
      true
    );
    assert.equal(
      importantDriverDecision(
        driverItem,
        analyzed({ relation: "industry", relatedCodes: [], importance: 90 }),
        tracked
      ).display,
      false
    );
    assert.equal(
      importantDriverDecision(
        driverItem,
        analyzed({
          relation: "industry",
          relatedCodes: ["600519"],
          inferredRelatedCodes: ["600519"],
          importance: 69,
          confidence: 55
        }),
        tracked
      ).display,
      false
    );
    assert.equal(
      importantDriverDecision(
        driverItem,
        analyzed({
          relation: "industry",
          relatedCodes: ["600519"],
          inferredRelatedCodes: ["600519"],
          importance: 70,
          confidence: 55
        }),
        tracked
      ).reason,
      "industry-inferred"
    );
    assert.equal(
      importantDriverDecision(
        driverItem,
        analyzed({ relation: "market", relatedCodes: [], importance: 79 }),
        tracked
      ).display,
      false
    );
    assert.equal(
      importantDriverDecision(
        driverItem,
        analyzed({ relation: "market", relatedCodes: [], importance: 85, confidence: 55 }),
        tracked
      ).display,
      true
    );
  });

  it("marks title-only quick news as limited material", () => {
    assert.equal(hasLimitedNewsMaterial({ ...driverItem, summary: undefined }), true);
    assert.equal(
      hasLimitedNewsMaterial({
        ...driverItem,
        summary: "这是较完整的新闻正文摘要，包含事件主体、时间、事实依据、相关金额、当前状态以及仍待确认的后续条件。"
      }),
      false
    );
  });
});
