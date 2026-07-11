import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NewsAnalysis, NewsItem } from "../types";
import { benchmarkCodeForSecurity, buildDecisionCue } from "../decision";

const item: NewsItem = {
  id: "event-1", title: "平安银行担保公告", url: "https://example.com/1.pdf",
  source: "cninfo", sourceTier: "official", documentType: "announcement",
  materialStatus: "title_only", publishedAt: "2026-07-11T01:00:00.000Z",
  relatedCodes: ["000001"]
};

const analysis: NewsAnalysis = {
  newsId: "event-1", priority: "high", status: "analyzed", useful: true,
  eventType: "capital", relatedCodes: ["000001"], sourceRelatedCodes: ["000001"],
  inferredRelatedCodes: [], relation: "direct", direction: "neutral", horizon: "short",
  importance: 80, confidence: 55, modelConfidence: 70, materialLimited: true,
  summary: "担保事项更新", mechanism: "可能增加或有负债",
  evidence: ["官方公告"], counterFactors: ["实际代偿风险未确认"],
  missingInformation: ["担保额度占净资产比例"], matchedKeywords: [],
  analyzedAt: "2026-07-11T01:01:00.000Z", provider: "ai", model: "test"
};

describe("lightweight decision cues", () => {
  it("marks a directly related official holding announcement for verification", () => {
    const cue = buildDecisionCue({
      item, analysis, holdingCodes: new Set(["000001"]), watchlistCodes: new Set(),
      quoteChangePercent: 2.7, benchmarkChangePercent: 0.4, recentRuleTriggered: false
    });
    assert.equal(cue.level, "verify");
    assert.match(cue.marketResponse, /明显强于大盘/);
    assert.equal(cue.uncertainty, "担保额度占净资产比例");
  });

  it("only escalates to immediate review for a holding with a local rule trigger", () => {
    const cue = buildDecisionCue({
      item, analysis, holdingCodes: new Set(["000001"]), watchlistCodes: new Set(),
      quoteChangePercent: 0.2, benchmarkChangePercent: 0.1, recentRuleTriggered: true
    });
    assert.equal(cue.label, "立即查看");
    assert.match(cue.nextStep, /已触发规则/);
  });

  it("keeps a media or indirect event at watch level without trading advice", () => {
    const cue = buildDecisionCue({
      item: { ...item, source: "eastmoney", sourceTier: "media" },
      analysis: { ...analysis, relation: "industry" },
      holdingCodes: new Set(), watchlistCodes: new Set(["000001"]),
      quoteChangePercent: null, benchmarkChangePercent: null, recentRuleTriggered: false
    });
    assert.equal(cue.label, "留意");
    assert.doesNotMatch(cue.nextStep, /买入|卖出|加仓|减仓/);
  });

  it("chooses an existing broad benchmark without sector attribution", () => {
    assert.equal(benchmarkCodeForSecurity("300750"), "399006");
    assert.equal(benchmarkCodeForSecurity("000858"), "399001");
    assert.equal(benchmarkCodeForSecurity("600519"), "000001");
  });
});
