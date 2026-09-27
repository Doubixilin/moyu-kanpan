import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Security } from "../../config";
import type { DailyCandle } from "../types";
import {
  DEFAULT_MARKET_INDICES,
  eastmoneySecid,
  resolveMarketInstrument,
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

  it("validates IPC market requests against the configured securities", () => {
    const securities: Security[] = [
      { code: "600519", market: "SH", name: "贵州茅台", alias: "茅台" }
    ];
    assert.deepEqual(
      resolveMarketInstrument({ kind: "index", market: "SH", code: "000001" }, securities),
      {
        key: "index:SH:000001",
        kind: "index",
        code: "000001",
        market: "SH",
        name: "上证"
      }
    );
    assert.deepEqual(
      resolveMarketInstrument({ kind: "stock", market: "SH", code: "600519" }, securities),
      {
        key: "stock:SH:600519",
        kind: "stock",
        code: "600519",
        market: "SH",
        name: "茅台"
      }
    );

    // 不在配置里的代码不能被请求（否则渲染器可借这个通道拉任意标的）
    assert.throws(
      () => resolveMarketInstrument({ kind: "stock", market: "SZ", code: "600519" }, securities),
      /股票不在当前配置中/
    );
    assert.throws(
      () => resolveMarketInstrument({ kind: "index", market: "SH", code: "399001" }, securities),
      /不支持的市场指数/
    );
    for (const bad of [
      null,
      "600519",
      { kind: "stock", market: "SH", code: "60051" },
      { kind: "stock", market: "US", code: "600519" },
      { kind: "future", market: "SH", code: "600519" }
    ]) {
      assert.throws(() => resolveMarketInstrument(bad, securities), /无效的行情标的/);
    }
  });
});
