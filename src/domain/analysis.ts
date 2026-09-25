import { hasLimitedNewsMaterial } from "./news.js";
import type { NewsAnalysis, NewsDirection, NewsEventType, NewsItem } from "./types.js";

const HIGH_KEYWORDS = ["政策", "证监会", "重磅", "业绩", "预增", "并购", "停牌", "复牌"];
const MEDIUM_KEYWORDS = ["公告", "减持", "增持", "回购", "订单", "中标", "调研"];

export function analyzeNewsWithRules(item: NewsItem, failureReason?: string): NewsAnalysis {
  const text = `${item.title} ${item.summary ?? ""}`;
  const highMatches = HIGH_KEYWORDS.filter((keyword) => text.includes(keyword));
  const mediumMatches = MEDIUM_KEYWORDS.filter((keyword) => text.includes(keyword));
  const matchedKeywords = [...highMatches, ...mediumMatches];
  const priority = highMatches.length > 0 ? "high" : mediumMatches.length > 0 ? "medium" : "low";
  const importance = priority === "high" ? 70 : priority === "medium" ? 45 : 15;

  return {
    newsId: item.id,
    priority,
    status: "rule_fallback",
    useful: priority !== "low",
    eventType: inferEventType(text),
    relatedCodes: [...new Set((item.relatedCodes ?? []).filter((code) => /^\d{6}$/.test(code)))],
    sourceRelatedCodes: [
      ...new Set((item.relatedCodes ?? []).filter((code) => /^\d{6}$/.test(code)))
    ],
    inferredRelatedCodes: [],
    relation: item.relatedCodes?.length ? "direct" : "uncertain",
    direction: inferDirection(text),
    horizon: "short",
    importance,
    confidence: priority === "low" ? 20 : 35,
    modelConfidence: null,
    materialLimited: hasLimitedNewsMaterial(item),
    summary: buildSummary(item.title, matchedKeywords, priority),
    mechanism: "本地规则只完成关键词筛选，尚未形成可靠的股价传导判断。",
    evidence: [item.title],
    counterFactors: ["尚未完成来源交叉核验和市场表现验证。"],
    missingInformation: ["需要模型或人工补充事件方向、影响周期和传导机制。"],
    matchedKeywords,
    analyzedAt: new Date().toISOString(),
    provider: "rules",
    ...(failureReason ? { failureReason } : {})
  };
}

function buildSummary(
  title: string,
  keywords: string[],
  priority: NewsAnalysis["priority"]
): string {
  if (keywords.length === 0) return `规则低优先级：${title}`;
  const label = priority === "high" ? "规则重点关注" : "规则留意";
  return `${label}：命中 ${keywords.join("、")}，${title}`;
}

function inferEventType(text: string): NewsEventType {
  if (/业绩|预增|预亏|营收|净利润/.test(text)) return "earnings";
  if (/政策|监管|证监会|央行|国务院/.test(text)) return "policy";
  if (/订单|中标|合同/.test(text)) return "order";
  if (/董事|高管|管理层|任免/.test(text)) return "management";
  if (/回购|增持|减持|定增|并购|融资/.test(text)) return "capital";
  if (/行业|产业|供需|产能/.test(text)) return "industry";
  if (/指数|大盘|市场|成交额/.test(text)) return "market";
  return "other";
}

function inferDirection(text: string): NewsDirection {
  const positive = /预增|增长|中标|增持|回购|突破|上调/.test(text);
  const negative = /预亏|下降|减持|处罚|调查|下调|风险/.test(text);
  if (positive && negative) return "mixed";
  if (positive) return "positive";
  if (negative) return "negative";
  return "neutral";
}
