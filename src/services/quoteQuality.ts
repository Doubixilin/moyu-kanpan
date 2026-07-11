import type { Quote } from "../domain/types.js";

export interface QuoteValidationContext {
  marketOpen: boolean;
  nowMs?: number;
  maxSourceAgeMs?: number;
}

export interface QuoteValidation {
  quote: Quote;
  issues: string[];
  usable: boolean;
  trusted: boolean;
}

const DEFAULT_MAX_SOURCE_AGE_MS = 90_000;
const FUTURE_TOLERANCE_MS = 5 * 60_000;
const NON_CRITICAL_ISSUES = new Set(["source_stale", "missing_timestamp"]);

export function validateQuote(
  quote: Quote,
  expectedCode: string,
  context: QuoteValidationContext
): QuoteValidation {
  const issues: string[] = [];
  const nowMs = context.nowMs ?? Date.now();
  const maxSourceAgeMs = context.maxSourceAgeMs ?? DEFAULT_MAX_SOURCE_AGE_MS;

  if (quote.code !== expectedCode) issues.push("code_mismatch");
  if (!positive(quote.price)) issues.push("invalid_price");
  if (!positive(quote.previousClose)) issues.push("invalid_previous_close");
  if (!optionalNonNegative(quote.open)) issues.push("invalid_open");
  if (!optionalNonNegative(quote.high)) issues.push("invalid_high");
  if (!optionalNonNegative(quote.low)) issues.push("invalid_low");
  if (!optionalNonNegative(quote.volume)) issues.push("invalid_volume");
  if (!optionalNonNegative(quote.amount)) issues.push("invalid_amount");

  if (positive(quote.high) && positive(quote.low) && quote.high < quote.low) {
    issues.push("high_below_low");
  }
  if (positive(quote.price) && positive(quote.high) && positive(quote.low)) {
    const tolerance = Math.max(0.02, quote.price * 0.0002);
    if (quote.price > quote.high + tolerance || quote.price < quote.low - tolerance) {
      issues.push("price_outside_range");
    }
  }
  if (positive(quote.price) && positive(quote.previousClose) && quote.change != null) {
    const expectedChange = quote.price - quote.previousClose;
    const tolerance = Math.max(0.03, quote.price * 0.0002);
    if (!Number.isFinite(quote.change) || Math.abs(quote.change - expectedChange) > tolerance) {
      issues.push("change_mismatch");
    }
  }
  if (positive(quote.price) && positive(quote.previousClose) && quote.changePercent != null) {
    const expectedPercent = (quote.price - quote.previousClose) / quote.previousClose * 100;
    if (!Number.isFinite(quote.changePercent) ||
        Math.abs(quote.changePercent - expectedPercent) > 0.08) {
      issues.push("change_percent_mismatch");
    }
  }

  if (!quote.updatedAt) {
    if (context.marketOpen) issues.push("missing_timestamp");
  } else {
    const sourceMs = Date.parse(quote.updatedAt);
    if (!Number.isFinite(sourceMs)) {
      issues.push("invalid_timestamp");
    } else if (sourceMs - nowMs > FUTURE_TOLERANCE_MS) {
      issues.push("future_timestamp");
    } else if (context.marketOpen && nowMs - sourceMs > maxSourceAgeMs) {
      issues.push("source_stale");
    }
  }

  const usable = issues.every((issue) => NON_CRITICAL_ISSUES.has(issue));
  return {
    quote,
    issues,
    usable,
    trusted: usable && issues.length === 0
  };
}

export function quotesConflict(
  left: Quote,
  right: Quote,
  relativeTolerance = 0.003
): boolean {
  if (!positive(left.price) || !positive(right.price)) return false;
  const scale = Math.max(Math.abs(left.price), Math.abs(right.price), 1);
  return Math.abs(left.price - right.price) > Math.max(0.02, scale * relativeTolerance);
}

function positive(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function optionalNonNegative(value: number | null | undefined): boolean {
  return value == null || (Number.isFinite(value) && value >= 0);
}
