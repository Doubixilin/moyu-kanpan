import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getAShareMarketState,
  isAShareTradingSession,
  quotePollDelayMs
} from "../marketClock";

describe("A-share market clock", () => {
  it("recognizes Shanghai trading sessions and the lunch break", () => {
    assert.equal(getAShareMarketState(new Date("2026-07-10T01:20:00.000Z")), "preopen");
    assert.equal(isAShareTradingSession(new Date("2026-07-10T01:20:00.000Z")), false);
    assert.equal(isAShareTradingSession(new Date("2026-07-10T02:00:00.000Z")), true);
    assert.equal(getAShareMarketState(new Date("2026-07-10T04:00:00.000Z")), "lunch");
    assert.equal(isAShareTradingSession(new Date("2026-07-10T06:00:00.000Z")), true);
    assert.equal(getAShareMarketState(new Date("2026-07-10T07:00:00.000Z")), "closed");
  });

  it("recognizes official 2026 exchange holidays", () => {
    assert.equal(getAShareMarketState(new Date("2026-02-16T02:00:00.000Z")), "holiday");
    assert.equal(getAShareMarketState(new Date("2026-05-04T02:00:00.000Z")), "holiday");
    assert.equal(getAShareMarketState(new Date("2026-10-06T02:00:00.000Z")), "holiday");
    assert.equal(isAShareTradingSession(new Date("2026-10-06T02:00:00.000Z")), false);
  });

  it("uses jitter while trading and a slower fixed interval while closed", () => {
    const trading = new Date("2026-07-10T02:00:00.000Z");
    assert.equal(quotePollDelayMs(trading, 8_000, 60_000, () => 0), 7_200);
    assert.equal(quotePollDelayMs(trading, 8_000, 60_000, () => 0.5), 8_000);
    assert.equal(quotePollDelayMs(trading, 8_000, 60_000, () => 1), 8_800);
    assert.equal(quotePollDelayMs(new Date("2026-07-10T04:00:00.000Z"), 8_000), 60_000);
    assert.equal(quotePollDelayMs(new Date("2026-07-11T02:00:00.000Z"), 8_000), 60_000);
  });
});
