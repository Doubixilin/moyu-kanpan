import { DEFAULT_BOSS_KEY_ACCELERATOR, parseBossKeyAccelerator } from "./shortcut.js";
import type { HoldingAlertRules, QuoteField, TabType, UserSettings } from "./config";
import { escapeAttr, escapeHtml } from "./presentation/format.js";
import { AiSettingsController } from "./settings/controllers/ai.js";
import {
  bossKeyCaptureOutcome,
  displayBossKey,
  type KeyEventLike
} from "./settings/controllers/bossKey.js";
import { ProfileImportController } from "./settings/controllers/profile.js";
import {
  HOLDING_ALERT_NUMBER_FIELDS,
  HOLDING_ROW_FIELDS,
  nullableInputNumber,
  RISK_GROUP_ROW_FIELDS,
  SETTINGS_FIELD_UPDATERS,
  TAB_ROW_FIELDS,
  WATCH_ROW_FIELDS,
  type FieldElement
} from "./settings/fields.js";
import {
  holdingRuleSummary,
  nullableNumber,
  option,
  renderAddHolding,
  renderHoldingSetting,
  renderProfilePanel,
  renderRiskGroupSetting,
  renderSettingsNavigation,
  renderTabSetting,
  renderWatchItem,
  settingsPageClass,
  type SettingsPage
} from "./settings/views.js";
import { captureUiState, restoreUiState } from "./settings/uiState.js";

const quoteFields: Array<{ value: QuoteField; label: string }> = [
  { value: "price", label: "当前价" },
  { value: "change", label: "涨跌额" },
  { value: "changePercent", label: "涨跌幅" },
  { value: "open", label: "开盘" },
  { value: "previousClose", label: "昨收" },
  { value: "high", label: "最高" },
  { value: "low", label: "最低" },
  { value: "volume", label: "成交量" },
  { value: "amount", label: "成交额" },
  { value: "mainInflow", label: "主力净流入" }
];

const tabTypeLabels: Record<TabType, string> = {
  holdings: "持仓页",
  watchlist: "自选页",
  market: "市场概览",
  drivers: "新闻专题",
  combined: "综合页面",
  "stock-list": "股票列表"
};

let settings: UserSettings | null = null;
let message = "";
let messageKind: "ok" | "error" | "" = "";
let recordingBossKey = false;
let activeSettingsPage: SettingsPage = "general";
let settingsDirty = false;

// 三个面板的状态与异步流程搬到 `settings/controllers/`：那里不读 DOM、不读模块级变量，
// 只通过端口回调回来，因此可以单测（此前这些逻辑在这个文件里完全没有测试）。
const ai = new AiSettingsController({
  ipc: () => window.floatingStock ?? null,
  render,
  notify: showMessage,
  clearMessage: () => {
    message = "";
    messageKind = "";
  }
});

const profile = new ProfileImportController({
  ipc: () => window.floatingStock ?? null,
  confirm: (text) => window.confirm(text),
  render,
  notify: showMessage,
  clearMessage: () => {
    message = "";
    messageKind = "";
  },
  applySettings: (next, backupCreated) => {
    settings = next;
    settingsDirty = false;
    if (backupCreated) profile.hasBackup = true;
  }
});

const root = document.getElementById("settings-root");
if (!root) throw new Error("Missing #settings-root");
const rootElement = root;

function render(): void {
  if (!settings) {
    rootElement.innerHTML =
      '<main class="settings-shell"><p class="loading">正在读取设置…</p></main>';
    return;
  }

  // 捕获为局部常量：`settings` 是模块级变量，在下面的箭头回调里 TS 无法保留非空收窄。
  const current = settings;
  const visibleTabs = current.tabs.filter((tab) => tab.visible);
  // 整页重建前先记下界面状态（展开的 details / 焦点与光标 / 滚动位置），重建后放回去。
  // 不做这一步时，任何一次必须重建的操作都会让用户正在编辑的输入框失焦、展开的面板收起（§4-6）。
  const uiState = captureUiState(rootElement);
  rootElement.innerHTML = `
    <main class="settings-shell">
      <header class="settings-header">
        <div>
          <p class="eyebrow">摸鱼看盘</p>
          <h1>摸鱼看盘设置</h1>
          <p>持仓、自选、页面和外观均保存在本机。</p>
        </div>
        <button class="primary" data-action="save">保存设置</button>
      </header>

      <div id="settings-message" role="status" aria-live="polite" ${message ? "" : "hidden"}>${
        message
          ? `<div class="message ${escapeHtml(messageKind)}">${escapeHtml(message)}</div>`
          : ""
      }</div>

      ${renderSettingsNavigation(activeSettingsPage)}

      ${renderProfilePanel({
        activePage: activeSettingsPage,
        preview: profile.preview,
        hasProfileBackup: profile.hasBackup,
        mode: profile.mode,
        text: profile.text,
        busy: profile.busy
      })}

      <section class="panel ${settingsPageClass("general", activeSettingsPage)}">
        <div class="panel-heading">
          <div>
            <h2>窗口与快捷键</h2>
            <p>窗口行为即时生效；老板键用于从任意应用快速隐藏或呼出。</p>
          </div>
          <span>本机设置</span>
        </div>
        <div class="window-toggle-grid">
          <label class="check-card window-check">
            <input type="checkbox" data-setting="always-on-top" ${settings.window.alwaysOnTop ? "checked" : ""} />
            <span><strong>始终置顶</strong><small>保持在其他应用上层</small></span>
          </label>
          <label class="check-card window-check">
            <input type="checkbox" data-setting="tray-only" ${settings.window.trayOnly ? "checked" : ""} />
            <span><strong>仅托盘驻留</strong><small>不显示任务栏图标</small></span>
          </label>
          <label class="check-card window-check">
            <input type="checkbox" data-setting="boss-key-enabled" ${settings.window.bossKeyEnabled ? "checked" : ""} />
            <span><strong>启用老板键</strong><small>全局呼出或隐藏</small></span>
          </label>
          <label class="check-card window-check">
            <input type="checkbox" data-setting="click-through" ${settings.window.clickThrough ? "checked" : ""} />
            <span><strong>点击穿透</strong><small>鼠标操作传给下层窗口</small></span>
          </label>
          <label class="check-card window-check">
            <input type="checkbox" data-setting="window-locked" ${settings.window.locked ? "checked" : ""} />
            <span><strong>锁定位置</strong><small>禁止拖动与缩放</small></span>
          </label>
        </div>
        <div class="shortcut-row">
          <span class="shortcut-label">老板键</span>
          <button id="boss-key-recorder" type="button" class="shortcut-recorder ${recordingBossKey ? "recording" : ""}" data-action="record-boss-key" ${!settings.window.bossKeyEnabled ? "disabled" : ""}>
            ${recordingBossKey ? "请按组合键…" : escapeHtml(displayBossKey(settings.window.bossKeyAccelerator))}
          </button>
          <button type="button" data-action="reset-boss-key" ${!settings.window.bossKeyEnabled ? "disabled" : ""}>恢复默认</button>
        </div>
        <p class="shortcut-hint">带修饰键时支持字母、数字、标点、空格、导航键及 F1–F24；单键仅允许功能键或媒体键，F11 和系统危险组合禁用。Esc 取消录制。</p>
      </section>
      <section class="panel ${settingsPageClass("general", activeSettingsPage)}">
        <div class="panel-heading">
          <div>
            <h2>页面与默认视图</h2>
            <p>内置页面可以隐藏，自定义页面可以删除；顶部最多直接显示 4 个。</p>
          </div>
          <span>${visibleTabs.length} 个显示</span>
        </div>

        <div class="tab-settings-list">
          ${settings.tabs.map((tab, index) => renderTabSetting(current, tab, index)).join("")}
        </div>

        <div class="add-row add-tab-row">
          <select id="new-tab-type" aria-label="页面模板">
            <option value="stock-list">股票列表</option>
            <option value="holdings">持仓页</option>
            <option value="drivers">新闻专题</option>
            <option value="combined">综合页面</option>
            <option value="market">市场概览</option>
          </select>
          <input id="new-tab-title" maxlength="12" placeholder="页面名称" />
          <button data-action="add-tab">添加页面</button>
        </div>

        <div class="navigation-options">
          <label class="form-row">
            <span>默认页面</span>
            <select data-setting="default-tab">
              ${visibleTabs.map((tab) => option(tab.id, tab.title, settings!.navigation.defaultTabId)).join("")}
            </select>
          </label>
          <label class="toggle-row">
            <input type="checkbox" data-setting="remember-tab" ${settings.navigation.rememberLastTab ? "checked" : ""} />
            <span>记住上次停留页面</span>
          </label>
        </div>
      </section>

      <section class="panel ${settingsPageClass("portfolio", activeSettingsPage)}">
        <div class="panel-heading">
          <div>
            <h2>持仓</h2>
            <p>交易后请同步数量和券商成本价；当日有买卖时，今日盈亏仅供参考。</p>
          </div>
          <span>${holdingRuleSummary(settings)}</span>
        </div>
        <div class="holding-settings-list">
          ${
            settings.holdings.length
              ? settings.holdings
                  .map((holding, index) => renderHoldingSetting(current, holding, index))
                  .join("")
              : '<div class="inline-empty">尚未配置持仓</div>'
          }
        </div>
        ${renderAddHolding(settings.securities, settings.holdings)}
      </section>

      <section class="panel risk-panel ${settingsPageClass("portfolio", activeSettingsPage)}">
        <div class="panel-heading">
          <div>
            <h2>交易规则与提醒</h2>
            <p>只做本地机械计算；先在影子模式观察，确认无误后再启用正式提醒。</p>
          </div>
          <span>${settings.risk.mode === "shadow" ? "影子模式" : "正式提醒"}</span>
        </div>
        <div class="risk-section">
          <div class="risk-section-heading"><strong>常用组合提醒</strong><span>金额均按人民币元填写</span></div>
          <div class="risk-global-grid risk-primary-grid">
            <label><span>运行模式</span><select data-setting="risk-mode">${option("shadow", "影子模式（推荐）", settings.risk.mode)}${option("active", "正式提醒", settings.risk.mode)}</select></label>
            <label><span>今日盈利达到</span><input data-setting="risk-daily-profit" type="number" min="0" step="10" value="${nullableNumber(settings.risk.portfolioDailyProfitThreshold)}" placeholder="不提醒" /></label>
            <label><span>今日亏损达到</span><input data-setting="risk-daily-loss" type="number" min="0" step="10" value="${nullableNumber(settings.risk.portfolioDailyLossThreshold)}" placeholder="不提醒" /></label>
          </div>
        </div>
        <div class="risk-toggle-grid">
          <label class="check-card"><input data-setting="risk-once-per-day" type="checkbox" ${settings.risk.oncePerDay ? "checked" : ""} /><span>每条规则每日仅一次</span></label>
          <label class="check-card"><input data-setting="risk-trading-only" type="checkbox" ${settings.risk.onlyDuringTrading ? "checked" : ""} /><span>仅交易时段判断</span></label>
          <label class="check-card"><input data-setting="risk-widget" type="checkbox" ${settings.risk.notifications.widget ? "checked" : ""} /><span>悬浮窗高亮</span></label>
          <label class="check-card"><input data-setting="risk-tray" type="checkbox" ${settings.risk.notifications.tray ? "checked" : ""} /><span>托盘状态</span></label>
          <label class="check-card"><input data-setting="risk-windows" type="checkbox" ${settings.risk.notifications.windows ? "checked" : ""} /><span>系统通知（无声音）</span></label>
        </div>
        <details class="risk-advanced-details">
          <summary>仓位纪律与防重复设置</summary>
          <p>账户基准只用于计算总仓位比例，1R 只用于盈亏换算；未设置时不会猜测。</p>
          <div class="risk-global-grid">
            <label><span>账户基准</span><input data-setting="risk-account-baseline" type="number" min="0" step="100" value="${nullableNumber(settings.risk.accountBaseline)}" placeholder="未设置" /></label>
            <label><span>账户 1R</span><input data-setting="risk-one-r" type="number" min="0" step="10" value="${nullableNumber(settings.risk.oneR)}" placeholder="未设置" /></label>
            <label><span>单只持仓上限</span><input data-setting="risk-max-position" type="number" min="0" step="100" value="${nullableNumber(settings.risk.maxPositionValue)}" placeholder="不限制" /></label>
            <label><span>持仓数量上限</span><input data-setting="risk-max-count" type="number" min="1" step="1" value="${nullableNumber(settings.risk.maxHoldingCount)}" placeholder="不限制" /></label>
            <label><span>总仓位上限 %</span><input data-setting="risk-max-exposure" type="number" min="0" step="1" value="${nullableNumber(settings.risk.maxTotalExposurePercent)}" placeholder="不限制" /></label>
            <label><span>止损预警区 %</span><input data-setting="risk-stop-warning" type="number" min="0.1" max="20" step="0.1" value="${settings.risk.stopWarningPercent}" /></label>
            <label><span>解除后回差 %</span><input data-setting="risk-hysteresis" type="number" min="0.01" max="10" step="0.01" value="${settings.risk.hysteresisPercent}" /></label>
            <label><span>重复提醒冷却（分钟）</span><input data-setting="risk-cooldown" type="number" min="0" max="1440" step="1" value="${settings.risk.cooldownMinutes}" /></label>
          </div>
        </details>
        <div class="risk-group-heading"><strong>风险组</strong><span>按持仓分组汇总累计浮盈亏</span></div>
        <div class="risk-group-list">
          ${settings.risk.groups.length ? settings.risk.groups.map(renderRiskGroupSetting).join("") : '<div class="inline-empty">尚未配置风险组</div>'}
        </div>
        <button class="secondary-action" data-action="add-risk-group">添加风险组</button>
      </section>

      <section class="panel ${settingsPageClass("quotes", activeSettingsPage)}">
        <div class="panel-heading">
          <div>
            <h2>自选股</h2>
            <p>代码作为证券唯一标识；别名只影响悬浮窗显示。</p>
          </div>
          <span>${settings.watchlist.length}/50</span>
        </div>
        <div class="watchlist">
          ${settings.watchlist
            .map((item, index, list) =>
              renderWatchItem(item, index, list.length, securityFor(item.securityCode)?.alias || "")
            )
            .join("")}
        </div>
        <div class="add-row">
          <input id="new-code" inputmode="numeric" maxlength="6" placeholder="股票代码，如 600519" />
          <input id="new-alias" maxlength="16" placeholder="名称或别名（可选）" />
          <button data-action="add-stock">添加</button>
        </div>
      </section>

      <section class="panel ${settingsPageClass("quotes", activeSettingsPage)}">
        <div class="panel-heading">
          <div>
            <h2>行情显示</h2>
            <p>最多选择 5 项；小窗建议保留 2–3 项。</p>
          </div>
        </div>
        <div class="field-grid">
          ${quoteFields
            .map(
              ({ value, label }) => `
            <label class="check-card">
              <input type="checkbox" data-setting="field" value="${value}" ${settings?.quotes.fields.includes(value) ? "checked" : ""} />
              <span>${label}</span>
            </label>
          `
            )
            .join("")}
        </div>
        <label class="form-row">
          <span>股票排序</span>
          <select data-setting="quote-sort">
            ${option("manual", "自定义顺序", settings.quotes.sort)}
            ${option("changePercentDesc", "涨幅从高到低", settings.quotes.sort)}
            ${option("changePercentAbs", "波动幅度优先", settings.quotes.sort)}
          </select>
        </label>
      </section>

      <section class="panel ai-panel ${settingsPageClass("news-ai", activeSettingsPage)}">
        <div class="panel-heading">
          <div>
            <h2>AI 快速分析</h2>
            <p>DeepSeek Flash 只分析公开新闻；数量、成本、账户和交易规则不会发送。</p>
          </div>
          <span class="ai-state ${escapeAttr(ai.status?.state ?? "unconfigured")}">${escapeHtml(ai.statusLabel(current))}</span>
        </div>
        <div class="ai-toggle-row">
          <label class="check-card">
            <input data-setting="ai-enabled" type="checkbox" ${settings.ai.enabled ? "checked" : ""} />
            <span><strong>启用 AI 筛选</strong><small>不可用时自动降级为本地规则</small></span>
          </label>
        </div>
        <div class="ai-settings-grid">
          <label><span>服务类型</span><select data-setting="ai-provider">${option("deepseek", "DeepSeek 官方", settings.ai.provider)}${option("custom", "自定义 OpenAI-compatible", settings.ai.provider)}</select></label>
          <label><span>模型</span><input data-setting="ai-model" maxlength="100" value="${escapeAttr(settings.ai.model)}" placeholder="deepseek-v4-flash" /></label>
          <label class="ai-base-url"><span>API 地址</span><input data-setting="ai-base-url" maxlength="300" value="${escapeAttr(settings.ai.baseUrl)}" placeholder="https://api.deepseek.com" /></label>
          <label><span>超时（秒）</span><input data-setting="ai-timeout" type="number" min="5" max="120" step="1" value="${settings.ai.timeoutSeconds}" /></label>
          <label class="ai-key-field"><span>API Key</span><input data-setting="ai-api-key" type="password" autocomplete="new-password" value="${escapeAttr(ai.pendingApiKey)}" placeholder="${ai.keyPlaceholder()}" /></label>
        </div>
        <div class="ai-actions">
          <button type="button" data-action="test-ai" ${ai.busy ? "disabled" : ""}>${ai.busy ? "测试中…" : "测试连接"}</button>
          <button type="button" data-action="clear-ai-key" class="danger" ${ai.status?.credentialSource !== "secure" || ai.busy ? "disabled" : ""}>清除 API Key</button>
          <span>${escapeHtml(ai.status?.message ?? "正在读取安全存储状态…")}</span>
        </div>
        <p class="ai-privacy-note">模型仅接收新闻标题、摘要、来源、时间和新闻自身包含的公开代码；不会接收完整持仓组合。DeepSeek 模式固定关闭深度思考并要求 JSON 输出。</p>
      </section>

      <section class="panel ${settingsPageClass("news-ai", activeSettingsPage)}">
        <div class="panel-heading">
          <div>
            <h2>快讯基础设置</h2>
            <p>AI 驱动页会进一步过滤低优先级内容。</p>
          </div>
        </div>
        <label class="form-row">
          <span>抓取筛选</span>
          <select data-setting="news-mode">
            ${option("all", "全部候选", settings.news.mode)}
            ${option("watchlist_related", "仅自选相关", settings.news.mode)}
            ${option("important", "仅中高优先级", settings.news.mode)}
          </select>
        </label>
        <label class="form-row">
          <span>候选上限</span>
          <input data-setting="news-max" type="number" min="1" max="30" value="${settings.news.maxItems}" />
        </label>
      </section>

      <section class="panel ${settingsPageClass("general", activeSettingsPage)}">
        <div class="panel-heading">
          <div>
            <h2>外观</h2>
            <p>低调模式去除红绿黄，只用明暗、粗细和箭头表达。</p>
          </div>
        </div>
        <label class="form-row">
          <span>显示模式</span>
          <select data-setting="theme">
            ${option("standard", "标准彩色", settings.appearance.theme)}
            ${option("stealth", "低调灰阶", settings.appearance.theme)}
          </select>
        </label>
        <label class="form-row">
          <span>行情刷新</span>
          <select data-setting="refresh-mode">
            ${option("fast", "较快：查看时3秒，后台5秒", settings.refreshPolicy?.mode ?? "fast")}
            ${option("standard", "标准：查看时5秒，后台8秒", settings.refreshPolicy?.mode ?? "fast")}
          </select>
        </label>
        <label class="range-row">
          <span>背景不透明度 <output id="opacity-value">${Math.round(settings.appearance.backgroundOpacity * 100)}%</output></span>
          <input data-setting="background-opacity" type="range" min="15" max="98" step="1" value="${Math.round(settings.appearance.backgroundOpacity * 100)}" />
        </label>
      </section>

      <footer>
        <button class="primary" data-action="save">保存设置</button>
      </footer>
    </main>
  `;
  restoreUiState(rootElement, uiState);
}

rootElement.addEventListener("input", handleFormChange);
rootElement.addEventListener("change", handleFormChange);
rootElement.addEventListener("click", (event) => void handleClick(event));
rootElement.addEventListener("toggle", handleHoldingRuleToggle, true);
document.addEventListener("keydown", handleBossKeyCapture, true);

function handleHoldingRuleToggle(event: Event): void {
  const opened = event.target;
  if (
    !(opened instanceof HTMLDetailsElement) ||
    !opened.classList.contains("holding-rule-details") ||
    !opened.open
  )
    return;
  rootElement
    .querySelectorAll<HTMLDetailsElement>(".holding-rule-details[open]")
    .forEach((details) => {
      if (details !== opened) details.open = false;
    });
}

/** 行内字段：先由 DOM 定位行索引，再交给声明式表里的更新函数。 */
function applyRowField<T extends object>(
  target: Element,
  rowSelector: string,
  indexDatasetKey: string,
  rows: T[],
  fields: Record<string, (settings: UserSettings, index: number, element: FieldElement) => void>,
  setting: string
): boolean {
  const row = target.closest<HTMLElement>(rowSelector);
  const index = Number(row?.dataset[indexDatasetKey]);
  if (!row || !Number.isInteger(index) || !rows[index]) return false;
  const field = fields[setting];
  if (!field) return false;
  field(settings!, index, target as unknown as FieldElement);
  return true;
}

/**
 * 表单字段派发。
 *
 * 字段逻辑全部在 `settings/fields.ts` 的声明式表里（纯函数、可单测），这里只负责：
 * 读取 `data-setting`、定位行上下文、应用副作用（重渲染 / 提示 / 重置录制 / 更新标签）。
 * 此前这里是一个 190 行、40 多个 `if (setting === "…")` 的分支函数。
 */
function handleFormChange(event: Event): void {
  if (!settings) return;
  const target = event.target as HTMLInputElement | HTMLSelectElement;
  const setting = target.dataset.setting;
  if (!setting) return;

  // 这三个字段改的是渲染层自身的状态（草稿文本/模式/文件），不属于 settings。
  if (setting === "profile-text") {
    profile.setText(target.value);
    return;
  }
  // API Key 不写入 settings（由主进程用系统安全存储加密），只暂存在渲染层。
  if (setting === "ai-api-key") {
    ai.setPendingApiKey(target.value);
    settingsDirty = true;
    return;
  }
  if (setting === "profile-mode") {
    profile.setMode(target.value);
    if (event.type === "change") render();
    return;
  }
  if (setting === "profile-file") {
    const file = (target as HTMLInputElement).files?.[0];
    if (file) void profile.readFile(file);
    return;
  }

  settingsDirty = true;

  if (
    applyRowField(target, ".watch-row", "index", settings.watchlist, WATCH_ROW_FIELDS, setting) ||
    applyRowField(
      target,
      ".holding-setting-block",
      "holdingIndex",
      settings.holdings,
      HOLDING_ROW_FIELDS,
      setting
    )
  ) {
    return;
  }
  // 持仓提醒的数值字段是 10 个同构输入框，用映射表统一处理。
  const alertField = HOLDING_ALERT_NUMBER_FIELDS[setting];
  {
    const row = target.closest<HTMLElement>(".holding-setting-block");
    const index = Number(row?.dataset.holdingIndex);
    if (alertField && row && Number.isInteger(index) && settings.holdings[index]) {
      settings.holdings[index].alertRules[alertField] = nullableInputNumber(target.value);
      return;
    }
  }
  if (
    applyRowField(
      target,
      ".risk-group-row",
      "riskGroupIndex",
      settings.risk.groups,
      RISK_GROUP_ROW_FIELDS,
      setting
    ) ||
    applyRowField(target, ".tab-setting-row", "tabIndex", settings.tabs, TAB_ROW_FIELDS, setting)
  ) {
    return;
  }

  const updater = SETTINGS_FIELD_UPDATERS[setting];
  if (!updater) return;
  const result = updater(settings, {
    element: target as unknown as FieldElement,
    eventType: event.type
  });
  if (result.resetBossKeyRecording) recordingBossKey = false;
  if (result.opacityLabel !== undefined) {
    const output = document.getElementById("opacity-value");
    if (output) output.textContent = result.opacityLabel;
  }
  if (result.message) {
    // 该字段没有被写入（例如超过行情字段上限），把控件恢复成未勾选。
    if (setting === "field") (target as HTMLInputElement).checked = false;
    showMessage(result.message.text, result.message.kind);
  }
  if (result.rerender) render();
}

async function handleClick(event: Event): Promise<void> {
  if (!settings) return;
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
  if (!button || button.disabled) return;
  const action = button.dataset.action;

  if (action === "settings-page") {
    const page = button.dataset.page;
    if (isSettingsPage(page)) {
      activeSettingsPage = page;
      render();
      window.scrollTo({ top: 0, behavior: "auto" });
    }
    return;
  }

  if (action === "record-boss-key") {
    recordingBossKey = true;
    message = "";
    messageKind = "";
    render();
    focusBossKeyRecorder();
    return;
  }
  if (action === "reset-boss-key") {
    settingsDirty = true;
    settings.window.bossKeyAccelerator = DEFAULT_BOSS_KEY_ACCELERATOR;
    recordingBossKey = false;
    showMessage("老板键已恢复默认，保存后生效", "ok");
    return;
  }
  if (action === "test-ai") {
    await ai.test(settings);
    return;
  }
  if (action === "clear-ai-key") {
    await ai.clearCredential();
    return;
  }
  if (action === "copy-profile-prompt") {
    await profile.copyPrompt();
    return;
  }
  if (action === "copy-profile-export") {
    await profile.copyExport();
    return;
  }
  if (action === "preview-profile") {
    await profile.previewDiff();
    return;
  }
  if (action === "apply-profile") {
    await profile.apply();
    return;
  }
  if (action === "restore-profile") {
    await profile.restore();
    return;
  }
  if (action === "clear-profile") {
    profile.clear();
    render();
    return;
  }

  settingsDirty = true;

  const watchRow = button.closest<HTMLElement>(".watch-row");
  const index = Number(watchRow?.dataset.index);
  if (action === "move-up" && index > 0) {
    [settings.watchlist[index - 1], settings.watchlist[index]] = [
      settings.watchlist[index],
      settings.watchlist[index - 1]
    ];
    normalizeOrder();
    render();
    return;
  }
  if (action === "move-down" && index < settings.watchlist.length - 1) {
    [settings.watchlist[index + 1], settings.watchlist[index]] = [
      settings.watchlist[index],
      settings.watchlist[index + 1]
    ];
    normalizeOrder();
    render();
    return;
  }
  if (action === "delete-stock") {
    if (settings.watchlist.length === 1) {
      showMessage("至少保留一只自选股", "error");
      return;
    }
    const removed = settings.watchlist.splice(index, 1)[0];
    if (removed) {
      for (const tab of settings.tabs) {
        tab.securityCodes = tab.securityCodes.filter((code) => code !== removed.securityCode);
      }
    }
    normalizeOrder();
    render();
    return;
  }

  const tabRow = button.closest<HTMLElement>(".tab-setting-row");
  const tabIndex = Number(tabRow?.dataset.tabIndex);
  if (action === "tab-up" && tabIndex > 0) {
    [settings.tabs[tabIndex - 1], settings.tabs[tabIndex]] = [
      settings.tabs[tabIndex],
      settings.tabs[tabIndex - 1]
    ];
    normalizeOrder();
    render();
    return;
  }
  if (action === "tab-down" && tabIndex < settings.tabs.length - 1) {
    [settings.tabs[tabIndex + 1], settings.tabs[tabIndex]] = [
      settings.tabs[tabIndex],
      settings.tabs[tabIndex + 1]
    ];
    normalizeOrder();
    render();
    return;
  }
  if (action === "delete-tab") {
    const removed = settings.tabs[tabIndex];
    if (removed?.builtIn) return;
    settings.tabs.splice(tabIndex, 1);
    repairNavigation();
    normalizeOrder();
    render();
    return;
  }

  const holdingRow = button.closest<HTMLElement>(".holding-setting-block");
  const holdingIndex = Number(holdingRow?.dataset.holdingIndex);
  if (action === "clear-holding-rules" && Number.isInteger(holdingIndex)) {
    settings.holdings[holdingIndex].alertRules = emptyHoldingAlertRules();
    showMessage(
      `已清空 ${securityFor(settings.holdings[holdingIndex].securityCode)?.name || settings.holdings[holdingIndex].securityCode} 的提醒规则，保存后生效`,
      "ok"
    );
    return;
  }
  if (action === "delete-holding") {
    settings.holdings.splice(holdingIndex, 1);
    render();
    return;
  }

  const riskGroupRow = button.closest<HTMLElement>(".risk-group-row");
  const riskGroupIndex = Number(riskGroupRow?.dataset.riskGroupIndex);
  if (action === "delete-risk-group" && Number.isInteger(riskGroupIndex)) {
    const removed = settings.risk.groups.splice(riskGroupIndex, 1)[0];
    if (removed) {
      settings.holdings.forEach((holding) => {
        if (holding.groupId === removed.id) holding.groupId = "all";
      });
    }
    render();
    return;
  }
  if (action === "add-risk-group") {
    settings.risk.groups.push({
      id: "risk-" + Date.now().toString(36),
      name: "新风险组",
      profitThreshold: null,
      lossThreshold: null,
      enabled: true
    });
    render();
    return;
  }

  if (action === "add-stock") {
    addStock();
    return;
  }
  if (action === "add-holding") {
    addHolding();
    return;
  }
  if (action === "add-tab") {
    addTab();
    return;
  }
  if (action === "save") await save();
}

function isSettingsPage(value: string | undefined): value is SettingsPage {
  return (
    value === "general" ||
    value === "portfolio" ||
    value === "quotes" ||
    value === "news-ai" ||
    value === "data"
  );
}

function addStock(): void {
  if (!settings) return;
  const codeInput = document.getElementById("new-code") as HTMLInputElement | null;
  const aliasInput = document.getElementById("new-alias") as HTMLInputElement | null;
  const code = codeInput?.value.trim() ?? "";
  const alias = aliasInput?.value.trim() ?? "";

  if (settings.watchlist.length >= 50) {
    showMessage("自选股最多 50 只", "error");
    return;
  }
  if (!/^\d{6}$/.test(code)) {
    showMessage("请输入 6 位股票代码", "error");
    return;
  }
  if (settings.watchlist.some((item) => item.securityCode === code)) {
    showMessage("股票代码已存在：" + code, "error");
    return;
  }

  let security = securityFor(code);
  if (!security) {
    security = {
      code,
      market: inferMarket(code),
      name: alias,
      alias: ""
    };
    settings.securities.push(security);
  } else if (alias && !security.name) {
    security.name = alias;
  }

  settings.watchlist.push({
    securityCode: code,
    visible: true,
    order: settings.watchlist.length,
    groupId: "all"
  });
  message = "";
  messageKind = "";
  render();
}

function addHolding(): void {
  if (!settings) return;
  const code =
    (document.getElementById("new-holding-code") as HTMLSelectElement | null)?.value ?? "";
  const quantity = Number(
    (document.getElementById("new-holding-quantity") as HTMLInputElement | null)?.value
  );
  const costPrice = Number(
    (document.getElementById("new-holding-cost") as HTMLInputElement | null)?.value
  );
  if (
    !code ||
    !Number.isFinite(quantity) ||
    quantity <= 0 ||
    !Number.isFinite(costPrice) ||
    costPrice <= 0
  ) {
    showMessage("请填写有效的持仓数量和成本价", "error");
    return;
  }
  settings.holdings.push({
    securityCode: code,
    quantity: Math.round(quantity),
    costPrice,
    groupId: "all",
    note: "",
    alertRules: emptyHoldingAlertRules()
  });
  render();
}

function emptyHoldingAlertRules(): HoldingAlertRules {
  return {
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
}

function addTab(): void {
  if (!settings) return;
  const type = (document.getElementById("new-tab-type") as HTMLSelectElement | null)
    ?.value as TabType;
  const input = document.getElementById("new-tab-title") as HTMLInputElement | null;
  const title = input?.value.trim() || tabTypeLabels[type] || "自定义";
  settings.tabs.push({
    id: "custom-" + Date.now().toString(36),
    type,
    title: title.slice(0, 12),
    builtIn: false,
    visible: true,
    order: settings.tabs.length,
    securityCodes: [],
    maxItems: type === "drivers" ? 5 : 8,
    newsMode: type === "drivers" ? "important" : "watchlist_related"
  });
  normalizeOrder();
  render();
}

async function save(): Promise<void> {
  if (!settings || !window.floatingStock) return;
  if (settings.quotes.fields.length === 0) {
    showMessage("至少选择一个行情字段", "error");
    return;
  }
  if (!settings.tabs.some((tab) => tab.visible)) {
    showMessage("至少显示一个页面", "error");
    return;
  }
  if (settings.window.bossKeyEnabled) {
    const accelerator = parseBossKeyAccelerator(settings.window.bossKeyAccelerator);
    if (!accelerator) {
      showMessage("老板键无效，请重新录制", "error");
      return;
    }
    settings.window.bossKeyAccelerator = accelerator;
  }

  normalizeOrder();
  repairNavigation();
  try {
    setSaving(true);
    settings = await window.floatingStock.saveSettings(settings);
    settingsDirty = false;
    await ai.syncAfterSave();
    showMessage("设置已保存，悬浮窗正在刷新", "ok");
  } catch (error) {
    showMessage(error instanceof Error ? error.message : String(error), "error");
  } finally {
    setSaving(false);
  }
}

function handleBossKeyCapture(event: KeyboardEvent): void {
  if (!recordingBossKey || !settings || event.repeat) return;
  event.preventDefault();
  event.stopPropagation();

  // 按键映射是纯逻辑，放在 controllers/bossKey.ts 里（那里可以脱离 DOM 单测）。
  const outcome = bossKeyCaptureOutcome(event as KeyEventLike);
  if (outcome.kind === "modifier") return;
  if (outcome.kind === "cancel") {
    recordingBossKey = false;
    showMessage(outcome.message, "ok");
    return;
  }
  if (outcome.kind === "unsupported") {
    // 继续保持录制状态，让用户直接换一个键重试。
    showMessage(outcome.message, "error");
    focusBossKeyRecorder();
    return;
  }

  settings.window.bossKeyAccelerator = outcome.accelerator;
  settingsDirty = true;
  recordingBossKey = false;
  showMessage(outcome.message, "ok");
}

function focusBossKeyRecorder(): void {
  requestAnimationFrame(() => document.getElementById("boss-key-recorder")?.focus());
}
function normalizeOrder(): void {
  settings?.watchlist.forEach((item, order) => {
    item.order = order;
  });
  settings?.tabs.forEach((tab, order) => {
    tab.order = order;
    tab.title = tab.title.trim() || "自定义";
  });
}

function repairNavigation(): void {
  const current = settings;
  if (!current) return;
  const visible = current.tabs.filter((tab) => tab.visible);
  if (!visible.some((tab) => tab.id === current.navigation.defaultTabId)) {
    current.navigation.defaultTabId = visible[0]?.id ?? "watchlist";
  }
  if (!visible.some((tab) => tab.id === current.navigation.lastActiveTabId)) {
    current.navigation.lastActiveTabId = current.navigation.defaultTabId;
  }
}

function securityFor(code: string) {
  return settings?.securities.find((security) => security.code === code);
}

function inferMarket(code: string): "SH" | "SZ" | "BJ" {
  if (/^[48]/.test(code)) return "BJ";
  if (/^[569]/.test(code)) return "SH";
  return "SZ";
}

function setSaving(saving: boolean): void {
  document.querySelectorAll<HTMLButtonElement>('[data-action="save"]').forEach((button) => {
    button.disabled = saving;
    button.textContent = saving ? "保存中…" : "保存设置";
  });
}

/**
 * 只更新提示区，不整页重渲染（§4-6）。
 *
 * 提示是最高频的反馈（保存、清空规则、字段超限…）。以前每次提示都走整页重建，
 * 于是"点一下看看结果"会连带丢掉焦点、光标和展开的面板——用户看到的是自己正在编辑的
 * 输入框突然失焦。提示区现在是模板里的固定槽位，因此可以原地替换。
 */
function updateMessage(): void {
  const slot = document.getElementById("settings-message");
  if (!slot) {
    // 首屏（settings 尚未加载）时还没有这个槽位，退化为整页渲染。
    render();
    return;
  }
  slot.innerHTML = message
    ? `<div class="message ${escapeHtml(messageKind)}">${escapeHtml(message)}</div>`
    : "";
  slot.hidden = !message;
}

function showMessage(value: string, kind: "ok" | "error"): void {
  message = value;
  messageKind = kind;
  updateMessage();
}

render();
void Promise.all([
  window.floatingStock?.getSettings(),
  window.floatingStock?.getAiStatus(),
  window.floatingStock?.hasProfileBackup()
])
  .then(([nextSettings, nextAiStatus, nextHasBackup]) => {
    if (nextSettings) settings = nextSettings;
    if (nextAiStatus) ai.status = nextAiStatus;
    profile.hasBackup = nextHasBackup === true;
    render();
  })
  .catch((error) => showMessage(error instanceof Error ? error.message : String(error), "error"));
window.floatingStock?.onSettings((value) => {
  if (settingsDirty) return;
  settings = value;
  render();
});
window.floatingStock?.onAiStatus((value) => {
  ai.status = value;
  render();
});
