import type { AlertEvent, NewsAnalysis, NewsItem, Quote } from "./types.js";
import type { DecisionCue } from "./decision.js";

export interface EventContextInput {
  item: NewsItem & { analysis?: NewsAnalysis };
  tracking: "holding" | "watchlist" | "market";
  securityName: string | null;
  quote?: Pick<Quote, "code" | "price" | "changePercent" | "updatedAt" | "source">;
  benchmark?: {
    name: string;
    changePercent: number | null;
    updatedAt: string | null;
  };
  cue: DecisionCue;
  alerts: Array<Pick<AlertEvent, "type" | "title" | "triggeredAt" | "mode">>;
}

export function buildSanitizedEventContext(input: EventContextInput): string {
  const analysis = input.item.analysis;
  const sources = input.item.sources?.length ? input.item.sources.join("、") : input.item.source;
  const security = input.cue.relatedCode
    ? `${input.securityName ?? "标的"}（${input.cue.relatedCode}）`
    : "全市场事件";
  const tracking =
    input.tracking === "holding"
      ? "持仓关联"
      : input.tracking === "watchlist"
        ? "自选关联"
        : "市场事件";
  const quote = input.quote
    ? `${formatNumber(input.quote.price)}，涨跌 ${formatPercent(input.quote.changePercent)}，` +
      `时间 ${input.quote.updatedAt ?? "未知"}，来源 ${input.quote.source}`
    : "无可用个股行情";
  const benchmark = input.benchmark
    ? `${input.benchmark.name} ${formatPercent(input.benchmark.changePercent)}，时间 ${input.benchmark.updatedAt ?? "未知"}`
    : "无可用基准行情";
  const alertLines = input.alerts.length
    ? input.alerts
        .map(
          (alert) =>
            `- ${alert.title}（${alert.type}，${alert.mode === "shadow" ? "影子" : "正式"}，${alert.triggeredAt}）`
        )
        .join("\n")
    : "- 无近期本地规则触发";

  return [
    "【摸鱼看盘：事件核验上下文】",
    `标的：${security}`,
    `本地关注关系：${tracking}`,
    `查看优先级：${input.cue.label}`,
    `当前行情：${quote}`,
    `市场基准：${benchmark}`,
    `当前表现：${input.cue.marketResponse}`,
    "",
    `事件：${input.item.title}`,
    `发布时间：${input.item.publishedAt}`,
    `来源：${sources}（${sourceTierLabel(input.item.sourceTier)}）`,
    `原文：${input.item.url}`,
    `快速摘要：${analysis?.summary ?? input.item.summary ?? "暂无"}`,
    `潜在影响路径：${analysis?.mechanism ?? "尚未形成"}`,
    `输入证据：${analysis?.evidence.join("；") || "仅有标题或简讯"}`,
    `反向因素：${analysis?.counterFactors.join("；") || "尚未确认"}`,
    `关键不确定点：${input.cue.uncertainty}`,
    "",
    "本地规则状态：",
    alertLines,
    `建议核验动作：${input.cue.nextStep}`,
    "",
    "边界：以上仅用于事实核验和进一步研究，不构成买卖或仓位建议；未包含任何账户或仓位私密数据。"
  ].join("\n");
}

function sourceTierLabel(value: NewsItem["sourceTier"]): string {
  if (value === "official") return "法定披露";
  if (value === "regulatory") return "监管政策";
  return "媒体线索";
}

function formatNumber(value: number | null): string {
  return value == null ? "--" : String(value);
}

function formatPercent(value: number | null): string {
  if (value == null) return "--";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}
