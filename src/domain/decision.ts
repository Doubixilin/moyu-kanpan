import type { NewsAnalysis, NewsItem } from "./types.js";

export type DecisionAttentionLevel = "watch" | "verify" | "review_now";

export interface DecisionCue {
  level: DecisionAttentionLevel;
  label: "留意" | "核验" | "立即查看";
  relatedCode: string | null;
  marketResponse: string;
  uncertainty: string;
  nextStep: string;
}

export interface DecisionCueInput {
  item: NewsItem;
  analysis?: NewsAnalysis;
  holdingCodes: ReadonlySet<string>;
  watchlistCodes: ReadonlySet<string>;
  quoteChangePercent: number | null;
  benchmarkChangePercent: number | null;
  recentRuleTriggered: boolean;
}

export function buildDecisionCue(input: DecisionCueInput): DecisionCue {
  const directCodes = sourceCodes(input.item, input.analysis);
  const relatedCode =
    directCodes.find((code) => input.holdingCodes.has(code) || input.watchlistCodes.has(code)) ??
    directCodes[0] ??
    null;
  const relatedHolding = relatedCode ? input.holdingCodes.has(relatedCode) : false;
  const relatedTracked =
    relatedHolding || Boolean(relatedCode && input.watchlistCodes.has(relatedCode));
  const official = input.item.sourceTier === "official";
  const importance = input.analysis?.importance ?? 0;
  const relativeMove =
    input.quoteChangePercent != null && input.benchmarkChangePercent != null
      ? input.quoteChangePercent - input.benchmarkChangePercent
      : null;

  let level: DecisionAttentionLevel = "watch";
  if (relatedHolding && input.recentRuleTriggered) {
    level = "review_now";
  } else if (
    relatedHolding &&
    official &&
    importance >= 85 &&
    relativeMove != null &&
    Math.abs(relativeMove) >= 2.5
  ) {
    level = "review_now";
  } else if (
    official &&
    relatedTracked &&
    (input.analysis?.relation === "direct" || directCodes.length > 0)
  ) {
    level = "verify";
  }

  return {
    level,
    label: level === "review_now" ? "立即查看" : level === "verify" ? "核验" : "留意",
    relatedCode,
    marketResponse: marketResponse(input.quoteChangePercent, input.benchmarkChangePercent),
    uncertainty: primaryUncertainty(input.item, input.analysis),
    nextStep: nextStep(level, official)
  };
}

export function benchmarkCodeForSecurity(code: string): string {
  if (code.startsWith("3")) return "399006";
  if (code.startsWith("0")) return "399001";
  return "000001";
}

function sourceCodes(item: NewsItem, analysis: NewsAnalysis | undefined): string[] {
  const values = analysis?.sourceRelatedCodes.length
    ? analysis.sourceRelatedCodes
    : (item.relatedCodes ?? []);
  return [...new Set(values.filter((code) => /^\d{6}$/.test(code)))];
}

function marketResponse(stock: number | null, benchmark: number | null): string {
  if (stock == null) return "当前市场表现待确认";
  if (benchmark == null) return `个股 ${signedPercent(stock)}；基准数据不足`;
  const relative = stock - benchmark;
  const relation = relative >= 1 ? "明显强于大盘" : relative <= -1 ? "明显弱于大盘" : "与大盘接近";
  return `个股 ${signedPercent(stock)}，基准 ${signedPercent(benchmark)}；${relation}（不代表事件因果）`;
}

function primaryUncertainty(item: NewsItem, analysis: NewsAnalysis | undefined): string {
  if (analysis?.missingInformation[0]) return analysis.missingInformation[0];
  if (analysis?.materialLimited || item.materialStatus !== "full")
    return "材料有限，需核对公告原文";
  return analysis?.counterFactors[0] ?? "尚未完成反向验证";
}

function nextStep(level: DecisionAttentionLevel, official: boolean): string {
  if (level === "review_now") return "先查看已触发规则，再核对事件原文";
  if (level === "verify") return "查看公告原文；需要时复制给 Coze";
  return official ? "保持观察；必要时核对公告原文" : "保持观察；需要时复制给 Coze 深度核验";
}

function signedPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}
