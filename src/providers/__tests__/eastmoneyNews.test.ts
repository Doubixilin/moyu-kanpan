import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseEastmoneyFastNews } from "../eastmoneyNews";

describe("Eastmoney fast-news provider", () => {
  it("normalizes A-share secids and excludes sector identifiers", () => {
    const [item] = parseEastmoneyFastNews({
      data: {
        fastNewsList: [{
          code: "202607110001",
          title: "示例快讯",
          showTime: "2026-07-11 10:00:00",
          stockList: ["0.000001", "1.600519", "90.BK0149", "300750", "invalid"]
        }]
      }
    });
    assert.deepEqual(item?.relatedCodes, ["000001", "600519", "300750"]);
  });
});
