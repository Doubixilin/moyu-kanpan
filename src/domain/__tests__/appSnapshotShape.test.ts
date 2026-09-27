import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeAppSnapshotProblem } from "../appSnapshotShape";

/** 最小合法快照：只包含自检表会检查的字段。 */
function snapshot(): Record<string, unknown> {
  return {
    updatedAt: "2026-09-25T01:00:00.000Z",
    quotes: [],
    news: [],
    market: { indices: [] },
    risk: { recentEvents: [] },
    ai: { state: "ready" },
    settings: {
      tabs: [],
      watchlist: [],
      securities: [],
      holdings: [],
      navigation: {},
      quotes: {},
      appearance: {},
      risk: {},
      window: {}
    },
    feeds: {
      quotes: {
        stale: false,
        stalled: false,
        degraded: false,
        conflictCount: 0,
        retainedCount: 0,
        missingCount: 0,
        alertSafe: true,
        coverage: null,
        source: null
      },
      news: { stale: false, degraded: false }
    },
    ui: { clickThrough: false }
  };
}

describe("app snapshot boundary shape", () => {
  it("accepts a well-formed snapshot", () => {
    assert.equal(describeAppSnapshotProblem(snapshot()), null);
  });

  it("rejects non-object payloads", () => {
    for (const value of [null, undefined, "snapshot", 42, []]) {
      const problem = describeAppSnapshotProblem(value);
      assert.ok(problem, String(value));
      assert.match(problem, /期望 object/);
    }
  });

  it("names the exact field that a rename would break", () => {
    // 这是审计报告 §4-4 点名的静默失败：字段改名后状态栏会显示"一切正常"
    const renamed = snapshot();
    const feeds = renamed.feeds as { quotes: Record<string, unknown> };
    delete feeds.quotes.degraded;
    const problem = describeAppSnapshotProblem(renamed);
    assert.equal(problem, "feeds.quotes.degraded：期望 boolean，实际 undefined");
  });

  it("reports the first problem in declaration order", () => {
    const broken = snapshot();
    delete broken.news;
    delete broken.settings;
    // news 在自检表里排在 settings 之前
    assert.equal(describeAppSnapshotProblem(broken), "news：期望 array，实际 undefined");
  });

  it("allows null only where the contract allows it", () => {
    const withNulls = snapshot();
    const feeds = withNulls.feeds as { quotes: Record<string, unknown> };
    feeds.quotes.coverage = null;
    feeds.quotes.source = null;
    assert.equal(describeAppSnapshotProblem(withNulls), null);

    // degraded 明确声明为 boolean，null 不算通过
    feeds.quotes.degraded = null;
    assert.equal(
      describeAppSnapshotProblem(withNulls),
      "feeds.quotes.degraded：期望 boolean，实际 null"
    );
  });

  it("catches wrong container types deep in the payload", () => {
    const broken = snapshot();
    (broken.settings as Record<string, unknown>).tabs = {};
    assert.equal(describeAppSnapshotProblem(broken), "settings.tabs：期望 array，实际 object");

    const brokenRisk = snapshot();
    (brokenRisk.risk as Record<string, unknown>).recentEvents = "none";
    assert.equal(
      describeAppSnapshotProblem(brokenRisk),
      "risk.recentEvents：期望 array，实际 string"
    );
  });
});
