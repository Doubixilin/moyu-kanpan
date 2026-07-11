import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Quote } from "../../domain/types";
import { quotesConflict, validateQuote } from "../quoteQuality";

const now = Date.parse("2026-07-10T02:00:30.000Z");
const baseQuote: Quote = {
  code: "600519",
  name: "贵州茅台",
  market: "SH",
  price: 100,
  change: 1,
  changePercent: 1.0101,
  open: 99.5,
  previousClose: 99,
  high: 101,
  low: 98.5,
  volume: 1_000,
  amount: 100_000,
  source: "eastmoney",
  updatedAt: "2026-07-10T02:00:20.000Z"
};

describe("quote quality gate", () => {
  it("accepts coherent and fresh quote data", () => {
    const result = validateQuote(baseQuote, "600519", { marketOpen: true, nowMs: now });
    assert.equal(result.trusted, true);
    assert.deepEqual(result.issues, []);
  });

  it("marks an HTTP-success quote stale when source time stops advancing", () => {
    const result = validateQuote(
      { ...baseQuote, updatedAt: "2026-07-10T01:58:00.000Z" },
      "600519",
      { marketOpen: true, nowMs: now, maxSourceAgeMs: 60_000 }
    );
    assert.equal(result.usable, true);
    assert.equal(result.trusted, false);
    assert.deepEqual(result.issues, ["source_stale"]);
  });

  it("rejects internally inconsistent price fields", () => {
    const result = validateQuote(
      { ...baseQuote, high: 90, changePercent: 20 },
      "600519",
      { marketOpen: false, nowMs: now }
    );
    assert.equal(result.usable, false);
    assert.ok(result.issues.includes("price_outside_range"));
    assert.ok(result.issues.includes("change_percent_mismatch"));
  });

  it("detects material price conflicts between providers", () => {
    assert.equal(quotesConflict(baseQuote, { ...baseQuote, price: 100.1 }), false);
    assert.equal(quotesConflict(baseQuote, { ...baseQuote, price: 101 }), true);
  });
});
