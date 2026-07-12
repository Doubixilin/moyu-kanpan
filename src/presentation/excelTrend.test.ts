import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DailyCandle } from "../domain/types";
import { buildExcelBollChart } from "./excelTrend";

describe("Excel BOLL trend chart", () => {
  it("builds bounded SVG points from recent daily data", () => {
    const items: DailyCandle[] = Array.from({ length: 70 }, (_, index) => ({
      date: `2026-06-${String(index + 1).padStart(2, "0")}`,
      open: 100 + index,
      close: 101 + index,
      high: 102 + index,
      low: 99 + index,
      volume: 1000,
      amount: null,
      bollMid: index < 19 ? null : 100 + index,
      bollUpper: index < 19 ? null : 105 + index,
      bollLower: index < 19 ? null : 95 + index
    }));
    const model = buildExcelBollChart(items);
    assert.equal(model?.count, 60);
    assert.equal(model?.latest.close, 170);
    assert.match(model?.close ?? "", /^54\.0,/);
    assert.ok((model?.upper.split(" ").length ?? 0) > 40);
  });

  it("returns null when there is not enough data", () => {
    assert.equal(buildExcelBollChart([]), null);
  });
});
