import type { AppSnapshot, Quote } from "./domain/types.js";
import { escapeHtml } from "./presentation/format.js";

const root = document.querySelector<HTMLDivElement>("#quick-root");
if (!root) throw new Error("Missing quick root");
const rootElement = root;

rootElement.innerHTML = `
  <main class="quick-card">
    <header><div><small>工作数据</small><strong>实时摘要</strong></div><time id="quick-time">--:--</time></header>
    <section class="indices" id="quick-indices"></section>
    <section class="watchlist"><div class="caption">重点项目</div><div id="quick-quotes"></div></section>
    <section class="event"><div class="caption">最新动态</div><p id="quick-event">暂无重要动态</p></section>
    <footer><span id="quick-status">数据加载中</span><div><button data-action="full">完整查看</button><button data-action="hide">关闭</button></div></footer>
  </main>`;

const indices = required("#quick-indices");
const quotes = required("#quick-quotes");
const eventText = required("#quick-event");
const status = required("#quick-status");
const time = required("#quick-time");

function update(snapshot: AppSnapshot): void {
  time.textContent = formatTime(snapshot.updatedAt);
  indices.innerHTML =
    snapshot.market.indices
      .slice(0, 3)
      .map(
        (item) => `
    <div class="index ${direction(item.changePercent)}"><small>${escapeHtml(item.instrument.name)}</small><strong>${formatNumber(item.price)}</strong><span>${formatPercent(item.changePercent)}</span></div>
  `
      )
      .join("") || '<div class="empty">指数等待更新</div>';

  const quoteMap = new Map(snapshot.quotes.map((quote) => [quote.code, quote]));
  const securityMap = new Map(
    snapshot.settings.securities.map((security) => [security.code, security])
  );
  const rows = snapshot.settings.watchlist
    .filter((item) => item.visible)
    .sort((a, b) => a.order - b.order)
    .slice(0, 5)
    .map((item) => {
      const quote = quoteMap.get(item.securityCode);
      const security = securityMap.get(item.securityCode);
      const name = security?.alias || security?.name || quote?.name || item.securityCode;
      return `<div class="quote ${direction(quote?.changePercent ?? null)}"><span><strong>${escapeHtml(name)}</strong><small>${escapeHtml(item.securityCode)}</small></span><b>${formatQuotePrice(quote)}</b><em>${formatPercent(quote?.changePercent ?? null)}</em></div>`;
    });
  quotes.innerHTML = rows.join("") || '<div class="empty">暂无重点项目</div>';

  const important =
    snapshot.news.find((item) => item.analysis?.priority === "high") ?? snapshot.news[0];
  eventText.textContent = important?.title ?? "暂无重要动态";
  const feed = snapshot.feeds.quotes;
  status.textContent =
    feed.degraded || feed.stale
      ? "行情待核验"
      : `${feed.source ?? "行情"} · ${formatTime(feed.lastSuccessAt)}`;
  document.documentElement.dataset.state = feed.degraded || feed.stale ? "degraded" : "ready";
}

rootElement.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-action]");
  if (button?.dataset.action === "full") void window.floatingStock?.showFullWindow();
  if (button?.dataset.action === "hide") void window.floatingStock?.hideQuickView();
});

function required(selector: string): HTMLElement {
  const element = rootElement.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
}

function direction(value: number | null): string {
  return value == null || value === 0 ? "flat" : value > 0 ? "up" : "down";
}

function formatNumber(value: number | null): string {
  return value == null ? "--" : value.toFixed(2);
}

function formatQuotePrice(quote: Quote | undefined): string {
  return quote?.price == null ? "--" : quote.price.toFixed(2);
}

function formatPercent(value: number | null): string {
  return value == null ? "--" : `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatTime(value: string | null): string {
  if (!value) return "--:--";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "--:--"
    : date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

void window.floatingStock?.getSnapshot().then(update);
window.floatingStock?.onSnapshot(update);
