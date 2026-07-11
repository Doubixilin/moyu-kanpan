import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { marketPrefixForCode, parseTencentQuoteText } from "../tencent";

describe("tencent provider", () => {
  it("maps Shanghai ETFs to the Shanghai market prefix", () => {
    assert.equal(marketPrefixForCode("510300"), "sh");
    assert.equal(marketPrefixForCode("600519"), "sh");
    assert.equal(marketPrefixForCode("000001"), "sz");
  });
  it("parses Tencent tilde-delimited quote text", () => {
    const text =
      'v_sh600519="1~贵州茅台~600519~1688.88~1668.38~1670.00~123456~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~20260709145959~20.50~1.23~1690.00~1660.00~1688.88/123456/987654321~123456~987654~0.00~0~0~0~0~0~0~987654321~0~0~0~0~0~0~0~0~0~0~0~0~0~0";';

    assert.deepEqual(parseTencentQuoteText(text).map((quote) => ({
      code: quote.code,
      name: quote.name,
      market: quote.market,
      price: quote.price,
      previousClose: quote.previousClose,
      open: quote.open,
      change: quote.change,
      changePercent: quote.changePercent,
      high: quote.high,
      low: quote.low,
      source: quote.source,
      updatedAt: quote.updatedAt
    })), [
      {
        code: "600519",
        name: "贵州茅台",
        market: "SH",
        price: 1688.88,
        previousClose: 1668.38,
        open: 1670,
        change: 20.5,
        changePercent: 1.23,
        high: 1690,
        low: 1660,
        source: "tencent",
        updatedAt: "2026-07-09T06:59:59.000Z"
      }
    ]);
  });
});
