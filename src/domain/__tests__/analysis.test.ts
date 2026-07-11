import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeNewsWithRules } from "../analysis";

describe("rule analysis", () => {
  it("marks high-impact policy and earnings news as important", () => {
    const result = analyzeNewsWithRules({
      id: "n1",
      title: "证监会发布重磅政策，半导体龙头业绩预增",
      url: "https://example.com/news",
      source: "eastmoney",
      publishedAt: "2026-07-09T09:30:00.000Z"
    });

    assert.equal(result.priority, "high");
    assert.match(result.summary, /政策/);
    assert.ok(result.matchedKeywords.includes("政策"));
    assert.ok(result.matchedKeywords.includes("业绩"));
  });
});
