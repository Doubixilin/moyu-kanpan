import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NewsAnalysis, NewsItem } from "../types";
import { buildSanitizedEventContext } from "../handoff";

const item: NewsItem & { analysis: NewsAnalysis } = {
  id: "event-1", title: "平安银行担保公告", url: "https://example.com/1.pdf",
  source: "cninfo", sources: ["cninfo", "szse"], sourceTier: "official",
  documentType: "announcement", materialStatus: "title_only",
  publishedAt: "2026-07-11T01:00:00.000Z", relatedCodes: ["000001"],
  analysis: {
    newsId: "event-1", priority: "high", status: "analyzed", useful: true,
    eventType: "capital", relatedCodes: ["000001"], sourceRelatedCodes: ["000001"],
    inferredRelatedCodes: [], relation: "direct", direction: "neutral", horizon: "short",
    importance: 80, confidence: 55, modelConfidence: 70, materialLimited: true,
    summary: "担保事项更新", mechanism: "可能增加或有负债", evidence: ["官方公告"],
    counterFactors: ["实际代偿风险未确认"], missingInformation: ["担保额度占净资产比例"],
    matchedKeywords: [], analyzedAt: "2026-07-11T01:01:00.000Z", provider: "ai"
  }
};

describe("sanitized Coze handoff", () => {
  it("copies only public event, quote and rule labels", () => {
    const text = buildSanitizedEventContext({
      item, tracking: "holding", securityName: "平安银行",
      quote: { code: "000001", price: 10, changePercent: 2.7, updatedAt: "2026-07-11T01:02:00.000Z", source: "eastmoney" },
      benchmark: { name: "深证成指", changePercent: 0.4, updatedAt: "2026-07-11T01:02:00.000Z" },
      cue: {
        level: "verify", label: "核验", relatedCode: "000001",
        marketResponse: "个股 +2.70%，基准 +0.40%；明显强于大盘（不代表事件因果）",
        uncertainty: "担保额度占净资产比例", nextStep: "查看公告原文；需要时复制给 Coze"
      },
      alerts: [{ type: "watch_price", title: "观察线提醒", triggeredAt: "2026-07-11T01:01:00.000Z", mode: "shadow" }]
    });
    assert.match(text, /平安银行（000001）/);
    assert.match(text, /观察线提醒/);
    assert.match(text, /不代表事件因果/);
    assert.doesNotMatch(text, /持仓数量|成本价|账户规模|300股|28\.585/);
    assert.doesNotMatch(text, /买入|卖出|加仓|减仓/);
  });
});
