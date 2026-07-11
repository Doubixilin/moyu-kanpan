import { importantDriverDecision } from "./domain/news.js";
import { benchmarkCodeForSecurity, buildDecisionCue } from "./domain/decision.js";
import type {
  QuoteField,
  TabConfig,
  UserSettings
} from "./config";
import type {
  AppSnapshot,
  DailyCandle,
  IntradayPoint,
  MarketDetail,
  MarketInstrumentRequest,
  MarketSeries,
  HoldingRiskMetrics,
  Quote
} from "./domain/types";

const defaultSettings: UserSettings = {
  schemaVersion: 8,
  personalSeedVersion: 0,
  securities: [
    { code: "000001", market: "SZ", name: "", alias: "" },
    { code: "600519", market: "SH", name: "", alias: "" }
  ],
  holdings: [],
  watchlist: [
    { securityCode: "000001", visible: true, order: 0, groupId: "all" },
    { securityCode: "600519", visible: true, order: 1, groupId: "all" }
  ],
  tabs: [
    {
      id: "holdings", type: "holdings", title: "持仓", builtIn: true,
      visible: true, order: 0, securityCodes: [], maxItems: 8,
      newsMode: "watchlist_related"
    },
    {
      id: "watchlist", type: "watchlist", title: "自选", builtIn: true,
      visible: true, order: 1, securityCodes: [], maxItems: 20,
      newsMode: "watchlist_related"
    },
    {
      id: "market", type: "market", title: "市场", builtIn: true,
      visible: true, order: 2, securityCodes: [], maxItems: 8,
      newsMode: "all"
    },
    {
      id: "drivers", type: "drivers", title: "AI驱动", builtIn: true,
      visible: true, order: 3, securityCodes: [], maxItems: 5,
      newsMode: "important"
    }
  ],
  navigation: {
    defaultTabId: "watchlist",
    rememberLastTab: false,
    lastActiveTabId: "watchlist"
  },
  quotes: {
    fields: ["price", "changePercent"],
    sort: "manual"
  },
  news: {
    mode: "all",
    maxItems: 5
  },
  appearance: {
    theme: "standard",
    backgroundOpacity: 0.82
  },
  ai: {
    enabled: true,
    provider: "deepseek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
    timeoutSeconds: 20
  },
  risk: {
    mode: "shadow",
    accountBaseline: null,
    oneR: null,
    maxPositionValue: null,
    maxHoldingCount: null,
    maxTotalExposurePercent: null,
    portfolioDailyProfitThreshold: null,
    portfolioDailyLossThreshold: null,
    stopWarningPercent: 2,
    hysteresisPercent: 0.2,
    cooldownMinutes: 15,
    oncePerDay: false,
    onlyDuringTrading: true,
    notifications: { widget: true, tray: true, windows: false },
    groups: []
  },
  window: {
    width: 380,
    height: 520,
    x: null,
    y: null,
    alwaysOnTop: true,
    trayOnly: true,
    bossKeyEnabled: true,
    bossKeyAccelerator: "CommandOrControl+Shift+Space",
    clickThrough: false,
    locked: false
  }
};

const emptySnapshot: AppSnapshot = {
  quotes: [],
  news: [],
  risk: {
    mode: "shadow",
    paused: false,
    pausedThroughDate: null,
    dataSafe: false,
    holdings: [],
    groups: [],
    portfolio: {
      holdingCount: 0,
      marketValue: null,
      dailyPnl: null,
      totalPnl: null,
      dailyPnlR: null,
      totalPnlR: null,
      exposurePercent: null,
      dataSafe: false,
      violations: []
    },
    recentEvents: [],
    updatedAt: new Date(0).toISOString()
  },
  ai: {
    enabled: false,
    configured: false,
    secureStorageAvailable: false,
    credentialSource: "none",
    state: "unconfigured",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    lastTestedAt: null,
    lastSuccessAt: null,
    message: "未配置 API Key，使用本地规则"
  },
  market: {
    indices: [],
    breadth: { upCount: null, downCount: null, flatCount: null, amount: null },
    sectors: [],
    intraday: { items: [], source: null, stale: true, updatedAt: null, error: null },
    source: null,
    stale: true,
    degraded: false,
    updatedAt: null,
    errors: []
  },
  errors: [],
  updatedAt: new Date().toISOString(),
  settings: defaultSettings,
  feeds: {
    quotes: {
      lastSuccessAt: null, dataUpdatedAt: null, lastChangedAt: null,
      stale: true, stalled: false, source: null,
      coverage: null, degraded: false, conflictCount: 0,
      retainedCount: 0, missingCount: 0, alertSafe: false, providerHealth: [], marketState: null
    },
    news: {
      lastSuccessAt: null, dataUpdatedAt: null, lastChangedAt: null,
      stale: true, stalled: false, source: null,
      coverage: null, degraded: false, conflictCount: 0,
      retainedCount: 0, missingCount: 0, alertSafe: false, providerHealth: [], marketState: null
    }
  },
  ui: {
    clickThrough: false
  }
};

const fieldLabels: Record<QuoteField, string> = {
  price: "现价",
  change: "涨跌",
  changePercent: "涨幅",
  open: "开盘",
  previousClose: "昨收",
  high: "最高",
  low: "最低",
  volume: "成交量",
  amount: "成交额",
  mainInflow: "主力流入"
};

let snapshot = emptySnapshot;
let clickThrough = false;
let activeTabId = defaultSettings.navigation.defaultTabId;
let navigationInitialized = false;
let marketDetailRequest: MarketInstrumentRequest | null = null;
let marketDetail: MarketDetail | null = null;
let marketDetailLoading = false;
let marketDetailError: string | null = null;
let marketChartMode: "intraday" | "daily" | "boll" = "intraday";
let marketDetailRequestId = 0;
let marketDetailRefreshTimer: number | null = null;
let lastRenderedPageKey = "";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");
const rootElement = root;

function render(next: AppSnapshot): void {
  const previousScroller = rootElement.querySelector<HTMLElement>(".page-body");
  const previousScrollTop = previousScroller?.scrollTop ?? 0;
  snapshot = next;
  clickThrough = next.ui.clickThrough;
  applyAppearance(next.settings);
  const tab = resolveActiveTab(next.settings);
  const pageTitle = marketDetailRequest
    ? marketDetail?.instrument.name || "走势详情"
    : tab.title;
  const pageKey = marketDetailRequest
    ? `detail:${marketDetailRequest.kind}:${marketDetailRequest.market}:${marketDetailRequest.code}`
    : tab.id;

  rootElement.innerHTML = `
    <main class="widget page-${tab.type}">
      <header class="drag header">
        <div>
          <div class="eyebrow">摸鱼看盘</div>
          <h1>${escapeHtml(pageTitle)}</h1>
        </div>
        <div class="controls no-drag" aria-label="窗口工具">
          <button data-action="hide" title="隐藏到托盘" aria-label="隐藏到托盘">隐</button>
          <button data-action="theme" title="切换标准/低调模式" aria-label="切换色彩模式">彩</button>
          <button class="${clickThrough ? "active" : ""}" data-action="click-through" title="${clickThrough ? "点击穿透已开启，可用快捷键关闭" : "开启鼠标点击穿透"}" aria-label="点击穿透" aria-pressed="${clickThrough}">穿</button>
          <button data-action="settings" title="页面、自选与外观设置" aria-label="打开设置">设</button>
        </div>
      </header>
      ${renderTabBar(next.settings, tab.id)}
      <section class="page-content">
        ${renderRecentAlert(snapshot)}
        ${renderErrors(snapshot.errors)}
        <div class="page-body">
          ${renderPage(tab, next)}
        </div>
      </section>
      <footer class="drag footer">
        ${renderFeedStatus("行情", snapshot.feeds.quotes)}
        ${renderFeedStatus("资讯", snapshot.feeds.news)}
      </footer>
    </main>
  `;
  if (pageKey === lastRenderedPageKey) {
    const nextScroller = rootElement.querySelector<HTMLElement>(".page-body");
    if (nextScroller) nextScroller.scrollTop = previousScrollTop;
  }
  lastRenderedPageKey = pageKey;
}

function resolveActiveTab(settings: UserSettings): TabConfig {
  const visibleTabs = settings.tabs
    .filter((tab) => tab.visible)
    .sort((a, b) => a.order - b.order);
  const preferred = settings.navigation.rememberLastTab
    ? settings.navigation.lastActiveTabId
    : settings.navigation.defaultTabId;

  if (!navigationInitialized || !visibleTabs.some((tab) => tab.id === activeTabId)) {
    activeTabId = visibleTabs.some((tab) => tab.id === preferred)
      ? preferred
      : visibleTabs[0]?.id ?? "watchlist";
    navigationInitialized = true;
  }

  return visibleTabs.find((tab) => tab.id === activeTabId)
    ?? visibleTabs[0]
    ?? defaultSettings.tabs[1]!;
}

function renderTabBar(settings: UserSettings, currentId: string): string {
  const tabs = settings.tabs.filter((tab) => tab.visible).sort((a, b) => a.order - b.order);
  const primary = tabs.slice(0, 4);
  const overflow = tabs.slice(4);
  const overflowActive = overflow.find((tab) => tab.id === currentId);

  return `
    <nav class="tabs no-drag" aria-label="看盘页面">
      ${primary.map((tab) => `
        <button class="tab ${tab.id === currentId ? "active" : ""}" data-action="tab" data-tab-id="${escapeAttr(tab.id)}">
          ${escapeHtml(tab.title)}
        </button>
      `).join("")}
      ${overflow.length ? `
        <select class="tab-overflow ${overflowActive ? "active" : ""}" data-action="tab-overflow" aria-label="更多页面">
          <option value="">${overflowActive ? escapeHtml(overflowActive.title) : "更多"} ···</option>
          ${overflow.map((tab) => `<option value="${escapeAttr(tab.id)}">${escapeHtml(tab.title)}</option>`).join("")}
        </select>
      ` : ""}
    </nav>
  `;
}

function renderPage(tab: TabConfig, next: AppSnapshot): string {
  if (marketDetailRequest) return renderMarketDetail();
  if (tab.type === "holdings") return renderHoldings(next);
  if (tab.type === "watchlist") return renderQuoteList(watchlistCodes(next.settings), next);
  if (tab.type === "stock-list") return renderQuoteList(tab.securityCodes, next);
  if (tab.type === "drivers") return renderNews(next, tab.maxItems, tab.newsMode);
  if (tab.type === "combined") return renderCombined(next, tab);
  return renderMarketOverview(next.market);
}

function renderHoldings(next: AppSnapshot): string {
  const quoteMap = new Map(next.quotes.map((quote) => [quote.code, quote]));
  const riskMap = new Map(next.risk.holdings.map((item) => [item.securityCode, item]));
  const rows = next.settings.holdings.map((holding) =>
    renderHoldingRow(
      holding,
      quoteMap.get(holding.securityCode),
      riskMap.get(holding.securityCode),
      next.settings
    )
  ).join("");

  if (!rows) {
    return `<div class="empty-state"><strong>尚未配置持仓</strong><span>可在设置中填写数量和成本价。</span></div>`;
  }

  const totals = next.settings.holdings.reduce((acc, holding) => {
    const price = quoteMap.get(holding.securityCode)?.price;
    if (price == null) return acc;
    acc.marketValue += price * holding.quantity;
    acc.costValue += holding.costPrice * holding.quantity;
    return acc;
  }, { marketValue: 0, costValue: 0 });
  const totalProfit = totals.marketValue - totals.costValue;
  const totalPercent = totals.costValue > 0 ? totalProfit / totals.costValue * 100 : null;

  return `
    <div class="holdings-page">
      <div class="portfolio-summary">
        <span><small>持仓市值</small><strong>${formatMoney(totals.marketValue)}</strong></span>
        <span class="${numberDirection(next.risk.portfolio.dailyPnl)}"><small>今日盈亏*${formatRLabel(next.risk.portfolio.dailyPnlR)}</small><strong>${formatSignedMoney(next.risk.portfolio.dailyPnl)}</strong></span>
        <span class="${numberDirection(totalProfit)}"><small>累计盈亏${formatRLabel(next.risk.portfolio.totalPnlR)}</small><strong>${formatSignedMoney(totalProfit)} / ${formatPercent(totalPercent)}</strong></span>
        ${next.settings.holdings.length ? '<p class="pnl-note">* 当日有买卖时，今日盈亏仅供参考</p>' : ""}
      </div>
      ${renderRiskStatus(next)}
      <div class="scroll-list holding-list">${rows}</div>
    </div>
  `;
}

function renderHoldingRow(
  holding: UserSettings["holdings"][number],
  quote: Quote | undefined,
  risk: HoldingRiskMetrics | undefined,
  settings: UserSettings
): string {
  const security = securityFor(settings, holding.securityCode);
  const price = quote?.price;
  const profit = price == null ? null : (price - holding.costPrice) * holding.quantity;
  const profitPercent = price == null ? null : (price - holding.costPrice) / holding.costPrice * 100;
  const dailyDirection = quoteDirection(quote);

  return `
    <article class="quote-row holding-row ${dailyDirection}" ${marketDetailAttributes("stock", security?.market ?? quote?.market, holding.securityCode)}>
      <div class="quote-name">
        <strong>${escapeHtml(security?.alias || security?.name || quote?.name || holding.securityCode)}</strong>
        <span>${security?.market ?? quote?.market ?? ""}.${holding.securityCode} · ${formatQuantity(holding.quantity)}股 @ ${formatNumber(holding.costPrice)}${renderQuoteQuality(quote)}${renderHoldingRiskHint(risk)}</span>
      </div>
      <div class="holding-metrics">
        <span><small>现价</small><strong>${formatNumber(price)}</strong></span>
        <span class="${numberDirection(risk?.dailyPnl)}"><small>今日</small><strong>${formatSignedMoney(risk?.dailyPnl)}</strong></span>
        <span class="${numberDirection(profit)}"><small>累计${formatRLabel(risk?.totalPnlR)}</small><strong>${formatSignedMoney(profit)} / ${formatPercent(profitPercent)}</strong></span>
      </div>
    </article>
  `;
}

function renderQuoteList(codes: string[], next: AppSnapshot): string {
  const orderedCodes = sortCodes(codes, next.quotes, next.settings);
  const quoteMap = new Map(next.quotes.map((quote) => [quote.code, quote]));
  if (orderedCodes.length === 0) {
    return `<div class="empty-state"><strong>这个页面还没有股票</strong><span>在设置中添加或选择股票。</span></div>`;
  }

  return `<div class="scroll-list quote-list">${
    orderedCodes.map((code) => renderQuote(code, quoteMap.get(code), next.settings)).join("")
  }</div>`;
}

function renderRiskStatus(next: AppSnapshot): string {
  const risk = next.risk;
  const violations = risk.portfolio.violations.slice(0, 2);
  const groups = risk.groups.filter((group) => group.memberCount > 0).slice(0, 3);
  return `
    <div class="risk-status ${risk.dataSafe ? "" : "unsafe"}">
      <div class="risk-status-head">
        <span><strong>${risk.mode === "shadow" ? "影子计算" : "正式提醒"}</strong> · ${risk.paused ? "已暂停" : risk.dataSafe ? "数据可用" : "数据不安全"}</span>
        <button data-action="${risk.paused ? "alerts-resume" : "alerts-pause"}">${risk.paused ? "恢复" : "暂停"}</button>
      </div>
      ${violations.length ? `<div class="risk-violations">${violations.map((item) => `<span class="${item.severity}">${escapeHtml(item.title)}</span>`).join("")}</div>` : ""}
      ${groups.length ? `<div class="risk-groups">${groups.map((group) => `<span>${escapeHtml(group.name)} ${formatSignedMoney(group.totalPnl)}</span>`).join("")}</div>` : ""}
    </div>
  `;
}

function renderHoldingRiskHint(risk: HoldingRiskMetrics | undefined): string {
  if (!risk) return "";
  if (!risk.dataSafe) return ' <em class="risk-badge unsafe">停用</em>';
  const breach = risk.violations.find((item) => item.severity === "breach");
  if (breach) return ` <em class="risk-badge breach" title="${escapeAttr(breach.message)}">越线</em>`;
  const warning = risk.violations[0];
  if (warning) return ` <em class="risk-badge warning" title="${escapeAttr(warning.message)}">预警</em>`;
  return "";
}
function renderCombined(next: AppSnapshot, tab: TabConfig): string {
  const codes = next.settings.holdings.length
    ? next.settings.holdings.map((holding) => holding.securityCode).slice(0, 4)
    : watchlistCodes(next.settings).slice(0, 4);
  return `
    <div class="combined">
      <div class="combined-quotes">${renderQuoteList(codes, next)}</div>
      <div class="combined-news">${renderNews(next, Math.min(2, tab.maxItems), "important")}</div>
    </div>
  `;
}



function renderMarketOverview(market: AppSnapshot["market"]): string {
  if (market.indices.length === 0) {
    const message = market.errors.length > 0 ? "市场数据暂不可用，实时行情不受影响。" : "正在加载指数和市场宽度。";
    return `<div class="empty-state"><strong>市场概览加载中</strong><span>${message}</span></div>`;
  }

  const breadth = market.breadth;
  const state = market.stale ? "缓存" : market.degraded ? "降级" : "实时";
  const diagnostics = market.errors.join("；");
  return `
    <div class="market-overview">
      <div class="market-breadth" title="${escapeAttr(diagnostics)}">
        <span class="up"><small>上涨</small><strong>${formatInteger(breadth.upCount)}</strong></span>
        <span class="down"><small>下跌</small><strong>${formatInteger(breadth.downCount)}</strong></span>
        <span><small>平盘</small><strong>${formatInteger(breadth.flatCount)}</strong></span>
        <span><small>两市额</small><strong>${formatMarketAmount(breadth.amount)}</strong></span>
      </div>
      <div class="market-index-grid">
        ${market.indices.map((item) => `
          <button class="market-index ${numberDirection(item.changePercent)}" data-action="market-detail" data-kind="index" data-market="${item.instrument.market}" data-code="${item.instrument.code}">
            <span>${escapeHtml(shortIndexName(item.instrument.name))}</span>
            <strong>${formatNumber(item.price)}</strong>
            <em>${formatPercent(item.changePercent)}</em>
          </button>
        `).join("")}
      </div>
      <section class="market-preview">
        <div class="section-caption"><span>上证分时</span><em>${dataSourceLabel(market.intraday.source)}${market.intraday.stale ? " · 缓存" : ""}</em></div>
        ${renderIntradayChart(market.intraday, true)}
      </section>
      <section class="market-sectors">
        <div class="section-caption"><span>领涨行业</span><em>${state} · ${dataSourceLabel(market.source)}</em></div>
        <div class="sector-list">
          ${market.sectors.slice(0, 5).map((item) => `
            <span class="sector-chip ${numberDirection(item.changePercent)}"><b>${escapeHtml(item.name)}</b><em>${formatPercent(item.changePercent)}</em></span>
          `).join("") || "<span class=\"sector-empty\">行业数据暂不可用</span>"}
        </div>
      </section>
    </div>
  `;
}

function renderMarketDetail(): string {
  if (marketDetailLoading && !marketDetail) {
    return `<div class="empty-state"><strong>正在加载走势</strong><span>分时和日K独立请求，不影响实时行情。</span></div>`;
  }
  if (!marketDetail) {
    return `
      <div class="empty-state">
        <strong>走势暂不可用</strong>
        <span>${escapeHtml(marketDetailError ?? "未知错误")}</span>
        <button class="inline-action" data-action="market-back">返回</button>
      </div>
    `;
  }

  const series = marketChartMode === "intraday" ? marketDetail.intraday : marketDetail.daily;
  const sourceState = `${dataSourceLabel(series.source)}${series.stale ? " · 缓存" : ""}`;
  return `
    <div class="market-detail">
      <div class="market-detail-toolbar">
        <button data-action="market-back">← 返回</button>
        <span>${marketDetail.instrument.market}.${marketDetail.instrument.code}</span>
        <em title="${escapeAttr(series.error ?? "")}">${sourceState}</em>
      </div>
      <div class="chart-tabs">
        ${chartModeButton("intraday", "分时")}
        ${chartModeButton("daily", "日K")}
        ${chartModeButton("boll", "BOLL")}
      </div>
      <section class="detail-chart">
        ${marketChartMode === "intraday"
          ? renderIntradayChart(marketDetail.intraday, false)
          : renderCandleChart(marketDetail.daily, marketChartMode === "boll")}
      </section>
      ${renderMarketDetailStats(marketDetail)}
      ${series.error ? `<div class="chart-warning">${escapeHtml(series.error)}</div>` : ""}
    </div>
  `;
}

function chartModeButton(mode: "intraday" | "daily" | "boll", label: string): string {
  return `<button class="${marketChartMode === mode ? "active" : ""}" data-action="chart-mode" data-mode="${mode}">${label}</button>`;
}

function renderIntradayChart(
  series: MarketSeries<IntradayPoint>,
  compact: boolean
): string {
  const items = series.items.filter((item) => Number.isFinite(item.price));
  if (items.length === 0) return `<div class="chart-empty">暂无分时数据</div>`;
  const width = 340;
  const height = compact ? 92 : 220;
  const top = 10;
  const bottom = compact ? 8 : 24;
  const prices = items.map((item) => item.price);
  const averages = items.flatMap((item) => item.average == null ? [] : [item.average]);
  const low = Math.min(...prices, ...averages);
  const high = Math.max(...prices, ...averages);
  const padding = Math.max((high - low) * 0.08, Math.abs(high) * 0.001, 0.01);
  const min = low - padding;
  const max = high + padding;
  const chartHeight = height - top - bottom;
  const x = (index: number) => items.length === 1 ? width / 2 : index / (items.length - 1) * width;
  const y = (value: number) => top + (max - value) / (max - min || 1) * chartHeight;
  const pricePoints = items.map((item, index) => `${x(index).toFixed(1)},${y(item.price).toFixed(1)}`).join(" ");
  const averagePoints = items.flatMap((item, index) =>
    item.average == null ? [] : [`${x(index).toFixed(1)},${y(item.average).toFixed(1)}`]
  ).join(" ");
  const firstTime = formatTime(items[0]!.time);
  const lastTime = formatTime(items.at(-1)!.time);
  return `
    <svg class="market-chart intraday-chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-label="分时图">
      <line class="chart-grid" x1="0" x2="${width}" y1="${y((max + min) / 2)}" y2="${y((max + min) / 2)}" />
      ${averagePoints ? `<polyline class="average-line" points="${averagePoints}" />` : ""}
      <polyline class="price-line" points="${pricePoints}" />
      ${compact ? "" : `<text class="chart-label" x="2" y="10">${formatNumber(max)}</text><text class="chart-label" x="2" y="${height - 3}">${firstTime}</text><text class="chart-label end" x="338" y="${height - 3}">${lastTime}</text>`}
    </svg>
  `;
}

function renderCandleChart(series: MarketSeries<DailyCandle>, showBoll: boolean): string {
  const items = series.items.slice(-45);
  if (items.length === 0) return `<div class="chart-empty">暂无日K数据</div>`;
  const width = 340;
  const height = 230;
  const priceTop = 12;
  const priceBottom = 168;
  const volumeTop = 184;
  const volumeBottom = 216;
  const rangeValues = items.flatMap((item) => [
    item.low,
    item.high,
    ...(showBoll && item.bollLower != null ? [item.bollLower] : []),
    ...(showBoll && item.bollUpper != null ? [item.bollUpper] : [])
  ]);
  const min = Math.min(...rangeValues);
  const max = Math.max(...rangeValues);
  const y = (value: number) => priceTop + (max - value) / (max - min || 1) * (priceBottom - priceTop);
  const step = width / items.length;
  const candleWidth = Math.max(2, Math.min(5, step * 0.62));
  const maxVolume = Math.max(...items.map((item) => item.volume), 1);
  const x = (index: number) => step * index + step / 2;
  const candles = items.map((item, index) => {
    const direction = item.close >= item.open ? "up" : "down";
    const bodyTop = y(Math.max(item.open, item.close));
    const bodyBottom = y(Math.min(item.open, item.close));
    const volumeHeight = item.volume / maxVolume * (volumeBottom - volumeTop);
    return `<g class="candle ${direction}"><line x1="${x(index)}" x2="${x(index)}" y1="${y(item.high)}" y2="${y(item.low)}"/><rect x="${x(index) - candleWidth / 2}" y="${bodyTop}" width="${candleWidth}" height="${Math.max(1, bodyBottom - bodyTop)}"/><rect class="volume" x="${x(index) - candleWidth / 2}" y="${volumeBottom - volumeHeight}" width="${candleWidth}" height="${Math.max(1, volumeHeight)}"/></g>`;
  }).join("");
  const boll = showBoll ? [
    bollPolyline(items, "bollUpper", x, y, "boll-upper"),
    bollPolyline(items, "bollMid", x, y, "boll-mid"),
    bollPolyline(items, "bollLower", x, y, "boll-lower")
  ].join("") : "";
  return `
    <svg class="market-chart candle-chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-label="${showBoll ? "布林线日K图" : "日K图"}">
      <line class="chart-grid" x1="0" x2="${width}" y1="${priceBottom}" y2="${priceBottom}" />
      <line class="chart-grid" x1="0" x2="${width}" y1="${volumeTop}" y2="${volumeTop}" />
      ${candles}${boll}
      <text class="chart-label" x="2" y="10">${formatNumber(max)}</text>
      <text class="chart-label" x="2" y="${priceBottom - 3}">${formatNumber(min)}</text>
      <text class="chart-label" x="2" y="228">${items[0]!.date.slice(5)}</text>
      <text class="chart-label end" x="338" y="228">${items.at(-1)!.date.slice(5)}</text>
    </svg>
  `;
}

function bollPolyline(
  items: DailyCandle[],
  field: "bollUpper" | "bollMid" | "bollLower",
  x: (index: number) => number,
  y: (value: number) => number,
  className: string
): string {
  const points = items.flatMap((item, index) =>
    item[field] == null ? [] : [`${x(index).toFixed(1)},${y(item[field]!).toFixed(1)}`]
  ).join(" ");
  return points ? `<polyline class="boll-line ${className}" points="${points}" />` : "";
}

function renderMarketDetailStats(detail: MarketDetail): string {
  if (marketChartMode === "intraday") {
    const items = detail.intraday.items;
    const first = items[0]?.price;
    const latest = items.at(-1)?.price;
    const change = first && latest ? (latest - first) / first * 100 : null;
    return `<div class="chart-stats"><span><small>最新</small><strong>${formatNumber(latest)}</strong></span><span class="${numberDirection(change)}"><small>分时变化</small><strong>${formatPercent(change)}</strong></span><span><small>数据点</small><strong>${items.length}</strong></span></div>`;
  }
  const latest = detail.daily.items.at(-1);
  if (!latest) return "";
  return `<div class="chart-stats"><span><small>开</small><strong>${formatNumber(latest.open)}</strong></span><span><small>高/低</small><strong>${formatNumber(latest.high)} / ${formatNumber(latest.low)}</strong></span><span><small>收</small><strong>${formatNumber(latest.close)}</strong></span></div>`;
}

function marketDetailAttributes(
  kind: MarketInstrumentRequest["kind"],
  market: string | undefined,
  code: string
): string {
  if (market !== "SH" && market !== "SZ" && market !== "BJ") return "";
  return `data-action="market-detail" data-kind="${kind}" data-market="${market}" data-code="${escapeAttr(code)}"`;
}

async function openMarketDetail(
  request: MarketInstrumentRequest,
  background = false
): Promise<void> {
  marketDetailRequest = request;
  const requestId = ++marketDetailRequestId;
  if (!background) {
    marketDetail = null;
    marketDetailLoading = true;
    marketDetailError = null;
    marketChartMode = "intraday";
    render(snapshot);
  }
  try {
    const detail = await window.floatingStock?.getMarketDetail(request);
    if (requestId !== marketDetailRequestId || !marketDetailRequest) return;
    if (!detail) throw new Error("市场数据接口未就绪");
    marketDetail = detail;
    marketDetailError = null;
  } catch (error) {
    if (requestId !== marketDetailRequestId) return;
    marketDetailError = error instanceof Error ? error.message : String(error);
  } finally {
    if (requestId === marketDetailRequestId) {
      marketDetailLoading = false;
      render(snapshot);
      scheduleMarketDetailRefresh();
    }
  }
}

function scheduleMarketDetailRefresh(): void {
  if (marketDetailRefreshTimer != null) window.clearTimeout(marketDetailRefreshTimer);
  if (!marketDetailRequest) return;
  marketDetailRefreshTimer = window.setTimeout(() => {
    if (marketDetailRequest) void openMarketDetail(marketDetailRequest, true);
  }, 30_000);
}

function closeMarketDetail(shouldRender = true): void {
  marketDetailRequestId += 1;
  marketDetailRequest = null;
  marketDetail = null;
  marketDetailLoading = false;
  marketDetailError = null;
  if (marketDetailRefreshTimer != null) window.clearTimeout(marketDetailRefreshTimer);
  marketDetailRefreshTimer = null;
  if (shouldRender) render(snapshot);
}

function shortIndexName(value: string): string {
  return value.replace("指数", "").replace("成指", "");
}

function dataSourceLabel(source: MarketSeries<unknown>["source"]): string {
  if (source === "eastmoney") return "东财";
  if (source === "tencent") return "腾讯";
  if (source === "mixed") return "双源";
  if (source === "local") return "缓存";
  return "等待";
}

function formatInteger(value: number | null): string {
  return value == null ? "--" : new Intl.NumberFormat("zh-CN").format(value);
}

function formatMarketAmount(value: number | null): string {
  if (value == null) return "--";
  if (Math.abs(value) >= 1_000_000_000_000) return (value / 1_000_000_000_000).toFixed(2) + "万亿";
  if (Math.abs(value) >= 100_000_000) return (value / 100_000_000).toFixed(0) + "亿";
  return formatCompact(value, "元");
}
function renderNews(next: AppSnapshot, maxItems: number, mode: TabConfig["newsMode"]): string {
  const trackedCodes = new Set([
    ...next.settings.holdings.map((holding) => holding.securityCode),
    ...next.settings.watchlist.map((item) => item.securityCode)
  ]);
  const items = next.news
    .filter((item) =>
      mode !== "important" ||
      importantDriverDecision(item, item.analysis, trackedCodes).display
    )
    .slice(0, maxItems);
  const hasAi = items.some((item) => item.analysis?.provider === "ai");
  const analyzer = hasAi
    ? "AI筛选"
    : next.ai.configured && next.ai.state === "error"
      ? "AI异常 · 规则降级"
      : "本地规则";

  if (items.length === 0) {
    const detail = next.ai.enabled && !next.ai.configured
      ? "未配置 API Key；当前只使用本地规则。"
      : "没有高价值事件时保持安静。";
    return `
      <div class="empty-state">
        <strong>暂无重要驱动</strong>
        <span>${escapeHtml(detail)}</span>
      </div>
    `;
  }

  return `
    <div class="section-caption">
      <span>潜在股价驱动</span>
      <em>${escapeHtml(analyzer)}</em>
    </div>
    <div class="scroll-list news-list driver-list">
      ${items.map((item) => {
        const analysis = item.analysis;
        const cue = decisionCueForItem(item, next);
        const related = analysis?.relatedCodes.length
          ? analysis.relatedCodes.join(" · ")
          : "未确认标的";
        const materialLimited = analysis?.materialLimited === true;
        const failure = analysis?.provider === "rules" && analysis.failureReason
          ? `降级：${analysis.failureReason}`
          : "";
        return `
          <article class="news-item driver-card priority-${analysis?.priority ?? "low"} direction-${analysis?.direction ?? "neutral"}" data-url="${escapeAttr(item.url)}" title="${escapeAttr(item.title)}">
            <span class="news-time">${formatTime(item.publishedAt)}</span>
            <span class="driver-heading">
              <strong>${escapeHtml(analysis?.summary ?? item.title)}</strong>
              <em class="attention-${cue.level}">${escapeHtml(cue.label)}</em>
            </span>
            <span class="driver-meta">
              ${escapeHtml(sourceLabel(item.source))}
              · ${escapeHtml(sourceTierLabel(item.sourceTier))}
              ${item.documentCount && item.documentCount > 1
                ? ` · 已合并 ${item.documentCount} 份材料`
                : ""}
              · ${escapeHtml(related)}
              · ${escapeHtml(relationLabel(analysis))}
              · ${escapeHtml(eventTypeLabel(analysis?.eventType))}
              · ${escapeHtml(horizonLabel(analysis?.horizon))}
              · ${escapeHtml(directionLabel(analysis?.direction))}
              · 重要度 ${analysis?.importance ?? "--"}
              · 综合可信 ${analysis?.confidence ?? "--"}
              ${materialLimited ? " · 材料有限" : ""}
            </span>
            <span class="news-mechanism">影响：${escapeHtml(analysis?.mechanism ?? item.summary ?? "尚未形成传导判断")}</span>
            <span class="decision-market">当前：${escapeHtml(cue.marketResponse)}</span>
            <span class="decision-uncertainty">不确定：${escapeHtml(cue.uncertainty)}</span>
            <span class="decision-next">
              <span>下一步：${escapeHtml(cue.nextStep)}</span>
              <button type="button" class="driver-context" data-action="copy-news-context" data-event-id="${escapeAttr(item.eventId ?? item.id)}">复制给 Coze</button>
            </span>
            ${failure ? `<span class="driver-fallback">${escapeHtml(failure)}</span>` : ""}
          </article>
        `;
      }).join("")}
    </div>
  `;
}

function decisionCueForItem(
  item: AppSnapshot["news"][number],
  next: AppSnapshot
) {
  const holdingCodes = new Set(next.settings.holdings.map((holding) => holding.securityCode));
  const watchlistCodes = new Set(next.settings.watchlist.map((entry) => entry.securityCode));
  const preliminary = buildDecisionCue({
    item,
    analysis: item.analysis,
    holdingCodes,
    watchlistCodes,
    quoteChangePercent: null,
    benchmarkChangePercent: null,
    recentRuleTriggered: false
  });
  const quote = preliminary.relatedCode
    ? next.quotes.find((entry) => entry.code === preliminary.relatedCode)
    : undefined;
  const benchmarkCode = benchmarkCodeForSecurity(preliminary.relatedCode ?? "600000");
  const benchmark = next.market.indices.find((entry) => entry.instrument.code === benchmarkCode);
  const recentRuleTriggered = Boolean(preliminary.relatedCode && next.risk.recentEvents.some((event) =>
    event.securityCode === preliminary.relatedCode &&
    Date.now() - Date.parse(event.triggeredAt) <= 30 * 60_000
  ));
  return buildDecisionCue({
    item,
    analysis: item.analysis,
    holdingCodes,
    watchlistCodes,
    quoteChangePercent: quote?.changePercent ?? null,
    benchmarkChangePercent: benchmark?.changePercent ?? null,
    recentRuleTriggered
  });
}

function directionLabel(value: string | undefined): string {
  if (value === "positive") return "偏正面";
  if (value === "negative") return "偏负面";
  if (value === "mixed") return "多空混合";
  if (value === "neutral") return "中性";
  return "方向待定";
}

function eventTypeLabel(value: string | undefined): string {
  const labels: Record<string, string> = {
    earnings: "业绩",
    policy: "政策",
    order: "订单",
    management: "管理层",
    capital: "资本事项",
    industry: "行业",
    market: "市场",
    other: "其他"
  };
  return value ? labels[value] ?? "其他" : "未分类";
}

function relationLabel(
  analysis: AppSnapshot["news"][number]["analysis"]
): string {
  if (!analysis) return "关联待确认";
  if (analysis.relation === "direct" && analysis.sourceRelatedCodes.length) {
    return "正文直接关联";
  }
  if (analysis.relation === "industry" &&
      analysis.inferredRelatedCodes.length &&
      !analysis.sourceRelatedCodes.length) {
    return "AI推测行业关联";
  }
  if (analysis.relation === "industry") return "行业关联";
  if (analysis.relation === "market") return "全市场";
  return "关联待确认";
}

function sourceLabel(value: string): string {
  if (/eastmoney|东方财富/i.test(value)) return "东财快讯";
  if (value === "cninfo") return "巨潮公告";
  if (value === "sse") return "上交所公告";
  if (value === "szse") return "深交所公告";
  if (value === "bse") return "北交所公告";
  if (value === "csrc") return "证监会";
  return value || "来源未知";
}

function sourceTierLabel(value: AppSnapshot["news"][number]["sourceTier"]): string {
  if (value === "official") return "法定披露";
  if (value === "regulatory") return "监管政策";
  return "媒体线索";
}

function horizonLabel(value: string | undefined): string {
  const labels: Record<string, string> = {
    intraday: "日内",
    short: "短期",
    medium: "中期",
    long: "长期"
  };
  return value ? labels[value] ?? "周期待定" : "周期待定";
}

function renderQuote(code: string, quote: Quote | undefined, settings: UserSettings): string {
  const security = securityFor(settings, code);
  const displayName = security?.alias || security?.name || quote?.name || code;
  const detailName = security?.alias && (security.name || quote?.name)
    ? (security.name || quote?.name) + " · "
    : "";
  const direction = quoteDirection(quote);

  return `
    <article class="quote-row ${direction}" ${marketDetailAttributes("stock", security?.market ?? quote?.market, code)}>
      <div class="quote-name">
        <strong>${escapeHtml(displayName)}</strong>
        <span>${escapeHtml(detailName)}${security?.market ?? quote?.market ?? ""}.${code}${renderQuoteQuality(quote)}</span>
      </div>
      <div class="quote-metrics">
        ${settings.quotes.fields.map((field) => renderQuoteField(quote, field)).join("")}
      </div>
    </article>
  `;
}

function renderQuoteField(quote: Quote | undefined, field: QuoteField): string {
  return `
    <span class="quote-metric">
      <small>${fieldLabels[field]}</small>
      <strong>${formatQuoteField(quote, field)}</strong>
    </span>
  `;
}

function watchlistCodes(settings: UserSettings): string[] {
  return [...settings.watchlist]
    .filter((item) => item.visible)
    .sort((a, b) => a.order - b.order)
    .map((item) => item.securityCode);
}

function sortCodes(codes: string[], quotes: Quote[], settings: UserSettings): string[] {
  const unique = [...new Set(codes)];
  const quoteMap = new Map(quotes.map((quote) => [quote.code, quote]));
  if (settings.quotes.sort === "changePercentDesc") {
    return unique.sort((a, b) =>
      (quoteMap.get(b)?.changePercent ?? -Infinity) -
      (quoteMap.get(a)?.changePercent ?? -Infinity)
    );
  }
  if (settings.quotes.sort === "changePercentAbs") {
    return unique.sort((a, b) =>
      Math.abs(quoteMap.get(b)?.changePercent ?? 0) -
      Math.abs(quoteMap.get(a)?.changePercent ?? 0)
    );
  }
  return unique;
}

function securityFor(settings: UserSettings, code: string) {
  return settings.securities.find((security) => security.code === code);
}

function applyAppearance(settings: UserSettings): void {
  document.documentElement.dataset.theme = settings.appearance.theme;
  document.documentElement.style.setProperty(
    "--widget-opacity",
    String(settings.appearance.backgroundOpacity)
  );
}

rootElement.addEventListener("click", async (event) => {
  const control = (event.target as HTMLElement).closest<HTMLElement>("[data-action], [data-url]");
  if (!control) return;

  if (control.dataset.action === "tab" && control.dataset.tabId) {
    await activateTab(control.dataset.tabId);
    return;
  }
  if (control.dataset.action === "market-detail") {
    const kind = control.dataset.kind === "index" ? "index" : "stock";
    const market = control.dataset.market;
    const code = control.dataset.code;
    if (code && (market === "SH" || market === "SZ" || market === "BJ")) {
      await openMarketDetail({ kind, market, code });
    }
    return;
  }
  if (control.dataset.action === "market-back") {
    closeMarketDetail();
    return;
  }
  if (control.dataset.action === "alerts-pause") {
    await window.floatingStock?.pauseAlertsToday();
    return;
  }
  if (control.dataset.action === "alerts-resume") {
    await window.floatingStock?.resumeAlerts();
    return;
  }
  if (control.dataset.action === "chart-mode") {
    const mode = control.dataset.mode;
    if (mode === "intraday" || mode === "daily" || mode === "boll") {
      marketChartMode = mode;
      render(snapshot);
    }
    return;
  }
  if (control.dataset.action === "hide") {
    await window.floatingStock?.hideWindow();
    return;
  }
  if (control.dataset.action === "settings") {
    await window.floatingStock?.openSettings();
    return;
  }
  if (control.dataset.action === "theme") {
    await window.floatingStock?.toggleTheme();
    return;
  }

  if (control.dataset.action === "click-through") {
    clickThrough = !clickThrough;
    await window.floatingStock?.toggleClickThrough(clickThrough);
    return;
  }
  if (control.dataset.action === "copy-news-context" && control.dataset.eventId) {
    const original = control.textContent;
    try {
      await window.floatingStock?.copyNewsContext(control.dataset.eventId);
      control.textContent = "已复制";
    } catch {
      control.textContent = "复制失败";
    }
    window.setTimeout(() => { control.textContent = original; }, 1_500);
    return;
  }

  const url = control.dataset.url;
  if (url) await window.floatingStock?.openExternal(url);
});

rootElement.addEventListener("change", async (event) => {
  const select = event.target as HTMLSelectElement;
  if (select.dataset.action === "tab-overflow" && select.value) {
    await activateTab(select.value);
  }
});

async function activateTab(tabId: string): Promise<void> {
  closeMarketDetail(false);
  activeTabId = tabId;
  render(snapshot);
  await window.floatingStock?.setActiveTab(tabId);
}

void window.floatingStock?.getSnapshot().then(render);
window.floatingStock?.onSnapshot(render);
window.addEventListener("online", () => {
  void window.floatingStock?.notifyOnline();
});
render(emptySnapshot);
navigationInitialized = false;

function renderRecentAlert(next: AppSnapshot): string {
  const event = next.risk.recentEvents[0];
  if (!event) return "";
  const age = Date.now() - Date.parse(event.triggeredAt);
  if (!Number.isFinite(age) || age < 0 || age > 30 * 60_000) return "";
  if (event.mode === "active" && !next.settings.risk.notifications.widget) return "";
  return `
    <section class="alert-banner ${event.mode}">
      <span>${event.mode === "shadow" ? "影子" : "提醒"}</span>
      <strong>${escapeHtml(event.title)}</strong>
      <em>${escapeHtml(event.message)}</em>
    </section>
  `;
}
function renderErrors(errors: string[]): string {
  if (errors.length === 0) return "";
  return `<section class="status">${errors.map((error) => `<span>${escapeHtml(error)}</span>`).join("")}</section>`;
}

function renderFeedStatus(label: string, status: AppSnapshot["feeds"]["quotes"]): string {
  if (!status.lastSuccessAt) return `<span class="stale">${label}等待</span>`;
  const sourceLabels: Record<string, string> = {
    eastmoney: "东财",
    tencent: "腾讯",
    official: "官方",
    mixed: label === "资讯" ? "多源" : "双源",
    local: "缓存"
  };
  const source = status.source ? " " + (sourceLabels[status.source] ?? status.source) : "";
  const states: string[] = [];
  const marketLabels = {
    preopen: "盘前",
    lunch: "午休",
    closed: "休市",
    holiday: "节休",
    weekend: "周末"
  } as const;
  if (status.marketState && status.marketState !== "trading") {
    states.push(marketLabels[status.marketState]);
  }
  if (status.stalled) states.push("停滞");
  else if (status.stale) states.push("延迟");
  if (status.conflictCount > 0) states.push(`冲突${status.conflictCount}`);
  if (status.retainedCount > 0) states.push(`缓存${status.retainedCount}`);
  if (status.missingCount > 0) states.push(`缺${status.missingCount}`);
  if (status.degraded && states.length === 0) states.push("降级");
  if (status.coverage != null && status.coverage < 1) {
    states.push(`${Math.round(status.coverage * 100)}%`);
  }
  const staleClass = status.stale || status.stalled || status.degraded ? "stale" : "";
  const stateText = states.length > 0 ? " · " + states.join("/") : "";
  const providerDetails = (status.providerHealth ?? []).map((health) => {
    const circuit = health.circuitState === "closed" ? "正常" :
      health.circuitState === "open" ? "熔断" : "探测";
    const p50 = health.latencyP50Ms == null ? "--" : `${health.latencyP50Ms}ms`;
    const p95 = health.latencyP95Ms == null ? "--" : `${health.latencyP95Ms}ms`;
    return `${sourceLabels[health.provider] ?? health.provider} 成功${Math.round(health.successRate * 100)}% 完整${Math.round(health.completenessRate * 100)}% 新鲜${Math.round(health.freshnessRate * 100)}% P50/P95 ${p50}/${p95} 解析失败${Math.round(health.parseFailureRate * 100)}% 差异${Math.round(health.conflictRate * 100)}% ${circuit}`;
  });
  const details = [
    `最近可信 ${formatFeedTime(status.lastSuccessAt)}`,
    status.dataUpdatedAt ? `源数据 ${formatFeedTime(status.dataUpdatedAt)}` : "源数据时间未知",
    status.lastChangedAt ? `数值变化 ${formatFeedTime(status.lastChangedAt)}` : "尚未检测到数值变化",
    `价格提醒${status.alertSafe ? "可用" : "已禁用"}`,
    ...providerDetails
  ].join("；");
  return `<span class="${staleClass}" title="${escapeAttr(details)}">${label} ${formatFeedTime(status.lastSuccessAt)}${source}${stateText}</span>`;
}

function renderQuoteQuality(quote: Quote | undefined): string {
  const quality = quote?.quality;
  if (!quality || quality.state === "fresh") return "";
  const labels = {
    fallback: "备用",
    stale: "陈旧",
    retained: "缓存",
    conflict: "冲突"
  } as const;
  const reasons = quality.reasons.length > 0 ? quality.reasons.join(", ") : quality.state;
  return ` <em class="quote-quality quality-${quality.state}" title="${escapeAttr(reasons)}">${labels[quality.state]}</em>`;
}

function quoteDirection(quote: Quote | undefined): string {
  const value = quote?.changePercent ?? 0;
  return value > 0 ? "up" : value < 0 ? "down" : "flat";
}

function numberDirection(value: number | null | undefined): string {
  if (value == null || value === 0) return "flat";
  return value > 0 ? "up" : "down";
}

function formatQuoteField(quote: Quote | undefined, field: QuoteField): string {
  const value = quote?.[field];
  if (field === "change") return formatSigned(value);
  if (field === "changePercent") return formatPercent(value);
  if (field === "volume") return formatCompact(value, "手");
  if (field === "amount" || field === "mainInflow") {
    return formatCompact(value, "元", field === "mainInflow");
  }
  return formatNumber(value);
}

function formatNumber(value: number | null | undefined): string {
  return value == null ? "--" : value.toFixed(Math.abs(value) > 100 ? 2 : 3);
}

function formatSigned(value: number | null | undefined): string {
  if (value == null) return "--";
  return (value > 0 ? "+" : "") + value.toFixed(2);
}

function formatPercent(value: number | null | undefined): string {
  if (value == null) return "--";
  return (value > 0 ? "+" : "") + value.toFixed(2) + "%";
}

function formatRLabel(value: number | null | undefined): string {
  return value == null ? "" : ` · ${value.toFixed(2)}R`;
}
function formatMoney(value: number | null | undefined): string {
  if (value == null) return "--";
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value);
}

function formatSignedMoney(value: number | null | undefined): string {
  if (value == null) return "--";
  return (value > 0 ? "+" : "") + new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: 0
  }).format(value);
}

function formatQuantity(value: number): string {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value);
}

function formatCompact(
  value: number | null | undefined,
  suffix: string,
  signed = false
): string {
  if (value == null) return "--";
  const absolute = Math.abs(value);
  const sign = signed && value > 0 ? "+" : value < 0 ? "-" : "";
  if (absolute >= 100_000_000) return sign + (absolute / 100_000_000).toFixed(1) + "亿";
  if (absolute >= 10_000) return sign + (absolute / 10_000).toFixed(1) + "万";
  return sign + absolute.toFixed(0) + suffix;
}

function formatFeedTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
}


function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
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
