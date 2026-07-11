import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_MARKET_INDICES } from "../../domain/market";
import {
  parseEastmoneyDaily,
  parseEastmoneyIntraday,
  parseEastmoneyMarketIndices,
  parseEastmoneySectors,
  parseTencentDaily,
  parseTencentIntraday,
  parseTencentMarketIndices
} from "../market";

describe("market data providers", () => {
  it("parses Eastmoney indices with breadth and keeps index identity", () => {
    const result = parseEastmoneyMarketIndices({ data: { diff: [{
      f12: "000001", f13: 1, f14: "上证指数", f2: 3997.24, f3: -0.97,
      f4: -39.35, f6: 1_549_319_582_865, f104: 1561, f105: 748, f106: 36,
      f124: 1783666682
    }] } }, DEFAULT_MARKET_INDICES);

    assert.equal(result[0]?.instrument.key, "index:SH:000001");
    assert.equal(result[0]?.upCount, 1561);
    assert.equal(result[0]?.amount, 1_549_319_582_865);
  });

  it("parses Tencent index fallback and exact turnover from its composite field", () => {
    const parts = Array.from({ length: 40 }, () => "");
    parts[1] = "上证指数";
    parts[3] = "3997.24";
    parts[30] = "20260710145802";
    parts[31] = "-39.35";
    parts[32] = "-0.97";
    parts[35] = "3997.24/621512318/1549319582865";
    const text = `v_sh000001="${parts.join("~")}";`;
    const result = parseTencentMarketIndices(text, DEFAULT_MARKET_INDICES);

    assert.equal(result[0]?.source, "tencent");
    assert.equal(result[0]?.amount, 1_549_319_582_865);
    assert.equal(result[0]?.upCount, null);
  });

  it("deduplicates Eastmoney sector hierarchy labels", () => {
    const result = parseEastmoneySectors({ data: { diff: [
      { f12: "BK1", f14: "航天装备Ⅲ", f2: 100, f3: 10, f6: 1 },
      { f12: "BK2", f14: "航天装备Ⅱ", f2: 100, f3: 10, f6: 1 },
      { f12: "BK3", f14: "医疗服务", f2: 90, f3: 5, f6: 2 }
    ] } }, 5);

    assert.deepEqual(result.map((item) => item.name), ["航天装备", "医疗服务"]);
  });

  it("normalizes Eastmoney intraday points to cumulative volume", () => {
    const result = parseEastmoneyIntraday({ data: {
      name: "贵州茅台",
      preClose: 1180,
      trends: [
        "2026-07-10 09:30,1182.20,1182.20,1182.20,1182.20,331,39130820.00,1182.20",
        "2026-07-10 09:31,1182.20,1175.35,1183.00,1175.00,705,83069456.00,1178.40"
      ]
    } });

    assert.equal(result.items[1]?.price, 1175.35);
    assert.equal(result.items[1]?.volume, 1036);
    assert.equal(result.items[1]?.amount, 122200276);
  });

  it("parses Tencent intraday fallback with Shanghai time", () => {
    const instrument = { ...DEFAULT_MARKET_INDICES[0]!, name: "上证" };
    const result = parseTencentIntraday({ data: { sh000001: {
      data: { date: "20260710", data: ["0930 4031.54 100 1000", "0931 4030.00 150 1500"] },
      qt: { sh000001: ["1", "上证指数", "000001", "4030", "4036.59"] }
    } } }, instrument);

    assert.equal(result.name, "上证指数");
    assert.equal(result.previousClose, 4036.59);
    assert.equal(result.items[1]?.price, 4030);
    assert.equal(result.items[0]?.time, "2026-07-10T01:30:00.000Z");
  });

  it("parses Eastmoney and Tencent daily candles", () => {
    const east = parseEastmoneyDaily({ data: {
      name: "贵州茅台",
      klines: ["2026-07-10,1182.20,1204.47,1204.60,1170.28,51595,6148878288.00"]
    } });
    const instrument = {
      key: "stock:SH:600519", kind: "stock" as const,
      code: "600519", market: "SH" as const, name: "贵州茅台"
    };
    const tencent = parseTencentDaily({ data: { sh600519: {
      qfqday: [["2026-07-10", "1182.20", "1204.47", "1204.60", "1170.28", "51595"]],
      qt: { sh600519: ["1", "贵州茅台"] }
    } } }, instrument);

    assert.equal(east.items[0]?.amount, 6148878288);
    assert.equal(tencent.items[0]?.close, 1204.47);
    assert.equal(tencent.items[0]?.amount, null);
  });
});