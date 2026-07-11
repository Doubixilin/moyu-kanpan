import {
  DEFAULT_BOSS_KEY_ACCELERATOR,
  parseBossKeyAccelerator
} from "./shortcut.js";
import type { AiRuntimeStatus } from "./domain/types";
import type {
  HoldingAlertRules,
  NewsMode,
  QuoteField,
  QuoteSort,
  TabConfig,
  TabType,
  ThemeMode,
  UserSettings
} from "./config";
import type { ProfileImportMode, ProfilePreview } from "./settings/profile";

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

type HoldingAlertNumberField = Exclude<keyof HoldingAlertRules, "enabled">;
type SettingsPage = "general" | "portfolio" | "quotes" | "news-ai" | "data";
const holdingAlertNumberFields: Record<string, HoldingAlertNumberField> = {
  "holding-stop-loss": "stopLossPrice",
  "holding-watch-price": "watchPrice",
  "holding-price-above": "priceAbove",
  "holding-price-below": "priceBelow",
  "holding-rise-percent": "risePercent",
  "holding-fall-percent": "fallPercent",
  "holding-daily-profit": "dailyProfitAmount",
  "holding-daily-loss": "dailyLossAmount",
  "holding-total-profit": "totalProfitAmount",
  "holding-total-loss": "totalLossAmount"
};
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
let aiStatus: AiRuntimeStatus | null = null;
let pendingAiApiKey = "";
let aiBusy = false;
let profileText = "";
let profileMode: ProfileImportMode = "merge";
let profilePreview: ProfilePreview | null = null;
let profileBusy = false;
let hasProfileBackup = false;
let activeSettingsPage: SettingsPage = "general";
let settingsDirty = false;

const root = document.getElementById("settings-root");
if (!root) throw new Error("Missing #settings-root");
const rootElement = root;

function render(): void {
  if (!settings) {
    rootElement.innerHTML = '<main class="settings-shell"><p class="loading">正在读取设置…</p></main>';
    return;
  }

  const visibleTabs = settings.tabs.filter((tab) => tab.visible);
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

      ${message ? `<div class="message ${messageKind}">${escapeHtml(message)}</div>` : ""}

      ${renderSettingsNavigation()}

      ${renderProfilePanel()}

      <section class="panel ${settingsPageClass("general")}">
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
      <section class="panel ${settingsPageClass("general")}">
        <div class="panel-heading">
          <div>
            <h2>页面与默认视图</h2>
            <p>内置页面可以隐藏，自定义页面可以删除；顶部最多直接显示 4 个。</p>
          </div>
          <span>${visibleTabs.length} 个显示</span>
        </div>

        <div class="tab-settings-list">
          ${settings.tabs.map(renderTabSetting).join("")}
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

      <section class="panel ${settingsPageClass("portfolio")}">
        <div class="panel-heading">
          <div>
            <h2>持仓</h2>
            <p>交易后请同步数量和券商成本价；当日有买卖时，今日盈亏仅供参考。</p>
          </div>
          <span>${holdingRuleSummary()}</span>
        </div>
        <div class="holding-settings-list">
          ${settings.holdings.length
            ? settings.holdings.map(renderHoldingSetting).join("")
            : '<div class="inline-empty">尚未配置持仓</div>'}
        </div>
        ${renderAddHolding()}
      </section>

      <section class="panel risk-panel ${settingsPageClass("portfolio")}">
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

      <section class="panel ${settingsPageClass("quotes")}">
        <div class="panel-heading">
          <div>
            <h2>自选股</h2>
            <p>代码作为证券唯一标识；别名只影响悬浮窗显示。</p>
          </div>
          <span>${settings.watchlist.length}/50</span>
        </div>
        <div class="watchlist">
          ${settings.watchlist.map(renderWatchItem).join("")}
        </div>
        <div class="add-row">
          <input id="new-code" inputmode="numeric" maxlength="6" placeholder="股票代码，如 600519" />
          <input id="new-alias" maxlength="16" placeholder="名称或别名（可选）" />
          <button data-action="add-stock">添加</button>
        </div>
      </section>

      <section class="panel ${settingsPageClass("quotes")}">
        <div class="panel-heading">
          <div>
            <h2>行情显示</h2>
            <p>最多选择 5 项；小窗建议保留 2–3 项。</p>
          </div>
        </div>
        <div class="field-grid">
          ${quoteFields.map(({ value, label }) => `
            <label class="check-card">
              <input type="checkbox" data-setting="field" value="${value}" ${settings?.quotes.fields.includes(value) ? "checked" : ""} />
              <span>${label}</span>
            </label>
          `).join("")}
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

      <section class="panel ai-panel ${settingsPageClass("news-ai")}">
        <div class="panel-heading">
          <div>
            <h2>AI 快速分析</h2>
            <p>DeepSeek Flash 只分析公开新闻；数量、成本、账户和交易规则不会发送。</p>
          </div>
          <span class="ai-state ${escapeAttr(aiStatus?.state ?? "unconfigured")}">${escapeHtml(aiStatusLabel())}</span>
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
          <label class="ai-key-field"><span>API Key</span><input data-setting="ai-api-key" type="password" autocomplete="new-password" value="${escapeAttr(pendingAiApiKey)}" placeholder="${aiKeyPlaceholder()}" /></label>
        </div>
        <div class="ai-actions">
          <button type="button" data-action="test-ai" ${aiBusy ? "disabled" : ""}>${aiBusy ? "测试中…" : "测试连接"}</button>
          <button type="button" data-action="clear-ai-key" class="danger" ${aiStatus?.credentialSource !== "secure" || aiBusy ? "disabled" : ""}>清除 API Key</button>
          <span>${escapeHtml(aiStatus?.message ?? "正在读取安全存储状态…")}</span>
        </div>
        <p class="ai-privacy-note">模型仅接收新闻标题、摘要、来源、时间和新闻自身包含的公开代码；不会接收完整持仓组合。DeepSeek 模式固定关闭深度思考并要求 JSON 输出。</p>
      </section>

      <section class="panel ${settingsPageClass("news-ai")}">
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

      <section class="panel ${settingsPageClass("general")}">
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
}

function renderSettingsNavigation(): string {
  const pages: Array<{ id: SettingsPage; label: string }> = [
    { id: "general", label: "窗口与页面" },
    { id: "portfolio", label: "持仓与提醒" },
    { id: "quotes", label: "自选与行情" },
    { id: "news-ai", label: "新闻与 AI" },
    { id: "data", label: "导入与备份" }
  ];
  return `
    <nav class="settings-tab-nav" aria-label="设置分类">
      ${pages.map((page) => `
        <button type="button" data-action="settings-page" data-page="${page.id}"
          class="${activeSettingsPage === page.id ? "active" : ""}"
          aria-selected="${activeSettingsPage === page.id}">${page.label}</button>
      `).join("")}
    </nav>
  `;
}

function settingsPageClass(page: SettingsPage): string {
  return `settings-page-section${activeSettingsPage === page ? " is-active" : ""}`;
}

function holdingRuleSummary(): string {
  if (!settings) return "";
  const enabledHoldings = settings.holdings.filter((holding) => holding.alertRules.enabled).length;
  const ruleCount = settings.holdings.reduce(
    (count, holding) => count + holdingRuleDescriptions(holding.alertRules, holding.costPrice).length,
    0
  );
  return `${settings.holdings.length} 只 · ${enabledHoldings} 只提醒 · ${ruleCount} 条规则`;
}

function renderProfilePanel(): string {
  const preview = profilePreview;
  return `
    <section class="panel profile-panel ${settingsPageClass("data")}">
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
        <button type="button" data-action="restore-profile" ${hasProfileBackup ? "" : "disabled"}>恢复上次导入前配置</button>
      </div>
      <div class="profile-mode-row">
        <label><span>导入方式</span><select data-setting="profile-mode">${option("merge", "合并：保留未提供的配置", profileMode)}${option("replace", "替换：替换包中明确提供的持仓/自选", profileMode)}</select></label>
        <span>含提醒规则的配置包会强制先进入影子模式。</span>
      </div>
      <label class="profile-json-field">
        <span>粘贴 AI 返回的 JSON，或选择文件</span>
        <textarea data-setting="profile-text" spellcheck="false" placeholder="{&#10;  &quot;profileVersion&quot;: 1,&#10;  ...&#10;}">${escapeHtml(profileText)}</textarea>
      </label>
      <div class="profile-actions">
        <button type="button" data-action="preview-profile" ${profileBusy || !profileText.trim() ? "disabled" : ""}>${profileBusy ? "处理中…" : "预览差异"}</button>
        <button type="button" class="primary" data-action="apply-profile" ${profileBusy || !preview?.valid || !preview.hasChanges ? "disabled" : ""}>确认导入</button>
        <button type="button" data-action="clear-profile" ${profileBusy || !profileText ? "disabled" : ""}>清空</button>
      </div>
      ${preview ? renderProfilePreview(preview) : '<div class="profile-empty">导入前不会修改任何设置。先预览差异，再确认保存。</div>'}
    </section>
  `;
}

function renderProfilePreview(preview: ProfilePreview): string {
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
      <strong>${preview.valid ? preview.hasChanges ? "校验通过，可以导入" : "校验通过，没有变化" : "校验失败，不会应用"}</strong>
      <div class="profile-diff-grid">
        ${rows.map(([label, codes]) => `<span><b>${label}</b>${codes.length ? escapeHtml(codes.join("、")) : "无"}</span>`).join("")}
        <span><b>提醒规则变化</b>${diff.alertRuleChanges}</span>
        <span><b>全局风险设置</b>${diff.riskSettingsChanged ? "有变化" : "无变化"}</span>
      </div>
      ${preview.issues.length ? `
        <div class="profile-issues">
          ${preview.issues.map((issue) => `<span class="${issue.severity}">${issue.severity === "error" ? "错误" : "提醒"} · ${escapeHtml(issue.path)}：${escapeHtml(issue.message)}</span>`).join("")}
        </div>
      ` : ""}
    </div>
  `;
}

function renderTabSetting(tab: TabConfig, index: number): string {
  const stockSelector = !tab.builtIn && tab.type === "stock-list"
    ? `
      <details class="tab-security-picker">
        <summary>选择股票（${tab.securityCodes.length}）</summary>
        <div class="security-check-grid">
          ${settings!.watchlist.map((item) => {
            const security = securityFor(item.securityCode);
            return `
              <label>
                <input type="checkbox" data-setting="tab-security" data-tab-id="${escapeAttr(tab.id)}" value="${item.securityCode}" ${tab.securityCodes.includes(item.securityCode) ? "checked" : ""} />
                <span>${escapeHtml(security?.alias || security?.name || item.securityCode)}</span>
              </label>
            `;
          }).join("")}
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
        <span class="tab-type">${tabTypeLabels[tab.type]}</span>
        <input data-setting="tab-title" maxlength="12" value="${escapeAttr(tab.title)}" ${tab.builtIn ? "readonly" : ""} aria-label="页面名称" />
        <div class="row-actions">
          <button data-action="tab-up" title="上移" ${index === 0 ? "disabled" : ""}>↑</button>
          <button data-action="tab-down" title="下移" ${index === settings!.tabs.length - 1 ? "disabled" : ""}>↓</button>
          ${tab.builtIn ? '<span class="built-in-mark">内置</span>' : '<button data-action="delete-tab" class="danger" title="删除">×</button>'}
        </div>
      </div>
      ${stockSelector}
    </div>
  `;
}

function renderHoldingSetting(
  holding: UserSettings["holdings"][number],
  index: number
): string {
  const security = securityFor(holding.securityCode);
  const rules = holding.alertRules;
  const ruleDescriptions = holdingRuleDescriptions(rules, holding.costPrice);
  const configuredCount = ruleDescriptions.length;
  return `
    <div class="holding-setting-block" data-holding-index="${index}">
      <div class="holding-setting-row">
        <span class="security-label"><strong>${escapeHtml(security?.alias || security?.name || holding.securityCode)}</strong><small>${holding.securityCode}</small></span>
        <label><span>数量</span><input data-setting="holding-quantity" type="number" min="1" step="1" value="${holding.quantity}" /></label>
        <label><span>成本</span><input data-setting="holding-cost" type="number" min="0.0001" step="0.001" value="${holding.costPrice}" /></label>
        <label><span>风险组</span><select data-setting="holding-group"><option value="all">未分组</option>${settings!.risk.groups.map((group) => option(group.id, group.name, holding.groupId)).join("")}</select></label>
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

function holdingAlertInput(setting: string, label: string, value: number | null): string {
  return `<label><span>${label}</span><input data-setting="${setting}" type="number" min="0" step="0.001" value="${nullableNumber(value)}" placeholder="不启用" /></label>`;
}

function holdingRuleDescriptions(rules: HoldingAlertRules, costPrice: number): string[] {
  const descriptions: string[] = [];
  if (rules.stopLossPrice != null) descriptions.push(`现价跌破 ${rules.stopLossPrice} 时提醒`);
  if (rules.watchPrice != null) {
    descriptions.push(`现价${rules.watchPrice >= costPrice ? "升至" : "降至"} ${rules.watchPrice} 时提醒`);
  }
  if (rules.priceAbove != null) descriptions.push(`现价向上突破 ${rules.priceAbove} 时提醒`);
  if (rules.priceBelow != null) descriptions.push(`现价向下跌破 ${rules.priceBelow} 时提醒`);
  if (rules.risePercent != null) descriptions.push(`今日涨幅达到 ${rules.risePercent}% 时提醒`);
  if (rules.fallPercent != null) descriptions.push(`今日跌幅达到 ${rules.fallPercent}% 时提醒`);
  if (rules.dailyProfitAmount != null) descriptions.push(`今日盈利达到 ${formatRuleAmount(rules.dailyProfitAmount)} 时提醒`);
  if (rules.dailyLossAmount != null) descriptions.push(`今日亏损达到 ${formatRuleAmount(rules.dailyLossAmount)} 时提醒`);
  if (rules.totalProfitAmount != null) descriptions.push(`累计盈利达到 ${formatRuleAmount(rules.totalProfitAmount)} 时提醒`);
  if (rules.totalLossAmount != null) descriptions.push(`累计亏损达到 ${formatRuleAmount(rules.totalLossAmount)} 时提醒`);
  return descriptions;
}

function formatRuleAmount(value: number): string {
  return `${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value)} 元`;
}

function renderRiskGroupSetting(
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
function renderAddHolding(): string {
  const available = settings!.securities.filter((security) =>
    !settings!.holdings.some((holding) => holding.securityCode === security.code)
  );
  if (available.length === 0) return "";

  return `
    <div class="add-row add-holding-row">
      <select id="new-holding-code">
        ${available.map((security) =>
          `<option value="${security.code}">${escapeHtml(security.alias || security.name || security.code)} · ${security.code}</option>`
        ).join("")}
      </select>
      <input id="new-holding-quantity" type="number" min="1" step="1" placeholder="数量" />
      <input id="new-holding-cost" type="number" min="0.0001" step="0.001" placeholder="成本价" />
      <button data-action="add-holding">加入持仓</button>
    </div>
  `;
}

function renderWatchItem(
  item: UserSettings["watchlist"][number],
  index: number
): string {
  const security = securityFor(item.securityCode);
  return `
    <div class="watch-row" data-index="${index}">
      <label class="visibility" title="是否在自选页面显示">
        <input type="checkbox" data-setting="visible" ${item.visible ? "checked" : ""} />
        <span>显示</span>
      </label>
      <span class="code-readonly">${item.securityCode}</span>
      <input data-setting="alias" maxlength="16" value="${escapeAttr(security?.alias || "")}" placeholder="显示别名" aria-label="显示别名" />
      <div class="row-actions">
        <button data-action="move-up" title="上移" ${index === 0 ? "disabled" : ""}>↑</button>
        <button data-action="move-down" title="下移" ${index === settings!.watchlist.length - 1 ? "disabled" : ""}>↓</button>
        <button data-action="delete-stock" class="danger" title="从自选移除">×</button>
      </div>
    </div>
  `;
}

rootElement.addEventListener("input", handleFormChange);
rootElement.addEventListener("change", handleFormChange);
rootElement.addEventListener("click", (event) => void handleClick(event));
rootElement.addEventListener("toggle", handleHoldingRuleToggle, true);
document.addEventListener("keydown", handleBossKeyCapture, true);

function handleHoldingRuleToggle(event: Event): void {
  const opened = event.target;
  if (!(opened instanceof HTMLDetailsElement) ||
      !opened.classList.contains("holding-rule-details") || !opened.open) return;
  rootElement.querySelectorAll<HTMLDetailsElement>(".holding-rule-details[open]")
    .forEach((details) => {
      if (details !== opened) details.open = false;
    });
}

function handleFormChange(event: Event): void {
  if (!settings) return;
  const target = event.target as HTMLInputElement | HTMLSelectElement;
  const setting = target.dataset.setting;
  if (!setting) return;

  if (setting === "profile-text") {
    profileText = target.value;
    profilePreview = null;
    return;
  }
  if (setting === "profile-mode") {
    profileMode = target.value === "replace" ? "replace" : "merge";
    profilePreview = null;
    if (event.type === "change") render();
    return;
  }
  if (setting === "profile-file") {
    const file = (target as HTMLInputElement).files?.[0];
    if (file) void loadProfileFile(file);
    return;
  }
  settingsDirty = true;

  const watchRow = target.closest<HTMLElement>(".watch-row");
  const watchIndex = Number(watchRow?.dataset.index);
  if (watchRow && Number.isInteger(watchIndex) && settings.watchlist[watchIndex]) {
    const item = settings.watchlist[watchIndex];
    if (setting === "visible") item.visible = (target as HTMLInputElement).checked;
    if (setting === "alias") {
      const security = securityFor(item.securityCode);
      if (security) security.alias = target.value.trimStart().slice(0, 16);
    }
    return;
  }

  const holdingRow = target.closest<HTMLElement>(".holding-setting-block");
  const holdingIndex = Number(holdingRow?.dataset.holdingIndex);
  if (holdingRow && Number.isInteger(holdingIndex) && settings.holdings[holdingIndex]) {
    if (setting === "holding-quantity") {
      settings.holdings[holdingIndex].quantity = Math.max(1, Math.round(Number(target.value) || 1));
    }
    if (setting === "holding-cost") {
      settings.holdings[holdingIndex].costPrice = Math.max(0.0001, Number(target.value) || 0.0001);
    }
    if (setting === "holding-group") settings.holdings[holdingIndex].groupId = target.value || "all";
    if (setting === "holding-note") settings.holdings[holdingIndex].note = target.value.slice(0, 120);
    if (setting === "holding-alert-enabled") {
      settings.holdings[holdingIndex].alertRules.enabled = (target as HTMLInputElement).checked;
    }
    const alertField = holdingAlertNumberFields[setting];
    if (alertField) {
      settings.holdings[holdingIndex].alertRules[alertField] = nullableInputNumber(target.value);
    }
    return;
  }

  const riskGroupRow = target.closest<HTMLElement>(".risk-group-row");
  const riskGroupIndex = Number(riskGroupRow?.dataset.riskGroupIndex);
  if (riskGroupRow && Number.isInteger(riskGroupIndex) && settings.risk.groups[riskGroupIndex]) {
    const group = settings.risk.groups[riskGroupIndex];
    if (setting === "risk-group-enabled") group.enabled = (target as HTMLInputElement).checked;
    if (setting === "risk-group-name") group.name = target.value.trimStart().slice(0, 16);
    if (setting === "risk-group-profit") group.profitThreshold = nullableInputNumber(target.value);
    if (setting === "risk-group-loss") group.lossThreshold = nullableInputNumber(target.value);
    return;
  }

  const tabRow = target.closest<HTMLElement>(".tab-setting-row");
  const tabIndex = Number(tabRow?.dataset.tabIndex);
  if (tabRow && Number.isInteger(tabIndex) && settings.tabs[tabIndex]) {
    const tab = settings.tabs[tabIndex];
    if (setting === "tab-visible") tab.visible = (target as HTMLInputElement).checked;
    if (setting === "tab-title" && !tab.builtIn) tab.title = target.value.trimStart().slice(0, 12);
    return;
  }

  if (setting === "tab-security") {
    const tab = settings.tabs.find((item) => item.id === target.dataset.tabId);
    const input = target as HTMLInputElement;
    if (!tab) return;
    if (input.checked && !tab.securityCodes.includes(input.value)) tab.securityCodes.push(input.value);
    if (!input.checked) tab.securityCodes = tab.securityCodes.filter((code) => code !== input.value);
    return;
  }

  if (setting === "default-tab") settings.navigation.defaultTabId = target.value;
  if (setting === "remember-tab") settings.navigation.rememberLastTab = (target as HTMLInputElement).checked;
  if (setting === "always-on-top") settings.window.alwaysOnTop = (target as HTMLInputElement).checked;
  if (setting === "tray-only") settings.window.trayOnly = (target as HTMLInputElement).checked;
  if (setting === "click-through") settings.window.clickThrough = (target as HTMLInputElement).checked;
  if (setting === "window-locked") settings.window.locked = (target as HTMLInputElement).checked;
  if (setting === "boss-key-enabled") {
    settings.window.bossKeyEnabled = (target as HTMLInputElement).checked;
    if (!settings.window.bossKeyEnabled) recordingBossKey = false;
    if (event.type === "change") render();
    return;
  }

  if (setting === "ai-enabled") settings.ai.enabled = (target as HTMLInputElement).checked;
  if (setting === "ai-provider") {
    settings.ai.provider = target.value === "custom" ? "custom" : "deepseek";
    if (settings.ai.provider === "deepseek") {
      settings.ai.baseUrl = "https://api.deepseek.com";
      settings.ai.model = "deepseek-v4-flash";
    } else {
      settings.ai.baseUrl = "https://api.openai.com/v1";
      settings.ai.model = "gpt-4.1-mini";
    }
    if (event.type === "change") render();
    return;
  }
  if (setting === "ai-base-url") settings.ai.baseUrl = target.value.trimStart().slice(0, 300);
  if (setting === "ai-model") settings.ai.model = target.value.trimStart().slice(0, 100);
  if (setting === "ai-timeout") {
    settings.ai.timeoutSeconds = Math.min(120, Math.max(5, Math.round(Number(target.value) || 20)));
  }
  if (setting === "ai-api-key") pendingAiApiKey = target.value.slice(0, 2_000);

  if (setting === "field") {
    const input = target as HTMLInputElement;
    const field = input.value as QuoteField;
    if (input.checked && !settings.quotes.fields.includes(field)) {
      if (settings.quotes.fields.length >= 5) {
        input.checked = false;
        showMessage("行情字段最多选择 5 项", "error");
        return;
      }
      settings.quotes.fields.push(field);
    } else if (!input.checked) {
      settings.quotes.fields = settings.quotes.fields.filter((value) => value !== field);
    }
    return;
  }

  if (setting === "risk-mode") {
    settings.risk.mode = target.value === "active" ? "active" : "shadow";
    if (event.type === "change") render();
    return;
  }
  if (setting === "risk-account-baseline") settings.risk.accountBaseline = nullableInputNumber(target.value);
  if (setting === "risk-one-r") settings.risk.oneR = nullableInputNumber(target.value);
  if (setting === "risk-max-position") settings.risk.maxPositionValue = nullableInputNumber(target.value);
  if (setting === "risk-max-count") settings.risk.maxHoldingCount = nullableInputInteger(target.value);
  if (setting === "risk-max-exposure") settings.risk.maxTotalExposurePercent = nullableInputNumber(target.value);
  if (setting === "risk-daily-profit") settings.risk.portfolioDailyProfitThreshold = nullableInputNumber(target.value);
  if (setting === "risk-daily-loss") settings.risk.portfolioDailyLossThreshold = nullableInputNumber(target.value);
  if (setting === "risk-stop-warning") settings.risk.stopWarningPercent = Math.max(0.1, Number(target.value) || 0.1);
  if (setting === "risk-hysteresis") settings.risk.hysteresisPercent = Math.max(0.01, Number(target.value) || 0.01);
  if (setting === "risk-cooldown") settings.risk.cooldownMinutes = Math.max(0, Math.round(Number(target.value) || 0));
  if (setting === "risk-once-per-day") settings.risk.oncePerDay = (target as HTMLInputElement).checked;
  if (setting === "risk-trading-only") settings.risk.onlyDuringTrading = (target as HTMLInputElement).checked;
  if (setting === "risk-widget") settings.risk.notifications.widget = (target as HTMLInputElement).checked;
  if (setting === "risk-tray") settings.risk.notifications.tray = (target as HTMLInputElement).checked;
  if (setting === "risk-windows") settings.risk.notifications.windows = (target as HTMLInputElement).checked;

  if (setting === "quote-sort") settings.quotes.sort = target.value as QuoteSort;
  if (setting === "news-mode") settings.news.mode = target.value as NewsMode;
  if (setting === "news-max") {
    settings.news.maxItems = Math.min(30, Math.max(1, Number(target.value) || 1));
  }
  if (setting === "theme") settings.appearance.theme = target.value as ThemeMode;
  if (setting === "background-opacity") {
    settings.appearance.backgroundOpacity = Number(target.value) / 100;
    const output = document.getElementById("opacity-value");
    if (output) output.textContent = target.value + "%";
  }
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
    await testAiSettings();
    return;
  }
  if (action === "clear-ai-key") {
    await clearAiCredential();
    return;
  }
  if (action === "copy-profile-prompt") {
    await copyProfilePrompt();
    return;
  }
  if (action === "copy-profile-export") {
    await copyProfileExport();
    return;
  }
  if (action === "preview-profile") {
    await previewPortableProfile();
    return;
  }
  if (action === "apply-profile") {
    await applyPortableProfile();
    return;
  }
  if (action === "restore-profile") {
    await restorePortableProfile();
    return;
  }
  if (action === "clear-profile") {
    profileText = "";
    profilePreview = null;
    render();
    return;
  }

  settingsDirty = true;

  const watchRow = button.closest<HTMLElement>(".watch-row");
  const index = Number(watchRow?.dataset.index);
  if (action === "move-up" && index > 0) {
    [settings.watchlist[index - 1], settings.watchlist[index]] =
      [settings.watchlist[index], settings.watchlist[index - 1]];
    normalizeOrder();
    render();
    return;
  }
  if (action === "move-down" && index < settings.watchlist.length - 1) {
    [settings.watchlist[index + 1], settings.watchlist[index]] =
      [settings.watchlist[index], settings.watchlist[index + 1]];
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
    [settings.tabs[tabIndex - 1], settings.tabs[tabIndex]] =
      [settings.tabs[tabIndex], settings.tabs[tabIndex - 1]];
    normalizeOrder();
    render();
    return;
  }
  if (action === "tab-down" && tabIndex < settings.tabs.length - 1) {
    [settings.tabs[tabIndex + 1], settings.tabs[tabIndex]] =
      [settings.tabs[tabIndex], settings.tabs[tabIndex + 1]];
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
    showMessage(`已清空 ${securityFor(settings.holdings[holdingIndex].securityCode)?.name || settings.holdings[holdingIndex].securityCode} 的提醒规则，保存后生效`, "ok");
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
  return value === "general" || value === "portfolio" || value === "quotes" ||
    value === "news-ai" || value === "data";
}

async function loadProfileFile(file: File): Promise<void> {
  if (file.size > 2_000_000) {
    showMessage("配置包不能超过 2MB", "error");
    return;
  }
  try {
    profileText = await file.text();
    profilePreview = null;
    showMessage(`已读取 ${file.name}，请预览差异`, "ok");
  } catch (error) {
    showMessage(error instanceof Error ? error.message : String(error), "error");
  }
}

async function copyProfilePrompt(): Promise<void> {
  try {
    const result = await window.floatingStock?.copyProfilePrompt();
    showMessage(result ?? "已复制配置包提示词", "ok");
  } catch (error) {
    showMessage(error instanceof Error ? error.message : String(error), "error");
  }
}

async function copyProfileExport(): Promise<void> {
  try {
    const result = await window.floatingStock?.copyProfileExport();
    showMessage(result ?? "已复制当前配置包", "ok");
  } catch (error) {
    showMessage(error instanceof Error ? error.message : String(error), "error");
  }
}

async function previewPortableProfile(): Promise<void> {
  if (!window.floatingStock || !profileText.trim()) return;
  profileBusy = true;
  render();
  try {
    profilePreview = await window.floatingStock.previewProfile({ text: profileText, mode: profileMode });
    message = profilePreview.valid
      ? profilePreview.hasChanges ? "配置包校验通过，请核对差异后确认导入" : "配置包与当前设置没有差异"
      : "配置包存在错误，不会应用";
    messageKind = profilePreview.valid ? "ok" : "error";
  } catch (error) {
    profilePreview = null;
    message = error instanceof Error ? error.message : String(error);
    messageKind = "error";
  } finally {
    profileBusy = false;
    render();
  }
}

async function applyPortableProfile(): Promise<void> {
  if (!window.floatingStock || !profilePreview?.valid || !profilePreview.hasChanges) return;
  if (profileMode === "replace" && !window.confirm("确认按预览内容替换明确提供的持仓/自选？导入前会自动备份。")) return;
  profileBusy = true;
  render();
  try {
    const result = await window.floatingStock.applyProfile({ text: profileText, mode: profileMode });
    settings = result.settings;
    settingsDirty = false;
    hasProfileBackup = result.backupCreated || hasProfileBackup;
    profileText = "";
    profilePreview = null;
    message = result.backupCreated
      ? "配置已导入并进入影子模式；已保存导入前备份"
      : "配置已导入并进入影子模式";
    messageKind = "ok";
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
    messageKind = "error";
  } finally {
    profileBusy = false;
    render();
  }
}

async function restorePortableProfile(): Promise<void> {
  if (!window.floatingStock || !hasProfileBackup) return;
  if (!window.confirm("确认恢复到上次导入前的配置？")) return;
  profileBusy = true;
  render();
  try {
    settings = await window.floatingStock.restoreProfileBackup();
    settingsDirty = false;
    profilePreview = null;
    message = "已恢复上次导入前配置";
    messageKind = "ok";
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
    messageKind = "error";
  } finally {
    profileBusy = false;
    render();
  }
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
  const code = (document.getElementById("new-holding-code") as HTMLSelectElement | null)?.value ?? "";
  const quantity = Number((document.getElementById("new-holding-quantity") as HTMLInputElement | null)?.value);
  const costPrice = Number((document.getElementById("new-holding-cost") as HTMLInputElement | null)?.value);
  if (!code || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(costPrice) || costPrice <= 0) {
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
  const type = (document.getElementById("new-tab-type") as HTMLSelectElement | null)?.value as TabType;
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

async function testAiSettings(): Promise<void> {
  if (!settings || !window.floatingStock || aiBusy) return;
  aiBusy = true;
  message = "";
  messageKind = "";
  render();
  try {
    aiStatus = await window.floatingStock.testAiConnection({
      ai: { ...settings.ai },
      ...(pendingAiApiKey.trim() ? { apiKey: pendingAiApiKey.trim() } : {})
    });
    showMessage(aiStatus.message, aiStatus.state === "success" ? "ok" : "error");
  } catch (error) {
    showMessage(error instanceof Error ? error.message : String(error), "error");
  } finally {
    aiBusy = false;
    render();
  }
}

async function clearAiCredential(): Promise<void> {
  if (!window.floatingStock || aiBusy) return;
  aiBusy = true;
  render();
  try {
    aiStatus = await window.floatingStock.clearAiApiKey();
    pendingAiApiKey = "";
    showMessage(aiStatus.message, "ok");
  } catch (error) {
    showMessage(error instanceof Error ? error.message : String(error), "error");
  } finally {
    aiBusy = false;
    render();
  }
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
    if (pendingAiApiKey.trim()) {
      aiStatus = await window.floatingStock.setAiApiKey(pendingAiApiKey.trim());
      pendingAiApiKey = "";
    } else {
      aiStatus = await window.floatingStock.getAiStatus();
    }
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

  if (event.key === "Escape") {
    recordingBossKey = false;
    showMessage("已取消老板键录制", "ok");
    return;
  }
  if (["ControlLeft", "ControlRight", "AltLeft", "AltRight", "ShiftLeft", "ShiftRight", "MetaLeft", "MetaRight"].includes(event.code)) {
    return;
  }

  const accelerator = acceleratorFromKeyboardEvent(event);
  if (!accelerator) {
    showMessage("该按键不受支持或属于危险组合，请换一个", "error");
    focusBossKeyRecorder();
    return;
  }

  settings.window.bossKeyAccelerator = accelerator;
  settingsDirty = true;
  recordingBossKey = false;
  showMessage("已记录 " + displayBossKey(accelerator) + "，保存后生效", "ok");
}

function acceleratorFromKeyboardEvent(event: KeyboardEvent): string | null {
  const key = keyFromKeyboardEvent(event);
  if (!key) return null;

  const parts: string[] = [];
  if (event.ctrlKey) parts.push("CommandOrControl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (event.metaKey) parts.push("Super");
  parts.push(key);
  return parseBossKeyAccelerator(parts.join("+"));
}

function keyFromKeyboardEvent(event: KeyboardEvent): string {
  if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3);
  if (/^Digit[0-9]$/.test(event.code)) return event.code.slice(5);
  if (/^F(?:[1-9]|1\d|2[0-4])$/.test(event.code)) return event.code;
  if (/^Numpad[0-9]$/.test(event.code)) return "num" + event.code.slice(6);

  const keys: Record<string, string> = {
    Space: "Space",
    Tab: "Tab",
    CapsLock: "Capslock",
    NumLock: "Numlock",
    ScrollLock: "Scrolllock",
    Backspace: "Backspace",
    Delete: "Delete",
    Insert: "Insert",
    Enter: "Enter",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    Home: "Home",
    End: "End",
    PageUp: "PageUp",
    PageDown: "PageDown",
    PrintScreen: "PrintScreen",
    NumpadDecimal: "numdec",
    NumpadAdd: "numadd",
    NumpadSubtract: "numsub",
    NumpadMultiply: "nummult",
    NumpadDivide: "numdiv",
    Backquote: String.fromCharCode(96),
    Minus: "-",
    Equal: "=",
    BracketLeft: "[",
    BracketRight: "]",
    Backslash: "\\",
    Semicolon: ";",
    Quote: "\"",
    Comma: ",",
    Period: ".",
    Slash: "/",
    AudioVolumeUp: "VolumeUp",
    AudioVolumeDown: "VolumeDown",
    AudioVolumeMute: "VolumeMute",
    MediaTrackNext: "MediaNextTrack",
    MediaTrackPrevious: "MediaPreviousTrack",
    MediaStop: "MediaStop",
    MediaPlayPause: "MediaPlayPause"
  };
  return keys[event.code] ?? "";
}
function displayBossKey(accelerator: string): string {
  return accelerator.replace("CommandOrControl", "Ctrl").replace("Super", "Win");
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

function showMessage(value: string, kind: "ok" | "error"): void {
  message = value;
  messageKind = kind;
  render();
}

function aiKeyPlaceholder(): string {
  if (aiStatus?.credentialSource === "secure") return "已安全保存；留空表示不变";
  if (aiStatus?.credentialSource === "environment") return "环境变量已配置；输入可改用安全存储";
  return "输入后由系统安全存储加密";
}

function aiStatusLabel(): string {
  if (!aiStatus) return "读取中";
  if (aiStatus.state === "testing") return "测试中";
  if (aiStatus.state === "success") return "连接正常";
  if (aiStatus.state === "error") return "需要处理";
  if (aiStatus.configured && !settings?.ai.enabled) return "已配置 · 未启用";
  if (aiStatus.configured) return aiStatus.credentialSource === "secure"
    ? "已安全配置"
    : "环境变量";
  return "本地规则";
}

function nullableNumber(value: number | null): string {
  return value == null ? "" : String(value);
}

function nullableInputNumber(value: string): number | null {
  if (!value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function nullableInputInteger(value: string): number | null {
  const number = nullableInputNumber(value);
  return number == null ? null : Math.max(1, Math.round(number));
}
function option(value: string, label: string, selected: string): string {
  return `<option value="${escapeAttr(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(label)}</option>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

render();
void Promise.all([
  window.floatingStock?.getSettings(),
  window.floatingStock?.getAiStatus(),
  window.floatingStock?.hasProfileBackup()
]).then(([nextSettings, nextAiStatus, nextHasBackup]) => {
  if (nextSettings) settings = nextSettings;
  if (nextAiStatus) aiStatus = nextAiStatus;
  hasProfileBackup = nextHasBackup === true;
  render();
}).catch((error) =>
  showMessage(error instanceof Error ? error.message : String(error), "error")
);
window.floatingStock?.onSettings((value) => {
  if (settingsDirty) return;
  settings = value;
  render();
});
window.floatingStock?.onAiStatus((value) => {
  aiStatus = value;
  render();
});
