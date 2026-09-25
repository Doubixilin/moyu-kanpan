import type { HoldingAlertRules, Security, TabConfig, UserSettings } from "../config.js";
import type { ProfilePreview } from "./profile.js";
import { escapeAttr, escapeHtml } from "../presentation/format.js";

/**
 * 设置界面的**纯**视图构造函数：输入数据 → 输出 HTML 字符串。
 *
 * 这些函数之前散在 1400+ 行的 `settingsRenderer.ts` 里，其中几个还直接读取模块级
 * `settings` 全局，既无法单测也无法复用（见审计报告 §4-5）。
 * 这里一律要求显式传参，因此可以直接断言输出。
 *
 * 注意：输出必须经过 `escapeHtml`/`escapeAttr`，这是渲染层唯一的注入防线。
 */

/** 输入框里的可空数值：null 显示为空串。 */
export function nullableNumber(value: number | null): string {
  return value == null ? "" : String(value);
}

/**
 * 按代码取展示名：别名 → 名称 → 代码。
 * 这条链在渲染层被复制了多次（审计报告 §4-7 记为 9 处），这里作为渲染侧的唯实现。
 */
export function displayNameForCode(securities: Security[], code: string): string {
  const security = securities.find((entry) => entry.code === code);
  return security?.alias || security?.name || code;
}

export type SettingsPage = "general" | "portfolio" | "quotes" | "news-ai" | "data";

const SETTINGS_PAGES: Array<{ id: SettingsPage; label: string }> = [
  { id: "general", label: "窗口与页面" },
  { id: "portfolio", label: "持仓与提醒" },
  { id: "quotes", label: "自选与行情" },
  { id: "news-ai", label: "新闻与 AI" },
  { id: "data", label: "导入与备份" }
];

const TAB_TYPE_LABELS: Record<TabConfig["type"], string> = {
  holdings: "持仓",
  watchlist: "自选",
  market: "市场",
  drivers: "新闻",
  combined: "组合",
  "stock-list": "自定义列表"
};

export function settingsPageClass(page: SettingsPage, activePage: SettingsPage): string {
  return `settings-page-section${activePage === page ? " is-active" : ""}`;
}

export function renderSettingsNavigation(activePage: SettingsPage): string {
  return `
    <nav class="settings-tab-nav" aria-label="设置分类">
      ${SETTINGS_PAGES.map(
        (page) => `
        <button type="button" data-action="settings-page" data-page="${page.id}"
          class="${activePage === page.id ? "active" : ""}"
          aria-selected="${activePage === page.id}">${page.label}</button>
      `
      ).join("")}
    </nav>
  `;
}

/** 一句话概括持仓与提醒规模。 */
export function holdingRuleSummary(settings: UserSettings): string {
  const enabledHoldings = settings.holdings.filter((holding) => holding.alertRules.enabled).length;
  const ruleCount = settings.holdings.reduce(
    (count, holding) =>
      count + holdingRuleDescriptions(holding.alertRules, holding.costPrice).length,
    0
  );
  return `${settings.holdings.length} 只 · ${enabledHoldings} 只提醒 · ${ruleCount} 条规则`;
}

export function option(value: string, label: string, selected: string): string {
  return `<option value="${escapeAttr(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(label)}</option>`;
}

export function holdingAlertInput(setting: string, label: string, value: number | null): string {
  return `<label><span>${label}</span><input data-setting="${setting}" type="number" min="0" step="0.001" value="${nullableNumber(value)}" placeholder="不启用" /></label>`;
}

export function formatRuleAmount(value: number): string {
  return `${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value)} 元`;
}

/**
 * 把提醒规则描述成一句句人话。
 *
 * `watchPrice` 的方向取决于它与成本价的关系（高于成本叫"升至"，低于成本叫"降至"），
 * 这条语义此前只存在于渲染逻辑里、没有任何测试。
 */
export function holdingRuleDescriptions(rules: HoldingAlertRules, costPrice: number): string[] {
  const descriptions: string[] = [];
  if (rules.stopLossPrice != null) descriptions.push(`现价跌破 ${rules.stopLossPrice} 时提醒`);
  if (rules.watchPrice != null) {
    descriptions.push(
      `现价${rules.watchPrice >= costPrice ? "升至" : "降至"} ${rules.watchPrice} 时提醒`
    );
  }
  if (rules.priceAbove != null) descriptions.push(`现价向上突破 ${rules.priceAbove} 时提醒`);
  if (rules.priceBelow != null) descriptions.push(`现价向下跌破 ${rules.priceBelow} 时提醒`);
  if (rules.risePercent != null) descriptions.push(`今日涨幅达到 ${rules.risePercent}% 时提醒`);
  if (rules.fallPercent != null) descriptions.push(`今日跌幅达到 ${rules.fallPercent}% 时提醒`);
  if (rules.dailyProfitAmount != null)
    descriptions.push(`今日盈利达到 ${formatRuleAmount(rules.dailyProfitAmount)} 时提醒`);
  if (rules.dailyLossAmount != null)
    descriptions.push(`今日亏损达到 ${formatRuleAmount(rules.dailyLossAmount)} 时提醒`);
  if (rules.totalProfitAmount != null)
    descriptions.push(`累计盈利达到 ${formatRuleAmount(rules.totalProfitAmount)} 时提醒`);
  if (rules.totalLossAmount != null)
    descriptions.push(`累计亏损达到 ${formatRuleAmount(rules.totalLossAmount)} 时提醒`);
  return descriptions;
}

/** 自选行。`total` 用于决定"下移"按钮是否禁用。 */
export function renderWatchItem(
  item: UserSettings["watchlist"][number],
  index: number,
  total: number,
  alias: string
): string {
  return `
    <div class="watch-row" data-index="${index}">
      <label class="visibility" title="是否在自选页面显示">
        <input type="checkbox" data-setting="visible" ${item.visible ? "checked" : ""} />
        <span>显示</span>
      </label>
      <span class="code-readonly">${item.securityCode}</span>
      <input data-setting="alias" maxlength="16" value="${escapeAttr(alias)}" placeholder="显示别名" aria-label="显示别名" />
      <div class="row-actions">
        <button data-action="move-up" title="上移" ${index === 0 ? "disabled" : ""}>↑</button>
        <button data-action="move-down" title="下移" ${index === total - 1 ? "disabled" : ""}>↓</button>
        <button data-action="delete-stock" class="danger" title="从自选移除">×</button>
      </div>
    </div>
  `;
}

export function renderRiskGroupSetting(
  group: UserSettings["risk"]["groups"][number],
  index: number
): string {
  return `
    <div class="risk-group-row" data-risk-group-index="${index}">
      <label class="visibility"><input data-setting="risk-group-enabled" type="checkbox" ${group.enabled ? "checked" : ""} /><span>启用</span></label>
      <input data-setting="risk-group-name" maxlength="16" value="${escapeAttr(group.name)}" aria-label="风险组名称" />
      <input data-setting="risk-group-profit" type="number" min="0" step="10" value="${nullableNumber(group.profitThreshold)}" placeholder="盈利阈值" />
      <input data-setting="risk-group-loss" type="number" min="0" step="10" value="${nullableNumber(group.lossThreshold)}" placeholder="亏损阈值" />
      <button data-action="delete-risk-group" class="danger compact-button" title="删除风险组">×</button>
    </div>
  `;
}

/** 可加入持仓的证券（已持仓的不再出现）。 */
export function renderAddHolding(
  securities: UserSettings["securities"],
  holdings: UserSettings["holdings"]
): string {
  const available = securities.filter(
    (security) => !holdings.some((holding) => holding.securityCode === security.code)
  );
  if (available.length === 0) return "";

  return `
    <div class="add-row add-holding-row">
      <select id="new-holding-code">
        ${available
          .map(
            (security) =>
              `<option value="${escapeAttr(security.code)}">${escapeHtml(security.alias || security.name || security.code)} · ${escapeHtml(security.code)}</option>`
          )
          .join("")}
      </select>
      <input id="new-holding-quantity" type="number" min="1" step="1" placeholder="数量" />
      <input id="new-holding-cost" type="number" min="0.0001" step="0.001" placeholder="成本价" />
      <button data-action="add-holding">加入持仓</button>
    </div>
  `;
}

export function renderTabSetting(settings: UserSettings, tab: TabConfig, index: number): string {
  const stockSelector =
    !tab.builtIn && tab.type === "stock-list"
      ? `
      <details class="tab-security-picker">
        <summary>选择股票（${tab.securityCodes.length}）</summary>
        <div class="security-check-grid">
          ${settings.watchlist
            .map(
              (item) => `
              <label>
                <input type="checkbox" data-setting="tab-security" data-tab-id="${escapeAttr(tab.id)}" value="${escapeAttr(item.securityCode)}" ${tab.securityCodes.includes(item.securityCode) ? "checked" : ""} />
                <span>${escapeHtml(displayNameForCode(settings.securities, item.securityCode))}</span>
              </label>
            `
            )
            .join("")}
        </div>
      </details>
    `
      : "";

  return `
    <div class="tab-setting-block">
      <div class="tab-setting-row" data-tab-index="${index}">
        <label class="visibility">
          <input type="checkbox" data-setting="tab-visible" ${tab.visible ? "checked" : ""} />
          <span>显示</span>
        </label>
        <span class="tab-type">${TAB_TYPE_LABELS[tab.type]}</span>
        <input data-setting="tab-title" maxlength="12" value="${escapeAttr(tab.title)}" ${tab.builtIn ? "readonly" : ""} aria-label="页面名称" />
        <div class="row-actions">
          <button data-action="tab-up" title="上移" ${index === 0 ? "disabled" : ""}>↑</button>
          <button data-action="tab-down" title="下移" ${index === settings.tabs.length - 1 ? "disabled" : ""}>↓</button>
          ${tab.builtIn ? '<span class="built-in-mark">内置</span>' : '<button data-action="delete-tab" class="danger" title="删除">×</button>'}
        </div>
      </div>
      ${stockSelector}
    </div>
  `;
}

export function renderHoldingSetting(
  settings: UserSettings,
  holding: UserSettings["holdings"][number],
  index: number
): string {
  const rules = holding.alertRules;
  const ruleDescriptions = holdingRuleDescriptions(rules, holding.costPrice);
  const configuredCount = ruleDescriptions.length;
  return `
    <div class="holding-setting-block" data-holding-index="${index}">
      <div class="holding-setting-row">
        <span class="security-label"><strong>${escapeHtml(displayNameForCode(settings.securities, holding.securityCode))}</strong><small>${escapeHtml(holding.securityCode)}</small></span>
        <label><span>数量</span><input data-setting="holding-quantity" type="number" min="1" step="1" value="${holding.quantity}" /></label>
        <label><span>成本</span><input data-setting="holding-cost" type="number" min="0.0001" step="0.001" value="${holding.costPrice}" /></label>
        <label><span>风险组</span><select data-setting="holding-group"><option value="all">未分组</option>${settings.risk.groups.map((group) => option(group.id, group.name, holding.groupId)).join("")}</select></label>
        <button data-action="delete-holding" class="danger compact-button" title="移出持仓">×</button>
      </div>
      <details class="holding-rule-details">
        <summary><span>警戒线与提醒</span><small>${configuredCount ? `${rules.enabled ? "已启用" : "已暂停"} · ${configuredCount} 条` : "未配置"}</small></summary>
        <div class="holding-rule-toolbar">
          <label class="check-card"><input data-setting="holding-alert-enabled" type="checkbox" ${rules.enabled ? "checked" : ""} /><span>启用该持仓提醒</span></label>
          <button type="button" class="danger" data-action="clear-holding-rules" ${configuredCount || rules.enabled ? "" : "disabled"}>清空规则</button>
        </div>
        ${configuredCount ? `<div class="holding-rule-preview">${ruleDescriptions.map((description) => `<span>${escapeHtml(description)}</span>`).join("")}</div>` : '<p class="holding-rule-empty">未设置机械条件，不会因该持仓主动提醒。</p>'}
        <div class="holding-alert-section">
          <strong>价格警戒线</strong>
          <div class="holding-alert-grid">
            ${holdingAlertInput("holding-stop-loss", "跌破止损价", rules.stopLossPrice)}
            ${holdingAlertInput("holding-watch-price", "到达观察线", rules.watchPrice)}
            ${holdingAlertInput("holding-price-above", "向上突破价", rules.priceAbove)}
            ${holdingAlertInput("holding-price-below", "向下跌破价", rules.priceBelow)}
          </div>
        </div>
        <div class="holding-alert-section">
          <strong>当日涨跌幅</strong>
          <div class="holding-alert-grid holding-alert-grid-two">
            ${holdingAlertInput("holding-rise-percent", "今日涨幅达到 %", rules.risePercent)}
            ${holdingAlertInput("holding-fall-percent", "今日跌幅达到 %", rules.fallPercent)}
          </div>
        </div>
        <div class="holding-alert-section">
          <strong>盈亏金额</strong>
          <div class="holding-alert-grid">
            ${holdingAlertInput("holding-daily-profit", "今日盈利达到", rules.dailyProfitAmount)}
            ${holdingAlertInput("holding-daily-loss", "今日亏损达到", rules.dailyLossAmount)}
            ${holdingAlertInput("holding-total-profit", "累计盈利达到", rules.totalProfitAmount)}
            ${holdingAlertInput("holding-total-loss", "累计亏损达到", rules.totalLossAmount)}
          </div>
        </div>
        <div class="holding-alert-section">
          <label class="holding-note"><span>备注 / 持有逻辑（仅展示）</span><input data-setting="holding-note" maxlength="120" value="${escapeAttr(holding.note)}" placeholder="本地展示，不参与规则解释" /></label>
        </div>
      </details>
    </div>
  `;
}

export function renderProfilePreview(preview: ProfilePreview): string {
  const diff = preview.diff;
  const rows = [
    ["新增证券", diff.securitiesAdded],
    ["更新证券", diff.securitiesUpdated],
    ["新增持仓", diff.holdingsAdded],
    ["更新持仓", diff.holdingsUpdated],
    ["删除持仓", diff.holdingsRemoved],
    ["新增自选", diff.watchlistAdded],
    ["更新自选", diff.watchlistUpdated],
    ["删除自选", diff.watchlistRemoved]
  ] as const;
  return `
    <div class="profile-preview ${preview.valid ? "valid" : "invalid"}">
      <strong>${preview.valid ? (preview.hasChanges ? "校验通过，可以导入" : "校验通过，没有变化") : "校验失败，不会应用"}</strong>
      <div class="profile-diff-grid">
        ${rows.map(([label, codes]) => `<span><b>${label}</b>${codes.length ? escapeHtml(codes.join("、")) : "无"}</span>`).join("")}
        <span><b>提醒规则变化</b>${diff.alertRuleChanges}</span>
        <span><b>全局风险设置</b>${diff.riskSettingsChanged ? "有变化" : "无变化"}</span>
      </div>
      ${
        preview.issues.length
          ? `
        <div class="profile-issues">
          ${preview.issues.map((issue) => `<span class="${issue.severity}">${issue.severity === "error" ? "错误" : "提醒"} · ${escapeHtml(issue.path)}：${escapeHtml(issue.message)}</span>`).join("")}
        </div>
      `
          : ""
      }
    </div>
  `;
}

/** 配置导入面板的可变状态（原实现直接读模块级全局）。 */
export interface ProfilePanelState {
  activePage: SettingsPage;
  preview: ProfilePreview | null;
  hasProfileBackup: boolean;
  mode: "merge" | "replace";
  text: string;
  busy: boolean;
}

export function renderProfilePanel(state: ProfilePanelState): string {
  const { preview } = state;
  return `
    <section class="panel profile-panel ${settingsPageClass("data", state.activePage)}">
      <div class="panel-heading">
        <div>
          <h2>配置导入与备份</h2>
          <p>手动编辑适合日常修改；Coze 或其他智能体可按严格格式生成批量配置包。</p>
        </div>
        <span>本地校验</span>
      </div>
      <div class="profile-toolbar">
        <button type="button" data-action="copy-profile-prompt">复制给 AI 的提示词</button>
        <button type="button" data-action="copy-profile-export">复制当前配置包</button>
        <label class="file-action">
          选择 JSON 文件
          <input type="file" data-setting="profile-file" accept="application/json,.json" />
        </label>
        <button type="button" data-action="restore-profile" ${state.hasProfileBackup ? "" : "disabled"}>恢复上次导入前配置</button>
      </div>
      <div class="profile-mode-row">
        <label><span>导入方式</span><select data-setting="profile-mode">${option("merge", "合并：保留未提供的配置", state.mode)}${option("replace", "替换：替换包中明确提供的持仓/自选", state.mode)}</select></label>
        <span>含提醒规则的配置包会强制先进入影子模式。</span>
      </div>
      <label class="profile-json-field">
        <span>粘贴 AI 返回的 JSON，或选择文件</span>
        <textarea data-setting="profile-text" spellcheck="false" placeholder="{&#10;  &quot;profileVersion&quot;: 1,&#10;  ...&#10;}">${escapeHtml(state.text)}</textarea>
      </label>
      <div class="profile-actions">
        <button type="button" data-action="preview-profile" ${state.busy || !state.text.trim() ? "disabled" : ""}>${state.busy ? "处理中…" : "预览差异"}</button>
        <button type="button" class="primary" data-action="apply-profile" ${state.busy || !preview?.valid || !preview.hasChanges ? "disabled" : ""}>确认导入</button>
        <button type="button" data-action="clear-profile" ${state.busy || !state.text ? "disabled" : ""}>清空</button>
      </div>
      ${preview ? renderProfilePreview(preview) : '<div class="profile-empty">导入前不会修改任何设置。先预览差异，再确认保存。</div>'}
    </section>
  `;
}
