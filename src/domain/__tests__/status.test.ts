import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildFeedStatus, summarizeNewsSourceHealth } from "../status";

describe("feed status", () => {
  it("uses the last successful fetch time instead of the snapshot push time", () => {
    const status = buildFeedStatus({
      lastSuccessAt: "2026-07-10T01:00:00.000Z",
      lastAttemptFailed: false,
      intervalMs: 15_000,
      nowMs: Date.parse("2026-07-10T01:00:20.000Z"),
      source: "eastmoney"
    });

    assert.equal(status.lastSuccessAt, "2026-07-10T01:00:00.000Z");
    assert.equal(status.stale, false);
  });

  it("marks retained data stale after a failed refresh", () => {
    const status = buildFeedStatus({
      lastSuccessAt: "2026-07-10T01:00:00.000Z",
      lastAttemptFailed: true,
      intervalMs: 15_000,
      nowMs: Date.parse("2026-07-10T01:00:01.000Z"),
      source: "eastmoney"
    });

    assert.equal(status.stale, true);
  });
});

describe("news source status", () => {
  it("keeps a one-off timeout out of the visible error stream", () => {
    const summary = summarizeNewsSourceHealth([{
      source: "eastmoney",
      lastSuccessAt: null,
      lastError: "Request timed out after 10000ms",
      consecutiveFailures: 1,
      nextRetryAt: null
    }]);
    assert.equal(summary, null);
  });

  it("shows a brief source label after repeated failures without exposing raw errors", () => {
    const summary = summarizeNewsSourceHealth([{
      source: "eastmoney",
      lastSuccessAt: null,
      lastError: "Request timed out after 10000ms",
      consecutiveFailures: 3,
      nextRetryAt: null
    }]);
    assert.equal(summary, "东财快讯连续失败，正在使用其他来源和历史事件");
    assert.doesNotMatch(summary ?? "", /10000ms|Request timed out/);
  });
});
