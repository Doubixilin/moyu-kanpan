import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { marketPrefixForCode, parseTencentQuoteText } from "../tencent";

describe("tencent provider", () => {
  it("maps Shanghai ETFs to the Shanghai market prefix", () => {
    assert.equal(marketPrefixForCode("510300"), "sh");
    assert.equal(marketPrefixForCode("600519"), "sh");
    assert.equal(marketPrefixForCode("000001"), "sz");
  });
  it("routes BSE codes to the bj prefix and keeps Shanghai B-shares on sh", () => {
    // 实测：bj920099 返回数据，sh920099 无数据。
    assert.equal(marketPrefixForCode("920099"), "bj");
    assert.equal(marketPrefixForCode("832000"), "bj");
    assert.equal(marketPrefixForCode("430047"), "bj");
    // 900xxx 是沪市 B 股，不能被 "9 开头" 规则误判为北交所。
    assert.equal(marketPrefixForCode("900001"), "sh");
  });
  it("prefers the explicit market over prefix inference", () => {
    // §3-2：显式市场优先；UNKNOWN 视为"没说"，回到前缀推断。
    assert.equal(marketPrefixForCode("600519", "SH"), "sh");
    assert.equal(marketPrefixForCode("000001", "SZ"), "sz");
    assert.equal(marketPrefixForCode("920099", "BJ"), "bj");
    assert.equal(marketPrefixForCode("600519", "BJ"), "bj");
    assert.equal(marketPrefixForCode("920099", "SH"), "sh");
    assert.equal(marketPrefixForCode("920099", "UNKNOWN"), "bj");
  });
  it("parses Tencent tilde-delimited quote text", () => {
    // 字段布局按真实响应构造：成交额在 [37]（万元），总市值在 [45]（亿元）。
    const text =
      'v_sh600519="1~贵州茅台~600519~1688.88~1668.38~1670.00~123456~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~20260709145959~20.50~1.23~1690.00~1660.00~1688.88/123456/20845635328~123456~2084564~0.00~0~0~0~0~0~0~21217.94~0~0~0~0~0~0~0~0~0~0~0~0~0~0";';

    assert.deepEqual(
      parseTencentQuoteText(text).map((quote) => ({
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
        volume: quote.volume,
        amount: quote.amount,
        source: quote.source,
        updatedAt: quote.updatedAt
      })),
      [
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
          volume: 123456,
          // 2084564 万元 → 元。若误读 [45] 会得到 21217.94（总市值亿元）。
          amount: 20_845_640_000,
          source: "tencent",
          updatedAt: "2026-07-09T06:59:59.000Z"
        }
      ]
    );
  });
});
