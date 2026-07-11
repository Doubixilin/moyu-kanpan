import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildEastmoneySecid, parseEastmoneyQuoteList } from "../eastmoney";

describe("eastmoney provider", () => {
  it("builds Eastmoney secids for A-share codes", () => {
    assert.equal(buildEastmoneySecid("600519"), "1.600519");
    assert.equal(buildEastmoneySecid("510300"), "1.510300");
    assert.equal(buildEastmoneySecid("000001"), "0.000001");
    assert.equal(buildEastmoneySecid("300750"), "0.300750");
  });

  it("parses quote list payload into normalized quotes", () => {
    const payload = {
      rc: 0,
      data: {
        diff: [
          {
            f2: 1688.88,
            f3: 1.23,
            f4: 20.5,
            f5: 123456,
            f6: 987654321,
            f12: "600519",
            f13: 1,
            f14: "贵州茅台",
            f15: 1690,
            f16: 1660,
            f17: 1670,
            f18: 1668.38,
            f62: 10000000,
            f124: 1783656031
          }
        ]
      }
    };

    assert.deepEqual(parseEastmoneyQuoteList(payload), [
      {
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
        mainInflow: 10000000,
        source: "eastmoney",
        updatedAt: new Date(1783656031 * 1000).toISOString()
      }
    ]);
  });
});
