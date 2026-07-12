import type { AppSnapshot, Quote } from "./types.js";

export type TrayVisualState = "neutral" | "up" | "down" | "attention" | "degraded";

export interface TrayPresentation {
  state: TrayVisualState;
  tooltip: string;
  quoteLabels: string[];
  importantCount: number;
}

export function buildTrayPresentation(snapshot: AppSnapshot): TrayPresentation {
  const visibleCodes = snapshot.settings.watchlist
    .filter((item) => item.visible)
    .sort((a, b) => a.order - b.order)
    .map((item) => item.securityCode);
  const quoteMap = new Map(snapshot.quotes.map((quote) => [quote.code, quote]));
  const securityMap = new Map(snapshot.settings.securities.map((security) => [security.code, security]));
  const visibleQuotes = visibleCodes.flatMap((code) => {
    const quote = quoteMap.get(code);
    return quote ? [quote] : [];
  });
  const upCount = visibleQuotes.filter((quote) => (quote.changePercent ?? 0) > 0).length;
  const downCount = visibleQuotes.filter((quote) => (quote.changePercent ?? 0) < 0).length;
  const importantCount = snapshot.news.filter((item) => item.analysis?.priority === "high").length;
  const hasRecentAlert = snapshot.risk.recentEvents.length > 0 && !snapshot.risk.paused;
  const degraded = snapshot.feeds.quotes.degraded || snapshot.feeds.quotes.stale ||
    snapshot.feeds.quotes.missingCount > 0 || !snapshot.feeds.quotes.alertSafe;
  const state: TrayVisualState = degraded
    ? "degraded"
    : hasRecentAlert || importantCount > 0
      ? "attention"
      : upCount > downCount
        ? "up"
        : downCount > upCount
          ? "down"
          : "neutral";
  const indices = snapshot.market.indices.slice(0, 3).map((item) =>
    `${item.instrument.name} ${formatPercent(item.changePercent)}`
  );
  const marketText = indices.length > 0 ? indices.join(" ") : "指数等待";
  const alertText = importantCount > 0 ? ` 重要${importantCount}` : "";
  const degradedText = degraded ? " 数据待核验" : "";

  return {
    state,
    tooltip: `${marketText}｜自选${upCount}涨${downCount}跌${alertText}${degradedText}`,
    quoteLabels: visibleCodes.slice(0, 5).map((code) => {
      const quote = quoteMap.get(code);
      const security = securityMap.get(code);
      const name = security?.alias || security?.name || quote?.name || code;
      return `${name} ${formatPrice(quote)} ${formatPercent(quote?.changePercent ?? null)}`;
    }),
    importantCount
  };
}

function formatPrice(quote: Quote | undefined): string {
  return quote?.price == null ? "--" : quote.price.toFixed(2);
}

function formatPercent(value: number | null): string {
  if (value == null) return "--";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}
