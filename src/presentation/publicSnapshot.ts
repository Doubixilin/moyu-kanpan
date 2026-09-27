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

/**
 * 网络载荷的边界校验（审计报告 §4-4）。
 *
 * 工作网页从本地 HTTP 服务与 `localStorage` 读的都是**不可信字节**：此前一律
 * `as PublicSnapshot`，形状不符时 `renderSnapshot` 直接抛错，而 `initialize` 的
 * `catch` 会把它报成"访问已失效，请从应用托盘重新打开"——把数据问题说成权限问题。
 *
 * 与 `normalizeExcelCustomSheet` 同一范式：能修的修（缺字段补默认值、坏条目丢弃），
 * 骨架不对才返回 `null` 让调用方给出明确提示。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function boolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function records(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

export function normalizePublicSnapshot(value: unknown): PublicSnapshot | null {
  if (!isRecord(value)) return null;
  const feeds = isRecord(value.feeds) ? value.feeds : {};
  const marketState =
    value.marketState === "trading" ||
    value.marketState === "preopen" ||
    value.marketState === "lunch" ||
    value.marketState === "closed" ||
    value.marketState === "holiday" ||
    value.marketState === "weekend"
      ? value.marketState
      : null;

  return {
    updatedAt: text(value.updatedAt),
    marketState,
    quotes: records(value.quotes)
      .filter((item) => typeof item.code === "string")
      .map((item) => ({
        code: text(item.code),
        name: text(item.name),
        price: nullableNumber(item.price),
        changePercent: nullableNumber(item.changePercent),
        status: text(item.status),
        updatedAt: nullableText(item.updatedAt)
      })),
    indices: records(value.indices).map((item) => ({
      name: text(item.name),
      value: nullableNumber(item.value),
      changePercent: nullableNumber(item.changePercent),
      updatedAt: nullableText(item.updatedAt)
    })),
    events: records(value.events)
      .filter((item) => typeof item.id === "string")
      .map((item) => ({
        id: text(item.id),
        title: text(item.title),
        category: text(item.category),
        priority:
          item.priority === "重要" || item.priority === "关注" || item.priority === "普通"
            ? item.priority
            : "普通",
        publishedAt: text(item.publishedAt)
      })),
    feeds: {
      quotesUpdatedAt: nullableText(feeds.quotesUpdatedAt),
      newsUpdatedAt: nullableText(feeds.newsUpdatedAt),
      stale: boolean(feeds.stale),
      degraded: boolean(feeds.degraded)
    }
  };
}

export function normalizePublicTrend(value: unknown): PublicTrend | null {
  if (!isRecord(value) || !Array.isArray(value.items)) return null;
  return {
    code: text(value.code),
    name: text(value.name),
    updatedAt: text(value.updatedAt),
    stale: boolean(value.stale),
    items: records(value.items)
      .filter((item) => typeof item.date === "string" && typeof item.close === "number")
      .map((item) => ({
        date: text(item.date),
        close: Number(item.close),
        upper: nullableNumber(item.upper),
        mid: nullableNumber(item.mid),
        lower: nullableNumber(item.lower)
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
