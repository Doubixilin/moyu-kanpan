import type { DataSource, FeedStatus, NewsSourceState, Quote } from "./types.js";

export interface FeedStatusInput {
  lastSuccessAt: string | null;
  lastAttemptFailed: boolean;
  intervalMs: number;
  nowMs?: number;
  source: DataSource | null;
  dataUpdatedAt?: string | null;
  lastChangedAt?: string | null;
  stalled?: boolean;
  coverage?: number | null;
  degraded?: boolean;
  conflictCount?: number;
  retainedCount?: number;
  missingCount?: number;
  alertSafe?: boolean;
  providerHealth?: FeedStatus["providerHealth"];
  marketState?: FeedStatus["marketState"];
}

export function buildFeedStatus(input: FeedStatusInput): FeedStatus {
  const nowMs = input.nowMs ?? Date.now();
  const lastSuccessMs = input.lastSuccessAt ? Date.parse(input.lastSuccessAt) : Number.NaN;
  const staleAfterMs = Math.max(input.intervalMs * 2, 60_000);
  const staleByAge = !Number.isFinite(lastSuccessMs) || nowMs - lastSuccessMs > staleAfterMs;

  return {
    lastSuccessAt: input.lastSuccessAt,
    dataUpdatedAt: input.dataUpdatedAt ?? null,
    lastChangedAt: input.lastChangedAt ?? null,
    stale: input.lastAttemptFailed || staleByAge,
    stalled: input.stalled ?? false,
    source: input.source,
    coverage: input.coverage ?? null,
    degraded: input.degraded ?? false,
    conflictCount: input.conflictCount ?? 0,
    retainedCount: input.retainedCount ?? 0,
    missingCount: input.missingCount ?? 0,
    alertSafe: input.alertSafe ?? true,
    providerHealth: input.providerHealth ?? [],
    marketState: input.marketState ?? null
  };
}

export function quoteFingerprint(quotes: Quote[]): string {
  return JSON.stringify(
    [...quotes]
      .sort((left, right) => left.code.localeCompare(right.code))
      .map((quote) => [
        quote.code,
        quote.price,
        quote.change,
        quote.changePercent,
        quote.volume,
        quote.amount,
        quote.mainInflow ?? null
      ])
  );
}

export function newestQuoteTimestamp(quotes: Quote[]): string | null {
  const timestamps = quotes
    .map((quote) => (quote.updatedAt ? Date.parse(quote.updatedAt) : Number.NaN))
    .filter(Number.isFinite);
  return timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null;
}

export function isQuoteFeedStalled(input: {
  dataUpdatedAt: string | null;
  lastChangedAt: string | null;
  marketOpen: boolean;
  nowMs: number;
  thresholdMs: number;
}): boolean {
  if (!input.marketOpen) return false;
  const activityTimes = [input.dataUpdatedAt, input.lastChangedAt]
    .map((value) => (value ? Date.parse(value) : Number.NaN))
    .filter(Number.isFinite);
  if (activityTimes.length === 0) return true;
  return input.nowMs - Math.max(...activityTimes) > input.thresholdMs;
}

export function summarizeNewsSourceHealth(
  states: Array<NewsSourceState | null>,
  failureThreshold = 3
): string | null {
  const labels: Record<string, string> = {
    eastmoney: "东财快讯",
    "media-fallback": "备用快讯",
    cninfo: "巨潮公告",
    csrc: "证监会"
  };
  const failing = states
    .filter((state): state is NewsSourceState =>
      Boolean(state && state.consecutiveFailures >= failureThreshold)
    )
    .map((state) => labels[state.source] ?? state.source);
  if (!failing.length) return null;
  return `${failing.join("、")}连续失败，正在使用其他来源和历史事件`;
}
