import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COVERED_HOLIDAY_YEARS,
  getAShareMarketState,
  isAShareTradingSession,
  isTradingCalendarVerified
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

  it("reports which years have an official holiday calendar", () => {
    assert.equal(COVERED_HOLIDAY_YEARS.includes(2026), true);
    assert.equal(isTradingCalendarVerified(new Date("2026-10-06T02:00:00.000Z")), true);
    // 跨年后必须显式暴露"日历未收录"，而不是静默把休市日当成交易日。
    assert.equal(isTradingCalendarVerified(new Date("2027-01-04T02:00:00.000Z")), false);
    assert.equal(isTradingCalendarVerified(new Date("2028-02-07T02:00:00.000Z")), false);
  });

  it("degrades to weekday-and-time only for years without a calendar", () => {
    // 2027-02-08 是周一。真实春节休市，但 2027 未收录，因此退化为"按工作日判断"。
    assert.equal(getAShareMarketState(new Date("2027-02-08T02:00:00.000Z")), "trading");
    // 周末判断与年份无关，仍然正确。
    assert.equal(getAShareMarketState(new Date("2027-01-02T02:00:00.000Z")), "weekend");
    assert.equal(isAShareTradingSession(new Date("2027-01-02T02:00:00.000Z")), false);
    // 时段判断同样仍然正确。
    assert.equal(getAShareMarketState(new Date("2027-01-04T04:00:00.000Z")), "lunch");
    assert.equal(getAShareMarketState(new Date("2027-01-04T07:00:00.000Z")), "closed");
  });
});
