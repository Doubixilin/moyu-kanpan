import type { DataSource, NewsAnalysis, NewsItem } from "./types.js";

export function aggregateNewsSource(
  items: NewsItem[],
  refreshedSources: string[] = []
): DataSource {
  const storedSources = new Set(
    items.flatMap((item) => (item.sources?.length ? item.sources : [item.source]))
  );
  const sources = storedSources.size ? storedSources : new Set(refreshedSources);
  const hasMedia = [...sources].some((source) => /eastmoney|media-fallback|东方财富/i.test(source));
  const hasOfficial = [...sources].some(
    (source) =>
      /^(cninfo|sse|szse|bse|csrc|pbc|stats|gov)$/i.test(source) ||
      /巨潮|交易所|证监会|人民银行|统计局|政府网/.test(source)
  );
  if (hasMedia && hasOfficial) return "mixed";
  if (hasOfficial) return "official";
  if (hasMedia) return "eastmoney";
  return "local";
}

export interface ImportantDriverDecision {
  display: boolean;
  reason: "direct" | "industry" | "industry-inferred" | "market" | "not-useful" | "unrelated";
}

export function importantDriverDecision(
  item: NewsItem,
  analysis: NewsAnalysis | undefined,
  trackedCodes: ReadonlySet<string>
): ImportantDriverDecision {
  if (!analysis?.useful || analysis.priority === "low") {
    return { display: false, reason: "not-useful" };
  }

  const sourceRelatedToTracked = analysis.sourceRelatedCodes.some((code) => trackedCodes.has(code));
  const inferredRelatedToTracked = analysis.inferredRelatedCodes.some((code) =>
    trackedCodes.has(code)
  );
  if (analysis.relation === "direct" && sourceRelatedToTracked) {
    return { display: true, reason: "direct" };
  }
  if (analysis.relation === "industry" && sourceRelatedToTracked && analysis.importance >= 50) {
    return { display: true, reason: "industry" };
  }
  if (
    analysis.relation === "industry" &&
    inferredRelatedToTracked &&
    analysis.importance >= 70 &&
    analysis.confidence >= 45
  ) {
    return { display: true, reason: "industry-inferred" };
  }
  if (analysis.relation === "market" && analysis.importance >= 80 && analysis.confidence >= 45) {
    return { display: true, reason: "market" };
  }

  void item;
  return { display: false, reason: "unrelated" };
}

export function hasLimitedNewsMaterial(item: NewsItem): boolean {
  const summary = (item.summary ?? "").replace(/\s+/g, "").trim();
  const title = item.title.replace(/\s+/g, "").trim();
  if (summary.length < 40) return true;
  if (summary === title || (summary.includes(title) && summary.length < title.length + 30))
    return true;
  return false;
}
