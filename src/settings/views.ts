import type { HoldingAlertRules, UserSettings } from "../config.js";
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
