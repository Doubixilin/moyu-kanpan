import type { MarketSessionState } from "./types.js";

const shanghaiClock = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  weekday: "short",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23"
});

// SSE 官方休市日历，按年份维护：
// https://www.sse.com.cn/disclosure/dealinstruc/closed/c/c_20251222_10802510.shtml
// 新增年份时必须在下面补上该年的休市日；否则该年会落入"日历未收录"状态，
// 由 isTradingCalendarVerified() 暴露给调用方作为可见告警。
const OFFICIAL_HOLIDAYS: Record<string, readonly string[]> = {
  "2026": [
    "2026-01-01",
    "2026-01-02",
    "2026-01-03",
    "2026-02-15",
    "2026-02-16",
    "2026-02-17",
    "2026-02-18",
    "2026-02-19",
    "2026-02-20",
    "2026-02-21",
    "2026-02-22",
    "2026-02-23",
    "2026-04-04",
    "2026-04-05",
    "2026-04-06",
    "2026-05-01",
    "2026-05-02",
    "2026-05-03",
    "2026-05-04",
    "2026-05-05",
    "2026-06-19",
    "2026-06-20",
    "2026-06-21",
    "2026-09-25",
    "2026-09-26",
    "2026-09-27",
    "2026-10-01",
    "2026-10-02",
    "2026-10-03",
    "2026-10-04",
    "2026-10-05",
    "2026-10-06",
    "2026-10-07"
  ]
};

/** 已收录官方休市日历的年份，升序。 */
export const COVERED_HOLIDAY_YEARS: readonly number[] = Object.keys(OFFICIAL_HOLIDAYS)
  .map(Number)
  .sort((left, right) => left - right);

const holidaySets = new Map<string, ReadonlySet<string>>(
  Object.entries(OFFICIAL_HOLIDAYS).map(([year, days]) => [year, new Set(days)])
);

function shanghaiParts(at: Date): Record<string, string> {
  return Object.fromEntries(shanghaiClock.formatToParts(at).map((part) => [part.type, part.value]));
}

/**
 * 该日期所属年份是否已收录官方休市日历。
 *
 * 未收录时 getAShareMarketState 只能退化为"工作日 + 时段"判断，休市日会被当作交易日，
 * 因此调用方应把它当作可见告警暴露给用户，而不是静默降级。
 */
export function isTradingCalendarVerified(at: Date): boolean {
  return holidaySets.has(shanghaiParts(at).year ?? "");
}

export function getAShareMarketState(at: Date): MarketSessionState {
  const parts = shanghaiParts(at);
  if (parts.weekday === "Sat" || parts.weekday === "Sun") return "weekend";

  const dateKey = `${parts.year}-${parts.month}-${parts.day}`;
  if (holidaySets.get(parts.year ?? "")?.has(dateKey)) return "holiday";

  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  if (minutes < 9 * 60 + 30) return "preopen";
  if (minutes < 11 * 60 + 30) return "trading";
  if (minutes < 13 * 60) return "lunch";
  if (minutes < 15 * 60) return "trading";
  return "closed";
}

export function isAShareTradingSession(at: Date): boolean {
  return getAShareMarketState(at) === "trading";
}

/**
 * 上海时区的 YYYY-MM-DD。
 *
 * 交易所接口（巨潮/上交所/深交所）的日期窗口必须使用上海日期：用 UTC 日期会在
 * 上海时间 08:00 之前把窗口整体前移一天，漏掉上海午夜之后发布的公告，随后空结果
 * 还会被误判为抓取失败并触发退避。
 */
export function shanghaiDateKey(at: Date): string {
  const parts = shanghaiParts(at);
  return `${parts.year}-${parts.month}-${parts.day}`;
}
