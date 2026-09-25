import type {
  AlertPriority,
  AppSnapshot,
  MarketDetail,
  QuoteQualityState
} from "../domain/types.js";

export interface PublicTrend {
  code: string;
  name: string;
  updatedAt: string;
  stale: boolean;
  items: Array<{
    date: string;
    close: number;
    upper: number | null;
    mid: number | null;
    lower: number | null;
  }>;
}

export interface PublicSnapshot {
  updatedAt: string;
  marketState: AppSnapshot["feeds"]["quotes"]["marketState"];
  quotes: Array<{
    code: string;
    name: string;
    price: number | null;
    changePercent: number | null;
    status: string;
    updatedAt: string | null;
  }>;
  indices: Array<{
    name: string;
    value: number | null;
    changePercent: number | null;
    updatedAt: string | null;
  }>;
  events: Array<{
    id: string;
    title: string;
    category: string;
    priority: "普通" | "关注" | "重要";
    publishedAt: string;
  }>;
  feeds: {
    quotesUpdatedAt: string | null;
    newsUpdatedAt: string | null;
    stale: boolean;
    degraded: boolean;
  };
}

export function buildPublicSnapshot(snapshot: AppSnapshot): PublicSnapshot {
  const securities = new Map(snapshot.settings.securities.map((item) => [item.code, item]));
  const quotes = new Map(snapshot.quotes.map((item) => [item.code, item]));
  const visibleCodes = snapshot.settings.watchlist
    .filter((item) => item.visible)
    .sort((a, b) => a.order - b.order)
    .slice(0, 10)
    .map((item) => item.securityCode);
  return {
    updatedAt: snapshot.updatedAt,
    marketState: snapshot.feeds.quotes.marketState,
    quotes: visibleCodes.map((code) => {
      const quote = quotes.get(code);
      const security = securities.get(code);
      return {
        code,
        name: security?.alias || security?.name || quote?.name || code,
        price: quote?.price ?? null,
        changePercent: quote?.changePercent ?? null,
        status: qualityLabel(quote?.quality?.state),
        updatedAt: quote?.updatedAt ?? null
      };
    }),
    indices: snapshot.market.indices.slice(0, 3).map((item) => ({
      name: item.instrument.name,
      value: item.price,
      changePercent: item.changePercent,
      updatedAt: item.updatedAt ?? null
    })),
    events: snapshot.news.slice(0, 8).map((item) => ({
      id: item.id,
      title: item.title,
      category: categoryLabel(item.sourceTier),
      priority: priorityLabel(item.analysis?.priority),
      publishedAt: item.publishedAt
    })),
    feeds: {
      quotesUpdatedAt: snapshot.feeds.quotes.lastSuccessAt,
      newsUpdatedAt: snapshot.feeds.news.lastSuccessAt,
      stale: snapshot.feeds.quotes.stale,
      degraded: snapshot.feeds.quotes.degraded
    }
  };
}

export function buildPublicTrend(detail: MarketDetail): PublicTrend {
  return {
    code: detail.instrument.code,
    name: detail.instrument.name,
    updatedAt: detail.daily.updatedAt ?? detail.fetchedAt,
    stale: detail.daily.stale,
    items: detail.daily.items.slice(-60).map((item) => ({
      date: item.date,
      close: item.close,
      upper: item.bollUpper,
      mid: item.bollMid,
      lower: item.bollLower
    }))
  };
}

function qualityLabel(state: QuoteQualityState | undefined): string {
  if (state === "fresh") return "正常";
  if (state === "fallback") return "备用";
  if (state === "conflict") return "待核验";
  if (state === "stale" || state === "retained") return "延迟";
  return "等待";
}

function categoryLabel(tier: AppSnapshot["news"][number]["sourceTier"]): string {
  if (tier === "official") return "公开材料";
  if (tier === "regulatory") return "监管动态";
  return "工作动态";
}

function priorityLabel(priority: AlertPriority | undefined): "普通" | "关注" | "重要" {
  if (priority === "high") return "重要";
  if (priority === "medium") return "关注";
  return "普通";
}
