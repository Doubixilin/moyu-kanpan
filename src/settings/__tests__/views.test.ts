import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { HoldingAlertRules, TabConfig, UserSettings } from "../../config";
import { loadAppConfigFromObject, toUserSettings } from "../../config";
import type { ProfileDiff, ProfilePreview } from "../profile";
import type { ProfilePanelState } from "../views";
import {
  displayNameForCode,
  formatRuleAmount,
  holdingAlertInput,
  holdingRuleDescriptions,
  holdingRuleSummary,
  nullableNumber,
  option,
  renderAddHolding,
  renderHoldingSetting,
  renderProfilePanel,
  renderProfilePreview,
  renderRiskGroupSetting,
  renderSettingsNavigation,
  renderTabSetting,
  renderWatchItem,
  settingsPageClass
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

  it("marks only the active settings page", () => {
    assert.equal(settingsPageClass("general", "general"), "settings-page-section is-active");
    assert.equal(settingsPageClass("data", "general"), "settings-page-section");

    const nav = renderSettingsNavigation("quotes");
    // 导航高亮必须唯一，否则"当前页"提示会同时亮起多个分类
    assert.equal((nav.match(/class="active"/g) ?? []).length, 1);
    assert.match(nav, /data-page="quotes"\s+class="active"/);
    assert.equal((nav.match(/aria-selected="true"/g) ?? []).length, 1);
    assert.match(nav, /窗口与页面/);
  });

  it("falls back from alias to name to code", () => {
    const securities = [
      { code: "600519", market: "SH" as const, name: "贵州茅台", alias: "茅台" },
      { code: "000001", market: "SZ" as const, name: "平安银行", alias: "" }
    ];
    assert.equal(displayNameForCode(securities, "600519"), "茅台");
    assert.equal(displayNameForCode(securities, "000001"), "平安银行");
    assert.equal(displayNameForCode(securities, "300750"), "300750");
  });

  it("renders built-in tabs as read-only and custom tabs as deletable", () => {
    const settings = baseSettings();
    const builtIn = settings.tabs[0]!;
    const builtInHtml = renderTabSetting(settings, builtIn, 0);
    assert.match(builtInHtml, /readonly/);
    assert.match(builtInHtml, /内置/);
    assert.equal(builtInHtml.includes("delete-tab"), false);
    assert.match(builtInHtml, /data-action="tab-up"[^>]*disabled/);

    const custom: TabConfig = {
      id: "custom-1",
      type: "stock-list",
      title: "我的列表",
      builtIn: false,
      visible: true,
      order: 1,
      securityCodes: [settings.watchlist[0]!.securityCode],
      maxItems: 10,
      newsMode: "watchlist_related"
    };
    const customHtml = renderTabSetting(settings, custom, 1);
    assert.match(customHtml, /data-action="delete-tab"/);
    assert.equal(customHtml.includes("readonly"), false);
    // 中间行两个方向键都可用（只有首/末行才禁用）
    assert.equal(/data-action="tab-(up|down)"[^>]*disabled/.test(customHtml), false);
    assert.match(customHtml, /选择股票（1）/);
    assert.match(customHtml, /data-setting="tab-security"[^>]*checked/);
  });

  it("summarizes holding rules as configured or empty", () => {
    const settings = baseSettings();
    const holding: UserSettings["holdings"][number] = {
      securityCode: settings.securities[0]!.code,
      quantity: 100,
      costPrice: 10,
      groupId: "all",
      note: "",
      alertRules: EMPTY_RULES
    };

    const empty = renderHoldingSetting(settings, holding, 0);
    assert.match(empty, /未配置/);
    assert.match(empty, /未设置机械条件/);
    assert.match(empty, /data-action="clear-holding-rules"[^>]*disabled/);

    const enabled = renderHoldingSetting(
      settings,
      {
        ...holding,
        alertRules: { ...EMPTY_RULES, enabled: true, stopLossPrice: 9, risePercent: 5 }
      },
      1
    );
    assert.match(enabled, /已启用 · 2 条/);
    assert.match(enabled, /现价跌破 9 时提醒/);
    assert.equal(enabled.includes("未设置机械条件"), false);
    assert.equal(/data-action="clear-holding-rules"[^>]*disabled/.test(enabled), false);

    // 有规则但暂停：仍然展示规则条数，且清空按钮可用
    const paused = renderHoldingSetting(
      settings,
      { ...holding, alertRules: { ...EMPTY_RULES, stopLossPrice: 9 } },
      2
    );
    assert.match(paused, /已暂停 · 1 条/);
    assert.equal(/data-action="clear-holding-rules"[^>]*disabled/.test(paused), false);
  });

  it("summarizes holdings and rule counts", () => {
    const settings = baseSettings();
    assert.equal(holdingRuleSummary({ ...settings, holdings: [] }), "0 只 · 0 只提醒 · 0 条规则");

    const base: UserSettings["holdings"][number] = {
      securityCode: settings.securities[0]!.code,
      quantity: 1,
      costPrice: 10,
      groupId: "all",
      note: "",
      alertRules: EMPTY_RULES
    };
    const holdings = [
      { ...base, alertRules: { ...EMPTY_RULES, enabled: true, stopLossPrice: 9, priceAbove: 12 } },
      { ...base }
    ];
    assert.equal(holdingRuleSummary({ ...settings, holdings }), "2 只 · 1 只提醒 · 2 条规则");
  });

  it("previews a profile diff and its issues", () => {
    const noChanges = renderProfilePreview(preview({ hasChanges: false }));
    assert.match(noChanges, /校验通过，没有变化/);

    const valid = renderProfilePreview(
      preview({
        diff: { ...EMPTY_DIFF, securitiesAdded: ["600519", "000001"], alertRuleChanges: 2 },
        issues: [{ severity: "warning", path: "holdings[0].quantity", message: "数量已取整" }]
      })
    );
    assert.match(valid, /校验通过，可以导入/);
    assert.match(valid, /class="profile-preview valid"/);
    assert.match(valid, /600519、000001/);
    assert.match(valid, /<b>提醒规则变化<\/b>2/);
    assert.match(valid, /class="warning">提醒 · holdings\[0\]\.quantity：数量已取整/);

    // 无效包必须显式说明"不会应用"，并把 error 与 warning 区分开
    const invalid = renderProfilePreview(
      preview({
        valid: false,
        issues: [
          { severity: "error", path: "holdings", message: "<b>缺少代码</b>" },
          { severity: "warning", path: "watchlist", message: "忽略未知代码" }
        ]
      })
    );
    assert.match(invalid, /class="profile-preview invalid"/);
    assert.match(invalid, /校验失败，不会应用/);
    assert.match(invalid, /class="error">错误 · holdings：&lt;b&gt;缺少代码&lt;\/b&gt;/);
    assert.equal(invalid.includes("<b>缺少代码</b>"), false);
    assert.equal(invalid.includes("profile-issues"), true);
  });

  it("gates profile panel actions on state and escapes the pasted JSON", () => {
    const empty = renderProfilePanel({ ...EMPTY_PANEL_STATE, activePage: "data" });
    assert.match(empty, /settings-page-section is-active/);
    assert.match(empty, /data-action="restore-profile" disabled/);
    assert.match(empty, /data-action="preview-profile" disabled/);
    assert.match(empty, /data-action="apply-profile" disabled/);
    assert.match(empty, /data-action="clear-profile" disabled/);
    assert.match(empty, /profile-empty/);

    const busy = renderProfilePanel({
      ...EMPTY_PANEL_STATE,
      activePage: "data",
      hasProfileBackup: true,
      busy: true,
      mode: "replace",
      text: '{"a":"<script>"}'
    });
    assert.equal(/data-action="restore-profile" disabled/.test(busy), false);
    assert.match(busy, /处理中…/);
    assert.match(busy, /value="replace" selected/);
    assert.match(busy, /&quot;&lt;script&gt;&quot;/);
    assert.equal(busy.includes("<script>"), false);

    // 只有"校验通过且有变化"才允许确认导入
    const ready = renderProfilePanel({
      ...EMPTY_PANEL_STATE,
      activePage: "data",
      text: "{}",
      preview: preview({ diff: { ...EMPTY_DIFF, holdingsAdded: ["600519"] } })
    });
    assert.equal(/data-action="apply-profile" disabled/.test(ready), false);
    assert.match(ready, /600519/);
    assert.equal(ready.includes("profile-empty"), false);
    assert.equal(/data-action="preview-profile" disabled/.test(ready), false);
  });
});

function baseSettings(): UserSettings {
  return toUserSettings(loadAppConfigFromObject({}, {}));
}

const EMPTY_DIFF: ProfileDiff = {
  securitiesAdded: [],
  securitiesUpdated: [],
  holdingsAdded: [],
  holdingsUpdated: [],
  holdingsRemoved: [],
  watchlistAdded: [],
  watchlistUpdated: [],
  watchlistRemoved: [],
  alertRuleChanges: 0,
  riskSettingsChanged: false
};

function preview(overrides: Partial<ProfilePreview> = {}): ProfilePreview {
  return {
    valid: true,
    hasChanges: true,
    mode: "merge",
    issues: [],
    ...overrides,
    diff: { ...EMPTY_DIFF, ...overrides.diff }
  };
}

const EMPTY_PANEL_STATE: ProfilePanelState = {
  activePage: "data",
  preview: null,
  hasProfileBackup: false,
  mode: "merge",
  text: "",
  busy: false
};
