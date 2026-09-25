import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Quote } from "../types";
import { isQuoteFeedStalled, newestQuoteTimestamp, quoteFingerprint } from "../status";

const baseQuote: Quote = {
  code: "600519",
  name: "贵州茅台",
  market: "SH",
  price: 1688.88,
  change: 20.5,
  changePercent: 1.23,
  open: 1670,
  previousClose: 1668.38,
  high: 1690,
  low: 1660,
  volume: 123456,
  amount: 987654321,
  source: "eastmoney",
  updatedAt: "2026-07-10T02:00:31.000Z"
};

describe("quote feed freshness", () => {
  it("tracks value changes independently from source timestamps", () => {
    const first = quoteFingerprint([baseQuote]);
    const sourceTimeOnly = quoteFingerprint([
      { ...baseQuote, updatedAt: "2026-07-10T02:00:39.000Z" }
    ]);
    const changedVolume = quoteFingerprint([{ ...baseQuote, volume: 123500 }]);
    assert.equal(sourceTimeOnly, first);
    assert.notEqual(changedVolume, first);
  });

  it("uses the newest valid quote source timestamp", () => {
    assert.equal(
      newestQuoteTimestamp([
        baseQuote,
        { ...baseQuote, code: "000001", updatedAt: "2026-07-10T02:00:39.000Z" }
      ]),
      "2026-07-10T02:00:39.000Z"
    );
  });

  it("only reports a stalled feed during market hours with no recent activity", () => {
    const input = {
      dataUpdatedAt: "2026-07-10T02:00:00.000Z",
      lastChangedAt: "2026-07-10T02:00:05.000Z",
      nowMs: Date.parse("2026-07-10T02:01:00.000Z"),
      thresholdMs: 45_000
    };
    assert.equal(isQuoteFeedStalled({ ...input, marketOpen: true }), true);
    assert.equal(isQuoteFeedStalled({ ...input, marketOpen: false }), false);
    assert.equal(
      isQuoteFeedStalled({
        ...input,
        marketOpen: true,
        dataUpdatedAt: "2026-07-10T02:00:50.000Z"
      }),
      false
    );
  });
});
