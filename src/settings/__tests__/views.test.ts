import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { HoldingAlertRules } from "../../config";
import {
  formatRuleAmount,
  holdingAlertInput,
  holdingRuleDescriptions,
  nullableNumber,
  option,
  renderAddHolding,
  renderRiskGroupSetting,
  renderWatchItem
} from "../views";

const EMPTY_RULES: HoldingAlertRules = {
  enabled: false,
  stopLossPrice: null,
  watchPrice: null,
  priceAbove: null,
  priceBelow: null,
  risePercent: null,
  fallPercent: null,
  dailyProfitAmount: null,
  dailyLossAmount: null,
  totalProfitAmount: null,
  totalLossAmount: null
};

describe("settings view builders", () => {
  it("renders nullable numbers as empty inputs", () => {
    assert.equal(nullableNumber(null), "");
    assert.equal(nullableNumber(0), "0");
    assert.match(holdingAlertInput("holding-stop-loss", "跌破", null), /value=""/);
    assert.match(holdingAlertInput("holding-stop-loss", "跌破", 9.5), /value="9\.5"/);
  });

  it("escapes values used in attributes and options", () => {
    // 转义是渲染层唯一的注入防线，必须在纯构造函数里就覆盖到。
    assert.match(option('a"b', "<i>", "x"), /value="a&quot;b"/);
    assert.match(option("a", "<i>", "x"), />&lt;i&gt;</);
    assert.match(option("a", "l", "a"), /selected/);
    assert.equal(option("a", "l", "b").includes("selected"), false);

    const escaped = renderRiskGroupSetting(
      { id: "g", name: '<b>"x"</b>', profitThreshold: null, lossThreshold: null, enabled: true },
      0
    );
    assert.match(escaped, /value="&lt;b&gt;&quot;x&quot;&lt;\/b&gt;"/);
    assert.equal(escaped.includes("<b>"), false);
  });

  it("describes watch price direction relative to cost", () => {
    const above = holdingRuleDescriptions({ ...EMPTY_RULES, watchPrice: 12 }, 10);
    assert.deepEqual(above, ["现价升至 12 时提醒"]);
    const below = holdingRuleDescriptions({ ...EMPTY_RULES, watchPrice: 8 }, 10);
    assert.deepEqual(below, ["现价降至 8 时提醒"]);
    // 恰好等于成本价时按"升至"处理（与原实现一致）
    assert.deepEqual(holdingRuleDescriptions({ ...EMPTY_RULES, watchPrice: 10 }, 10), [
      "现价升至 10 时提醒"
    ]);
  });

  it("only describes configured rules", () => {
    assert.deepEqual(holdingRuleDescriptions(EMPTY_RULES, 10), []);
    const described = holdingRuleDescriptions(
      {
        ...EMPTY_RULES,
        stopLossPrice: 9,
        priceAbove: 12,
        risePercent: 5,
        dailyLossAmount: 50,
        totalProfitAmount: 1500
      },
      10
    );
    assert.deepEqual(described, [
      "现价跌破 9 时提醒",
      "现价向上突破 12 时提醒",
      "今日涨幅达到 5% 时提醒",
      "今日亏损达到 50 元 时提醒",
      "累计盈利达到 1,500 元 时提醒"
    ]);
  });

  it("formats rule amounts with grouping", () => {
    assert.equal(formatRuleAmount(1500), "1,500 元");
    assert.equal(formatRuleAmount(12.345), "12.35 元");
  });

  it("disables the first move-up and last move-down buttons", () => {
    const item = { securityCode: "600519", visible: true, order: 0, groupId: "all" };
    const first = renderWatchItem(item, 0, 2, "茅台");
    assert.match(first, /data-action="move-up"[^>]*disabled/);
    assert.equal(/data-action="move-down"[^>]*disabled/.test(first), false);

    const last = renderWatchItem(item, 1, 2, "");
    assert.equal(/data-action="move-up"[^>]*disabled/.test(last), false);
    assert.match(last, /data-action="move-down"[^>]*disabled/);
    // 别名同样要转义
    assert.match(renderWatchItem(item, 0, 1, 'a"b'), /value="a&quot;b"/);
  });

  it("only offers securities that are not already held", () => {
    const securities = [
      { code: "600519", market: "SH" as const, name: "甲", alias: "" },
      { code: "000001", market: "SZ" as const, name: "乙", alias: "乙别名" }
    ];
    const holdings = [
      {
        securityCode: "600519",
        quantity: 1,
        costPrice: 1,
        groupId: "all",
        note: "",
        alertRules: EMPTY_RULES
      }
    ];
    const html = renderAddHolding(securities, holdings);
    assert.equal(html.includes("600519"), false);
    assert.match(html, /乙别名/);
    // 全部已持仓时整块不渲染
    assert.equal(
      renderAddHolding(securities, [...holdings, { ...holdings[0]!, securityCode: "000001" }]),
      ""
    );
  });
});
