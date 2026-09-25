import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadAppConfigFromObject, toUserSettings, type UserSettings } from "../../config";
import {
  HOLDING_ALERT_NUMBER_FIELDS,
  HOLDING_ROW_FIELDS,
  nullableInputInteger,
  nullableInputNumber,
  RISK_GROUP_ROW_FIELDS,
  SETTINGS_FIELD_UPDATERS,
  TAB_ROW_FIELDS,
  WATCH_ROW_FIELDS,
  type FieldElement
} from "../fields";

function settings(): UserSettings {
  return toUserSettings(
    loadAppConfigFromObject({
      securities: [{ code: "600519", market: "SH", name: "测试股", alias: "" }],
      watchlist: [{ securityCode: "600519", visible: true, order: 0 }],
      holdings: [{ securityCode: "600519", quantity: 100, costPrice: 10 }]
    })
  );
}

function field(value: string, checked = false, dataset?: Record<string, string>): FieldElement {
  return { value, checked, dataset };
}

/** 应用一个顶层字段，返回结果（不涉及 DOM）。 */
function apply(
  current: UserSettings,
  setting: string,
  element: FieldElement,
  eventType = "change"
) {
  const updater = SETTINGS_FIELD_UPDATERS[setting];
  assert.ok(updater, `缺少字段定义: ${setting}`);
  return updater(current, { element, eventType });
}

describe("settings field parsers", () => {
  it("treats empty, non-numeric and non-positive input as null", () => {
    assert.equal(nullableInputNumber(""), null);
    assert.equal(nullableInputNumber("   "), null);
    assert.equal(nullableInputNumber("abc"), null);
    assert.equal(nullableInputNumber("0"), null);
    assert.equal(nullableInputNumber("-5"), null);
    assert.equal(nullableInputNumber("Infinity"), null);
    assert.equal(nullableInputNumber("12.5"), 12.5);
    // 整数版：向下限 1 收敛并四舍五入
    assert.equal(nullableInputInteger(""), null);
    assert.equal(nullableInputInteger("0.4"), 1);
    assert.equal(nullableInputInteger("7.6"), 8);
  });
});

describe("settings field table", () => {
  it("clamps numeric fields to the same bounds as the save path", () => {
    const stop = settings();
    apply(stop, "risk-stop-warning", field("0"));
    assert.equal(stop.risk.stopWarningPercent, 0.1);
    apply(stop, "risk-stop-warning", field("999"));
    assert.equal(stop.risk.stopWarningPercent, 999);

    const hysteresis = settings();
    apply(hysteresis, "risk-hysteresis", field("-3"));
    assert.equal(hysteresis.risk.hysteresisPercent, 0.01);

    const cooldown = settings();
    apply(cooldown, "risk-cooldown", field("0"));
    assert.equal(cooldown.risk.cooldownMinutes, 0);
    apply(cooldown, "risk-cooldown", field("90.6"));
    assert.equal(cooldown.risk.cooldownMinutes, 91);

    const timeout = settings();
    apply(timeout, "ai-timeout", field("1"));
    assert.equal(timeout.ai.timeoutSeconds, 5);
    apply(timeout, "ai-timeout", field("1000"));
    assert.equal(timeout.ai.timeoutSeconds, 120);

    const news = settings();
    apply(news, "news-max", field("0"));
    assert.equal(news.news.maxItems, 1);
    apply(news, "news-max", field("99"));
    assert.equal(news.news.maxItems, 30);
  });

  it("keeps the raw value for the default tab selector", () => {
    const current = settings();
    apply(current, "default-tab", field("  holdings  "));
    // 下拉框给的是已知 id，不做 trim（与原实现一致）。
    assert.equal(current.navigation.defaultTabId, "  holdings  ");
  });

  it("caps quote fields at five and reports instead of writing", () => {
    const current = settings();
    current.quotes.fields = ["price", "change", "changePercent", "open", "high"];
    const result = apply(current, "field", field("low", true));
    assert.deepEqual(result.message, { text: "行情字段最多选择 5 项", kind: "error" });
    assert.deepEqual(current.quotes.fields, ["price", "change", "changePercent", "open", "high"]);

    // 取消勾选则移除
    apply(current, "field", field("price", false));
    assert.equal(current.quotes.fields.includes("price"), false);
  });

  it("adds and removes tab security codes by tab id", () => {
    const current = settings();
    const tabId = current.tabs[0]!.id;
    apply(current, "tab-security", field("000001", true, { tabId }));
    assert.deepEqual(current.tabs[0]!.securityCodes, ["000001"]);
    // 重复勾选不会产生重复项
    apply(current, "tab-security", field("000001", true, { tabId }));
    assert.deepEqual(current.tabs[0]!.securityCodes, ["000001"]);
    apply(current, "tab-security", field("000001", false, { tabId }));
    assert.deepEqual(current.tabs[0]!.securityCodes, []);
    // 未知 tab 不应崩溃
    assert.deepEqual(apply(current, "tab-security", field("600519", true, { tabId: "nope" })), {});
  });

  it("only re-renders boss key, provider and risk mode on change events", () => {
    assert.equal(apply(settings(), "boss-key-enabled", field("", false), "input").rerender, false);
    assert.equal(apply(settings(), "boss-key-enabled", field("", false), "change").rerender, true);
    assert.equal(apply(settings(), "ai-provider", field("custom"), "input").rerender, false);
    assert.equal(apply(settings(), "risk-mode", field("active"), "input").rerender, false);
    assert.equal(apply(settings(), "risk-mode", field("active"), "change").rerender, true);
  });

  it("resets boss key recording only when disabling it", () => {
    const disabled = apply(settings(), "boss-key-enabled", field("", false));
    assert.equal(disabled.resetBossKeyRecording, true);
    const enabled = apply(settings(), "boss-key-enabled", field("", true));
    assert.equal(enabled.resetBossKeyRecording, false);
  });

  it("fills provider defaults and reports the opacity label", () => {
    const custom = settings();
    apply(custom, "ai-provider", field("custom"));
    assert.equal(custom.ai.baseUrl, "https://api.openai.com/v1");
    assert.equal(custom.ai.model, "gpt-4.1-mini");
    apply(custom, "ai-provider", field("deepseek"));
    assert.equal(custom.ai.baseUrl, "https://api.deepseek.com");

    const opacity = settings();
    const result = apply(opacity, "background-opacity", field("72"));
    assert.equal(opacity.appearance.backgroundOpacity, 0.72);
    assert.equal(result.opacityLabel, "72%");
  });

  it("does not write unknown settings", () => {
    const current = settings();
    const before = structuredClone(current);
    assert.equal(SETTINGS_FIELD_UPDATERS["not-a-field"], undefined);
    assert.deepEqual(current, before);
  });
});

describe("row field tables", () => {
  it("normalizes holding quantity and cost with the same lower bounds as the UI", () => {
    const current = settings();
    HOLDING_ROW_FIELDS["holding-quantity"]!(current, 0, field("0"));
    assert.equal(current.holdings[0]!.quantity, 1);
    HOLDING_ROW_FIELDS["holding-quantity"]!(current, 0, field("100.6"));
    assert.equal(current.holdings[0]!.quantity, 101);
    HOLDING_ROW_FIELDS["holding-cost"]!(current, 0, field("0"));
    assert.equal(current.holdings[0]!.costPrice, 0.0001);
  });

  it("writes holding alert numbers and the note", () => {
    const current = settings();
    const alertField = HOLDING_ALERT_NUMBER_FIELDS["holding-stop-loss"]!;
    current.holdings[0]!.alertRules[alertField] = nullableInputNumber("9.5");
    assert.equal(current.holdings[0]!.alertRules.stopLossPrice, 9.5);
    HOLDING_ROW_FIELDS["holding-note"]!(current, 0, field("x".repeat(200)));
    assert.equal(current.holdings[0]!.note.length, 120);
  });

  it("updates watchlist visibility and security alias", () => {
    const current = settings();
    WATCH_ROW_FIELDS["visible"]!(current, 0, field("", false));
    assert.equal(current.watchlist[0]!.visible, false);
    WATCH_ROW_FIELDS["alias"]!(current, 0, field("  茅台"));
    assert.equal(current.securities[0]!.alias, "茅台");
  });

  it("updates risk group thresholds and tab titles", () => {
    const current = settings();
    current.risk.groups = [
      { id: "tech", name: "科技", profitThreshold: null, lossThreshold: null, enabled: true }
    ];
    RISK_GROUP_ROW_FIELDS["risk-group-profit"]!(current, 0, field("150"));
    assert.equal(current.risk.groups[0]!.profitThreshold, 150);
    RISK_GROUP_ROW_FIELDS["risk-group-enabled"]!(current, 0, field("", false));
    assert.equal(current.risk.groups[0]!.enabled, false);

    const builtIn = current.tabs.find((tab) => tab.builtIn)!;
    const index = current.tabs.indexOf(builtIn);
    TAB_ROW_FIELDS["tab-title"]!(current, index, field("改名"));
    // 内置页的标题不允许改
    assert.equal(builtIn.title === "改名", false);
    TAB_ROW_FIELDS["tab-visible"]!(current, index, field("", false));
    assert.equal(builtIn.visible, false);
  });
});
