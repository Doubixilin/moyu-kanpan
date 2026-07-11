import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DailyCandle } from "../types";
import {
  DEFAULT_MARKET_INDICES,
  eastmoneySecid,
  tencentSymbol,
  withBoll
} from "../market";

function candle(day: number, close: number): DailyCandle {
  return {
    date: `2026-01-${String(day).padStart(2, "0")}`,
    open: close,
    close,
    high: close,
    low: close,
    volume: 1,
    amount: 1,
    bollMid: null,
    bollUpper: null,
    bollLower: null
  };
}

describe("market domain", () => {
  it("maps index instruments without confusing the Shanghai index with Ping An Bank", () => {
    assert.equal(eastmoneySecid(DEFAULT_MARKET_INDICES[0]!), "1.000001");
    assert.equal(tencentSymbol(DEFAULT_MARKET_INDICES[0]!), "sh000001");
    assert.equal(eastmoneySecid(DEFAULT_MARKET_INDICES[1]!), "0.399001");
  });

  it("calculates deterministic 20-day BOLL values locally", () => {
    const result = withBoll(Array.from({ length: 21 }, (_, index) => candle(index + 1, index + 1)));
    assert.equal(result[18]?.bollMid, null);
    assert.equal(result[19]?.bollMid, 10.5);
    assert.equal(result[20]?.bollMid, 11.5);
    assert.ok((result[20]?.bollUpper ?? 0) > 11.5);
    assert.ok((result[20]?.bollLower ?? 99) < 11.5);
  });
});