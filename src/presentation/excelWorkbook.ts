import type { AppSnapshot, Quote, QuoteQualityState } from "../domain/types.js";

export interface ExcelSheetData {
  id: "overview" | "tracking" | "activity" | "custom" | "trend";
  name: string;
  cells: Record<string, string | number>;
}

export function buildExcelWorkbook(snapshot: AppSnapshot): ExcelSheetData[] {
  const visibleCodes = snapshot.settings.watchlist
    .filter((item) => item.visible)
    .sort((a, b) => a.order - b.order)
    .slice(0, 10)
    .map((item) => item.securityCode);
  const quoteMap = new Map(snapshot.quotes.map((quote) => [quote.code, quote]));
  const securityMap = new Map(snapshot.settings.securities.map((security) => [security.code, security]));
  const visibleQuotes = visibleCodes.map((code) => ({
    code,
    quote: quoteMap.get(code),
    name: securityMap.get(code)?.alias || securityMap.get(code)?.name || quoteMap.get(code)?.name || code
  }));
  const overview = baseOverviewCells();
  const tracking = baseTrackingCells();
  const activity = baseActivityCells();

  visibleQuotes.forEach((item, index) => {
    const row = index + 4;
    const quote = item.quote;
    overview[`A${row}`] = index + 1;
    overview[`B${row}`] = item.name;
    overview[`C${row}`] = item.code;
    overview[`D${row}`] = numberOrDash(quote?.price);
    overview[`E${row}`] = percentOrDash(quote?.changePercent);
    overview[`F${row}`] = compactAmount(quote?.amount);
    overview[`G${row}`] = qualityLabel(quote?.quality?.state);
    overview[`H${row}`] = formatTime(quote?.updatedAt);
    overview[`I${row}`] = sourceLabel(quote?.source);
    overview[`J${row}`] = relatedEventTitle(snapshot, item.code);

    tracking[`A${row}`] = formatTime(quote?.updatedAt);
    tracking[`B${row}`] = item.name;
    tracking[`C${row}`] = numberOrDash(quote?.price);
    tracking[`D${row}`] = numberOrDash(quote?.open);
    tracking[`E${row}`] = numberOrDash(quote?.high);
    tracking[`F${row}`] = numberOrDash(quote?.low);
    tracking[`G${row}`] = percentOrDash(quote?.changePercent);
    tracking[`H${row}`] = qualityLabel(quote?.quality?.state);
    tracking[`I${row}`] = sourceLabel(quote?.source);
    tracking[`J${row}`] = compactAmount(quote?.amount);
  });

  snapshot.market.indices.slice(0, 3).forEach((item, index) => {
    const row = index + 17;
    overview[`A${row}`] = item.instrument.name;
    overview[`B${row}`] = numberOrDash(item.price);
    overview[`C${row}`] = percentOrDash(item.changePercent);
    overview[`D${row}`] = compactAmount(item.amount);
    overview[`E${row}`] = `${item.upCount ?? "--"}/${item.downCount ?? "--"}`;
    overview[`F${row}`] = sourceLabel(item.source);
    overview[`G${row}`] = formatTime(item.updatedAt ?? undefined);
  });

  snapshot.news.slice(0, 12).forEach((item, index) => {
    const row = index + 4;
    activity[`A${row}`] = formatTime(item.publishedAt);
    activity[`B${row}`] = tierLabel(item.sourceTier);
    activity[`C${row}`] = item.relatedCodes?.join("、") || "市场";
    activity[`D${row}`] = item.title;
    activity[`E${row}`] = priorityLabel(item.analysis?.priority);
    activity[`F${row}`] = materialLabel(item.materialStatus);
    activity[`G${row}`] = newsSourceLabel(item.sourceTier);
  });

  const upCount = visibleQuotes.filter((item) => (item.quote?.changePercent ?? 0) > 0).length;
  const downCount = visibleQuotes.filter((item) => (item.quote?.changePercent ?? 0) < 0).length;
  overview.A14 = "自选摘要";
  overview.A15 = "上涨";
  overview.B15 = upCount;
  overview.C15 = "下跌";
  overview.D15 = downCount;
  overview.E15 = "更新时间";
  overview.F15 = formatTime(snapshot.feeds.quotes.lastSuccessAt ?? undefined);
  overview.A16 = "市场指标";

  return [
    { id: "overview", name: "项目总览", cells: overview },
    { id: "tracking", name: "进度跟踪", cells: tracking },
    { id: "activity", name: "动态记录", cells: activity }
  ];
}

function baseOverviewCells(): Record<string, string | number> {
  return {
    A1: "2026年项目数据实时汇总",
    A3: "序号", B3: "项目名称", C3: "项目代码", D3: "当前值", E3: "日变化",
    F3: "累计量", G3: "当前状态", H3: "更新时间", I3: "数据源", J3: "最新动态"
  };
}

function baseTrackingCells(): Record<string, string | number> {
  return {
    A1: "项目实时进度跟踪表",
    A3: "时间", B3: "项目", C3: "当前值", D3: "起始值", E3: "最高值",
    F3: "最低值", G3: "变化", H3: "状态", I3: "来源", J3: "累计量"
  };
}

function baseActivityCells(): Record<string, string | number> {
  return {
    A1: "工作动态与事项记录",
    A3: "时间", B3: "类别", C3: "关联项目", D3: "事项摘要", E3: "优先级",
    F3: "材料状态", G3: "记录来源"
  };
}

function numberOrDash(value: number | null | undefined): string | number {
  return value == null ? "--" : value;
}

function percentOrDash(value: number | null | undefined): string {
  return value == null ? "--" : `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function compactAmount(value: number | null | undefined): string {
  if (value == null) return "--";
  if (Math.abs(value) >= 100_000_000) return `${(value / 100_000_000).toFixed(2)}亿`;
  if (Math.abs(value) >= 10_000) return `${(value / 10_000).toFixed(1)}万`;
  return String(Math.round(value));
}

function formatTime(value: string | undefined): string {
  if (!value) return "--:--";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "--:--"
    : date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function qualityLabel(state: QuoteQualityState | undefined): string {
  const labels: Record<QuoteQualityState, string> = {
    fresh: "正常",
    fallback: "备用",
    stale: "延迟",
    retained: "缓存",
    conflict: "冲突"
  };
  return state ? labels[state] : "等待";
}

function sourceLabel(source: Quote["source"] | undefined): string {
  if (source === "eastmoney") return "数据一";
  if (source === "tencent") return "数据二";
  if (source === "mixed") return "混合";
  if (source === "local") return "缓存";
  return "--";
}

function relatedEventTitle(snapshot: AppSnapshot, code: string): string {
  const event = snapshot.news.find((item) => item.relatedCodes?.includes(code));
  return event?.title ?? "持续监控";
}

function tierLabel(tier: AppSnapshot["news"][number]["sourceTier"]): string {
  if (tier === "official") return "正式材料";
  if (tier === "regulatory") return "监管动态";
  return "工作动态";
}

function priorityLabel(priority: "low" | "medium" | "high" | undefined): string {
  if (priority === "high") return "重要";
  if (priority === "medium") return "关注";
  return "普通";
}

function materialLabel(status: AppSnapshot["news"][number]["materialStatus"]): string {
  if (status === "full") return "完整";
  if (status === "title_only") return "标题";
  return "待补充";
}

function newsSourceLabel(tier: AppSnapshot["news"][number]["sourceTier"]): string {
  if (tier === "official") return "公开材料";
  if (tier === "regulatory") return "监管公开";
  return "信息汇总";
}
