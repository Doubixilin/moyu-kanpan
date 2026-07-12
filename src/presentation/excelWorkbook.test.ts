import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AppSnapshot } from "../domain/types";
import { buildExcelWorkbook } from "./excelWorkbook";

describe("Excel workbook presentation", () => {
  it("maps live quotes, indices and news without exposing holding costs", () => {
    const snapshot = {
      quotes: [{
        code: "600519", name: "甲", market: "SH", price: 101.5, change: 1.5,
        changePercent: 1.5, open: 100, previousClose: 100, high: 102, low: 99,
        volume: 10, amount: 230_000_000, source: "eastmoney",
        updatedAt: "2026-07-10T02:30:00.000Z",
        quality: { state: "fresh", receivedAt: "2026-07-10T02:30:00.000Z", reasons: [] }
      }],
      news: [{ id: "n1", title: "项目正式材料更新", url: "https://example.com", source: "official",
        publishedAt: "2026-07-10T02:29:00.000Z", relatedCodes: ["600519"], sourceTier: "official",
        materialStatus: "full", analysis: { priority: "high" } }],
      market: { indices: [{ instrument: { key: "index:SH:000001", kind: "index", code: "000001", market: "SH", name: "上证" },
        price: 4000, change: 10, changePercent: 0.25, amount: 100, upCount: 100,
        downCount: 80, flatCount: 5, updatedAt: "2026-07-10T02:30:00.000Z", source: "eastmoney" }] },
      settings: {
        securities: [{ code: "600519", market: "SH", name: "甲", alias: "项目甲" }],
        watchlist: [{ securityCode: "600519", visible: true, order: 0, groupId: "all" }],
        holdings: [{ securityCode: "600519", quantity: 200, costPrice: 88.88 }]
      },
      feeds: { quotes: { lastSuccessAt: "2026-07-10T02:30:00.000Z" } }
    } as unknown as AppSnapshot;

    const workbook = buildExcelWorkbook(snapshot);
    assert.equal(workbook[0]?.cells.B4, "项目甲");
    assert.equal(workbook[0]?.cells.D4, 101.5);
    assert.equal(workbook[0]?.cells.E4, "+1.50%");
    assert.equal(workbook[0]?.cells.G4, "正常");
    assert.equal(workbook[0]?.cells.J4, "项目正式材料更新");
    assert.equal(workbook[1]?.cells.C4, 101.5);
    assert.equal(workbook[2]?.cells.E4, "重要");
    assert.equal(workbook[2]?.cells.G4, "公开材料");
    assert.ok(!JSON.stringify(workbook).includes("88.88"));
    assert.ok(!JSON.stringify(workbook).includes("quantity"));
  });
});
