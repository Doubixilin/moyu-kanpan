import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AppConfig } from "../../config";
import type { NewsItem } from "../../domain/types";
import {
  analyzeNewsBatch,
  safeAiError,
  testAiConnection
} from "../openaiCompatible";

const ai: AppConfig["ai"] = {
  enabled: true,
  provider: "deepseek",
  apiKey: "sk-private",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
  timeoutSeconds: 5
};

const item: NewsItem = {
  id: "news-1",
  title: "某公司中标重大项目",
  summary: "公告称项目金额仍待合同确认",
  url: "https://example.com/news-1",
  source: "东方财富",
  publishedAt: "2026-07-10T01:00:00.000Z",
  relatedCodes: ["600000"]
};

function completion(content: unknown, finishReason: string | null = "stop"): Response {
  return new Response(JSON.stringify({
    choices: [{
      finish_reason: finishReason,
      message: { content: JSON.stringify(content) }
    }]
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

function structured(direction = "positive") {
  return {
    items: [{
      newsId: "news-1",
      useful: true,
      eventType: "order",
      relatedCodes: ["600000"],
      relation: "direct",
      direction,
      horizon: "short",
      importance: 78,
      confidence: 82,
      summary: "公司披露中标项目，合同尚未最终确认。",
      mechanism: "若合同落地，可能通过订单和收入预期影响估值。",
      evidence: ["输入材料称公司中标重大项目"],
      counterFactors: ["合同尚未最终确认"],
      missingInformation: ["项目金额占收入比例"]
    }]
  };
}

describe("OpenAI-compatible structured analysis", () => {
  it("uses DeepSeek non-thinking JSON mode and returns validated analysis", async () => {
    let requestBody = "";
    const fetcher: typeof fetch = async (_url, init) => {
      requestBody = String(init?.body ?? "");
      return completion(structured());
    };

    const [result] = await analyzeNewsBatch([item], ai, fetcher, {
      maxAttempts: 1,
      retryDelayMs: 0
    });
    const parsedBody = JSON.parse(requestBody) as Record<string, unknown>;

    assert.deepEqual(parsedBody.thinking, { type: "disabled" });
    assert.deepEqual(parsedBody.response_format, { type: "json_object" });
    assert.equal(requestBody.includes("持仓数量"), false);
    assert.equal(requestBody.includes("成本价"), false);
    assert.equal(result?.provider, "ai");
    assert.equal(result?.direction, "positive");
    assert.equal(result?.relation, "direct");
    assert.deepEqual(result?.sourceRelatedCodes, ["600000"]);
    assert.deepEqual(result?.inferredRelatedCodes, []);
    assert.equal(result?.priority, "high");
    assert.equal(result?.materialLimited, true);
    assert.ok((result?.confidence ?? 100) <= 55);
  });

  it("downgrades model-inferred direct codes to capped industry association", async () => {
    const publicItem = {
      ...item,
      summary: "这是一段足够长的公开新闻材料，用于确认即使正文内容较完整，只要相关股票代码并未在正文中出现，就不能被模型标成直接关联。",
      relatedCodes: []
    };
    const fetcher: typeof fetch = async () => completion(structured());

    const [result] = await analyzeNewsBatch([publicItem], ai, fetcher, { maxAttempts: 1 });
    assert.equal(result?.relation, "industry");
    assert.deepEqual(result?.sourceRelatedCodes, []);
    assert.deepEqual(result?.inferredRelatedCodes, ["600000"]);
    assert.ok((result?.confidence ?? 100) <= 55);
  });

  it("uses normalized source tiers when scoring complete official material", async () => {
    const completeSummary = "这是完整的公开事件材料，包含事件主体、发生时间、核心事实、当前状态、官方披露依据以及仍待确认的后续条件。";
    const fetcher: typeof fetch = async () => completion(structured());
    const [official] = await analyzeNewsBatch([{
      ...item, summary: completeSummary, source: "cninfo", sourceTier: "official"
    }], ai, fetcher, { maxAttempts: 1 });
    const [media] = await analyzeNewsBatch([{
      ...item, summary: completeSummary, source: "eastmoney", sourceTier: "media"
    }], ai, fetcher, { maxAttempts: 1 });
    assert.ok((official?.confidence ?? 0) > (media?.confidence ?? 100));
  });

  it("normalizes common model enum variants instead of degrading the whole batch", async () => {
    const variant = structured("bullish");
    variant.items[0]!.eventType = "corporate";
    variant.items[0]!.relation = "direct_impact";
    variant.items[0]!.horizon = "short-term";
    const fetcher: typeof fetch = async () => completion(variant);

    const [result] = await analyzeNewsBatch([item], ai, fetcher, { maxAttempts: 1 });
    assert.equal(result?.eventType, "other");
    assert.equal(result?.relation, "direct");
    assert.equal(result?.direction, "positive");
    assert.equal(result?.horizon, "short");
  });

  it("rejects trading-action enums instead of displaying them", async () => {
    const fetcher: typeof fetch = async () => completion(structured("buy"));
    await assert.rejects(
      () => analyzeNewsBatch([item], ai, fetcher, { maxAttempts: 1 }),
      /禁止的交易动作/
    );
  });

  it("tests the configured chat endpoint with a minimal JSON response", async () => {
    let url = "";
    const fetcher: typeof fetch = async (input) => {
      url = String(input);
      return completion({ ok: true });
    };
    await testAiConnection(ai, fetcher, { maxAttempts: 1 });
    assert.equal(url, "https://api.deepseek.com/chat/completions");
  });

  it("maps provider failures to safe messages without credentials", () => {
    const message = safeAiError(new Error("request sk-private failed"));
    assert.equal(message.includes("sk-private"), false);
  });
});
