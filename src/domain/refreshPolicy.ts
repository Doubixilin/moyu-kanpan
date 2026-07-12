import type { MarketSessionState } from "./types.js";
import type { RefreshMode } from "../config.js";

export interface QuoteRefreshContext {
  marketState: MarketSessionState;
  foreground: boolean;
  mode?: RefreshMode;
}

export const FOREGROUND_QUOTE_INTERVAL_MS = 3_000;
export const BACKGROUND_QUOTE_INTERVAL_MS = 5_000;
export const IDLE_QUOTE_INTERVAL_MS = 60_000;
export const STANDARD_FOREGROUND_QUOTE_INTERVAL_MS = 5_000;
export const STANDARD_BACKGROUND_QUOTE_INTERVAL_MS = 8_000;
export const FAST_INDEX_INTERVAL_MS = 5_000;
export const HEAVY_MARKET_INTERVAL_MS = 15_000;

export function quoteTargetIntervalMs(context: QuoteRefreshContext): number {
  if (context.marketState !== "trading") return IDLE_QUOTE_INTERVAL_MS;
  if (context.mode === "standard") {
    return context.foreground
      ? STANDARD_FOREGROUND_QUOTE_INTERVAL_MS
      : STANDARD_BACKGROUND_QUOTE_INTERVAL_MS;
  }
  return context.foreground
    ? FOREGROUND_QUOTE_INTERVAL_MS
    : BACKGROUND_QUOTE_INTERVAL_MS;
}

export function startToStartDelayMs(
  targetIntervalMs: number,
  elapsedMs: number,
  random = Math.random
): number {
  const safeTarget = Math.max(250, Math.round(targetIntervalMs));
  const safeElapsed = Math.max(0, Math.round(elapsedMs));
  const jitter = 0.95 + Math.min(1, Math.max(0, random())) * 0.1;
  return Math.max(100, Math.round(safeTarget * jitter) - safeElapsed);
}
