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

// SSE official 2026 closure calendar:
// https://www.sse.com.cn/disclosure/dealinstruc/closed/c/c_20251222_10802510.shtml
const OFFICIAL_HOLIDAYS = new Set([
  "2026-01-01", "2026-01-02", "2026-01-03",
  "2026-02-15", "2026-02-16", "2026-02-17", "2026-02-18", "2026-02-19",
  "2026-02-20", "2026-02-21", "2026-02-22", "2026-02-23",
  "2026-04-04", "2026-04-05", "2026-04-06",
  "2026-05-01", "2026-05-02", "2026-05-03", "2026-05-04", "2026-05-05",
  "2026-06-19", "2026-06-20", "2026-06-21",
  "2026-09-25", "2026-09-26", "2026-09-27",
  "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05",
  "2026-10-06", "2026-10-07"
]);

export function getAShareMarketState(at: Date): MarketSessionState {
  const parts = Object.fromEntries(
    shanghaiClock.formatToParts(at).map((part) => [part.type, part.value])
  );
  if (parts.weekday === "Sat" || parts.weekday === "Sun") return "weekend";

  const dateKey = `${parts.year}-${parts.month}-${parts.day}`;
  if (OFFICIAL_HOLIDAYS.has(dateKey)) return "holiday";

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

export function quotePollDelayMs(
  at: Date,
  activeIntervalMs: number,
  idleIntervalMs = 60_000,
  random = Math.random
): number {
  if (!isAShareTradingSession(at)) return idleIntervalMs;
  const jitter = 0.9 + Math.min(1, Math.max(0, random())) * 0.2;
  return Math.round(activeIntervalMs * jitter);
}
