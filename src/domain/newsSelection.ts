import type { NewsAnalysis, NewsItem } from "./types.js";
import type { NewsMode, Security } from "../config.js";

/**
 * 新闻的"相关性标注 + 展示筛选"。
 *
 * 这两步此前写死在 `electron/main.ts`（`selectRelevantNews` / `presentNews`）里，
 * 直接读模块级 `config` 与 `latestQuotes`，因此既无法单测也无法复用
 * （审计报告 §6-4：`main.ts` 需要"抽纯函数再测"）。
 */

/** 参与匹配的行情名（例如东财返回的"五 粮 液"这种带空格的名字）。 */
export interface NewsSelectionContext {
  /** 当前生效的证券（`activeSecurityCodes` 的子集）。 */
  securities: Security[];
  /** 生效代码集合，用于过滤 `relatedCodes`。 */
  activeCodes: string[];
  /** code → 行情名，用于给关键字表补上"行情里才有的名字"。 */
  quoteNames?: Map<string, string>;
  mode: NewsMode;
}

/**
 * 给每条新闻补 `relatedCodes`，并按模式过滤。
 *
 * 匹配规则（保持不变）：代码/名称/别名/行情名任一出现在"标题 + 摘要"里即算相关；
 * 长度小于 2 的关键字忽略（否则"*ST"这类短串会命中一切）。
 */
export function selectRelevantNews<T extends NewsItem>(
  items: T[],
  context: NewsSelectionContext
): T[] {
  const activeCodes = new Set(context.activeCodes);
  const quoteNames = context.quoteNames ?? new Map<string, string>();
  const annotated = items.map((item): T => {
    const text = `${item.title} ${item.summary ?? ""}`;
    const relatedCodes = new Set((item.relatedCodes ?? []).filter((code) => activeCodes.has(code)));
    for (const security of context.securities) {
      if (!activeCodes.has(security.code)) continue;
      const keywords = [
        security.code,
        security.name,
        security.alias,
        quoteNames.get(security.code) ?? ""
      ].filter((keyword) => keyword.length >= 2);
      if (keywords.some((keyword) => text.includes(keyword))) relatedCodes.add(security.code);
    }
    return { ...item, relatedCodes: [...relatedCodes] } as T;
  });

  if (context.mode !== "watchlist_related") return annotated;
  return annotated.filter((item) => (item.relatedCodes?.length ?? 0) > 0);
}

/** 展示筛选：`important` 模式只留"AI 判定有用且非低优先级"的条目，然后截断。 */
export function presentNews<T extends NewsItem & { analysis?: NewsAnalysis }>(
  items: T[],
  limit: number,
  mode: NewsMode
): T[] {
  const visible =
    mode === "important"
      ? items.filter((item) => item.analysis?.useful === true && item.analysis.priority !== "low")
      : items;
  return visible.slice(0, limit);
}
